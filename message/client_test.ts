/**
 * Tests for `client.ts`: `ChoMessageClient` sends the message of a contract
 * as JSON and reads its reply, and `localSender` delivers to an application
 * in the same process.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { legacy, loose } from "@chojs/core/utils/test_utils";
import { ChoMessageClient, localSender } from "./client.ts";
import type { ChoMessageContext } from "./context.ts";
import { contract } from "./contract.ts";
import { Controller, Middlewares, Module, Subscribe } from "./decorators.ts";
import { request_error } from "./errors.ts";
import type { Delivery, Reply, RequestOptions, Sender } from "./linker.ts";
import { ChoMessage } from "./message.ts";
import { isReplyError, ReplyError } from "./reply-error.ts";
import type { ChoMessageValidator } from "./types.ts";
import { validate } from "./validate.ts";

const encoder = new TextEncoder();

type Order = { id: number };
type Price = { id: number; price: number };

const WithId: ChoMessageValidator<Order> = {
  parse(value) {
    const id = Number((value as { id?: unknown } | null)?.id);
    if (!Number.isInteger(id)) {
      throw new Error("id: expected an integer");
    }
    return { id };
  },
};

const IsPrice: ChoMessageValidator<Price> = {
  parse(value) {
    const { id, price } = (value ?? {}) as Record<string, unknown>;
    if (typeof id !== "number" || typeof price !== "number") {
      throw new Error("not a price");
    }
    return { id, price: Math.round(price) };
  },
};

const GetPrice = contract({
  topic: "shop.orders.price",
  request: WithId,
  reply: IsPrice,
});
const Created = contract<Order>({ topic: "shop.orders.created" });
const Ping = contract({ topic: "ping" });

/** A sender that records what it is asked to send, and answers `reply`. */
function recording(reply?: Reply | Error) {
  const published: [string, Delivery][] = [];
  const requested: [string, Delivery, RequestOptions | undefined][] = [];
  const sender: Sender = {
    publish(topic, delivery) {
      published.push([topic, delivery]);
      return Promise.resolve();
    },
    request(topic, delivery, options) {
      requested.push([topic, delivery, options]);
      return reply instanceof Error
        ? Promise.reject(reply)
        : Promise.resolve(reply);
    },
  };
  return { sender, published, requested };
}

/** A reply with the given text. */
const reply_of = (text: string): Reply => ({ value: encoder.encode(text) });

describe("ChoMessageClient", () => {
  it("needs a sender", () => {
    for (
      const sender of [undefined, null, "nats", {}, { publish: "yes" }, {
        publish() {},
        request: true,
      }]
    ) {
      assert.throws(() => new ChoMessageClient(loose(sender)), {
        code: "CHO_MESSAGE_INVALID_CLIENT",
        message: /^new ChoMessageClient\(\): expected a sender, such as/,
      });
    }
  });

  it("checks its options", () => {
    const { sender } = recording();
    assert.throws(() => new ChoMessageClient(sender, loose(null)), {
      code: "CHO_MESSAGE_INVALID_CLIENT",
      message: /^new ChoMessageClient\(\): expected options, such as/,
    });
    assert.throws(() => new ChoMessageClient(sender, loose({ topic: "a" })), {
      code: "CHO_CORE_UNKNOWN_OPTION",
      message:
        'new ChoMessageClient(): unknown option "topic". Known options: prefix, timeout',
    });
    assert.throws(() => new ChoMessageClient(sender, { prefix: "a.*" }), {
      code: "CHO_MESSAGE_INVALID_TOPIC",
    });
    for (const timeout of [0, -1, "1s", NaN, Infinity]) {
      assert.throws(
        () => new ChoMessageClient(sender, loose({ timeout })),
        {
          code: "CHO_MESSAGE_INVALID_CLIENT",
          message:
            /^new ChoMessageClient\(\): "timeout" is a number of milliseconds/,
        },
      );
    }
  });
});

