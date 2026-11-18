/**
 * Tests for `@Args` and `validate()`, end to end: what `@Args` records, how
 * a handler with arguments is called, what a message that is not valid leads
 * to, and what the graph of the application exposes.
 *
 * Decorators are applied as plain function calls, so the tests run on every
 * runtime. The typed decorator of `@Args` is checked with decorator syntax
 * in `syntax_test.ts`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isChoError } from "@chojs/core";
import { read_method_metadata } from "@chojs/core/di";
import type { Debuglog } from "@chojs/core/utils";
import {
  type AnyMethodDecorator,
  legacy,
  loose,
  tc39,
  tc39_record,
} from "@chojs/core/utils/test_utils";
import { Header, Key, Value } from "./args.ts";
import type { ChoMessageContext } from "./context.ts";
import {
  Args,
  Catch,
  Controller,
  Middlewares,
  Module,
  Subscribe,
} from "./decorators.ts";
import { ARGS, handler_args } from "./keys.ts";
import type { Delivery, Reply } from "./linker.ts";
import { ChoMessage } from "./message.ts";
import { ChoMessageReply } from "./reply.ts";
import { compile_routes } from "./routes.ts";
import type {
  ChoMessageArg,
  ChoMessageInvalid,
  ChoMessageMiddlewareFn,
  ChoMessageValidator,
} from "./types.ts";
import { validate } from "./validate.ts";

type Class = new () => object;

/** `@Args`, as a decorator the test helpers can apply by hand. */
const args = (...list: unknown[]): AnyMethodDecorator =>
  loose(Args(...loose(list)));

/** A module declaring the given controllers. */
function feature(controllers: Class[], middlewares: unknown[] = []) {
  class Feature {}
  if (middlewares.length > 0) {
    Middlewares(...loose(middlewares))(Feature);
  }
  Module({ controllers })(Feature);
  return Feature;
}

/**
 * A controller with one handler, of the topic `orders`: `run` is called with
 * what the handler receives.
 */
function controller(
  list: unknown[],
  run: (...values: unknown[]) => unknown,
  middlewares: unknown[] = [],
) {
  class Ctrl {
    run(...values: unknown[]) {
      return run(...values);
    }
  }
  legacy(args(...list), Ctrl, "run");
  legacy(Subscribe("orders"), Ctrl, "run");
  if (middlewares.length > 0) {
    legacy(loose(Middlewares(...loose(middlewares))), Ctrl, "run");
  }
  Controller()(Ctrl);
  return Ctrl;
}

/** Deliver a message to the handler of `controller`. */
async function deliver(ctrl: Class, delivery: Delivery, on: unknown[] = []) {
  const app = await ChoMessage.create(feature([ctrl], on));
  return app.handle("orders", delivery);
}

/** The text of a reply. */
const text_of = (reply: Reply | undefined) =>
  reply === undefined ? undefined : new TextDecoder().decode(reply.value);

/** A validator that gives an order with a numeric id, or throws. */
const Order: ChoMessageValidator<{ id: number }> = {
  parse(value) {
    const id = Number((value as { id?: unknown } | null)?.id);
    if (!Number.isInteger(id)) {
      throw Object.assign(new Error("id: expected an integer"), {
        issues: [{ path: ["id"], message: "expected an integer" }],
      });
    }
    return { id };
  },
};

const number: ChoMessageValidator<number> = { parse: (value) => Number(value) };

