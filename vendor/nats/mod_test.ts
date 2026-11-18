/**
 * Tests for `mod.ts`: `NatsLinker` checks its options, links an application
 * without connecting to anything, and runs a `ChoMessage` application on a
 * connection.
 *
 * What the adapter does with messages is tested in `consume_test.ts`, and
 * against a server in `nats_test.ts`. Here a small fake stands for the
 * connection: the tests run on every runtime.
 *
 * Decorators are applied as plain function calls.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ChoMessage,
  type ChoMessageContext,
  ChoMessageReply,
  Controller,
  Module,
  Subscribe,
} from "@chojs/message";
import { legacy, loose } from "@chojs/core/utils/test_utils";
import type { Route } from "@chojs/message/linker";
import {
  ERROR_HEADERS,
  type NatsConnectionLike,
  NatsLinked,
  NatsLinker,
  type NatsLinkerOptions,
  type NatsMessageLike,
  type NatsNative,
} from "./mod.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** A connection that keeps its subscriptions, for the test to feed. */
function fake_connection() {
  const feeds = new Map<string, (message: NatsMessageLike | null) => void>();
  const subscribed: string[] = [];
  let closed = false;
  let close!: () => void;
  const done = new Promise<void>((resolve) => (close = resolve));
  const connection = {
    /** A member the adapter does not know: the type of `instance` has it. */
    server: "fake",
    subscribed,
    /** Give a message to the subscription of a subject. */
    feed(subject: string, message: NatsMessageLike) {
      feeds.get(subject)!(message);
    },
    subscribe(subject: string, options: { queue: string }) {
      subscribed.push(`${subject} (${options.queue})`);
      const queue: (NatsMessageLike | null)[] = [];
      let wake: (() => void) | undefined;
      const push = (message: NatsMessageLike | null) => {
        queue.push(message);
        wake?.();
      };
      feeds.set(subject, push);
      return {
        drain() {
          push(null);
          return Promise.resolve();
        },
        async *[Symbol.asyncIterator]() {
          while (true) {
            while (queue.length === 0) {
              await new Promise<void>((resolve) => (wake = resolve));
            }
            const message = queue.shift()!;
            if (message === null) {
              return;
            }
            yield message;
          }
        },
      };
    },
    flush: () => Promise.resolve(),
    drain() {
      closed = true;
      // As the client does: every subscription ends with the connection.
      for (const end of feeds.values()) {
        end(null);
      }
      close();
      return Promise.resolve();
    },
    closed: () => done,
    isClosed: () => closed,
  } satisfies NatsConnectionLike & Record<string, unknown>;
  return connection;
}

/** What a request was answered with. */
type Answer = { value: string; headers: Record<string, string> };

/** A request: a message that asks for a reply, and keeps its answers. */
function request(subject: string, value: string) {
  const answers: Answer[] = [];
  const message: NatsMessageLike = {
    subject,
    data: encoder.encode(value),
    reply: "_INBOX.test",
    respond(data, options) {
      answers.push({
        value: decoder.decode(data),
        headers: Object.fromEntries(
          [...(options?.headers ?? [])].map(([name, values]) => [
            name,
            values[0] ?? "",
          ]),
        ),
      });
      return true;
    },
  };
  return { message, answers };
}

/** Options that are right. */
const options = (): NatsLinkerOptions<ReturnType<typeof fake_connection>> => ({
  connect: fake_connection,
  queue: "mailer",
});

/** A route of a topic. */
const route = (topic: string): Route => ({
  topic,
  name: `Test.${topic}`,
  handle: () => Promise.resolve(undefined),
});

/** An application with one handler, of the topic `orders.created`. */
function orders_app(handler: (ctx: ChoMessageContext) => unknown) {
  class Orders {
    created(ctx: ChoMessageContext) {
      return handler(ctx);
    }
  }
  legacy(Subscribe("created"), Orders, "created");
  loose(Controller({ topic: "orders" }))(Orders);
  class App {}
  loose(Module({ controllers: [Orders] }))(App);
  return App;
}

