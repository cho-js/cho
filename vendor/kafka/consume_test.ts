/**
 * Tests for `consume.ts`: what the adapter does with the messages of Kafka.
 * It gives each one to the route of its topic and commits it, tries a failed
 * one again, sends a dead one to its dead-letter topic or stops, keeps the
 * order of a partition, and leaves uncommitted what did not finish.
 *
 * A fake consumer and a fake producer stand for the client library: these
 * tests need no broker, and run on every runtime. `kafka_test.ts` has the
 * tests with a broker.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { debuglog, make_error } from "@chojs/core/utils";
import type { Delivery, Route } from "@chojs/message/linker";
import {
  DEAD_LETTER_HEADERS,
  type KafkaConsumeOptionsLike,
  type KafkaConsumerLike,
  type KafkaMessage,
  type KafkaMessageToProduce,
  type KafkaNative,
  type KafkaProducerLike,
  type KafkaStreamLike,
  Pump,
  type PumpSettings,
  to_dead_letter,
  to_delivery,
} from "./consume.ts";

/** A stream of messages the test feeds. */
class FakeStream implements KafkaStreamLike {
  readonly #queue: (KafkaMessage | Error | null)[] = [];
  #wake: (() => void) | undefined;
  closed = false;

  /** Give a message, an error that ends the stream, or `null`: its end. */
  push(...items: (KafkaMessage | Error | null)[]) {
    this.#queue.push(...items);
    this.#wake?.();
  }

