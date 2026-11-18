/**
 * Tests for `args.ts` and `validate.ts`: the arguments `Value`, `Key` and
 * `Header` make, how they are evaluated, and the validation middleware.
 *
 * How a handler with arguments is called, end to end, is in
 * `handler-args_test.ts`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loose } from "@chojs/core/utils/test_utils";
import {
  describe_invalid,
  evaluate_args,
  Header,
  InvalidArgument,
  Key,
  Value,
} from "./args.ts";
import { create_context } from "./context.ts";
import type { Delivery } from "./linker.ts";
import type { ChoMessageArg, ChoMessageValidator } from "./types.ts";
import { validate, validation_of } from "./validate.ts";

/** The context of a message of the topic `orders`. */
const ctx_of = (delivery: Delivery = {}) => create_context("orders", delivery);

/** A validator that gives a positive number, or throws. */
const positive: ChoMessageValidator<number> = {
  parse(value) {
    const n = Number(value);
    if (!(n > 0)) {
      throw new Error("expected a positive number");
    }
    return n;
  },
};

describe("Value", () => {
  it("gives the value, parsed as JSON", async () => {
    assert.deepEqual(
      await Value()(ctx_of({ value: '{"id":7,"tags":["a"]}' })),
      { id: 7, tags: ["a"] },
    );
    assert.equal(await Value()(ctx_of({ value: "42" })), 42);
    assert.equal(await Value()(ctx_of({ value: "null" })), null);
  });

  it("gives undefined for a message with no value", async () => {
    assert.equal(await Value()(ctx_of()), undefined);
    assert.equal(await Value("id")(ctx_of()), undefined);
  });

  it("gives one property of the value", async () => {
    const ctx = ctx_of({ value: '{"id":7,"name":null}' });
    assert.equal(await Value("id")(ctx), 7);
    assert.equal(await Value("name")(ctx), null);
    assert.equal(await Value("missing")(ctx), undefined);
  });

  it("gives undefined for a property of a value that is not an object", async () => {
    assert.equal(await Value("id")(ctx_of({ value: "42" })), undefined);
    assert.equal(await Value("id")(ctx_of({ value: "null" })), undefined);
    assert.equal(await Value("length")(ctx_of({ value: '"text"' })), undefined);
  });

  it("parses the value once for a message", async () => {
    const ctx = ctx_of({ value: '{"id":7}' });
    const whole = await Value()(ctx);
    assert.equal(await Value()(ctx), whole);
    assert.equal(await Value("id")(ctx), 7);
  });

  it("throws the error of JSON for a value that is not JSON", () => {
    assert.throws(() => Value()(ctx_of({ value: "{not json" })), SyntaxError);
  });

  it("says what it reads", () => {
    assert.deepEqual(Value().info, { source: "value" });
    assert.deepEqual(Value("id").info, { source: "value", key: "id" });
    assert.deepEqual(Value(positive).info, {
      source: "value",
      validator: positive,
    });
    assert.deepEqual(Value("id", positive).info, {
      source: "value",
      key: "id",
      validator: positive,
    });
    assert.equal(Object.isFrozen(Value().info), true);
  });
});

describe("Key", () => {
  it("gives the key, or undefined", async () => {
    assert.equal(await Key()(ctx_of({ key: "k1" })), "k1");
    assert.equal(await Key()(ctx_of()), undefined);
  });

  it("says what it reads", () => {
    assert.deepEqual(Key().info, { source: "key" });
    assert.deepEqual(Key(positive).info, {
      source: "key",
      validator: positive,
    });
  });

  it("takes a validator only", () => {
    assert.throws(() => Key(loose("id")), {
      code: "CHO_MESSAGE_INVALID_ARGUMENT",
      message:
        'Key(): expected a validator (an object with a parse method): a key has no keys of its own, got "id"',
    });
    assert.throws(() => loose(Key)(positive, positive), {
      code: "CHO_MESSAGE_INVALID_ARGUMENT",
      message: /^Key\(\): a validator is the only argument, got/,
    });
  });
});

describe("Header", () => {
  const ctx = ctx_of({ headers: { tenant: "acme", Trace: "t1" } });

  it("gives all the headers, as the message has them", async () => {
    assert.deepEqual(await Header()(ctx), { tenant: "acme", Trace: "t1" });
    assert.deepEqual(await Header()(ctx_of()), {});
  });

  it("gives one header, by its exact name", async () => {
    assert.equal(await Header("tenant")(ctx), "acme");
    assert.equal(await Header("Trace")(ctx), "t1");
    assert.equal(await Header("trace")(ctx), undefined);
    assert.equal(await Header("missing")(ctx), undefined);
    // Not a property every object has.
    assert.equal(await Header("toString")(ctx), undefined);
  });

  it("says what it reads", () => {
    assert.deepEqual(Header().info, { source: "header" });
    assert.deepEqual(Header("tenant", positive).info, {
      source: "header",
      key: "tenant",
      validator: positive,
    });
  });
});

