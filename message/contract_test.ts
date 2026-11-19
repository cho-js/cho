/**
 * Tests for `contract.ts`, and for `@Subscribe(contract)`: what a contract
 * is, the topic of its handler, how the handler is called, and what it
 * replies.
 *
 * Decorators are applied as plain function calls, so the tests run on every
 * runtime. The typed decorator is checked with decorator syntax in
 * `syntax_test.ts`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  type AnyMethodDecorator,
  legacy,
  loose,
  standard_schema,
} from "@chojs/core/utils/test_utils";
import { Value } from "./args.ts";
import type { ChoMessageContext } from "./context.ts";
import { type Contract, contract, is_contract } from "./contract.ts";
import {
  Args,
  Catch,
  Controller,
  Middlewares,
  Module,
  Subscribe,
} from "./decorators.ts";
import type { Delivery, Reply } from "./linker.ts";
import { ChoMessage } from "./message.ts";
import { ReplyError } from "./reply-error.ts";
import { ChoMessageReply } from "./reply.ts";
import type { ChoValidator } from "@chojs/core";
import { validate } from "./validate.ts";

type Class = new () => object;

/** `@Subscribe(contract)`, as a decorator the test helpers apply by hand. */
const subscribe = (of: unknown): AnyMethodDecorator => loose(Subscribe)(of);

/** The text of a reply. */
const text_of = (reply: Reply | undefined) =>
  reply === undefined ? undefined : new TextDecoder().decode(reply.value);

/** A validator that gives `{ id: number }`, or throws. */
const WithId: ChoValidator<{ id: number }> = {
  parse(value) {
    const id = Number((value as { id?: unknown } | null)?.id);
    if (!Number.isInteger(id)) {
      throw new Error("id: expected an integer");
    }
    return { id };
  },
};

const Price: ChoValidator<{ id: number; price: number }> = {
  parse: (value) => value as { id: number; price: number },
};

const GetPrice = contract({
  topic: "shop.orders.price",
  request: WithId,
  reply: Price,
});

/**
 * An application with one handler of a contract: `run` is what the handler
 * does. `topics` are those of the module and of the controller.
 */
function app_of(
  of: Contract<unknown, unknown>,
  run: (...values: unknown[]) => unknown,
  { module, controller, middlewares = [] }: {
    module?: string;
    controller?: string;
    middlewares?: unknown[];
  } = {},
) {
  class Ctrl {
    run(...values: unknown[]) {
      return run(...values);
    }
  }
  legacy(subscribe(of), Ctrl, "run");
  if (middlewares.length > 0) {
    Middlewares(...loose(middlewares))(Ctrl);
  }
  Controller(controller === undefined ? {} : { topic: controller })(Ctrl);
  class App {}
  Module({
    controllers: [Ctrl as Class],
    ...(module === undefined ? {} : { topic: module }),
  })(App);
  return App;
}

/** Deliver a message to an application. */
async function deliver(app: Class, topic: string, delivery: Delivery = {}) {
  return (await ChoMessage.create(app)).handle(topic, delivery);
}

describe("contract", () => {
  it("keeps the topic and the validators", () => {
    assert.deepEqual(GetPrice, {
      topic: "shop.orders.price",
      request: WithId,
      reply: Price,
    });
    assert.equal(Object.isFrozen(GetPrice), true);
    assert.deepEqual(Object.keys(GetPrice), ["topic", "request", "reply"]);
  });

  it("needs a topic only", () => {
    const Ping = contract({ topic: "  ping " });
    assert.deepEqual(Ping, { topic: "ping" });
    assert.deepEqual(contract({ topic: "a", reply: Price }), {
      topic: "a",
      reply: Price,
    });
  });

  it("is recognized, and nothing else is", () => {
    assert.equal(is_contract(GetPrice), true);
    for (const value of [undefined, null, "a", { topic: "a" }, WithId]) {
      assert.equal(is_contract(value), false);
    }
  });

  it("refuses options that are not an object, or not known", () => {
    for (const options of [undefined, null, "shop.orders.price"]) {
      assert.throws(() => contract(loose(options)), {
        code: "CHO_MESSAGE_INVALID_CONTRACT",
        message: /^contract\(\): expected options, such as/,
      });
    }
    assert.throws(() => contract(loose({ topic: "a", response: Price })), {
      code: "CHO_CORE_UNKNOWN_OPTION",
      message:
        'contract(): unknown option "response". Known options: reply, request, topic',
    });
  });

  it("refuses a topic that is missing, empty or not valid", () => {
    assert.throws(() => contract(loose({})), {
      code: "CHO_MESSAGE_INVALID_TOPIC",
      message: /^Invalid topic of contract\(\): expected a string/,
    });
    assert.throws(() => contract({ topic: " " }), {
      code: "CHO_MESSAGE_INVALID_TOPIC",
      message: /^Invalid topic of contract\(\): it is empty/,
    });
    assert.throws(() => contract({ topic: "orders.*" }), {
      code: "CHO_MESSAGE_INVALID_TOPIC",
    });
  });

  it("refuses what is not a validator", () => {
    for (const name of ["request", "reply"]) {
      for (const given of [{ safeParse() {} }, { "~standard": {} }, "id"]) {
        assert.throws(
          () => contract(loose({ topic: "a", [name]: given })),
          {
            code: "CHO_MESSAGE_INVALID_CONTRACT",
            message: new RegExp(
              `^contract\\(\\): "${name}" is a validator \\(a Standard Schema, or an object with a parse method\\), got`,
            ),
          },
        );
      }
    }
  });

  it("takes Standard Schemas, and keeps them", () => {
    const request = standard_schema<{ id: number }>((value) => ({
      value: value as { id: number },
    }));
    const reply = Object.assign(
      () => {},
      standard_schema((value) => ({ value })),
    );
    const made = contract({ topic: "a", request, reply });
    assert.equal(made.request, request);
    assert.equal(made.reply, reply);
  });
});