describe("@Args", () => {
  it("writes the list of arguments on the method (TC39)", () => {
    const value = Value();
    const key = Key();
    function created() {}
    tc39(args(value, key), created, "created");
    const record = handler_args(tc39_record(created, "created") as object);
    assert.deepEqual(record, { list: [value, key] });
    assert.ok(Object.isFrozen(record) && Object.isFrozen(record!.list));
  });

  it("writes the list of arguments on the method (legacy)", () => {
    const value = Value();
    class Ctrl {
      created() {}
    }
    legacy(args(value), Ctrl, "created");
    assert.deepEqual(
      (read_method_metadata(Ctrl, "created") as Record<symbol, unknown>)[ARGS],
      { list: [value] },
    );
  });

  it("goes above or below @Subscribe", async () => {
    for (const order of ["above", "below"]) {
      const seen: unknown[] = [];
      class Ctrl {
        run(key: unknown) {
          seen.push(key);
        }
      }
      if (order === "below") {
        legacy(args(Key()), Ctrl, "run");
      }
      legacy(Subscribe("orders"), Ctrl, "run");
      if (order === "above") {
        legacy(args(Key()), Ctrl, "run");
      }
      Controller()(Ctrl);
      await deliver(Ctrl, { key: "k1" });
      assert.deepEqual(seen, ["k1"]);
    }
  });

  it("rejects an argument that is not a function", () => {
    class Ctrl {
      run() {}
    }
    assert.throws(() => legacy(args(Value(), "id"), Ctrl, "run"), {
      code: "CHO_MESSAGE_INVALID_ARGUMENT",
      message:
        '@Args() on method run: argument 2 must be made with Value, Key or Header, or be a function, got "id"',
    });
  });

  it("rejects a second @Args on a method", () => {
    class Ctrl {
      run() {}
    }
    legacy(args(Value()), Ctrl, "run");
    assert.throws(() => legacy(args(Key()), Ctrl, "run"), {
      code: "CHO_MESSAGE_DUPLICATE_DECORATOR",
      message: "Cannot add @Args() to method run: it already has one.",
    });
  });

  it("rejects a static method, and one named by a symbol", () => {
    class Ctrl {
      static run() {}
    }
    assert.throws(
      () => legacy(args(Value()), Ctrl, "run", { isStatic: true }),
      { code: "CHO_CORE_INVALID_TARGET" },
    );
    assert.throws(
      () => tc39(args(Value()), function sym() {}, Symbol("sym")),
      { code: "CHO_CORE_INVALID_TARGET", message: /symbol-named method/ },
    );
  });
});

describe("a handler with arguments", () => {
  it("is called with the value of each argument, then the context", async () => {
    const seen: unknown[][] = [];
    const Topic: ChoMessageArg<string> = (ctx) => ctx.topic;
    const Ctrl = controller(
      [Value(), Value("id"), Key(), Header("tenant"), Header(), Topic],
      (...values) => void seen.push(values),
    );
    await deliver(Ctrl, {
      value: '{"id":7}',
      key: "k1",
      headers: { tenant: "acme" },
    });
    const [value, id, key, tenant, headers, topic, ctx] = seen[0]!;
    assert.deepEqual(value, { id: 7 });
    assert.equal(id, 7);
    assert.equal(key, "k1");
    assert.equal(tenant, "acme");
    assert.deepEqual(headers, { tenant: "acme" });
    assert.equal(topic, "orders");
    assert.equal((ctx as ChoMessageContext).topic, "orders");
    assert.equal(seen[0]!.length, 7);
  });

  it("receives the context alone without @Args, or with an empty one", async () => {
    const seen: unknown[][] = [];
    class Plain {
      run(...values: unknown[]) {
        seen.push(values);
      }
    }
    legacy(Subscribe("orders"), Plain, "run");
    Controller()(Plain);
    await deliver(Plain, { value: "1" });
    await deliver(controller([], (...values) => void seen.push(values)), {});
    assert.deepEqual(seen.map((values) => values.length), [1, 1]);
  });

  it("gives its reply, as any handler does", async () => {
    const Ctrl = controller([Value("id")], (id) => ({ id, price: 42 }));
    assert.equal(
      text_of(await deliver(Ctrl, { value: '{"id":7}' })),
      '{"id":7,"price":42}',
    );
  });

  it("awaits an argument that is asynchronous", async () => {
    const seen: unknown[] = [];
    const Later: ChoMessageArg<string> = async (ctx) => {
      await Promise.resolve();
      return `later ${ctx.key}`;
    };
    await deliver(controller([Later], (value) => void seen.push(value)), {
      key: "k",
    });
    assert.deepEqual(seen, ["later k"]);
  });

  it("evaluates its arguments after the middlewares, in order", async () => {
    const order: string[] = [];
    const arg = (name: string): ChoMessageArg => () => void order.push(name);
    const middleware: ChoMessageMiddlewareFn = async (_ctx, next) => {
      order.push("middleware");
      await next();
      order.push("after");
    };
    const Ctrl = controller(
      [arg("first"), arg("second")],
      () => void order.push("handler"),
      [middleware],
    );
    await deliver(Ctrl, {});
    assert.deepEqual(order, [
      "middleware",
      "first",
      "second",
      "handler",
      "after",
    ]);
  });

  it("is not called, and evaluates nothing, when a middleware skips it", async () => {
    let evaluated = 0;
    const Ctrl = controller(
      [() => void evaluated++],
      () => {
        throw new Error("not called");
      },
      [() => {}],
    );
    assert.equal(await deliver(Ctrl, { value: "{broken" }), undefined);
    assert.equal(evaluated, 0);
  });

  it("gives the error of an argument to the error handler", async () => {
    const boom = new Error("boom");
    const caught: unknown[] = [];
    class Ctrl {
      run() {
        throw new Error("not called");
      }
    }
    legacy(args(() => Promise.reject(boom)), Ctrl, "run");
    legacy(Subscribe("orders"), Ctrl, "run");
    legacy(Catch((error) => void caught.push(error)), Ctrl, "run");
    Controller()(Ctrl);
    await assert.rejects(deliver(Ctrl, {}), boom);
    assert.deepEqual(caught, [boom]);
  });

  it("keeps the arguments it inherits, unless it declares its own", async () => {
    const seen: unknown[][] = [];
    class Base {
      run(...values: unknown[]) {
        seen.push(values.slice(0, -1));
      }
    }
    legacy(args(Key()), Base, "run");
    legacy(Subscribe("orders"), Base, "run");
    class Keeps extends Base {}
    Controller()(Keeps);
    class Replaces extends Base {
      override run(...values: unknown[]) {
        super.run(...values);
      }
    }
    legacy(args(Value("id"), Key()), Replaces, "run");
    Controller()(Replaces);
    await deliver(Keeps, { key: "k", value: '{"id":1}' });
    await deliver(Replaces, { key: "k", value: '{"id":1}' });
    assert.deepEqual(seen, [["k"], [1, "k"]]);
  });
});

