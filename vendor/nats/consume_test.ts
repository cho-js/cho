/**
 * Tests for `consume.ts`: what the adapter does with the messages of NATS.
 * It subscribes to the subject of each route in the queue group, gives each
 * message to its route, answers the ones that ask for a reply (with the
 * reply, with an empty one, or with an error reply), keeps the order of a
 * subject, handles what was received before it closes, and tells the
 * application when it stops by itself.
 *
 * A fake connection stands for the client library: these tests need no
 * server, and run on every runtime. `nats_test.ts` has the tests with a
 * server.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { Debuglog } from "@chojs/core/utils";
import type { Delivery, Reply, Route } from "@chojs/message/linker";
import {
  ERROR_HEADERS,
  INTERNAL_ERROR,
  type NatsConnectionLike,
  type NatsMessageLike,
  type NatsNative,
  type NatsSubscriptionLike,
  Pump,
  type PumpSettings,
  to_delivery,
} from "./consume.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** What a message was answered with. */
type Sent = { value: string; headers: Record<string, string> };

/** A message of the test: it keeps what it was answered with. */
type FakeMessage = NatsMessageLike & { readonly sent: Sent[] };

/** A message of NATS. `respond` is recorded in `sent`. */
function message(
  value: string,
  { reply, headers, subject = "orders", respond_error }: {
    reply?: string;
    headers?: [string, string[]][];
    subject?: string;
    /** `respond` throws it, for a reply that has no headers. */
    respond_error?: Error;
  } = {},
): FakeMessage {
  const sent: Sent[] = [];
  return {
    subject,
    data: encoder.encode(value),
    reply,
    headers,
    sent,
    respond(data, options) {
      if (respond_error && !options?.headers) {
        throw respond_error;
      }
      sent.push({
        value: decoder.decode(data),
        headers: Object.fromEntries(
          [...(options?.headers ?? [])].map(([name, values]) => [
            name,
            values.join(","),
          ]),
        ),
      });
      return true;
    },
  };
}

/** A subscription the test feeds. */
class FakeSubscription implements NatsSubscriptionLike {
  readonly #queue: (NatsMessageLike | Error | null)[] = [];
  #wake: (() => void) | undefined;
  drained = 0;
  drain_error: Error | undefined;

  /** Give a message, an error that ends the subscription, or `null`: its end. */
  push(...items: (NatsMessageLike | Error | null)[]) {
    this.#queue.push(...items);
    this.#wake?.();
  }