describe("@Subscribe(contract): the topic", () => {
  it("is the topic of the contract, under the prefix of the application", async () => {
    const App = app_of(GetPrice, () => undefined);
    const app = await ChoMessage.create(App, { prefix: "staging" });
    assert.deepEqual(app.routes.map((route) => route.topic), [
      "staging.shop.orders.price",
    ]);
  });

  it("goes with the topics of its module and controller that are the start of it", async () => {
    for (
      const [topics, relative] of [
        [{ module: "shop" }, "orders.price"],
        [{ controller: "shop.orders" }, "price"],
        [{ module: "shop", controller: "orders" }, "price"],
        [{ module: "shop.orders", controller: "price" }, ""],
        [{}, "shop.orders.price"],
      ] as const
    ) {
      const app = await ChoMessage.create(
        app_of(GetPrice, () => undefined, topics),
      );
      assert.deepEqual(app.routes.map((route) => route.topic), [
        "shop.orders.price",
      ]);
      const [method] = app.graph.features[0]!.controllers[0]!.methods;
      assert.equal(method!.topic, relative);
    }
  });

  it("refuses a module or a controller whose topic is not the start of it", async () => {
    for (
      const [topics, parent] of [
        [{ module: "billing" }, "billing"],
        [{ controller: "orders" }, "orders"],
        [{ module: "shop", controller: "payments" }, "shop.payments"],
        [{ module: "sho" }, "sho"],
        [{ controller: "shop.orders.price.more" }, "shop.orders.price.more"],
      ] as const
    ) {
      await assert.rejects(
        ChoMessage.create(app_of(GetPrice, () => undefined, topics)),
        {
          code: "CHO_MESSAGE_INVALID_TOPIC",
          message:
            `Invalid topic of method run of controller Ctrl: the topic of its contract, "shop.orders.price", does not start with "${parent}", the topic of its module and controller. A contract has the whole topic of its handler`,
        },
      );
    }
  });

  it("refuses a second @Subscribe, and @Args, on the handler", () => {
    class Ctrl {
      one() {}
      two() {}
      three() {}
    }
    legacy(subscribe(GetPrice), Ctrl, "one");
    assert.throws(() => legacy(Subscribe("other"), Ctrl, "one"), {
      code: "CHO_MESSAGE_DUPLICATE_DECORATOR",
      message: /it already handles "shop\.orders\.price"/,
    });
    assert.throws(() => legacy(loose(Args(Value())), Ctrl, "one"), {
      code: "CHO_MESSAGE_DUPLICATE_DECORATOR",
      message:
        "Cannot add @Args() to method one: it is the handler of a contract, and receives its request, then the context.",
    });
    legacy(loose(Args(Value())), Ctrl, "two");
    assert.throws(() => legacy(subscribe(GetPrice), Ctrl, "two"), {
      code: "CHO_MESSAGE_DUPLICATE_DECORATOR",
      message:
        "Cannot add @Subscribe() of a contract to method two: it has @Args(). A handler of a contract receives its request, then the context.",
    });
  });

  it("reports what is neither a topic nor a contract as a topic", () => {
    class Ctrl {
      run() {}
    }
    assert.throws(() => legacy(subscribe({ topic: "a" }), Ctrl, "run"), {
      code: "CHO_MESSAGE_INVALID_TOPIC",
    });
  });
});