describe("validation", () => {
  it("runs the validators of a handler validate() covers: they convert", async () => {
    const seen: unknown[][] = [];
    const Ctrl = controller(
      [Value(Order), Header("attempt", number), Key()],
      (...values) => void seen.push(values.slice(0, -1)),
      [validate()],
    );
    await deliver(Ctrl, {
      value: '{"id":"7","extra":true}',
      headers: { attempt: "2" },
    });
    assert.deepEqual(seen, [[{ id: 7 }, 2, undefined]]);
  });

  it("awaits a validator that is asynchronous", async () => {
    const seen: unknown[] = [];
    const later: ChoMessageValidator<string> = {
      parse: async (value) => {
        await Promise.resolve();
        return `checked ${value}`;
      },
    };
    await deliver(
      controller([Key(later)], (key) => void seen.push(key), [validate()]),
      { key: "k" },
    );
    assert.deepEqual(seen, ["checked k"]);
  });

  it("covers a handler from its controller, and from its feature", async () => {
    for (const level of ["controller", "feature"]) {
      const seen: unknown[] = [];
      class Ctrl {
        run(order: unknown) {
          seen.push(order);
        }
      }
      legacy(args(Value(Order)), Ctrl, "run");
      legacy(Subscribe("orders"), Ctrl, "run");
      if (level === "controller") {
        Middlewares(validate())(Ctrl);
      }
      Controller()(Ctrl);
      await deliver(
        Ctrl,
        { value: '{"id":"7"}' },
        level === "feature" ? [validate()] : [],
      );
      assert.deepEqual(seen, [{ id: 7 }]);
    }
  });

  it("does not run a validator without validate() on the route", async () => {
    const seen: unknown[] = [];
    const Ctrl = controller([Value(Order)], (order) => void seen.push(order));
    await deliver(Ctrl, { value: '{"id":"not a number"}' });
    assert.deepEqual(seen, [{ id: "not a number" }]);
  });

  it("fails a message that is not valid, and does not call the handler", async () => {
    let called = false;
    const Ctrl = controller(
      [Value(Order)],
      () => void (called = true),
      [validate()],
    );
    await assert.rejects(
      deliver(Ctrl, { value: '{"id":"x"}' }),
      (error: Error) => {
        assert.equal(isChoError(error, "CHO_MESSAGE_INVALID_MESSAGE"), true);
        assert.equal(
          error.message,
          "Invalid message of orders: the value is not valid",
        );
        assert.equal((error.cause as Error).message, "id: expected an integer");
        return true;
      },
    );
    assert.equal(called, false);
  });

  it("names the property, the key or the header that is not valid", async () => {
    const fails: ChoMessageValidator = {
      parse() {
        throw new Error("no");
      },
    };
    for (
      const [arg, message] of [
        [Value("id", fails), 'the property "id" of the value is not valid'],
        [Key(fails), "the key is not valid"],
        [Header(fails), "the headers is not valid"],
        [Header("tenant", fails), 'the header "tenant" is not valid'],
      ] as const
    ) {
      await assert.rejects(
        deliver(controller([arg], () => {}, [validate()]), {}),
        {
          code: "CHO_MESSAGE_INVALID_MESSAGE",
          message: `Invalid message of orders: ${message}`,
        },
      );
    }
  });

  it("fails a validated message whose value is not JSON, with the same code", async () => {
    const Ctrl = controller([Value()], () => {}, [validate()]);
    await assert.rejects(
      deliver(Ctrl, { value: "{not json" }),
      (error: Error) => {
        assert.equal(isChoError(error, "CHO_MESSAGE_INVALID_MESSAGE"), true);
        assert.ok(error.cause instanceof SyntaxError);
        return true;
      },
    );
    // Without validate(), it is the error of JSON, as from any handler.
    await assert.rejects(
      deliver(controller([Value()], () => {}), { value: "{not json" }),
      SyntaxError,
    );
  });

  it("gives a message that is not valid to the error handler", async () => {
    const caught: unknown[] = [];
    class Ctrl {
      run() {}
    }
    legacy(args(Value(Order)), Ctrl, "run");
    legacy(Subscribe("orders"), Ctrl, "run");
    legacy(loose(Middlewares(validate())), Ctrl, "run");
    legacy(
      Catch((error) => {
        caught.push(error);
        return true; // handled: skipped
      }),
      Ctrl,
      "run",
    );
    Controller()(Ctrl);
    assert.equal(await deliver(Ctrl, { value: "{}" }), undefined);
    assert.equal(isChoError(caught[0], "CHO_MESSAGE_INVALID_MESSAGE"), true);
  });
});