  drain() {
    this.drained++;
    if (this.drain_error) {
      return Promise.reject(this.drain_error);
    }
    this.push(null);
    return Promise.resolve();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<NatsMessageLike> {
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

/** A connection that gives the subscriptions of the test, and records. */
class FakeConnection implements NatsConnectionLike {
  readonly subscriptions = new Map<string, FakeSubscription>();
  readonly subscribed: { subject: string; queue: string }[] = [];
  flushed = 0;
  drained = 0;
  drain_error: Error | undefined;
  #closed = false;
  #close!: (error: void | Error) => void;
  readonly #done = new Promise<void | Error>((resolve) => {
    this.#close = resolve;
  });

  /** The subscription of a subject. */
  of(subject: string): FakeSubscription {
    const subscription = this.subscriptions.get(subject);
    assert.ok(subscription, `no subscription to ${subject}`);
    return subscription;
  }

  subscribe(subject: string, options: { queue: string }) {
    this.subscribed.push({ subject, queue: options.queue });
    const subscription = new FakeSubscription();
    this.subscriptions.set(subject, subscription);
    return subscription;
  }

  flush() {
    this.flushed++;
    return Promise.resolve();
  }

  drain() {
    this.drained++;
    if (this.drain_error) {
      return Promise.reject(this.drain_error);
    }
    this.close();
    return Promise.resolve();
  }

  closed() {
    return this.#done;
  }

  isClosed() {
    return this.#closed;
  }

  /** Close the connection, as the client does: every subscription ends. */
  close(error?: Error) {
    if (this.#closed) {
      return;
    }
    this.#closed = true;
    for (const subscription of this.subscriptions.values()) {
      subscription.push(null);
    }
    this.#close(error);
  }
}

/** A route that calls `handler` with the text of the value. */
function route(
  topic: string,
  handler: (text: string, native: NatsNative, delivery: Delivery) => unknown =
    () => undefined,
): Route {
  return {
    topic,
    name: `Test.${topic}`,
    handle: async (delivery, native) => {
      const { value } = delivery;
      const text = typeof value === "string"
        ? value
        : value
        ? decoder.decode(value)
        : "";
      const result = await handler(text, native as NatsNative, delivery);
      // What `@chojs/message` does with what a handler returns. A test that
      // needs headers gives the reply itself.
      if (result === undefined) {
        return undefined;
      }
      return result !== null && typeof result === "object"
        ? result as Reply
        : { value: encoder.encode(String(result)) };
    },
  };
}

/** The code of an error of the framework. */
const code_of = (error: unknown) => (error as { code?: string } | null)?.code;

/** A debug logger that keeps its lines. */
function recorder() {
  const lines: string[] = [];
  const errors: unknown[][] = [];
  const text = (args: unknown[]) =>
    args.map((arg) => arg instanceof Error ? arg.message : String(arg))
      .join(" ");
  const log = Object.assign(
    (...args: unknown[]) => void lines.push(text(args)),
    {
      error: (...args: unknown[]) => {
        errors.push(args);
        lines.push(`ERROR ${text(args)}`);
      },
      start: () => () => {},
      enabled: true,
    },
  ) satisfies Debuglog;
  return { log, lines, errors };
}

/** The settings of a pump that a test builds by hand. */
const settings = (): PumpSettings => ({
  queue: "group",
  concurrency: 1,
  errorReply: undefined,
  onFatal: () => {},
  log: recorder().log,
});

/** A pump on a fake connection. */
function pump_of(routes: Route[], settings: Partial<PumpSettings> = {}) {
  const connection = new FakeConnection();
  const fatal: Error[] = [];
  const { log, lines, errors } = recorder();
  const pump = new Pump(routes, () => connection, {
    queue: "group",
    concurrency: 1,
    errorReply: undefined,
    onFatal: (error) => void fatal.push(error),
    log,
    ...settings,
  });
  return { pump, connection, fatal, lines, errors };
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

/** The error reply a requester is told by default. */
const INTERNAL = {
  value: "",
  headers: {
    [ERROR_HEADERS.description]: "Internal Error",
    [ERROR_HEADERS.code]: "500",
  },
};

describe("to_delivery", () => {
  it("gives the payload as the value, and the headers", () => {
    const delivery = to_delivery(
      message("hello", { headers: [["a", ["1"]], ["b", ["2"]]] }),
    );
    assert.deepEqual(delivery, {
      value: encoder.encode("hello"),
      headers: { a: "1", b: "2" },
    });
  });

  it("has no key, and no header for a message without headers", () => {
    const delivery = to_delivery(message(""));
    assert.deepEqual(delivery, { value: new Uint8Array(0), headers: {} });
    assert.equal("key" in delivery, false);
  });

  it("keeps the first value of a repeated header", () => {
    const delivery = to_delivery(
      message("x", { headers: [["a", ["1", "2"]], ["empty", []]] }),
    );
    assert.deepEqual(delivery.headers, { a: "1", empty: "" });
  });
});

describe("Pump: starting", () => {
  it("subscribes to the subject of each route, in the queue group", async () => {
    const { pump, connection } = pump_of(
      [route("orders"), route("shop.payments")],
      { queue: "mailer" },
    );
    await pump.start();
    assert.deepEqual(connection.subscribed, [
      { subject: "orders", queue: "mailer" },
      { subject: "shop.payments", queue: "mailer" },
    ]);
    assert.equal(pump.connection, connection);
    await pump.stop();
  });

  it("resolves once the server has the subscriptions", async () => {
    const { pump, connection } = pump_of([route("orders")]);
    await pump.start();
    assert.equal(connection.flushed, 1);
    await pump.stop();
  });

  it("connects with no route, and subscribes to nothing", async () => {
    const { pump, connection, lines } = pump_of([]);
    await pump.start();
    assert.deepEqual(connection.subscribed, []);
    assert.equal(pump.connection, connection);
    assert.match(lines.join("\n"), /no subject to subscribe to/);
    await pump.stop();
    assert.equal(connection.drained, 1);
  });

  it("has no connection before it started", () => {
    const { pump } = pump_of([route("orders")]);
    assert.throws(() => pump.connection, {
      code: "CHO_NATS_NOT_STARTED",
      message: /^NatsLinker: there is no connection before start\(\)/,
    });
  });

  it("rejects with the error of a connect that fails", async () => {
    const error = new Error("no server");
    const pump = new Pump(
      [route("orders")],
      () => Promise.reject(error),
      settings(),
    );
    await assert.rejects(pump.start(), error);
    assert.throws(() => pump.connection, { code: "CHO_NATS_NOT_STARTED" });
    await pump.stop(); // nothing to close
  });

  it("rejects a connect that gives no connection", async () => {
    for (const given of [undefined, null, "nats://x", { subscribe() {} }]) {
      const pump = new Pump(
        [route("orders")],
        () => given as unknown as NatsConnectionLike,
        settings(),
      );
      await assert.rejects(pump.start(), {
        code: "CHO_NATS_INVALID_CONNECTION",
        message: /^NatsLinker: the "connect" option did not give a connection/,
      });
      await pump.stop();
    }
  });
});

describe("Pump: a message", () => {
  it("is given to its route, with the message of the client", async () => {
    const seen: [string, NatsNative, Delivery][] = [];
    const { pump, connection } = pump_of([
      route("orders", (text, native, delivery) => {
        seen.push([text, native, delivery]);
      }),
      route("payments", (text) => void seen.push([text, null!, null!])),
    ]);
    await pump.start();
    const one = message("first", { headers: [["trace", ["t1"]]] });
    connection.of("orders").push(one);
    connection.of("payments").push(message("paid", { subject: "payments" }));
    await until(() => seen.length === 2);
    const [text, native, delivery] = seen.find(([text]) => text === "first")!;
    assert.equal(text, "first");
    assert.equal(native.message, one);
    assert.deepEqual(delivery.headers, { trace: "t1" });
    assert.ok(seen.some(([text]) => text === "paid"));
    await pump.stop();
  });

  it("that asks for no reply is not answered", async () => {
    const { pump, connection } = pump_of([route("orders", () => undefined)]);
    await pump.start();
    const one = message("a");
    connection.of("orders").push(one);
    await pump.stop();
    assert.deepEqual(one.sent, []);
  });

  it("drops a reply nobody asked for, and says so once for a route", async () => {
    const { pump, connection, lines } = pump_of([
      route("orders", (text) => `done ${text}`),
    ]);
    await pump.start();
    const messages = [message("a"), message("b")];
    connection.of("orders").push(...messages);
    await pump.stop();
    assert.deepEqual(messages.map((one) => one.sent), [[], []]);
    assert.equal(
      lines.filter((line) => /asks for none: it is dropped/.test(line)).length,
      1,
    );
  });
});

describe("Pump: a request", () => {
  it("is answered with the reply of its handler", async () => {
    const { pump, connection } = pump_of([
      route("orders", (text) => `done ${text}`),
    ]);
    await pump.start();
    const one = message("a", { reply: "_INBOX.1" });
    connection.of("orders").push(one);
    await pump.stop();
    assert.deepEqual(one.sent, [{ value: "done a", headers: {} }]);
  });

  it("is answered with the headers of the reply", async () => {
    const { pump, connection } = pump_of([
      route("orders", (text): Reply => ({
        value: encoder.encode(`done ${text}`),
        headers: { "Content-Type": "text/plain", "x-cache": "60" },
      })),
    ]);
    await pump.start();
    const one = message("a", { reply: "_INBOX.1" });
    connection.of("orders").push(one);
    await pump.stop();
    assert.deepEqual(one.sent, [{
      value: "done a",
      headers: { "Content-Type": "text/plain", "x-cache": "60" },
    }]);
  });

  it("is told of an error when a header of the reply is not one of NATS", async () => {
    for (
      const headers of [
        { "a name": "1" },
        { "a:b": "1" },
        { ok: "two\nlines" },
      ]
    ) {
      const seen: unknown[] = [];
      const { pump, connection, fatal } = pump_of([
        route("orders", (): Reply => ({ value: encoder.encode("x"), headers })),
      ], { errorReply: (error) => void seen.push(error) });
      await pump.start();
      const one = message("a", { reply: "_INBOX.1" });
      connection.of("orders").push(one);
      await pump.stop();
      assert.deepEqual(one.sent, [INTERNAL]);
      assert.equal(code_of(seen[0]), "CHO_NATS_REPLY_FAILED");
      assert.deepEqual(fatal, []);
    }
  });

  it("is answered with an empty reply when its handler gave none", async () => {
    const { pump, connection } = pump_of([route("orders", () => undefined)]);
    await pump.start();
    const one = message("a", { reply: "_INBOX.1" });
    connection.of("orders").push(one);
    await pump.stop();
    assert.deepEqual(one.sent, [{ value: "", headers: {} }]);
  });

  it("is answered with an error reply when it failed", async () => {
    const { pump, connection, lines } = pump_of([
      route("orders", () => {
        throw new Error("a secret of the database");
      }),
    ]);
    await pump.start();
    const one = message("a", { reply: "_INBOX.1" });
    connection.of("orders").push(one);
    await pump.stop();
    assert.deepEqual(one.sent, [INTERNAL]);
    assert.deepEqual(INTERNAL_ERROR, {
      code: 500,
      description: "Internal Error",
    });
    // The message of the error is logged, not sent.
    assert.match(lines.join("\n"), /Test\.orders failed for a request/);
    assert.match(lines.join("\n"), /a secret of the database/);
  });

  it("goes on after a request that failed", async () => {
    const { pump, connection, fatal } = pump_of([
      route("orders", (text) => {
        if (text === "bad") {
          throw new Error("boom");
        }
        return "ok";
      }),
    ]);
    await pump.start();
    const messages = ["bad", "good"].map((text) =>
      message(text, { reply: "_INBOX.1" })
    );
    connection.of("orders").push(...messages);
    await pump.stop();
    assert.deepEqual(messages[0]!.sent, [INTERNAL]);
    assert.deepEqual(messages[1]!.sent, [{ value: "ok", headers: {} }]);
    assert.deepEqual(fatal, []);
  });
});

describe("Pump: the errorReply option", () => {
  const failing = (error: unknown) =>
    route("orders", () => {
      throw error;
    });

  it("decides the code, the description and the value", async () => {
    const boom = new Error("no such order");
    const calls: unknown[][] = [];
    const { pump, connection } = pump_of([failing(boom)], {
      errorReply: (error, native) => {
        calls.push([error, native]);
        return { code: 404, description: "Not Found", value: '{"id":7}' };
      },
    });
    await pump.start();
    const one = message("a", { reply: "_INBOX.1" });
    connection.of("orders").push(one);
    await pump.stop();
    assert.deepEqual(calls, [[boom, one]]);
    assert.deepEqual(one.sent, [{
      value: '{"id":7}',
      headers: {
        [ERROR_HEADERS.description]: "Not Found",
        [ERROR_HEADERS.code]: "404",
      },
    }]);
  });

  it("sends bytes as the value", async () => {
    const { pump, connection } = pump_of([failing(new Error("x"))], {
      errorReply: () => ({
        code: 400,
        description: "Bad Request",
        value: encoder.encode("why"),
      }),
    });
    await pump.start();
    const one = message("a", { reply: "_INBOX.1" });
    connection.of("orders").push(one);
    await pump.stop();
    assert.equal(one.sent[0]!.value, "why");
  });

  it("keeps the description on one line", async () => {
    const { pump, connection } = pump_of([failing(new Error("x"))], {
      errorReply: () => ({ code: 400, description: "two\r\nlines" }),
    });
    await pump.start();
    const one = message("a", { reply: "_INBOX.1" });
    connection.of("orders").push(one);
    await pump.stop();
    assert.equal(one.sent[0]!.headers[ERROR_HEADERS.description], "two lines");
  });

  it("tells 500 when it returns nothing", async () => {
    const { pump, connection, lines } = pump_of([failing(new Error("x"))], {
      errorReply: () => undefined,
    });
    await pump.start();
    const one = message("a", { reply: "_INBOX.1" });
    connection.of("orders").push(one);
    await pump.stop();
    assert.deepEqual(one.sent, [INTERNAL]);
    assert.doesNotMatch(lines.join("\n"), /errorReply/);
  });

  it("tells 500, and logs, when it returns something else or throws", async () => {
    for (
      const errorReply of [
        () => "Not Found",
        () => ({ code: "404", description: "Not Found" }),
        () => ({ code: 404 }),
        () => {
          throw new Error("the option is broken");
        },
      ]
    ) {
      const { pump, connection, lines } = pump_of([failing(new Error("x"))], {
        errorReply: errorReply as unknown as PumpSettings["errorReply"],
      });
      await pump.start();
      const one = message("a", { reply: "_INBOX.1" });
      connection.of("orders").push(one);
      await pump.stop();
      assert.deepEqual(one.sent, [INTERNAL]);
      assert.match(lines.join("\n"), /the "errorReply" option/);
    }
  });

  it("is not called for a message that asks for no reply", async () => {
    let calls = 0;
    const { pump, connection, lines } = pump_of([failing(new Error("boom"))], {
      errorReply: () => {
        calls++;
        return undefined;
      },
    });
    await pump.start();
    const one = message("a");
    connection.of("orders").push(one);
    await pump.stop();
    assert.equal(calls, 0);
    assert.deepEqual(one.sent, []);
    assert.match(lines.join("\n"), /asks for no reply: the message is lost/);
    assert.match(lines.join("\n"), /boom/);
  });
});

describe("Pump: a reply that cannot be sent", () => {
  it("is logged, and the requester is told of an error", async () => {
    const cause = new Error("max_payload size exceeded");
    const seen: unknown[] = [];
    const { pump, connection, errors, fatal } = pump_of([
      route("orders", () => "a large reply"),
    ], {
      errorReply: (error) => void seen.push(error),
    });
    await pump.start();
    const messages = [
      message("a", { reply: "_INBOX.1", respond_error: cause }),
      message("b", { reply: "_INBOX.2" }),
    ];
    connection.of("orders").push(...messages);
    await pump.stop();
    assert.deepEqual(messages[0]!.sent, [INTERNAL]);
    assert.equal(seen.length, 1);
    assert.equal(code_of(seen[0]), "CHO_NATS_REPLY_FAILED");
    assert.equal((seen[0] as Error).cause, cause);
    assert.match(
      (seen[0] as Error).message,
      /^NatsLinker: cannot send the reply of Test\.orders, of 13 byte\(s\)/,
    );
    assert.ok(errors.some(([error]) => error === seen[0]));
    // The adapter goes on.
    assert.deepEqual(messages[1]!.sent, [{
      value: "a large reply",
      headers: {},
    }]);
    assert.deepEqual(fatal, []);
  });

  it("is logged when the error reply cannot be sent either", async () => {
    const { pump, connection, lines, fatal } = pump_of([
      route("orders", () => {
        throw new Error("boom");
      }),
    ]);
    await pump.start();
    const one = message("a", { reply: "_INBOX.1" });
    one.respond = () => {
      throw new Error("the connection is closed");
    };
    connection.of("orders").push(one);
    await pump.stop();
    assert.match(lines.join("\n"), /cannot tell who asked on "orders"/);
    assert.deepEqual(fatal, []);
  });
});

describe("Pump: concurrency", () => {
  it("handles the messages of a subject one at a time, in order", async () => {
    const order: string[] = [];
    let running = 0;
    let most = 0;
    const { pump, connection } = pump_of([
      route("orders", async (text) => {
        most = Math.max(most, ++running);
        order.push(`start ${text}`);
        await new Promise((resolve) => setTimeout(resolve, 2));
        order.push(`end ${text}`);
        running--;
      }),
    ]);
    await pump.start();
    connection.of("orders").push(message("a"), message("b"), message("c"));
    await pump.stop();
    assert.equal(most, 1);
    assert.deepEqual(order, [
      "start a",
      "end a",
      "start b",
      "end b",
      "start c",
      "end c",
    ]);
  });

  it("handles `concurrency` messages of a subject at once", async () => {
    const gate = deferred();
    let running = 0;
    let most = 0;
    let done = 0;
    const { pump, connection } = pump_of([
      route("orders", async () => {
        most = Math.max(most, ++running);
        await gate.promise;
        running--;
        done++;
      }),
    ], { concurrency: 2 });
    await pump.start();
    connection.of("orders").push(
      message("a"),
      message("b"),
      message("c"),
      message("d"),
    );
    await until(() => running === 2);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(running, 2);
    gate.resolve();
    await pump.stop();
    assert.equal(most, 2);
    assert.equal(done, 4);
  });

  it("does not hold a subject for the messages of another", async () => {
    const gate = deferred();
    const seen: string[] = [];
    const { pump, connection } = pump_of([
      route("slow", async () => {
        await gate.promise;
      }),
      route("quick", (text) => void seen.push(text)),
    ]);
    await pump.start();
    connection.of("slow").push(message("a"), message("b"));
    connection.of("quick").push(message("x"), message("y"));
    await until(() => seen.length === 2);
    assert.deepEqual(seen, ["x", "y"]);
    gate.resolve();
    await pump.stop();
  });
});

describe("Pump: stopping", () => {
  it("handles and answers what was received, then closes", async () => {
    const gate = deferred();
    const { pump, connection } = pump_of([
      route("orders", async (text) => {
        await gate.promise;
        return `done ${text}`;
      }),
    ]);
    await pump.start();
    const messages = ["a", "b"].map((text) =>
      message(text, { reply: "_INBOX.1" })
    );
    connection.of("orders").push(...messages);
    await new Promise((resolve) => setTimeout(resolve, 5));
    let stopped = false;
    const stopping = pump.stop().then(() => (stopped = true));
    await new Promise((resolve) => setTimeout(resolve, 5));
    // It waits for the message in hand, and for the one behind it.
    assert.equal(stopped, false);
    assert.equal(connection.of("orders").drained, 1);
    assert.equal(connection.drained, 0);
    gate.resolve();
    await stopping;
    assert.deepEqual(messages.map((one) => one.sent[0]?.value), [
      "done a",
      "done b",
    ]);
    assert.equal(connection.drained, 1);
    assert.equal(connection.isClosed(), true);
  });

  it("gives the same promise every time", async () => {
    const { pump, connection } = pump_of([route("orders")]);
    await pump.start();
    const first = pump.stop();
    assert.equal(pump.stop(), first);
    await first;
    await pump.stop();
    assert.equal(connection.drained, 1);
  });

  it("does nothing before it started, and then it does not start", async () => {
    let connected = 0;
    const connection = new FakeConnection();
    const pump = new Pump([route("orders")], () => {
      connected++;
      return connection;
    }, settings());
    await pump.stop();
    await pump.start();
    assert.equal(connected, 0);
    assert.deepEqual(connection.subscribed, []);
  });

  it("closes a connection that was made while it stopped", async () => {
    const gate = deferred();
    const connection = new FakeConnection();
    const pump = new Pump([route("orders")], async () => {
      await gate.promise;
      return connection;
    }, settings());
    const starting = pump.start();
    const stopping = pump.stop();
    gate.resolve();
    await starting;
    await stopping;
    assert.deepEqual(connection.subscribed, []);
    assert.equal(connection.drained, 1);
  });

  it("rejects when the connection fails to close", async () => {
    const { pump, connection } = pump_of([route("orders")]);
    connection.drain_error = new Error("cannot flush");
    await pump.start();
    await assert.rejects(pump.stop(), connection.drain_error);
  });

  it("rejects with every error, when more than one step failed", async () => {
    const { pump, connection } = pump_of([route("orders")]);
    await pump.start();
    connection.of("orders").drain_error = new Error("cannot unsubscribe");
    connection.drain_error = new Error("cannot flush");
    const stopping = pump.stop();
    // The subscription did not end by itself: the connection ends it.
    connection.of("orders").push(null);
    await assert.rejects(stopping, (error: AggregateError) => {
      assert.equal(error.message, "NatsLinker: failed to stop");
      assert.deepEqual(error.errors, [
        connection.of("orders").drain_error,
        connection.drain_error,
      ]);
      return true;
    });
  });
});

describe("Pump: stopping by itself", () => {
  it("tells the application once when the connection closes", async () => {
    const cause = new Error("connection refused");
    const { pump, connection, fatal, errors } = pump_of([
      route("orders"),
      route("payments"),
    ]);
    await pump.start();
    connection.close(cause);
    await until(() => fatal.length > 0);
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(fatal.length, 1);
    assert.equal(code_of(fatal[0]), "CHO_NATS_CONNECTION_CLOSED");
    assert.equal(fatal[0]!.cause, cause);
    assert.match(
      fatal[0]!.message,
      /^NatsLinker: the connection to NATS closed/,
    );
    assert.ok(errors.some(([error]) => error === fatal[0]));
    // It does not close what is closed, and `stop()` resolves.
    await pump.stop();
    assert.equal(connection.drained, 0);
    assert.equal(connection.of("orders").drained, 0);
  });

  it("has no cause when the connection closed with no error", async () => {
    const { pump, connection, fatal } = pump_of([route("orders")]);
    await pump.start();
    connection.close();
    await until(() => fatal.length > 0);
    assert.equal(code_of(fatal[0]), "CHO_NATS_CONNECTION_CLOSED");
    assert.equal(fatal[0]!.cause, undefined);
  });

  it("waits for the messages in hand before it tells", async () => {
    const gate = deferred();
    let done = false;
    const { pump, connection, fatal } = pump_of([
      route("orders", async () => {
        await gate.promise;
        done = true;
      }),
    ]);
    await pump.start();
    connection.of("orders").push(message("a"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    connection.close(new Error("gone"));
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(fatal, []);
    gate.resolve();
    await until(() => fatal.length > 0);
    assert.equal(done, true);
  });

  it("stops when a subscription fails, and closes the connection", async () => {
    const cause = new Error("permissions violation");
    const { pump, connection, fatal } = pump_of([
      route("orders"),
      route("payments"),
    ]);
    await pump.start();
    connection.of("orders").push(cause);
    await until(() => fatal.length > 0);
    assert.equal(code_of(fatal[0]), "CHO_NATS_SUBSCRIPTION_FAILED");
    assert.equal(fatal[0]!.cause, cause);
    assert.match(
      fatal[0]!.message,
      /^NatsLinker: the subscription of Test\.orders to "orders" failed/,
    );
    assert.equal(connection.of("payments").drained, 1);
    assert.equal(connection.drained, 1);
    assert.equal(fatal.length, 1);
  });

  it("stops when a subscription ends by itself", async () => {
    const { pump, connection, fatal } = pump_of([route("orders")]);
    await pump.start();
    connection.of("orders").push(null);
    await until(() => fatal.length > 0);
    assert.equal(code_of(fatal[0]), "CHO_NATS_SUBSCRIPTION_FAILED");
    assert.match(fatal[0]!.message, /to "orders" ended/);
    assert.equal(fatal[0]!.cause, undefined);
  });

  it("does not tell when the application stops it", async () => {
    const { pump, fatal } = pump_of([route("orders")]);
    await pump.start();
    await pump.stop();
    await new Promise((resolve) => setTimeout(resolve, 5));
    assert.deepEqual(fatal, []);
  });
});