describe("NatsLinker options", () => {
  const rejects = (
    given: unknown,
    message: RegExp,
    code = "CHO_NATS_INVALID_OPTION",
  ) => assert.throws(() => new NatsLinker(loose(given)), { code, message });

  it("needs options", () => {
    rejects(undefined, /^NatsLinker: expected options/);
    rejects(null, /^NatsLinker: expected options/);
  });

  it("needs a function that connects", () => {
    const message = /^NatsLinker: the "connect" option is required/;
    rejects({ queue: "q" }, message);
    rejects({ connect: "localhost:4222", queue: "q" }, message);
    rejects({ connect: fake_connection(), queue: "q" }, message);
  });

  it("needs a queue group", () => {
    const message = /^NatsLinker: the "queue" option is required/;
    rejects({ connect: fake_connection }, message);
    rejects({ connect: fake_connection, queue: "" }, message);
    rejects({ connect: fake_connection, queue: 7 }, message);
    rejects(
      { connect: fake_connection, queue: "my app" },
      /"queue" option is a name without a space, got "my app"/,
    );
  });

  it("names an unknown option, and the known ones", () => {
    rejects(
      { ...options(), group: "g" },
      /unknown option "group"\. Known options: concurrency, connect, errorReply, onFatal, queue$/,
      "CHO_CORE_UNKNOWN_OPTION",
    );
  });

  it("checks each option", () => {
    rejects({ ...options(), concurrency: 0 }, /"concurrency" option is 1 or/);
    rejects({ ...options(), concurrency: 1.5 }, /"concurrency" option is 1/);
    rejects({ ...options(), errorReply: 404 }, /"errorReply" option is a fun/);
    rejects({ ...options(), onFatal: "exit" }, /"onFatal" option is a functi/);
  });

  it("accepts every option", () => {
    new NatsLinker({
      ...options(),
      concurrency: 4,
      errorReply: () => ({ code: 404, description: "Not Found" }),
      onFatal: () => {},
    });
  });
});

describe("NatsLinker.link", () => {
  it("connects nothing", async () => {
    let connected = 0;
    const linked = new NatsLinker({
      queue: "mailer",
      connect: () => {
        connected++;
        return fake_connection();
      },
    }).link([route("orders.created")]);
    assert.ok(linked instanceof NatsLinked);
    assert.equal(connected, 0);
    await linked.stop();
    assert.equal(connected, 0);
  });

  it("links one application only", () => {
    const linker = new NatsLinker(options());
    linker.link([]);
    assert.throws(
      () => linker.link([]),
      {
        code: "CHO_NATS_ALREADY_LINKED",
        message:
          "NatsLinker.link() was already called: use one linker for one application",
      },
    );
  });

  it("has no instance before the start, and the connection after", async () => {
    const linked = new NatsLinker(options()).link([route("orders.created")]);
    assert.throws(() => linked.instance, {
      code: "CHO_NATS_NOT_STARTED",
      message: /^NatsLinker: there is no connection before start\(\) resolves/,
    });
    await linked.start();
    // The instance is what `connect` gave, with its own type.
    assert.equal(linked.instance.server, "fake");
    assert.deepEqual(linked.instance.subscribed, ["orders.created (mailer)"]);
    await linked.stop();
    assert.equal(linked.instance.isClosed(), true);
  });

  it("rejects the start with the error of a connect that fails", async () => {
    const error = new Error("no server");
    const linked = new NatsLinker({
      queue: "mailer",
      connect: () => Promise.reject(error),
    }).link([route("orders")]);
    await assert.rejects(linked.start(), error);
    assert.throws(() => linked.instance, { code: "CHO_NATS_NOT_STARTED" });
    await linked.stop();
  });

  it("rejects the start when connect gives no connection", async () => {
    const linked = new NatsLinker({
      queue: "mailer",
      connect: () => loose("nats://localhost:4222"),
    }).link([route("orders")]);
    await assert.rejects(linked.start(), {
      code: "CHO_NATS_INVALID_CONNECTION",
    });
    await linked.stop();
  });

  it("returns the same promise for every start", async () => {
    const linked = new NatsLinker(options()).link([]);
    assert.equal(linked.start(), linked.start());
    await linked.start();
    await linked.stop();
  });

  it("tells onFatal when the connection closes by itself", async () => {
    const thrown: unknown[] = [];
    const linked = new NatsLinker({
      ...options(),
      onFatal: (error) => void thrown.push(error),
    }).link([route("orders")]);
    await linked.start();
    await linked.instance.drain(); // the connection closes by itself
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(thrown.length, 1);
    assert.equal(
      (thrown[0] as { code?: string }).code,
      "CHO_NATS_CONNECTION_CLOSED",
    );
  });
});