describe("@Subscribe(contract): the handler", () => {
  it("receives the value of the message, then the context", async () => {
    const seen: unknown[][] = [];
    const App = app_of(GetPrice, (...values) => void seen.push(values));
    await deliver(App, "shop.orders.price", { value: '{"id":"7"}', key: "k" });
    const [request, ctx] = seen[0]!;
    // Not validated: validate() is not on the route.
    assert.deepEqual(request, { id: "7" });
    assert.equal((ctx as ChoMessageContext).key, "k");
    assert.equal(seen[0]!.length, 2);
  });

  it("receives the request through its validator, with validate()", async () => {
    const seen: unknown[] = [];
    const App = app_of(GetPrice, (request) => void seen.push(request), {
      middlewares: [validate()],
    });
    await deliver(App, "shop.orders.price", { value: '{"id":"7","x":1}' });
    assert.deepEqual(seen, [{ id: 7 }]);
    await assert.rejects(
      deliver(App, "shop.orders.price", { value: '{"id":"x"}' }),
      {
        code: "CHO_MESSAGE_INVALID_MESSAGE",
        message:
          "Invalid message of shop.orders.price: the value is not valid: id: expected an integer",
      },
    );
  });

  it("receives the value as it is for a contract with no request validator", async () => {
    const seen: unknown[] = [];
    const Ping = contract({ topic: "ping" });
    const App = app_of(Ping, (request) => void seen.push(request), {
      middlewares: [validate()],
    });
    await deliver(App, "ping", { value: "[1,2]" });
    await deliver(App, "ping");
    assert.deepEqual(seen, [[1, 2], undefined]);
  });

  it("has its contract, and its argument, on the graph", async () => {
    const app = await ChoMessage.create(
      app_of(GetPrice, () => undefined, { middlewares: [validate()] }),
    );
    const [method] = app.graph.features[0]!.controllers[0]!.methods;
    assert.equal(method!.contract, GetPrice);
    assert.equal(method!.validated, true);
    assert.deepEqual(method!.args.map((arg) => arg.info), [
      { source: "value", validator: WithId },
    ]);
    // A handler of a topic has no contract.
    class Plain {
      run() {}
    }
    legacy(Subscribe("plain"), Plain, "run");
    Controller()(Plain);
    class App {}
    Module({ controllers: [Plain] })(App);
    const plain = await ChoMessage.create(App);
    assert.equal(
      plain.graph.features[0]!.controllers[0]!.methods[0]!.contract,
      undefined,
    );
  });
});

describe("@Subscribe(contract): the reply", () => {
  /** The reply of a handler that returns `value`. */
  const reply_of = (value: unknown) =>
    deliver(app_of(GetPrice, () => value), "shop.orders.price");

  it("is what the handler returns, as JSON", async () => {
    assert.equal(
      text_of(await reply_of({ id: 7, price: 42 })),
      '{"id":7,"price":42}',
    );
    assert.equal(text_of(await reply_of([1, 2])), "[1,2]");
    assert.equal(text_of(await reply_of(null)), "null");
    assert.equal(text_of(await reply_of(0)), "0");
    assert.equal(
      text_of(await reply_of(Promise.resolve({ ok: true }))),
      '{"ok":true}',
    );
  });

  it("is JSON for a string too: a contract speaks JSON", async () => {
    assert.equal(text_of(await reply_of("pong")), '"pong"');
    assert.equal(text_of(await reply_of("")), '""');
    // A handler of a topic sends the text of a string.
    class Plain {
      run() {
        return "pong";
      }
    }
    legacy(Subscribe("plain"), Plain, "run");
    Controller()(Plain);
    class App {}
    Module({ controllers: [Plain] })(App);
    assert.equal(text_of(await deliver(App, "plain")), "pong");
  });

  it("is none for a handler that returns nothing", async () => {
    assert.equal(await reply_of(undefined), undefined);
  });

  it("keeps the headers of a ChoMessageReply, with its value as JSON", async () => {
    const reply = await reply_of(
      new ChoMessageReply({ id: 7 }, { headers: { cache: "60" } }),
    );
    assert.equal(text_of(reply), '{"id":7}');
    assert.deepEqual(reply?.headers, { cache: "60" });
    const text = await reply_of(new ChoMessageReply("pong"));
    assert.equal(text_of(text), '"pong"');
    const empty = await reply_of(
      new ChoMessageReply(undefined, { headers: { status: "204" } }),
    );
    assert.equal(empty?.value.byteLength, 0);
    assert.deepEqual(empty?.headers, { status: "204" });
  });

  it("fails the message for a value that has no JSON", async () => {
    await assert.rejects(reply_of(10n), {
      code: "CHO_MESSAGE_INVALID_REPLY",
      message: /^Invalid reply of Ctrl\.run: /,
    });
  });

  it("rejects with the ReplyError the handler throws, after the error handler", async () => {
    const error = new ReplyError(404, "Not Found");
    const caught: unknown[] = [];
    class Ctrl {
      run() {
        throw error;
      }
    }
    legacy(subscribe(GetPrice), Ctrl, "run");
    legacy(Catch((thrown) => void caught.push(thrown)), Ctrl, "run");
    Controller()(Ctrl);
    class App {}
    Module({ controllers: [Ctrl] })(App);
    await assert.rejects(deliver(App, "shop.orders.price"), error);
    assert.deepEqual(caught, [error]);
  });
});