  close() {
    this.closed = true;
    this.push(null);
    return Promise.resolve();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<KafkaMessage> {
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

/** A consumer that gives the streams of the test, and records its calls. */
class FakeConsumer implements KafkaConsumerLike {
  streams: FakeStream[] = [new FakeStream()];
  consumed: KafkaConsumeOptionsLike[] = [];
  closed: (boolean | undefined)[] = [];
  consume_error: Error | undefined;
  close_error: Error | undefined;

  /** The stream the pump reads. */
  get stream(): FakeStream {
    return this.streams[this.consumed.length - 1]!;
  }

  consume(options: KafkaConsumeOptionsLike) {
    if (this.consume_error) {
      return Promise.reject(this.consume_error);
    }
    this.consumed.push(options);
    this.streams[this.consumed.length - 1] ??= new FakeStream();
    return Promise.resolve(this.stream);
  }

  close(force?: boolean) {
    this.closed.push(force);
    return this.close_error
      ? Promise.reject(this.close_error)
      : Promise.resolve();
  }
}

/** A producer that keeps what it is asked to send. */
class FakeProducer implements KafkaProducerLike {
  sent: KafkaMessageToProduce[] = [];
  closed = 0;
  send_error: Error | undefined;

  send(options: { messages: KafkaMessageToProduce[] }) {
    if (this.send_error) {
      return Promise.reject(this.send_error);
    }
    this.sent.push(...options.messages);
    return Promise.resolve();
  }

  close() {
    this.closed++;
    return Promise.resolve();
  }
}

/** The error of a message that is not valid, as `@chojs/message` makes it. */
function invalid_message(text = "not valid"): Error {
  return make_error(
    "CHO_MESSAGE_INVALID_MESSAGE",
    text,
    undefined,
    invalid_message,
  );
}

/** The offsets that were committed, as `topic/partition@offset`. */
type Commits = string[];

/** A message of Kafka. Its `commit` is recorded in `commits`. */
function message(
  commits: Commits,
  value: string | null,
  { topic = "orders", partition = 0, offset = 0, key = "", headers = {} }: {
    topic?: string;
    partition?: number;
    offset?: number;
    key?: string;
    headers?: Record<string, string>;
  } = {},
  commit_error?: Error,
): KafkaMessage {
  const entries = Object.entries(headers).map(
    ([name, text]) =>
      [Buffer.from(name), Buffer.from(text)] as [Buffer, Buffer],
  );
  return {
    topic,
    partition,
    offset: BigInt(offset),
    key: key === "" ? undefined : Buffer.from(key),
    value: value === null ? undefined : Buffer.from(value),
    headers: new Map(entries),
    headerEntries: entries,
    timestamp: 0n,
    leaderEpoch: 0,
    metadata: {},
    commit: () => {
      if (commit_error) {
        return Promise.reject(commit_error);
      }
      commits.push(`${topic}/${partition}@${offset}`);
      return Promise.resolve();
    },
    toJSON: () => {
      throw new Error("not used");
    },
  } as unknown as KafkaMessage;
}

/** A route that calls `handler` with the text of the value. */
function route(
  topic: string,
  handler: (text: string, native: KafkaNative, delivery: Delivery) => unknown,
): Route {
  return {
    topic,
    name: `Test.${topic}`,
    handle: async (delivery, native) => {
      const { value } = delivery;
      const text = typeof value === "string"
        ? value
        : value
        ? new TextDecoder().decode(value)
        : "";
      await handler(text, native as KafkaNative, delivery);
      return undefined;
    },
  };
}

/** The code of an error of the framework. */
const code_of = (error: unknown) => (error as { code?: string } | null)?.code;

/** A pump on fakes, with settings that make the tests quick. */
function pump_of(routes: Route[], settings: Partial<PumpSettings> = {}) {
  const consumer = new FakeConsumer();
  const producer = new FakeProducer();
  const fatal: Error[] = [];
  const delays: number[] = [];
  const pump = new Pump(routes, consumer, producer, {
    groupId: "group",
    from: "latest",
    retries: 2,
    retryDelay: (retry) => {
      delays.push(retry);
      return 0;
    },
    deadLetter: undefined,
    concurrency: 1,
    consume: {},
    onFatal: (error) => void fatal.push(error),
    log: debuglog("cho:kafka"),
    ...settings,
  });
  return { pump, consumer, producer, fatal, delays };
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

describe("to_delivery", () => {
  it("gives the value, the key and the headers", () => {
    const delivery = to_delivery(
      message([], "hello", { key: "k", headers: { a: "1", b: "2" } }),
    );
    assert.deepEqual(delivery, {
      value: Buffer.from("hello"),
      key: "k",
      headers: { a: "1", b: "2" },
    });
  });

  it("gives null for a message with no value, and no key", () => {
    const delivery = to_delivery(message([], null));
    assert.deepEqual(delivery, { value: null, headers: {} });
    assert.equal("key" in delivery, false);
  });

  it("keeps the last of a repeated header", () => {
    const one = message([], "x");
    const entry = (name: string, text: string) =>
      [Buffer.from(name), Buffer.from(text)] as [Buffer, Buffer];
    one.headerEntries = [entry("a", "1"), entry("a", "2")];
    assert.deepEqual(to_delivery(one).headers, { a: "2" });
  });
});

describe("to_dead_letter", () => {
  it("keeps the message, and adds where it comes from", () => {
    const letter = to_dead_letter(
      message([], "hello", {
        key: "k",
        partition: 3,
        offset: 42,
        headers: { a: "1" },
      }),
      "orders.dead",
      "group",
      4,
      new Error("boom"),
    );
    assert.equal(letter.topic, "orders.dead");
    assert.deepEqual(letter.key, Buffer.from("k"));
    assert.deepEqual(letter.value, Buffer.from("hello"));
    const headers = Object.fromEntries(
      [...(letter.headers as Map<Buffer, Buffer>)].map(
        ([name, value]) => [String(name), new TextDecoder().decode(value)],
      ),
    );
    assert.deepEqual(headers, {
      a: "1",
      [DEAD_LETTER_HEADERS.topic]: "orders",
      [DEAD_LETTER_HEADERS.partition]: "3",
      [DEAD_LETTER_HEADERS.offset]: "42",
      [DEAD_LETTER_HEADERS.group]: "group",
      [DEAD_LETTER_HEADERS.attempts]: "4",
      [DEAD_LETTER_HEADERS.error]: "boom",
    });
  });

  it("describes an error that is not an Error", () => {
    const letter = to_dead_letter(message([], "x"), "dead", "g", 1, "no");
    const headers = [...(letter.headers as Map<Buffer, Buffer>)];
    assert.equal(String(headers.at(-1)![1]), "no");
    assert.equal("key" in letter, false);
  });
});

describe("Pump", () => {
  it("subscribes to the topic of each route, without autocommit", async () => {
    const { pump, consumer } = pump_of(
      [route("a", () => {}), route("b", () => {})],
      { from: "earliest", consume: { sessionTimeout: 5000 } },
    );
    await pump.start();
    assert.deepEqual(consumer.consumed, [{
      sessionTimeout: 5000,
      topics: ["a", "b"],
      autocommit: false,
      mode: "committed",
      fallbackMode: "earliest",
    }]);
    await pump.stop();
  });

  it("does not let the consume options replace what it decides", async () => {
    const { pump, consumer } = pump_of([route("a", () => {})], {
      consume: { autocommit: true, topics: ["other"], mode: "latest" },
    });
    await pump.start();
    assert.equal(consumer.consumed[0]!.autocommit, false);
    assert.deepEqual(consumer.consumed[0]!.topics, ["a"]);
    assert.equal(consumer.consumed[0]!.mode, "committed");
    await pump.stop();
  });

  it("consumes nothing without a route", async () => {
    const { pump, consumer, producer } = pump_of([]);
    await pump.start();
    assert.equal(consumer.consumed.length, 0);
    await pump.stop();
    assert.deepEqual(consumer.closed, [true]);
    assert.equal(producer.closed, 1);
  });

  it("rejects the start when the consumer cannot join", async () => {
    const { pump, consumer } = pump_of([route("orders", () => {})]);
    consumer.consume_error = new Error("no broker");
    await assert.rejects(pump.start(), /no broker/);
    await pump.stop();
  });

  it("handles a message, then commits it", async () => {
    const commits: Commits = [];
    const seen: unknown[] = [];
    const { pump, consumer } = pump_of([
      route("orders", (text, native, delivery) => {
        seen.push([text, delivery.key, native.attempt, commits.length]);
        assert.equal(native.message.offset, 7n);
      }),
    ]);
    await pump.start();
    consumer.stream.push(message(commits, "one", { offset: 7, key: "k" }));
    await until(() => commits.length === 1);
    // Committed after the handler, not before.
    assert.deepEqual(seen, [["one", "k", 1, 0]]);
    assert.deepEqual(commits, ["orders/0@7"]);
    await pump.stop();
  });

  it("commits a message whose handler gave a reply, and drops the reply", async () => {
    const commits: Commits = [];
    const lines: string[] = [];
    const log = Object.assign(
      (...args: unknown[]) => void lines.push(args.join(" ")),
      { error: () => {}, start: () => () => {}, enabled: true },
    );
    const replying: Route = {
      topic: "orders",
      name: "Test.orders",
      handle: () =>
        Promise.resolve({ value: new TextEncoder().encode("a reply") }),
    };
    const { pump, consumer, producer, fatal } = pump_of([replying], { log });
    await pump.start();
    consumer.stream.push(
      message(commits, "one", { offset: 1 }),
      message(commits, "two", { offset: 2 }),
    );
    await until(() => commits.length === 2);
    // Kafka has no replies: the message is handled, and nothing is sent.
    assert.deepEqual(commits, ["orders/0@1", "orders/0@2"]);
    assert.deepEqual(producer.sent, []);
    assert.deepEqual(fatal, []);
    // Said once for the route, not for each message.
    assert.deepEqual(
      lines.filter((line) => line.includes("returned a reply")),
      [
        "Test.orders returned a reply: Kafka has no replies, what a handler returns is dropped",
      ],
    );
    await pump.stop();
  });

  it("tries a failed message again, with the number of the attempt", async () => {
    const commits: Commits = [];
    const attempts: number[] = [];
    const { pump, consumer, delays, producer } = pump_of([
      route("orders", (_text, native) => {
        attempts.push(native.attempt);
        if (native.attempt < 3) {
          throw new Error("not yet");
        }
      }),
    ]);
    await pump.start();
    consumer.stream.push(message(commits, "one"));
    await until(() => commits.length === 1);
    assert.deepEqual(attempts, [1, 2, 3]);
    assert.deepEqual(delays, [1, 2]);
    assert.deepEqual(producer.sent, []);
    await pump.stop();
  });

  it("sends a dead message to its dead-letter topic, and goes on", async () => {
    const commits: Commits = [];
    const seen: string[] = [];
    const { pump, consumer, producer, fatal } = pump_of(
      [route("orders", (text, native) => {
        seen.push(`${text}#${native.attempt}`);
        if (text === "bad") {
          throw new Error("boom");
        }
      })],
      { deadLetter: (topic) => `${topic}.dead` },
    );
    await pump.start();
    consumer.stream.push(
      message(commits, "bad", { offset: 0, key: "k" }),
      message(commits, "good", { offset: 1 }),
    );
    await until(() => commits.length === 2);
    assert.deepEqual(seen, ["bad#1", "bad#2", "bad#3", "good#1"]);
    assert.deepEqual(commits, ["orders/0@0", "orders/0@1"]);
    assert.equal(producer.sent.length, 1);
    const letter = producer.sent[0]!;
    assert.equal(letter.topic, "orders.dead");
    assert.deepEqual(letter.value, Buffer.from("bad"));
    const headers = new Map(
      [...(letter.headers as Map<Buffer, Buffer>)].map(
        ([name, value]) => [String(name), String(value)],
      ),
    );
    assert.equal(headers.get(DEAD_LETTER_HEADERS.attempts), "3");
    assert.equal(headers.get(DEAD_LETTER_HEADERS.error), "boom");
    assert.deepEqual(fatal, []);
    await pump.stop();
  });

  it("does not try a message that is not valid again: it is dead at once", async () => {
    const commits: Commits = [];
    const seen: string[] = [];
    const invalid = invalid_message(
      "Invalid message of orders: the value is not valid",
    );
    const { pump, consumer, producer, delays, fatal } = pump_of(
      [route("orders", (text, native) => {
        seen.push(`${text}#${native.attempt}`);
        if (text === "bad") {
          throw invalid;
        }
      })],
      { deadLetter: (topic) => `${topic}.dead` },
    );
    await pump.start();
    consumer.stream.push(
      message(commits, "bad", { offset: 0 }),
      message(commits, "good", { offset: 1 }),
    );
    await until(() => commits.length === 2);
    // One attempt, and no wait: the retries are for what may work later.
    assert.deepEqual(seen, ["bad#1", "good#1"]);
    assert.deepEqual(delays, []);
    assert.equal(producer.sent.length, 1);
    const headers = new Map(
      [...(producer.sent[0]!.headers as Map<Buffer, Buffer>)].map(
        ([name, value]) => [String(name), String(value)],
      ),
    );
    assert.equal(headers.get(DEAD_LETTER_HEADERS.attempts), "1");
    assert.equal(
      headers.get(DEAD_LETTER_HEADERS.error),
      "Invalid message of orders: the value is not valid",
    );
    assert.deepEqual(fatal, []);
    await pump.stop();
  });

  it("stops at once at a message that is not valid, with no dead-letter topic", async () => {
    const commits: Commits = [];
    let calls = 0;
    const invalid = invalid_message("not valid");
    const { pump, consumer, fatal } = pump_of([
      route("orders", () => {
        calls++;
        throw invalid;
      }),
    ]);
    await pump.start();
    consumer.stream.push(message(commits, "bad"));
    await until(() => fatal.length === 1);
    assert.equal(calls, 1);
    assert.deepEqual(commits, []);
    assert.equal(code_of(fatal[0]), "CHO_KAFKA_NO_DEAD_LETTER");
    assert.match(fatal[0]!.message, /failed 1 time\(s\)/);
    assert.equal(fatal[0]!.cause, invalid);
    await pump.stop();
  });

  it("does not try again with no retries", async () => {
    const commits: Commits = [];
    let calls = 0;
    const { pump, consumer, producer } = pump_of(
      [route("orders", () => {
        calls++;
        throw new Error("boom");
      })],
      { retries: 0, deadLetter: () => "dead" },
    );
    await pump.start();
    consumer.stream.push(message(commits, "bad"));
    await until(() => commits.length === 1);
    assert.equal(calls, 1);
    assert.equal(producer.sent.length, 1);
    await pump.stop();
  });

  it("stops at a dead message when there is no dead-letter topic", async () => {
    const commits: Commits = [];
    const seen: string[] = [];
    const cause = new Error("boom");
    const { pump, consumer, producer, fatal } = pump_of([
      route("orders", (text) => {
        seen.push(text);
        throw cause;
      }),
    ], { retries: 1 });
    await pump.start();
    consumer.stream.push(
      message(commits, "bad", { partition: 2, offset: 5 }),
      message(commits, "next", { partition: 2, offset: 6 }),
    );
    await until(() => fatal.length === 1);
    // Nothing is committed, and the next message is not handled.
    assert.deepEqual(commits, []);
    assert.deepEqual(seen, ["bad", "bad"]);
    assert.match(
      fatal[0]!.message,
      /^KafkaLinker: Test\.orders failed 2 time\(s\) for orders\[2\]@5, and there is no dead-letter topic/,
    );
    assert.equal(fatal[0]!.cause, cause);
    assert.equal(code_of(fatal[0]), "CHO_KAFKA_NO_DEAD_LETTER");
    // The clients are closed before the application is told.
    assert.deepEqual(consumer.closed, [true]);
    assert.equal(producer.closed, 1);
    // `close()` of the application still stops it, once, without an error.
    await pump.stop();
    assert.deepEqual(consumer.closed, [true]);
    assert.equal(fatal.length, 1);
  });

  it("stops when a dead letter cannot be sent", async () => {
    const commits: Commits = [];
    const { pump, consumer, producer, fatal } = pump_of(
      [route("orders", () => {
        throw new Error("boom");
      })],
      { retries: 0, deadLetter: () => "dead" },
    );
    producer.send_error = new Error("no leader");
    await pump.start();
    consumer.stream.push(message(commits, "bad"));
    await until(() => fatal.length === 1);
    assert.deepEqual(commits, []);
    assert.match(
      fatal[0]!.message,
      /cannot send orders\[0\]@0 to the dead-letter topic "dead"/,
    );
    assert.equal(fatal[0]!.cause, producer.send_error);
    assert.equal(code_of(fatal[0]), "CHO_KAFKA_DEAD_LETTER_FAILED");
    await pump.stop();
  });

  it("commits and skips a message of a topic with no route", async () => {
    const commits: Commits = [];
    const seen: string[] = [];
    const { pump, consumer } = pump_of([
      route("orders", (text) => void seen.push(text)),
    ]);
    await pump.start();
    consumer.stream.push(message(commits, "x", { topic: "other" }));
    await until(() => commits.length === 1);
    assert.deepEqual(commits, ["other/0@0"]);
    assert.deepEqual(seen, []);
    await pump.stop();
  });

  it("goes on when a commit fails", async () => {
    const commits: Commits = [];
    const seen: string[] = [];
    const { pump, consumer, fatal } = pump_of([
      route("orders", (text) => void seen.push(text)),
    ]);
    await pump.start();
    consumer.stream.push(
      message(commits, "one", { offset: 0 }, new Error("rebalance")),
      message(commits, "two", { offset: 1 }),
    );
    await until(() => commits.length === 1);
    assert.deepEqual(seen, ["one", "two"]);
    assert.deepEqual(commits, ["orders/0@1"]);
    assert.deepEqual(fatal, []);
    await pump.stop();
  });

  it("handles one message at a time by default", async () => {
    const commits: Commits = [];
    let running = 0;
    let most = 0;
    const { pump, consumer } = pump_of([
      route("orders", async () => {
        most = Math.max(most, ++running);
        await new Promise((resolve) => setTimeout(resolve, 2));
        running--;
      }),
    ]);
    await pump.start();
    consumer.stream.push(
      ...[0, 1, 2, 3].map((i) =>
        message(commits, String(i), { partition: i, offset: 0 })
      ),
    );
    await until(() => commits.length === 4);
    assert.equal(most, 1);
    await pump.stop();
  });

  it("runs partitions together, each one in order", async () => {
    const commits: Commits = [];
    const seen: string[] = [];
    let running = 0;
    let most = 0;
    const gate = deferred();
    const { pump, consumer } = pump_of(
      [route("orders", async (text) => {
        most = Math.max(most, ++running);
        // The first message of partition 0 is slow: the second waits for it.
        await (text === "0a" ? gate.promise : Promise.resolve());
        running--;
        seen.push(text);
      })],
      { concurrency: 3 },
    );
    await pump.start();
    consumer.stream.push(
      message(commits, "0a", { partition: 0, offset: 0 }),
      message(commits, "0b", { partition: 0, offset: 1 }),
      message(commits, "1a", { partition: 1, offset: 0 }),
    );
    await until(() => seen.includes("1a"));
    assert.deepEqual(seen, ["1a"]);
    gate.resolve();
    await until(() => commits.length === 3);
    assert.deepEqual(seen, ["1a", "0a", "0b"]);
    assert.deepEqual(commits, ["orders/1@0", "orders/0@0", "orders/0@1"]);
    assert.ok(most <= 3);
    await pump.stop();
  });

  it("keeps no more messages in hand than the concurrency", async () => {
    const commits: Commits = [];
    let running = 0;
    let most = 0;
    const { pump, consumer } = pump_of(
      [route("orders", async () => {
        most = Math.max(most, ++running);
        await new Promise((resolve) => setTimeout(resolve, 2));
        running--;
      })],
      { concurrency: 2 },
    );
    await pump.start();
    consumer.stream.push(
      ...[0, 1, 2, 3, 4, 5].map((i) =>
        message(commits, String(i), { partition: i })
      ),
    );
    await until(() => commits.length === 6);
    assert.equal(most, 2);
    await pump.stop();
  });

  it("waits for the message in hand when it stops", async () => {
    const commits: Commits = [];
    const gate = deferred();
    const { pump, consumer, producer } = pump_of([
      route("orders", () => gate.promise),
    ]);
    await pump.start();
    const stream = consumer.stream;
    stream.push(message(commits, "one"));
    await until(() => stream.closed === false);
    await new Promise((resolve) => setTimeout(resolve, 5));
    let stopped = false;
    const stop = pump.stop().then(() => (stopped = true));
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(stopped, false);
    assert.deepEqual(consumer.closed, []);
    gate.resolve();
    await stop;
    // It finished: it is committed, then the clients are closed.
    assert.deepEqual(commits, ["orders/0@0"]);
    assert.equal(stream.closed, true);
    assert.deepEqual(consumer.closed, [true]);
    assert.equal(producer.closed, 1);
  });

  it("leaves uncommitted a message that is failing when it stops", async () => {
    const commits: Commits = [];
    let calls = 0;
    const { pump, consumer, producer, fatal } = pump_of(
      [route("orders", () => {
        calls++;
        throw new Error("boom");
      })],
      { retryDelay: () => 60_000, deadLetter: () => "dead" },
    );
    await pump.start();
    consumer.stream.push(
      message(commits, "bad", { offset: 0 }),
      message(commits, "next", { offset: 1 }),
    );
    await until(() => calls === 1);
    // The wait before the retry ends with the stop.
    await pump.stop();
    assert.equal(calls, 1);
    assert.deepEqual(commits, []);
    assert.deepEqual(producer.sent, []);
    assert.deepEqual(fatal, []);
  });

  it("returns the same promise for every stop", async () => {
    const { pump } = pump_of([route("orders", () => {})]);
    await pump.start();
    const stop = pump.stop();
    assert.equal(pump.stop(), stop);
    await stop;
  });

  it("rejects the stop when a client fails to close, after closing the other", async () => {
    const { pump, consumer, producer } = pump_of([route("orders", () => {})]);
    consumer.close_error = new Error("cannot leave");
    await pump.start();
    await assert.rejects(pump.stop(), /cannot leave/);
    assert.equal(producer.closed, 1);
  });

  it("reads the topics again when the stream fails", async () => {
    const commits: Commits = [];
    const seen: string[] = [];
    const { pump, consumer, fatal } = pump_of([
      route("orders", (text) => void seen.push(text)),
    ]);
    consumer.streams.push(new FakeStream());
    await pump.start();
    consumer.streams[0]!.push(
      message(commits, "one", { offset: 0 }),
      new Error("rebalance in progress"),
    );
    await until(() => consumer.consumed.length === 2);
    consumer.streams[1]!.push(message(commits, "two", { offset: 1 }));
    await until(() => commits.length === 2);
    assert.deepEqual(seen, ["one", "two"]);
    assert.deepEqual(fatal, []);
    await pump.stop();
    assert.equal(consumer.streams[1]!.closed, true);
  });

  it("stops when the topics cannot be read again", async () => {
    const { pump, consumer, fatal } = pump_of([route("orders", () => {})]);
    await pump.start();
    consumer.consume_error = new Error("no broker");
    consumer.stream.push(new Error("connection lost"));
    await until(() => fatal.length === 1);
    assert.equal(
      fatal[0]!.message,
      "KafkaLinker: cannot read the topics again",
    );
    assert.equal(code_of(fatal[0]), "CHO_KAFKA_CONSUME_FAILED");
    assert.equal(fatal[0]!.cause, consumer.consume_error);
    assert.deepEqual(consumer.closed, [true]);
  });
});