describe("validate({ onInvalid })", () => {
  /** A validated handler of an `Order`, with the given `onInvalid`. */
  const validated = (
    onInvalid: (invalid: ChoMessageInvalid, ctx: ChoMessageContext) => unknown,
    run: (...values: unknown[]) => unknown = () => "handled",
  ) =>
    controller([Key(), Value("order", Order)], run, [validate({ onInvalid })]);

  it("receives what failed, and the context", async () => {
    const calls: [ChoMessageInvalid, ChoMessageContext][] = [];
    const Ctrl = validated((invalid, ctx) => {
      calls.push([invalid, ctx]);
      return true;
    });
    await deliver(Ctrl, { value: '{"order":{"id":"x"}}', key: "k" });
    const [invalid, ctx] = calls[0]!;
    assert.equal(invalid.source, "value");
    assert.equal(invalid.key, "order");
    assert.equal((invalid.error as Error).message, "id: expected an integer");
    assert.equal(ctx.key, "k");
    assert.equal(calls.length, 1);
  });

  it("is not called for a message that is valid", async () => {
    let calls = 0;
    const Ctrl = validated(() => void calls++);
    assert.equal(
      text_of(await deliver(Ctrl, { value: '{"order":{"id":1}}' })),
      "handled",
    );
    assert.equal(calls, 0);
  });

  it("fails the message for nothing, and for false", async () => {
    for (const answer of [undefined, false]) {
      await assert.rejects(
        deliver(validated(() => answer), { value: "{}" }),
        { code: "CHO_MESSAGE_INVALID_MESSAGE" },
      );
      await assert.rejects(
        deliver(validated(() => Promise.resolve(answer)), { value: "{}" }),
        { code: "CHO_MESSAGE_INVALID_MESSAGE" },
      );
    }
  });

  it("handles the message with no reply, for true", async () => {
    let called = false;
    const Ctrl = validated(() => true, () => void (called = true));
    assert.equal(await deliver(Ctrl, { value: "{}" }), undefined);
    assert.equal(called, false);
  });

  it("handles the message with a reply, for any other value", async () => {
    assert.equal(
      text_of(
        await deliver(
          validated(({ source }) => ({ error: `bad ${source}` })),
          { value: "{}" },
        ),
      ),
      '{"error":"bad value"}',
    );
    assert.equal(
      text_of(await deliver(validated(() => null), { value: "{}" })),
      "null",
    );
    const reply = await deliver(
      validated(() =>
        new ChoMessageReply("no", { headers: { status: "400" } })
      ),
      { value: "{}" },
    );
    assert.equal(text_of(reply), "no");
    assert.deepEqual(reply?.headers, { status: "400" });
  });

  it("gives what it throws to the error handler", async () => {
    const boom = new Error("the option is broken");
    await assert.rejects(
      deliver(
        validated(() => {
          throw boom;
        }),
        { value: "{}" },
      ),
      boom,
    );
  });

  it("is the one of the nearest validate(): the handler's, then the controller's", async () => {
    const calls: string[] = [];
    const says = (name: string) =>
      validate({
        onInvalid: () => {
          calls.push(name);
          return true;
        },
      });
    class Ctrl {
      near() {}
      far() {}
    }
    legacy(args(Value(Order)), Ctrl, "near");
    legacy(Subscribe("near"), Ctrl, "near");
    legacy(loose(Middlewares(says("handler"))), Ctrl, "near");
    legacy(args(Value(Order)), Ctrl, "far");
    legacy(Subscribe("far"), Ctrl, "far");
    Middlewares(says("controller"))(Ctrl);
    Controller()(Ctrl);
    const app = await ChoMessage.create(feature([Ctrl], [says("feature")]));
    await app.handle("near", { value: "{}" });
    await app.handle("far", { value: "{}" });
    assert.deepEqual(calls, ["handler", "controller"]);
  });
});