describe("ChoMessageClient.publish", () => {
  it("sends the value as JSON, to the topic of the contract", async () => {
    const { sender, published, requested } = recording();
    const client = new ChoMessageClient(sender);
    await client.publish(Created, { id: 7 });
    assert.deepEqual(published, [["shop.orders.created", {
      value: '{"id":7}',
    }]]);
    assert.deepEqual(requested, []);
  });

  it("sends a string, a number and null as JSON too", async () => {
    const { sender, published } = recording();
    const client = new ChoMessageClient(sender);
    const Any = contract<unknown>({ topic: "any" });
    await client.publish(Any, "text");
    await client.publish(Any, 0);
    await client.publish(Any, null);
    assert.deepEqual(published.map(([, delivery]) => delivery.value), [
      '"text"',
      "0",
      "null",
    ]);
  });

  it("sends no value for a message that has none", async () => {
    const { sender, published } = recording();
    const client = new ChoMessageClient(sender);
    await client.publish(Ping);
    await client.publish(Ping, undefined, { key: "k" });
    assert.deepEqual(published, [["ping", {}], ["ping", { key: "k" }]]);
  });

  it("sends the key and the headers", async () => {
    const { sender, published } = recording();
    const client = new ChoMessageClient(sender);
    await client.publish(Created, { id: 7 }, {
      key: "k7",
      headers: { tenant: "acme" },
    });
    assert.deepEqual(published[0]![1], {
      value: '{"id":7}',
      key: "k7",
      headers: { tenant: "acme" },
    });
  });

  it("puts its prefix before the topic", async () => {
    const { sender, published } = recording();
    const client = new ChoMessageClient(sender, { prefix: " staging " });
    await client.publish(Ping);
    assert.equal(published[0]![0], "staging.ping");
  });

  it("refuses what is not a contract, and a value that has no JSON", async () => {
    const client = new ChoMessageClient(recording().sender);
    await assert.rejects(client.publish(loose({ topic: "ping" })), {
      code: "CHO_MESSAGE_INVALID_CONTRACT",
      message:
        /^ChoMessageClient\.publish\(\): expected a contract, made by contract\(\), got/,
    });
    const Any = contract<unknown>({ topic: "any" });
    await assert.rejects(client.publish(Any, 10n), {
      code: "CHO_MESSAGE_INVALID_VALUE",
      message: /^Invalid value of a message to "any": .* cannot be serialized/,
    });
    await assert.rejects(client.publish(Any, () => {}), {
      code: "CHO_MESSAGE_INVALID_VALUE",
      message: /expected a value JSON can hold/,
    });
  });

  it("rejects with the error of the sender", async () => {
    const boom = new Error("no connection");
    const client = new ChoMessageClient({
      publish: () => Promise.reject(boom),
    });
    await assert.rejects(client.publish(Ping), boom);
  });
});

describe("ChoMessageClient.request", () => {
  it("sends the request, and gives the reply through its validator", async () => {
    const { sender, requested, published } = recording(
      reply_of('{"id":7,"price":41.6,"extra":true}'),
    );
    const client = new ChoMessageClient(sender);
    const price = await client.request(GetPrice, { id: 7 });
    assert.deepEqual(price, { id: 7, price: 42 });
    assert.deepEqual(requested, [
      ["shop.orders.price", { value: '{"id":7}' }, undefined],
    ]);
    assert.deepEqual(published, []);
  });

  it("gives the reply as JSON for a contract with no reply validator", async () => {
    const Raw = contract<Order, unknown>({ topic: "raw" });
    const reply = (text: string) =>
      new ChoMessageClient(recording(reply_of(text)).sender).request(Raw, {
        id: 1,
      });
    assert.deepEqual(await reply('{"a":[1]}'), { a: [1] });
    assert.equal(await reply('"pong"'), "pong");
    assert.equal(await reply("null"), null);
  });

  it("gives undefined for an empty reply, or none", async () => {
    for (const reply of [undefined, reply_of("")]) {
      const client = new ChoMessageClient(recording(reply).sender);
      assert.equal(await client.request(Ping), undefined);
    }
  });

  it("passes the time to wait: the request's, then the client's", async () => {
    const { sender, requested } = recording();
    await new ChoMessageClient(sender).request(Ping);
    await new ChoMessageClient(sender, { timeout: 500 }).request(Ping);
    await new ChoMessageClient(sender, { timeout: 500 }).request(
      Ping,
      undefined,
      { timeout: 50, headers: { a: "1" } },
    );
    assert.deepEqual(
      requested.map(([, delivery, options]) => [
        delivery,
        options,
      ]),
      [
        [{}, undefined],
        [{}, { timeout: 500 }],
        [{ headers: { a: "1" } }, { timeout: 50 }],
      ],
    );
    await assert.rejects(
      new ChoMessageClient(sender).request(Ping, undefined, { timeout: 0 }),
      {
        code: "CHO_MESSAGE_INVALID_CLIENT",
        message: /^ChoMessageClient\.request\(\): "timeout" is a number/,
      },
    );
  });

  it("rejects when the reply is not JSON", async () => {
    const client = new ChoMessageClient(recording(reply_of("pong")).sender);
    await assert.rejects(
      client.request(GetPrice, { id: 7 }),
      (error: Error) => {
        assert.equal(loose(error).code, "CHO_MESSAGE_UNEXPECTED_REPLY");
        assert.equal(
          error.message,
          'Unexpected reply to the request of "shop.orders.price": it is not JSON',
        );
        assert.ok(error.cause instanceof SyntaxError);
        return true;
      },
    );
  });

  it("rejects when the validator of the reply refuses it", async () => {
    const client = new ChoMessageClient(
      recording(reply_of('{"id":"7"}')).sender,
    );
    await assert.rejects(
      client.request(GetPrice, { id: 7 }),
      (error: Error) => {
        assert.equal(loose(error).code, "CHO_MESSAGE_UNEXPECTED_REPLY");
        assert.match(
          error.message,
          /the validator of its contract refused it$/,
        );
        assert.equal((error.cause as Error).message, "not a price");
        return true;
      },
    );
  });

  it("rejects with what the sender rejects with", async () => {
    const told = new ReplyError(404, "Not Found");
    await assert.rejects(
      new ChoMessageClient(recording(told).sender).request(Ping),
      told,
    );
    for (
      const code of [
        "CHO_MESSAGE_NO_RESPONDERS",
        "CHO_MESSAGE_REQUEST_TIMEOUT",
      ] as const
    ) {
      await assert.rejects(
        new ChoMessageClient(recording(request_error(code, "ping")).sender)
          .request(Ping),
        { code },
      );
    }
  });

  it("refuses a sender whose broker has no replies", async () => {
    const client = new ChoMessageClient({ publish: () => Promise.resolve() });
    await assert.rejects(client.request(Ping), {
      code: "CHO_MESSAGE_NO_REPLIES",
      message:
        /^ChoMessageClient\.request\(\): the sender cannot ask "ping": its broker has no replies/,
    });
  });
});

