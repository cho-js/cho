/**
 * Tests for the NATS adapter against a real server: what only NATS can tell.
 * A message is delivered, a request is answered with what its handler
 * returns, a failed request is answered with an error reply, a queue group
 * gives each message to one instance, and what was received is answered
 * before the connection closes.
 *
 * They run on Deno, Node.js and Bun, each with the transport of its runtime,
 * when `NATS_URL` is set, and are skipped otherwise:
 *
 * ```sh
 * docker run -d --rm -p 4222:4222 nats:2
 * NATS_URL=localhost:4222 deno test --allow-env --allow-net vendor/nats/nats_test.ts
 * NATS_URL=localhost:4222 npx tsx --test vendor/nats/nats_test.ts
 * NATS_URL=localhost:4222 bun test vendor/nats/nats_test.ts
 * ```
 *
 * Decorators are applied as plain function calls.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Args,
  ChoMessage,
  ChoMessageClient,
  type ChoMessageContext,
  ChoMessageReply,
  type ChoMessageValidator,
  contract,
  Controller,
  isReplyError,
  Middlewares,
  Module,
  ReplyError,
  Subscribe,
  validate,
  Value,
} from "@chojs/message";
import { engine, env } from "@chojs/core/utils";
import { legacy, loose } from "@chojs/core/utils/test_utils";
import type { NatsConnection } from "@nats-io/nats-core";
import {
  ERROR_HEADERS,
  NatsLinker,
  type NatsLinkerOptions,
  type NatsNative,
} from "./mod.ts";

const SERVER = env("NATS_URL") ?? "";

/** Whether the tests run: with a server. */
const RUN = SERVER !== "";

/** `describe`, skipped without a server. */
const suite = RUN ? describe : describe.skip;

/** Connects to the server, with the transport of this runtime. */
type Connect = (options: { servers: string }) => Promise<NatsConnection>;

// Loaded only when the tests run. Deno has its own transport, on JSR; the
// one of Node.js serves Bun too.
const transport: { connect: Connect } = !RUN
  ? loose({})
  : engine() === "deno"
  ? await import("@nats-io/transport-deno")
  : await import("@nats-io/transport-node");

/** A connection of the test. */
const connect = () => transport.connect({ servers: SERVER });

/** A name no other run of the tests has. */
const unique = (name: string) =>
  `cho-test-${name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** Resolves when `done()` is true; rejects after the timeout. */
async function until(done: () => boolean, what: string, ms = 10_000) {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) {
      throw new Error(`timeout: ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** An application with one handler, of the topic `<prefix>.orders.created`. */
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

/** Start an application of `orders_app` on the server. */
async function start(
  prefix: string,
  handler: (ctx: ChoMessageContext) => unknown,
  options: Partial<NatsLinkerOptions> = {},
) {
  const app = await ChoMessage.create(orders_app(handler), {
    prefix,
    linker: new NatsLinker({ connect, queue: unique("queue"), ...options }),
  });
  await app.start();
  return app;
}

/** Run a test with a connection of its own: the one that asks. */
async function with_client(run: (client: NatsConnection) => Promise<void>) {
  const client = await connect();
  try {
    await run(client);
  } finally {
    await client.close();
  }
}

