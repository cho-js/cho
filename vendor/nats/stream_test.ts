/**
 * Tests for `stream.ts`: what the adapter does with the messages of a
 * JetStream stream. It finds the routes of a stream, makes a durable consumer
 * for each, acknowledges a message that was handled, has a failed one
 * delivered again, sends a dead one to its dead-letter subject or ends it,
 * and leaves unacknowledged what did not finish.
 *
 * A fake JetStream client stands for the client library: these tests need no
 * server, and run on every runtime. `nats_test.ts` has the tests with a
 * server.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { type Debuglog, make_error } from "@chojs/core/utils";
import type { Delivery, Reply, Route } from "@chojs/message/linker";
import {
  type NatsConnectionLike,
  type NatsMessageLike,
  type NatsSubscriptionLike,
  Pump,
  type PumpSettings,
} from "./consume.ts";
import {
  consumer_name,
  type ConsumerSettings,
  DEAD_LETTER_HEADERS,
  type JetStreamClientLike,
  type JetStreamMessageLike,
  type JetStreamMessagesLike,
  type NatsStreamNative,
  type StreamSettings,
  subject_matches,
  to_stream_delivery,
} from "./stream.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** What was done with a message: `ack`, `nak 1000`, `term <reason>`. */
type Settled = string[];

/** A message of a stream. What is done with it is recorded in `settled`. */
function message(
  value: string,
  { subject = "orders.created", seq = 1, attempt = 1, headers }: {
    subject?: string;
    seq?: number;
    attempt?: number;
    headers?: [string, string[]][];
  } = {},
): JetStreamMessageLike & { settled: Settled } {
  const settled: Settled = [];
  return {
    subject,
    data: encoder.encode(value),
    headers,
    seq,
    info: { deliveryCount: attempt },
    settled,
    ack: () => void settled.push("ack"),
    nak: (millis) => void settled.push(`nak ${millis}`),
    term: (reason) => void settled.push(`term ${reason}`),
  };
}

/** The messages of a consumer, which the test feeds. */
class FakeMessages implements JetStreamMessagesLike {
  readonly #queue: (JetStreamMessageLike | Error | null)[] = [];
  #wake: (() => void) | undefined;
  closed = 0;
  close_error: Error | undefined;

  /** Give a message, an error that ends the consumer, or `null`: its end. */
  push(...items: (JetStreamMessageLike | Error | null)[]) {
    this.#queue.push(...items);
    this.#wake?.();
  }