describe("request_error", () => {
  it("names the topic, and keeps the cause", () => {
    const cause = new Error("timeout");
    const late = request_error("CHO_MESSAGE_REQUEST_TIMEOUT", "a.b", { cause });
    assert.equal(
      late.message,
      'No answer to the request of "a.b": the time to wait is over',
    );
    assert.equal(late.cause, cause);
    assert.equal(
      request_error("CHO_MESSAGE_NO_RESPONDERS", "a.b").message,
      'No answer to the request of "a.b": nobody listens to it',
    );
  });
});

describe("localSender", () => {
  /** An application of the contracts of this file. */
  function shop(seen: unknown[] = []) {
    class Orders {
      price(order: Order) {
        if (order.id === 404) {
          throw new ReplyError(404, "Not Found");
        }
        if (order.id === 500) {
          throw new Error("a secret");
        }
        return { id: order.id, price: order.id * 10 };
      }
      created(order: Order, ctx: ChoMessageContext) {
        seen.push([order, ctx.key, ctx.headers]);
      }
      ping() {
        return "pong";
      }
    }
    legacy(loose(Subscribe)(GetPrice), Orders, "price");
    legacy(loose(Subscribe)(Created), Orders, "created");
    legacy(loose(Subscribe)(Ping), Orders, "ping");
    Middlewares(validate())(Orders);
    Controller()(Orders);
    class App {}
    Module({ controllers: [Orders] })(App);
    return App;
  }

  it("needs an application", () => {
    for (const app of [undefined, null, {}, { handle: "yes" }]) {
      assert.throws(() => localSender(loose(app)), {
        code: "CHO_MESSAGE_INVALID_CLIENT",
        message: /^localSender\(\): expected an application, such as/,
      });
    }
  });

  it("gives a request to its handler, and the reply back, typed", async () => {
    const app = await ChoMessage.create(shop());
    const client = new ChoMessageClient(localSender(app));
    const price: Price = await client.request(GetPrice, { id: 7 });
    assert.deepEqual(price, { id: 7, price: 70 });
    // A string is JSON both ways.
    assert.equal(
      await client.request(contract<unknown, string>({
        topic: "ping",
      })),
      "pong",
    );
  });

  it("gives a message to its handler, with its key and its headers", async () => {
    const seen: unknown[] = [];
    const app = await ChoMessage.create(shop(seen));
    const client = new ChoMessageClient(localSender(app));
    await client.publish(Created, { id: 7 }, {
      key: "k",
      headers: { tenant: "acme" },
    });
    assert.deepEqual(seen, [[{ id: 7 }, "k", { tenant: "acme" }]]);
  });

  it("rejects with the ReplyError of the handler", async () => {
    const app = await ChoMessage.create(shop());
    const client = new ChoMessageClient(localSender(app));
    await assert.rejects(
      client.request(GetPrice, { id: 404 }),
      (error: unknown) => {
        assert.equal(isReplyError(error, 404), true);
        assert.equal((error as ReplyError).description, "Not Found");
        return true;
      },
    );
  });

  it("rejects with the error of a message that failed, or is not valid", async () => {
    const app = await ChoMessage.create(shop());
    const client = new ChoMessageClient(localSender(app));
    await assert.rejects(client.request(GetPrice, { id: 500 }), {
      message: "a secret",
    });
    await assert.rejects(client.request(GetPrice, loose({ id: "x" })), {
      code: "CHO_MESSAGE_INVALID_MESSAGE",
    });
  });

  it("uses the prefix of the application", async () => {
    const app = await ChoMessage.create(shop(), { prefix: "staging" });
    const sender = localSender(app);
    assert.deepEqual(
      await new ChoMessageClient(sender, { prefix: "staging" }).request(
        GetPrice,
        { id: 1 },
      ),
      { id: 1, price: 10 },
    );
    await assert.rejects(
      new ChoMessageClient(sender).request(GetPrice, { id: 1 }),
      { code: "CHO_MESSAGE_UNKNOWN_TOPIC" },
    );
  });
});