describe("the four signatures", () => {
  it("refuse what is neither a key nor a validator", () => {
    for (const make of [Value, Header]) {
      const name = make.name;
      for (const given of [42, null, {}, { parse: "no" }, []]) {
        assert.throws(() => loose(make)(given), {
          code: "CHO_MESSAGE_INVALID_ARGUMENT",
          message: new RegExp(
            `^${name}\\(\\): expected a key \\(a string\\) or a validator \\(an object with a parse method\\), got `,
          ),
        });
      }
      assert.throws(() => loose(make)("id", "number"), {
        code: "CHO_MESSAGE_INVALID_ARGUMENT",
        message: new RegExp(`^${name}\\(\\): expected a key`),
      });
    }
  });

  it("refuse anything after a validator", () => {
    assert.throws(() => loose(Value)(positive, "id"), {
      code: "CHO_MESSAGE_INVALID_ARGUMENT",
      message: 'Value(): a validator is the last argument, got "id" after it',
    });
  });

  it("accept a validator that is a function with a parse method", () => {
    const schema = Object.assign(() => {}, {
      parse: (value: unknown) => value,
    });
    assert.equal(Value(schema).info?.validator, schema);
  });
});

describe("evaluate_args", () => {
  const ctx = () => ctx_of({ value: '{"id":"7"}', key: "k", headers: {} });

  it("gives the values in order, and runs no validator when not validated", async () => {
    const own: ChoMessageArg<string> = (ctx) => ctx.topic;
    assert.deepEqual(
      await evaluate_args(
        [Value("id", positive), Key(), own, Value()],
        ctx(),
        false,
      ),
      ["7", "k", "orders", { id: "7" }],
    );
  });

  it("runs the validators of a validated handler: they convert", async () => {
    const later: ChoMessageValidator<string> = {
      parse: async (value) => {
        await Promise.resolve();
        return `key ${value}`;
      },
    };
    assert.deepEqual(
      await evaluate_args(
        [Value("id", positive), Key(later), Value()],
        ctx(),
        true,
      ),
      [7, "key k", { id: "7" }],
    );
  });

  it("rejects with what failed, for a validated handler", async () => {
    const invalid = ctx_of({ value: '{"id":-1}' });
    await assert.rejects(
      evaluate_args([Key(), Value("id", positive), Value()], invalid, true),
      (error: InvalidArgument) => {
        assert.ok(error instanceof InvalidArgument);
        assert.equal(error.invalid.source, "value");
        assert.equal(error.invalid.key, "id");
        assert.equal(
          (error.invalid.error as Error).message,
          "expected a positive number",
        );
        return true;
      },
    );
  });

  it("rejects with what failed for a value that is not JSON, when validated", async () => {
    const broken = ctx_of({ value: "{not json" });
    await assert.rejects(
      evaluate_args([Value()], broken, true),
      (error: InvalidArgument) => {
        assert.ok(error instanceof InvalidArgument);
        assert.deepEqual(Object.keys(error.invalid), ["source", "error"]);
        assert.ok(error.invalid.error instanceof SyntaxError);
        return true;
      },
    );
    // Not validated: the error of JSON, as it is.
    await assert.rejects(evaluate_args([Value()], broken, false), SyntaxError);
  });

  it("leaves the error of an argument of the application as it is", async () => {
    const boom = new Error("boom");
    const own: ChoMessageArg = () => {
      throw boom;
    };
    await assert.rejects(evaluate_args([own], ctx(), true), boom);
  });

  it("stops at the first argument that fails", async () => {
    let called = false;
    const after: ChoMessageArg = () => {
      called = true;
    };
    await assert.rejects(
      evaluate_args([Value(positive), after], ctx(), true),
      InvalidArgument,
    );
    assert.equal(called, false);
  });
});

describe("describe_invalid", () => {
  it("names what is not valid", () => {
    assert.equal(describe_invalid({ source: "value" }), "the value");
    assert.equal(
      describe_invalid({ source: "value", key: "id" }),
      'the property "id" of the value',
    );
    assert.equal(describe_invalid({ source: "key" }), "the key");
    assert.equal(describe_invalid({ source: "header" }), "the headers");
    assert.equal(
      describe_invalid({ source: "header", key: "tenant" }),
      'the header "tenant"',
    );
  });
});

describe("validate", () => {
  it("makes a middleware that runs the rest of the chain", async () => {
    let ran = 0;
    await validate()(ctx_of(), () => {
      ran++;
      return Promise.resolve();
    });
    assert.equal(ran, 1);
  });

  it("is recognized, with its options", () => {
    const onInvalid = () => true;
    assert.deepEqual(validation_of(validate()), {});
    assert.equal(validation_of(validate({ onInvalid }))?.onInvalid, onInvalid);
    assert.equal(validation_of((_ctx, next) => next()), undefined);
    // Two calls make two middlewares.
    assert.notEqual(validate(), validate());
  });

  it("refuses options that are not an object, unknown, or wrong", () => {
    for (const options of [null, "strict", 5]) {
      assert.throws(() => validate(loose(options)), {
        code: "CHO_MESSAGE_INVALID_ARGUMENT",
        message:
          /^validate\(\): expected options, got .+\. Give an object, such as \{ onInvalid: /,
      });
    }
    assert.throws(() => validate(loose({ invalid: () => true })), {
      code: "CHO_CORE_UNKNOWN_OPTION",
      message: 'validate(): unknown option "invalid". Known options: onInvalid',
    });
    assert.throws(() => validate(loose({ onInvalid: true })), {
      code: "CHO_MESSAGE_INVALID_ARGUMENT",
      message: 'validate(): "onInvalid" is a function, got true',
    });
  });
});