describe("the graph of a handler with arguments", () => {
  it("has its arguments, and whether it is validated", async () => {
    const order = Value(Order);
    const key = Key();
    class Ctrl {
      checked() {}
      loose() {}
      plain() {}
    }
    legacy(args(order, key), Ctrl, "checked");
    legacy(Subscribe("checked"), Ctrl, "checked");
    legacy(loose(Middlewares(validate())), Ctrl, "checked");
    legacy(args(order), Ctrl, "loose");
    legacy(Subscribe("loose"), Ctrl, "loose");
    legacy(Subscribe("plain"), Ctrl, "plain");
    Controller()(Ctrl);
    const app = await ChoMessage.create(feature([Ctrl]));
    const methods = app.graph.features[0]!.controllers[0]!.methods;
    const [checked, unchecked, plain] = ["checked", "loose", "plain"].map(
      (name) => methods.find((method) => method.name === name)!,
    );
    assert.deepEqual(checked!.args, [order, key]);
    assert.equal(checked!.validated, true);
    assert.deepEqual(
      checked!.args.map((arg) => [arg.info?.source, arg.info?.validator]),
      [["value", Order], ["key", undefined]],
    );
    assert.deepEqual(unchecked!.args, [order]);
    assert.equal(unchecked!.validated, false);
    assert.deepEqual(plain!.args, []);
    assert.equal(plain!.validated, false);
  });

  it("has a handler that is called with the context alone", async () => {
    const Ctrl = controller([Value("id")], (id) => `got ${id}`);
    const app = await ChoMessage.create(feature([Ctrl]));
    const [method] = app.graph.features[0]!.controllers[0]!.methods;
    const { create_context } = await import("./context.ts");
    assert.equal(
      await method!.handler(create_context("orders", { value: '{"id":7}' })),
      "got 7",
    );
  });

  it("says, in the debug log, which handler has a validator and is not validated", async () => {
    class Ctrl {
      checked() {}
      unchecked() {}
      plain() {}
    }
    legacy(args(Value(Order)), Ctrl, "checked");
    legacy(Subscribe("checked"), Ctrl, "checked");
    legacy(loose(Middlewares(validate())), Ctrl, "checked");
    legacy(args(Value(Order)), Ctrl, "unchecked");
    legacy(Subscribe("unchecked"), Ctrl, "unchecked");
    legacy(args(Value()), Ctrl, "plain");
    legacy(Subscribe("plain"), Ctrl, "plain");
    Controller()(Ctrl);
    const app = await ChoMessage.create(feature([Ctrl]));
    const lines: string[] = [];
    const log = Object.assign(
      (...parts: unknown[]) => void lines.push(parts.join(" ")),
      { error: () => {}, start: () => () => {}, enabled: true },
    ) satisfies Debuglog;
    compile_routes(app.graph, log);
    assert.deepEqual(lines, [
      "Ctrl.unchecked has an argument with a validator and no validate() middleware: it is not validated",
    ]);
  });
});