  close() {
    this.closed++;
    if (this.close_error) {
      return Promise.reject(this.close_error);
    }
    this.push(null);
    return Promise.resolve();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<JetStreamMessageLike> {
    while (true) {
      while (this.#queue.length === 0) {
        await new Promise<void>((resolve) => (this.#wake = resolve));
      }
      const item = this.#queue.shift()!;
      if (item === null) {
        return;
      }
      if (item instanceof Error) {
        throw item;
      }
      yield item;
    }
  }
}

/** A dead letter, or any message that was published. */
type Published = {
  subject: string;
  value: string;
  headers: Record<string, string>;
};

/** A JetStream client on streams the test declares. */
class FakeJetStream implements JetStreamClientLike {
  /** The subjects of each stream of the server. */
  readonly streams: Record<string, string[]>;
  /** The consumers that were made: their stream, and their settings. */
  readonly made: [string, ConsumerSettings][] = [];
  /** The messages of each consumer, by its name. */
  readonly feeds = new Map<string, FakeMessages>();
  /** What `consume` was asked for, by the name of the consumer. */
  readonly consumed = new Map<string, unknown>();
  readonly published: Published[] = [];
  manager_error: Error | undefined;
  add_error: Error | undefined;
  publish_error: Error | undefined;

  constructor(streams: Record<string, string[]>) {
    this.streams = streams;
  }

  /** The messages of the consumer of a topic, in the queue group `group`. */
  of(topic: string, queue = "group"): FakeMessages {
    const feed = this.feeds.get(consumer_name(queue, topic));
    assert.ok(feed, `no consumer for ${topic}`);
    return feed;
  }

  readonly consumers = {
    get: (_stream: string, name: string) =>
      Promise.resolve({
        consume: (options?: { max_messages?: number }) => {
          this.consumed.set(name, options);
          const feed = new FakeMessages();
          this.feeds.set(name, feed);
          return Promise.resolve(feed);
        },
      }),
  };

  publish(
    subject: string,
    data?: Uint8Array,
    options?: { headers?: Iterable<[string, string[]]> },
  ) {
    if (this.publish_error) {
      return Promise.reject(this.publish_error);
    }
    this.published.push({
      subject,
      value: decoder.decode(data),
      headers: Object.fromEntries(
        [...(options?.headers ?? [])].map(([name, values]) => [
          name,
          values.join(","),
        ]),
      ),
    });
    return Promise.resolve();
  }

  jetstreamManager() {
    if (this.manager_error) {
      return Promise.reject(this.manager_error);
    }
    return Promise.resolve({
      streams: {
        info: (stream: string) =>
          stream in this.streams
            ? Promise.resolve({ config: { subjects: this.streams[stream]! } })
            : Promise.reject(new Error("stream not found")),
      },
      consumers: {
        add: (stream: string, config: ConsumerSettings) => {
          if (this.add_error) {
            return Promise.reject(this.add_error);
          }
          this.made.push([stream, config]);
          return Promise.resolve();
        },
      },
    });
  }
}

/** A connection that keeps the subjects it is subscribed to. */
function connection_of() {
  const subscribed: string[] = [];
  const ends: (() => void)[] = [];
  let closed = false;
  let close!: () => void;
  const done = new Promise<void>((resolve) => (close = resolve));
  const connection = {
    subscribed,
    drained: 0,
    subscribe(subject: string): NatsSubscriptionLike {
      subscribed.push(subject);
      let end!: () => void;
      const ended = new Promise<void>((resolve) => (end = resolve));
      ends.push(end);
      return {
        drain() {
          end();
          return Promise.resolve();
        },
        [Symbol.asyncIterator](): AsyncIterator<NatsMessageLike> {
          // No message: it ends when the subscription is drained.
          return {
            next: async () => {
              await ended;
              return { done: true, value: undefined };
            },
          };
        },
      };
    },
    publish() {},
    request: (): Promise<NatsMessageLike> =>
      Promise.reject(new Error("not used")),
    flush: () => Promise.resolve(),
    drain() {
      connection.drained++;
      closed = true;
      ends.forEach((end) => end());
      close();
      return Promise.resolve();
    },
    closed: () => done,
    isClosed: () => closed,
  } satisfies NatsConnectionLike & Record<string, unknown>;
  return connection;
}

/** A route that calls `handler` with the text of the value. */
function route(
  topic: string,
  handler: (
    text: string,
    native: NatsStreamNative,
    delivery: Delivery,
  ) => unknown = () => undefined,
): Route {
  return {
    topic,
    name: `Test.${topic}`,
    handle: async (delivery, native) => {
      const text = decoder.decode(delivery.value as Uint8Array);
      const result = await handler(text, native as NatsStreamNative, delivery);
      return result === undefined
        ? undefined
        : { value: encoder.encode(String(result)) } as Reply;
    },
  };
}

/** A debug logger that keeps its lines. */
function recorder() {
  const lines: string[] = [];
  /** The errors that were logged. */
  const errors: unknown[] = [];
  const text = (args: unknown[]) =>
    args.map((arg) => arg instanceof Error ? arg.message : String(arg))
      .join(" ");
  const log = Object.assign(
    (...args: unknown[]) => void lines.push(text(args)),
    {
      error: (...args: unknown[]) => {
        errors.push(...args.filter((arg) => arg instanceof Error));
        lines.push(`ERROR ${text(args)}`);
      },
      start: () => () => {},
      enabled: true,
    },
  ) satisfies Debuglog;
  return { log, lines, errors };
}

/** A pump with streams, on a fake connection and a fake JetStream client. */
function pump_of(
  routes: Route[],
  streams: Record<string, string[]> = { ORDERS: ["orders.>"] },
  settings: Partial<StreamSettings> = {},
  pump_settings: Partial<PumpSettings> = {},
) {
  const connection = connection_of();
  const jetstream = new FakeJetStream(streams);
  const fatal: Error[] = [];
  const delays: number[] = [];
  const given: unknown[] = [];
  const { log, lines, errors } = recorder();
  const concurrency = pump_settings.concurrency ?? 1;
  const pump = new Pump(routes, () => connection, {
    queue: "group",
    concurrency,
    errorReply: undefined,
    onFatal: (error) => void fatal.push(error),
    log,
    jetstream: {
      client: (nc: unknown) => {
        given.push(nc);
        return jetstream;
      },
      streams: Object.keys(streams),
      queue: "group",
      concurrency,
      retries: 2,
      retryDelay: (retry) => {
        delays.push(retry);
        return retry * 100;
      },
      deadLetter: undefined,
      ackWait: 30_000,
      log,
      ...settings,
    },
    ...pump_settings,
  });
  return { pump, connection, jetstream, fatal, delays, given, lines, errors };
}

/** Resolves when `done()` is true. */
async function until(done: () => boolean) {
  for (let i = 0; !done(); i++) {
    if (i > 2000) {
      throw new Error("timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
}

/** A promise, and what settles it. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** The code of an error of the framework. */
const code_of = (error: unknown) => (error as { code?: string } | null)?.code;

/** The error of a message that is not valid, as `@chojs/message` makes it. */
function invalid_message(text = "not valid"): Error {
  return make_error(
    "CHO_MESSAGE_INVALID_MESSAGE",
    text,
    undefined,
    invalid_message,
  );
}

describe("subject_matches", () => {
  it("matches a subject with itself", () => {
    assert.equal(subject_matches("orders.created", "orders.created"), true);
    assert.equal(subject_matches("orders.created", "orders.cancelled"), false);
    assert.equal(subject_matches("orders", "orders.created"), false);
    assert.equal(subject_matches("orders.created", "orders"), false);
  });

  it("matches one token with *", () => {
    assert.equal(subject_matches("orders.*", "orders.created"), true);
    assert.equal(subject_matches("*.created", "orders.created"), true);
    assert.equal(subject_matches("orders.*", "orders"), false);
    assert.equal(subject_matches("orders.*", "orders.eu.created"), false);
    assert.equal(
      subject_matches("orders.*.created", "orders.eu.created"),
      true,
    );
  });

  it("matches every token that is left, and at least one, with >", () => {
    assert.equal(subject_matches("orders.>", "orders.created"), true);
    assert.equal(subject_matches("orders.>", "orders.eu.created"), true);
    assert.equal(subject_matches("orders.>", "orders"), false);
    assert.equal(subject_matches(">", "orders"), true);
    assert.equal(subject_matches("orders.*.>", "orders.eu.created"), true);
    assert.equal(subject_matches("orders.*.>", "orders.eu"), false);
  });
});

describe("consumer_name", () => {
  it("joins the queue group and the topic, with no dot", () => {
    assert.equal(
      consumer_name("shop", "orders.created"),
      "shop_orders_created",
    );
    assert.equal(consumer_name("shop.eu", "orders"), "shop_eu_orders");
    assert.equal(consumer_name("a/b", "c-d_e"), "a_b_c-d_e");
  });
});

describe("to_stream_delivery", () => {
  it("gives the payload as the value, and the first value of each header", () => {
    assert.deepEqual(
      to_stream_delivery(
        message("hello", { headers: [["a", ["1", "2"]], ["b", ["3"]]] }),
      ),
      { value: encoder.encode("hello"), headers: { a: "1", b: "3" } },
    );
    assert.deepEqual(to_stream_delivery(message("")), {
      value: new Uint8Array(0),
      headers: {},
    });
  });
});

describe("StreamReader: starting", () => {
  it("makes a durable consumer for each route of a stream", async () => {
    const { pump, connection, jetstream, given } = pump_of(
      [route("orders.created"), route("orders.eu.paid")],
      { ORDERS: ["orders.>"] },
      { ackWait: 5000 },
      { concurrency: 4 },
    );
    await pump.start();
    assert.deepEqual(given, [connection]);
    assert.deepEqual(jetstream.made, [
      ["ORDERS", {
        durable_name: "group_orders_created",
        ack_policy: "explicit",
        filter_subject: "orders.created",
        ack_wait: 5_000_000_000,
        max_deliver: -1,
        max_ack_pending: 4,
      }],
      ["ORDERS", {
        durable_name: "group_orders_eu_paid",
        ack_policy: "explicit",
        filter_subject: "orders.eu.paid",
        ack_wait: 5_000_000_000,
        max_deliver: -1,
        max_ack_pending: 4,
      }],
    ]);
    assert.deepEqual([...jetstream.consumed], [
      ["group_orders_created", { max_messages: 4 }],
      ["group_orders_eu_paid", { max_messages: 4 }],
    ]);
    // A route of a stream is not subscribed to.
    assert.deepEqual(connection.subscribed, []);
    await pump.stop();
  });

  it("subscribes to the routes that are of no stream", async () => {
    const { pump, connection, jetstream } = pump_of(
      [route("orders.created"), route("prices.get"), route("orders")],
    );
    await pump.start();
    assert.deepEqual(jetstream.made.map(([, made]) => made.filter_subject), [
      "orders.created",
    ]);
    assert.deepEqual(connection.subscribed, ["prices.get", "orders"]);
    await pump.stop();
  });

  it("gives a route to the first stream that holds its subject", async () => {
    const { pump, jetstream, lines } = pump_of(
      [route("orders.created"), route("payments.done")],
      {
        ORDERS: ["orders.created", "orders.cancelled"],
        ALL: ["orders.>", "payments.*"],
        EMPTY: ["nothing.here"],
      },
    );
    await pump.start();
    assert.deepEqual(
      jetstream.made.map(([stream, made]) => [stream, made.filter_subject]),
      [["ORDERS", "orders.created"], ["ALL", "payments.done"]],
    );
    assert.match(
      lines.join("\n"),
      /the stream "EMPTY" holds no topic of the application/,
    );
    await pump.stop();
  });

  it("rejects when JetStream cannot be reached", async () => {
    const { pump, jetstream } = pump_of([route("orders.created")]);
    jetstream.manager_error = new Error("jetstream not enabled");
    await assert.rejects(pump.start(), {
      code: "CHO_NATS_STREAM_NOT_FOUND",
      message:
        "NatsLinker: JetStream cannot be reached: is it enabled on the server?",
      cause: jetstream.manager_error,
    });
    await pump.stop();
  });

  it("rejects for a stream that does not exist", async () => {
    const { pump, connection, jetstream } = pump_of(
      [route("orders.created")],
      { ORDERS: ["orders.>"] },
      { streams: ["ORDERS", "PAYMENTS"] },
    );
    await assert.rejects(pump.start(), {
      code: "CHO_NATS_STREAM_NOT_FOUND",
      message:
        'NatsLinker: the stream "PAYMENTS" cannot be read: create it before the application starts, the adapter does not',
    });
    // Nothing was made, or subscribed to.
    assert.deepEqual(jetstream.made, []);
    assert.deepEqual(connection.subscribed, []);
    await pump.stop();
    assert.equal(connection.drained, 1);
  });

  it("rejects when a consumer cannot be made, and reads nothing", async () => {
    let handled = 0;
    const { pump, jetstream } = pump_of([
      route("orders.created", () => void handled++),
    ]);
    jetstream.add_error = new Error("insufficient resources");
    await assert.rejects(pump.start(), {
      code: "CHO_NATS_CONSUMER_FAILED",
      message:
        'NatsLinker: cannot make the consumer "group_orders_created" of Test.orders.created, on "orders.created" of the stream "ORDERS"',
      cause: jetstream.add_error,
    });
    assert.equal(handled, 0);
    await pump.stop();
  });

  it("rejects for two topics that have the same consumer name", async () => {
    const { pump } = pump_of([route("orders.a_b"), route("orders.a.b")]);
    await assert.rejects(pump.start(), {
      code: "CHO_NATS_DUPLICATE_CONSUMER",
      message:
        'NatsLinker: the topics "orders.a_b" and "orders.a.b" have the same consumer name, "group_orders_a_b": a "." of a topic is a "_" of the name. Rename one of them',
    });
    await pump.stop();
  });

  it("rejects when the client option gives no JetStream client", async () => {
    for (const given of [undefined, null, {}, { publish() {} }]) {
      const { pump } = pump_of([route("orders.created")], undefined, {
        client: () => given as never,
      });
      await assert.rejects(pump.start(), {
        code: "CHO_NATS_INVALID_JETSTREAM",
        message:
          /^NatsLinker: the "client" option of "jetstream" did not give a JetStream client/,
      });
      await pump.stop();
    }
  });
});

describe("StreamReader: a message", () => {
  it("is given to its route, with the message and the attempt, then acknowledged", async () => {
    const seen: [string, NatsStreamNative, Delivery][] = [];
    const { pump, jetstream } = pump_of([
      route("orders.created", (text, native, delivery) => {
        seen.push([text, native, delivery]);
      }),
    ]);
    await pump.start();
    const one = message("first", { attempt: 2, headers: [["trace", ["t1"]]] });
    jetstream.of("orders.created").push(one);
    await until(() => one.settled.length > 0);
    assert.deepEqual(one.settled, ["ack"]);
    const [text, native, delivery] = seen[0]!;
    assert.equal(text, "first");
    assert.equal(native.message, one);
    assert.equal(native.attempt, 2);
    assert.deepEqual(delivery.headers, { trace: "t1" });
    assert.equal("key" in delivery, false);
    await pump.stop();
  });

  it("is acknowledged when its handler gave a reply, which is dropped", async () => {
    const { pump, jetstream, lines } = pump_of([
      route("orders.created", () => "a reply"),
    ]);
    await pump.start();
    const messages = [message("a"), message("b", { seq: 2 })];
    jetstream.of("orders.created").push(...messages);
    await until(() => messages.every((one) => one.settled.length > 0));
    assert.deepEqual(messages.map((one) => one.settled), [["ack"], ["ack"]]);
    assert.equal(
      lines.filter((line) =>
        /it has nobody to answer, and is dropped/.test(line)
      )
        .length,
      1,
    );
    await pump.stop();
  });

  it("is delivered again after the delay when it failed", async () => {
    const { pump, jetstream, delays, lines, fatal } = pump_of([
      route("orders.created", () => {
        throw new Error("boom");
      }),
    ]);
    await pump.start();
    const first = message("bad", { attempt: 1 });
    const second = message("bad", { attempt: 2 });
    jetstream.of("orders.created").push(first, second);
    await until(() => second.settled.length > 0);
    assert.deepEqual(first.settled, ["nak 100"]);
    assert.deepEqual(second.settled, ["nak 200"]);
    assert.deepEqual(delays, [1, 2]);
    assert.match(lines.join("\n"), /\(attempt 1 of 3\): boom/);
    assert.deepEqual(fatal, []);
    await pump.stop();
  });

  it("is ended after the retries, when there is no dead-letter subject", async () => {
    const { pump, jetstream, lines, fatal } = pump_of([
      route("orders.created", (text) => {
        if (text === "bad") {
          throw new Error("boom");
        }
      }),
    ]);
    await pump.start();
    const dead = message("bad", { attempt: 3, seq: 7 });
    const next = message("good", { seq: 8 });
    jetstream.of("orders.created").push(dead, next);
    await until(() => next.settled.length > 0);
    assert.deepEqual(dead.settled, ["term failed after 3 attempt(s)"]);
    assert.deepEqual(jetstream.published, []);
    assert.match(
      lines.join("\n"),
      /Test\.orders\.created failed for orders\.created@7 after 3 attempt\(s\), and there is no dead-letter subject/,
    );
    // The consumer goes on.
    assert.deepEqual(next.settled, ["ack"]);
    assert.deepEqual(fatal, []);
    await pump.stop();
  });

  it("is sent to its dead-letter subject after the retries, then ended", async () => {
    const { pump, jetstream, fatal } = pump_of(
      [route("orders.created", () => {
        throw new Error("no\nstock");
      })],
      undefined,
      { deadLetter: (topic) => `dead.${topic}` },
    );
    await pump.start();
    const dead = message("bad", {
      attempt: 3,
      seq: 42,
      headers: [["trace", ["t1", "t2"]]],
    });
    jetstream.of("orders.created").push(dead);
    await until(() => dead.settled.length > 0);
    assert.deepEqual(dead.settled, [
      "term sent to dead.orders.created after 3 attempt(s)",
    ]);
    assert.deepEqual(jetstream.published, [{
      subject: "dead.orders.created",
      value: "bad",
      headers: {
        trace: "t1,t2",
        [DEAD_LETTER_HEADERS.topic]: "orders.created",
        [DEAD_LETTER_HEADERS.stream]: "ORDERS",
        [DEAD_LETTER_HEADERS.sequence]: "42",
        [DEAD_LETTER_HEADERS.consumer]: "group_orders_created",
        [DEAD_LETTER_HEADERS.attempts]: "3",
        [DEAD_LETTER_HEADERS.error]: "no stock",
      },
    }]);
    assert.deepEqual(fatal, []);
    await pump.stop();
  });

  it("is not ended, and is delivered again, when the dead letter cannot be sent", async () => {
    const { pump, jetstream, lines, errors, fatal } = pump_of(
      [route("orders.created", () => {
        throw new Error("boom");
      })],
      undefined,
      { deadLetter: () => "dead.orders" },
    );
    jetstream.publish_error = new Error("no stream matches subject");
    await pump.start();
    const dead = message("bad", { attempt: 5, seq: 9 });
    jetstream.of("orders.created").push(dead);
    await until(() => dead.settled.length > 0);
    assert.deepEqual(dead.settled, ["nak 500"]);
    assert.equal(code_of(errors[0]), "CHO_NATS_DEAD_LETTER_FAILED");
    assert.equal((errors[0] as Error).cause, jetstream.publish_error);
    assert.match(
      lines.join("\n"),
      /NatsLinker: cannot send orders\.created@9 to the dead-letter subject "dead\.orders": is it a subject of a stream\? The message is delivered again/,
    );
    assert.deepEqual(fatal, []);
    await pump.stop();
  });

  it("is never delivered again when it is not valid: it is dead at once", async () => {
    const invalid = invalid_message(
      "Invalid message of orders.created: the value is not valid",
    );
    const failing = () =>
      route("orders.created", () => {
        throw invalid;
      });
    // With a dead-letter subject: sent there, on the first attempt.
    const with_dead = pump_of([failing()], undefined, {
      deadLetter: () => "dead.orders",
    });
    await with_dead.pump.start();
    const one = message("bad", { attempt: 1 });
    with_dead.jetstream.of("orders.created").push(one);
    await until(() => one.settled.length > 0);
    assert.deepEqual(one.settled, [
      "term sent to dead.orders after 1 attempt(s)",
    ]);
    assert.equal(
      with_dead.jetstream.published[0]!.headers[DEAD_LETTER_HEADERS.attempts],
      "1",
    );
    assert.deepEqual(with_dead.delays, []);
    await with_dead.pump.stop();
    // Without one: ended.
    const without = pump_of([failing()]);
    await without.pump.start();
    const two = message("bad", { attempt: 1 });
    without.jetstream.of("orders.created").push(two);
    await until(() => two.settled.length > 0);
    assert.deepEqual(two.settled, ["term failed after 1 attempt(s)"]);
    await without.pump.stop();
  });

  it("does not try again with no retries", async () => {
    const { pump, jetstream } = pump_of(
      [route("orders.created", () => {
        throw new Error("boom");
      })],
      undefined,
      { retries: 0 },
    );
    await pump.start();
    const one = message("bad", { attempt: 1 });
    jetstream.of("orders.created").push(one);
    await until(() => one.settled.length > 0);
    assert.deepEqual(one.settled, ["term failed after 1 attempt(s)"]);
    await pump.stop();
  });
});

describe("StreamReader: concurrency", () => {
  it("handles the messages of a route one at a time by default", async () => {
    const order: string[] = [];
    let running = 0;
    let most = 0;
    const { pump, jetstream } = pump_of([
      route("orders.created", async (text) => {
        most = Math.max(most, ++running);
        order.push(`start ${text}`);
        await new Promise((resolve) => setTimeout(resolve, 2));
        order.push(`end ${text}`);
        running--;
      }),
    ]);
    await pump.start();
    const messages = ["a", "b", "c"].map((text, seq) => message(text, { seq }));
    jetstream.of("orders.created").push(...messages);
    await until(() => messages.every((one) => one.settled.length > 0));
    assert.equal(most, 1);
    assert.deepEqual(order, [
      "start a",
      "end a",
      "start b",
      "end b",
      "start c",
      "end c",
    ]);
    await pump.stop();
  });

  it("handles `concurrency` messages of a route at once", async () => {
    const gate = deferred();
    let running = 0;
    let most = 0;
    const { pump, jetstream } = pump_of(
      [route("orders.created", async () => {
        most = Math.max(most, ++running);
        await gate.promise;
        running--;
      })],
      undefined,
      {},
      { concurrency: 2 },
    );
    await pump.start();
    const messages = ["a", "b", "c"].map((text, seq) => message(text, { seq }));
    jetstream.of("orders.created").push(...messages);
    await until(() => running === 2);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(running, 2);
    gate.resolve();
    await until(() => messages.every((one) => one.settled.length > 0));
    assert.equal(most, 2);
    await pump.stop();
  });
});

describe("StreamReader: stopping", () => {
  it("waits for the message in hand, acknowledges it, and leaves the next", async () => {
    const gate = deferred();
    const { pump, connection, jetstream } = pump_of([
      route("orders.created", async () => {
        await gate.promise;
      }),
    ]);
    await pump.start();
    const feed = jetstream.of("orders.created");
    const in_hand = message("a");
    const waiting = message("b", { seq: 2 });
    feed.push(in_hand, waiting);
    await new Promise((resolve) => setTimeout(resolve, 5));
    let stopped = false;
    const stopping = pump.stop().then(() => (stopped = true));
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(stopped, false);
    assert.equal(feed.closed, 1);
    assert.equal(connection.drained, 0);
    gate.resolve();
    await stopping;
    assert.deepEqual(in_hand.settled, ["ack"]);
    // Not handled, and not acknowledged: JetStream delivers it again.
    assert.deepEqual(waiting.settled, []);
    assert.equal(connection.drained, 1);
  });

  it("goes on stopping when a consumer fails to close", async () => {
    const { pump, connection, jetstream, lines } = pump_of([
      route("orders.created"),
    ]);
    await pump.start();
    const feed = jetstream.of("orders.created");
    feed.close_error = new Error("already closed");
    const stopping = pump.stop();
    feed.push(null);
    await stopping;
    assert.match(
      lines.join("\n"),
      /cannot close the consumer "group_orders_created": already closed/,
    );
    assert.equal(connection.drained, 1);
  });
});

describe("StreamReader: stopping by itself", () => {
  it("stops when a consumer fails, and tells the application once", async () => {
    const cause = new Error("consumer deleted");
    const { pump, connection, jetstream, fatal } = pump_of([
      route("orders.created"),
      route("orders.paid"),
    ]);
    await pump.start();
    jetstream.of("orders.created").push(cause);
    await until(() => fatal.length > 0);
    assert.equal(code_of(fatal[0]), "CHO_NATS_SUBSCRIPTION_FAILED");
    assert.equal(fatal[0]!.cause, cause);
    assert.equal(
      fatal[0]!.message,
      'NatsLinker: the consumer "group_orders_created" of Test.orders.created, on "orders.created" of the stream "ORDERS", failed: the application stopped',
    );
    assert.equal(jetstream.of("orders.paid").closed, 1);
    assert.equal(connection.drained, 1);
    assert.equal(fatal.length, 1);
  });

  it("stops when a consumer ends by itself", async () => {
    const { pump, jetstream, fatal } = pump_of([route("orders.created")]);
    await pump.start();
    jetstream.of("orders.created").push(null);
    await until(() => fatal.length > 0);
    assert.equal(code_of(fatal[0]), "CHO_NATS_SUBSCRIPTION_FAILED");
    assert.match(fatal[0]!.message, /, ended: the application stopped$/);
    await pump.stop();
  });
});