suite("NatsLinker, with a server", { timeout: 60_000 }, () => {
  it("delivers a message, with its headers and native message", async () => {
    const prefix = unique("deliver");
    const subject = `${prefix}.orders.created`;
    const seen: unknown[] = [];
    const app = await start(prefix, (ctx) => {
      const native = ctx.native as NatsNative;
      seen.push({
        topic: ctx.topic,
        key: ctx.key,
        value: ctx.json(),
        headers: ctx.headers,
        subject: native.message.subject,
        reply: native.message.reply,
      });
    });
    await with_client(async (client) => {
      const { headers } = await import("@nats-io/nats-core");
      const sent = headers();
      sent.set("Message-Id", "abc");
      sent.append("Trace", "t1");
      sent.append("Trace", "t2");
      client.publish(subject, JSON.stringify({ id: 1 }), { headers: sent });
      await client.flush();
      await until(() => seen.length === 1, "the message is handled");
    });
    await app.close();
    assert.deepEqual(seen, [{
      topic: subject,
      key: undefined,
      value: { id: 1 },
      headers: { "Message-Id": "abc", Trace: "t1" },
      subject,
      reply: "",
    }]);
  });

  it("answers a request with what its handler returns", async () => {
    const prefix = unique("reply");
    const subject = `${prefix}.orders.created`;
    const app = await start(prefix, (ctx) => {
      switch (ctx.text()) {
        case "json":
          return { ok: true, list: [1, 2] };
        case "text":
          return "plain text";
        case "bytes":
          return new Uint8Array([0, 1, 254, 255]);
        case "null":
          return null;
        default:
          return undefined;
      }
    });
    await with_client(async (client) => {
      const ask = (text: string) => client.request(subject, text);
      assert.deepEqual((await ask("json")).json(), { ok: true, list: [1, 2] });
      assert.equal((await ask("text")).string(), "plain text");
      assert.deepEqual([...(await ask("bytes")).data], [0, 1, 254, 255]);
      assert.equal((await ask("null")).string(), "null");
      // A handler that returns nothing answers with an empty reply.
      const none = await ask("nothing");
      assert.equal(none.data.length, 0);
      assert.equal(none.headers, undefined);
    });
    await app.close();
  });

  it("answers with the headers of a reply", async () => {
    const prefix = unique("headers");
    const subject = `${prefix}.orders.created`;
    const app = await start(prefix, (ctx) => {
      switch (ctx.text()) {
        case "empty":
          return new ChoMessageReply(undefined, { headers: { Status: "204" } });
        case "bad":
          return new ChoMessageReply("x", { headers: { "a name": "1" } });
        default:
          return new ChoMessageReply({ ok: true }, {
            headers: { "Content-Type": "application/json", "X-Cache": "60" },
          });
      }
    });
    await with_client(async (client) => {
      const reply = await client.request(subject, "json");
      assert.deepEqual(reply.json(), { ok: true });
      assert.equal(reply.headers?.get("Content-Type"), "application/json");
      assert.equal(reply.headers?.get("X-Cache"), "60");
      // Headers alone: an empty value.
      const empty = await client.request(subject, "empty");
      assert.equal(empty.data.length, 0);
      assert.equal(empty.headers?.get("Status"), "204");
      // A header NATS does not accept: who asked is told of an error.
      const bad = await client.request(subject, "bad");
      assert.equal(bad.headers?.get(ERROR_HEADERS.code), "500");
    });
    await app.close();
  });

  it("is the connection of the application: it publishes and requests", async () => {
    const prefix = unique("instance");
    const subject = `${prefix}.orders.created`;
    const app = await start(prefix, (ctx) => `got ${ctx.text()}`);
    const reply = await app.linked.instance.request(subject, "it");
    assert.equal(reply.string(), "got it");
    await app.close();
    assert.equal(app.linked.instance.isClosed(), true);
  });

  it("answers a failed request with an error reply", async () => {
    const prefix = unique("error");
    const subject = `${prefix}.orders.created`;
    const app = await start(prefix, () => {
      throw new Error("a secret of the database");
    });
    await with_client(async (client) => {
      const reply = await client.request(subject, "x");
      assert.equal(reply.data.length, 0);
      assert.equal(
        reply.headers?.get(ERROR_HEADERS.description),
        "Internal Error",
      );
      assert.equal(reply.headers?.get(ERROR_HEADERS.code), "500");
    });
    await app.close();
  });

  it("answers a failed request as the errorReply option says", async () => {
    const prefix = unique("error-reply");
    const subject = `${prefix}.orders.created`;
    const app = await start(prefix, (ctx) => {
      if (ctx.text() === "missing") {
        throw new Error("no such order");
      }
      throw new Error("something else");
    }, {
      errorReply: (error, message) =>
        (error as Error).message === "no such order"
          ? {
            code: 404,
            description: "Not Found",
            value: JSON.stringify({ subject: message.subject }),
          }
          : undefined,
    });
    await with_client(async (client) => {
      const missing = await client.request(subject, "missing");
      assert.equal(missing.headers?.get(ERROR_HEADERS.code), "404");
      assert.equal(
        missing.headers?.get(ERROR_HEADERS.description),
        "Not Found",
      );
      assert.deepEqual(missing.json(), { subject });
      const other = await client.request(subject, "other");
      assert.equal(other.headers?.get(ERROR_HEADERS.code), "500");
    });
    await app.close();
  });

  it("answers a request that is not valid with 400, and calls no handler", async () => {
    const prefix = unique("invalid");
    const subject = `${prefix}.orders.created`;
    const Order: ChoMessageValidator<{ id: number }> = {
      parse(value) {
        const id = (value as { id?: unknown } | null)?.id;
        if (typeof id !== "number") {
          throw new Error("id: expected a number");
        }
        return { id };
      },
    };
    const seen: number[] = [];
    class Orders {
      created(order: { id: number }) {
        seen.push(order.id);
        return { ok: order.id };
      }
    }
    legacy(loose(Args(Value(Order))), Orders, "created");
    legacy(Subscribe("created"), Orders, "created");
    loose(Middlewares(validate()))(Orders);
    loose(Controller({ topic: "orders" }))(Orders);
    class App {}
    loose(Module({ controllers: [Orders] }))(App);
    const app = await ChoMessage.create(App, {
      prefix,
      linker: new NatsLinker({ connect, queue: unique("queue") }),
    });
    await app.start();
    await with_client(async (client) => {
      for (const payload of ['{"id":"seven"}', "{not json", ""]) {
        const reply = await client.request(subject, payload);
        assert.equal(reply.headers?.get(ERROR_HEADERS.code), "400");
        assert.equal(
          reply.headers?.get(ERROR_HEADERS.description),
          "Bad Request",
        );
      }
      assert.deepEqual((await client.request(subject, '{"id":7}')).json(), {
        ok: 7,
      });
    });
    await app.close();
    assert.deepEqual(seen, [7]);
  });

  it("answers a client that asks with a contract, with a typed reply", async () => {
    const prefix = unique("contract");
    type Order = { id: number };
    const IsOrder: ChoMessageValidator<Order> = {
      parse(value) {
        const id = (value as { id?: unknown } | null)?.id;
        if (typeof id !== "number") {
          throw new Error("id: expected a number");
        }
        return { id };
      },
    };
    const GetPrice = contract({
      topic: "shop.orders.price",
      request: IsOrder,
      reply: {
        parse: (value: unknown) => value as { id: number; price: number },
      },
    });
    const Slow = contract<number, string>({ topic: "shop.orders.slow" });
    const Created = contract<Order>({ topic: "shop.orders.created" });
    const Nobody = contract({ topic: "shop.orders.nobody" });
    const created: unknown[] = [];

    class Orders {
      price(order: Order) {
        if (order.id === 404) {
          throw new ReplyError(404, "Not Found");
        }
        if (order.id === 500) {
          throw new Error("a secret of the database");
        }
        return { id: order.id, price: order.id * 10 };
      }
      async slow(ms: number) {
        await new Promise((resolve) => setTimeout(resolve, ms));
        return "done";
      }
      created(order: Order, ctx: ChoMessageContext) {
        created.push([order, ctx.headers]);
      }
    }
    legacy(loose(Subscribe)(GetPrice), Orders, "price");
    legacy(loose(Subscribe)(Slow), Orders, "slow");
    legacy(loose(Subscribe)(Created), Orders, "created");
    loose(Middlewares(validate()))(Orders);
    loose(Controller({ topic: "shop.orders" }))(Orders);
    class App {}
    loose(Module({ controllers: [Orders] }))(App);
    const app = await ChoMessage.create(App, {
      prefix,
      linker: new NatsLinker({ connect, queue: unique("queue") }),
    });
    await app.start();

    // Another application: it only sends.
    const linker = new NatsLinker({ connect, queue: unique("asker") });
    class Asker {}
    loose(Module({}))(Asker);
    const asker = await ChoMessage.create(Asker, { linker });
    const client = new ChoMessageClient(linker.sender, { prefix });
    await assert.rejects(client.request(GetPrice, { id: 7 }), {
      code: "CHO_NATS_NOT_STARTED",
    });
    await asker.start();

    assert.deepEqual(await client.request(GetPrice, { id: 7 }), {
      id: 7,
      price: 70,
    });
    // A string is JSON both ways.
    assert.equal(await client.request(Slow, 1), "done");

    // What the handler threw, as a ReplyError.
    await assert.rejects(client.request(GetPrice, { id: 404 }), (error) => {
      assert.equal(isReplyError(error, 404), true);
      assert.equal((error as ReplyError).description, "Not Found");
      return true;
    });
    // Any other error: 500, and nothing of its message.
    await assert.rejects(client.request(GetPrice, { id: 500 }), (error) => {
      assert.equal(isReplyError(error, 500), true);
      assert.equal((error as ReplyError).description, "Internal Error");
      return true;
    });
    // A request that is not valid: 400.
    await assert.rejects(
      client.request(GetPrice, loose({ id: "seven" })),
      (error) => isReplyError(error, 400),
    );
    // No answer in time, and nobody that listens.
    await assert.rejects(client.request(Slow, 400, { timeout: 100 }), {
      code: "CHO_MESSAGE_REQUEST_TIMEOUT",
    });
    await assert.rejects(client.request(Nobody), {
      code: "CHO_MESSAGE_NO_RESPONDERS",
    });

    // A message that asks for no reply, with headers.
    await client.publish(Created, { id: 9 }, { headers: { Tenant: "acme" } });
    await asker.linked.instance.flush();
    await until(() => created.length === 1, "the message is handled");
    assert.deepEqual(created, [[{ id: 9 }, { Tenant: "acme" }]]);

    await asker.close();
    await app.close();
  });

  it("tells who asked when the reply is too large for the server", async () => {
    const prefix = unique("large");
    const subject = `${prefix}.orders.created`;
    const seen: unknown[] = [];
    const app = await start(prefix, (ctx) => {
      const { max_payload } = app.linked.instance.info!;
      return ctx.text() === "large" ? "x".repeat(max_payload + 1) : "small";
    }, {
      errorReply: (error) => void seen.push(error),
    });
    await with_client(async (client) => {
      const large = await client.request(subject, "large");
      assert.equal(large.headers?.get(ERROR_HEADERS.code), "500");
      // The adapter goes on.
      assert.equal((await client.request(subject, "small")).string(), "small");
    });
    await app.close();
    assert.equal(seen.length, 1);
    assert.equal(
      (seen[0] as { code?: string }).code,
      "CHO_NATS_REPLY_FAILED",
    );
  });

  it("goes on after a message that failed and asks for no reply", async () => {
    const prefix = unique("lost");
    const subject = `${prefix}.orders.created`;
    const seen: string[] = [];
    const app = await start(prefix, (ctx) => {
      seen.push(ctx.text());
      if (ctx.text() === "bad") {
        throw new Error("boom");
      }
    });
    await with_client(async (client) => {
      client.publish(subject, "bad");
      client.publish(subject, "good");
      await client.flush();
      await until(() => seen.length === 2, "both messages are handled");
    });
    await app.close();
    // The failed message is not delivered again: at most once.
    assert.deepEqual(seen, ["bad", "good"]);
  });

  it("gives each message to one instance of a queue group", async () => {
    const prefix = unique("group");
    const subject = `${prefix}.orders.created`;
    const queue = unique("queue");
    const seen: [string, string][] = [];
    const instance = (name: string) =>
      start(prefix, (ctx) => {
        seen.push([name, ctx.text()]);
        return name;
      }, { queue });
    const apps = [await instance("a"), await instance("b")];
    const total = 40;
    await with_client(async (client) => {
      const answers = await Promise.all(
        Array.from(
          { length: total },
          (_, i) => client.request(subject, String(i)),
        ),
      );
      // One answer for each request, from one of the two.
      assert.equal(answers.length, total);
      assert.ok(answers.every((one) => ["a", "b"].includes(one.string())));
    });
    await Promise.all(apps.map((app) => app.close()));
    assert.deepEqual(
      seen.map(([, text]) => Number(text)).sort((a, b) => a - b),
      Array.from({ length: total }, (_, i) => i),
    );
  });

  it("handles the messages of a subject in order, one at a time", async () => {
    const prefix = unique("order");
    const subject = `${prefix}.orders.created`;
    const seen: string[] = [];
    let running = 0;
    let most = 0;
    const app = await start(prefix, async (ctx) => {
      most = Math.max(most, ++running);
      await new Promise((resolve) => setTimeout(resolve, 2));
      seen.push(ctx.text());
      running--;
    });
    const sent = Array.from({ length: 20 }, (_, i) => String(i));
    await with_client(async (client) => {
      for (const text of sent) {
        client.publish(subject, text);
      }
      await client.flush();
      await until(
        () => seen.length === sent.length,
        "every message is handled",
      );
    });
    await app.close();
    assert.deepEqual(seen, sent);
    assert.equal(most, 1);
  });

  it("answers the requests it received before it closes", async () => {
    const prefix = unique("close");
    const subject = `${prefix}.orders.created`;
    let started = 0;
    const app = await start(prefix, async (ctx) => {
      started++;
      await new Promise((resolve) => setTimeout(resolve, 100));
      return `done ${ctx.text()}`;
    });
    await with_client(async (client) => {
      // Two requests: one in hand, and one that waits behind it.
      const answers = Promise.all([
        client.request(subject, "a", { timeout: 5000 }),
        client.request(subject, "b", { timeout: 5000 }),
      ]);
      await until(() => started === 1, "the first request is in hand");
      await app.close();
      assert.deepEqual((await answers).map((one) => one.string()), [
        "done a",
        "done b",
      ]);
      // Nobody answers any more.
      await assert.rejects(client.request(subject, "c", { timeout: 1000 }));
    });
    assert.equal(app.linked.instance.isClosed(), true);
  });

  it("tells the application when the connection closes by itself", async () => {
    const prefix = unique("fatal");
    const fatal: Error[] = [];
    const app = await start(prefix, () => undefined, {
      onFatal: (error) => void fatal.push(error),
    });
    await app.linked.instance.close();
    await until(() => fatal.length > 0, "onFatal is called");
    assert.equal(fatal.length, 1);
    assert.equal(
      (fatal[0] as { code?: string }).code,
      "CHO_NATS_CONNECTION_CLOSED",
    );
    await app.close();
  });

  it("rejects the start when no server answers", async () => {
    const app = await ChoMessage.create(orders_app(() => undefined), {
      linker: new NatsLinker({
        queue: "nobody",
        connect: () =>
          transport.connect(
            loose({ servers: "127.0.0.1:1", maxReconnectAttempts: 0 }),
          ),
      }),
    });
    await assert.rejects(app.start());
    await app.close();
  });
});