describe("a ChoMessage application on NatsLinker", () => {
  it("handles a message, and answers a request with what the handler returns", async () => {
    const seen: unknown[] = [];
    const app = await ChoMessage.create(
      orders_app((ctx) => {
        const native = ctx.native as NatsNative;
        seen.push([ctx.topic, ctx.json(), native.message.reply]);
        return { ok: true, id: ctx.json<{ id: number }>().id };
      }),
      { prefix: "shop", linker: new NatsLinker(options()) },
    );
    await app.start();
    const connection = app.linked.instance;
    assert.deepEqual(connection.subscribed, ["shop.orders.created (mailer)"]);
    const { message, answers } = request("shop.orders.created", '{"id":7}');
    connection.feed("shop.orders.created", message);
    await app.close();
    assert.deepEqual(seen, [["shop.orders.created", { id: 7 }, "_INBOX.test"]]);
    assert.deepEqual(answers, [{ value: '{"ok":true,"id":7}', headers: {} }]);
  });

  it("answers with the headers of a ChoMessageReply", async () => {
    const app = await ChoMessage.create(
      orders_app((ctx) =>
        new ChoMessageReply(ctx.json(), {
          headers: { "Content-Type": "application/json" },
        })
      ),
      { linker: new NatsLinker(options()) },
    );
    await app.start();
    const { message, answers } = request("orders.created", '{"id":7}');
    app.linked.instance.feed("orders.created", message);
    await app.close();
    assert.deepEqual(answers, [{
      value: '{"id":7}',
      headers: { "Content-Type": "application/json" },
    }]);
  });

  it("answers a request whose handler failed with an error reply", async () => {
    const app = await ChoMessage.create(
      orders_app(() => {
        throw new Error("no such order");
      }),
      {
        linker: new NatsLinker({
          ...options(),
          errorReply: (error) => ({
            code: 404,
            description: (error as Error).message,
          }),
        }),
      },
    );
    await app.start();
    const { message, answers } = request("orders.created", "{}");
    app.linked.instance.feed("orders.created", message);
    await app.close();
    assert.deepEqual(answers, [{
      value: "",
      headers: {
        [ERROR_HEADERS.description]: "no such order",
        [ERROR_HEADERS.code]: "404",
      },
    }]);
  });

  it("answers with the reply of an error handler", async () => {
    class Orders {
      created() {
        throw new Error("boom");
      }
    }
    legacy(Subscribe("orders.created"), Orders, "created");
    loose(Controller())(Orders);
    class App {}
    loose(Module({ controllers: [Orders] }))(App);
    const { Catch } = await import("@chojs/message");
    loose(Catch(() => ({ failed: true })))(Orders);
    const app = await ChoMessage.create(App, {
      linker: new NatsLinker(options()),
    });
    await app.start();
    const { message, answers } = request("orders.created", "{}");
    app.linked.instance.feed("orders.created", message);
    await app.close();
    assert.deepEqual(answers, [{ value: '{"failed":true}', headers: {} }]);
  });
});
