/**
 * Tests for `args.ts`: the five argument functions read their source, in
 * each of their four call forms, carry what they read as `info`, and
 * `evaluate_args` runs validators only for a validated request.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loose } from "@chojs/core/utils/test_utils";
import {
  Body,
  evaluate_args,
  Form,
  Header,
  InvalidArgument,
  mark_validated,
  Param,
  Query,
} from "./args.ts";
import { create_context } from "./context.ts";
import type { ChoWebArg, ChoWebValidator } from "./types.ts";

/** A validator that turns a value into a number, and rejects what is not one. */
const number: ChoWebValidator<number> = {
  parse(value) {
    const n = Number(value);
    if (Number.isNaN(n)) {
      throw new Error(`not a number: ${value}`);
    }
    return n;
  },
};

/** The context of a request, with path parameters. */
function context(
  path = "/",
  init: RequestInit = {},
  params: Record<string, string> = {},
) {
  return create_context(new Request(`http://localhost${path}`, init), params);
}

/** The context of a `POST` with a body. */
const post = (body: string) => context("/", { method: "POST", body });

describe("Param", () => {
  const ctx = context("/users/7/posts/a%20b", {}, { id: "7", post: "a b" });

  it("gives every path parameter, or one", async () => {
    assert.deepEqual(await Param()(ctx), { id: "7", post: "a b" });
    assert.equal(await Param("id")(ctx), "7");
    assert.equal(await Param("post")(ctx), "a b");
  });

  it("carries its source, key and validator", () => {
    assert.deepEqual(Param().info, { source: "param" });
    assert.deepEqual(Param("id").info, { source: "param", key: "id" });
    assert.deepEqual(Param(number).info, {
      source: "param",
      validator: number,
    });
    assert.deepEqual(Param("id", number).info, {
      source: "param",
      key: "id",
      validator: number,
    });
    assert.ok(Object.isFrozen(Param("id").info));
  });
});

describe("Query", () => {
  const ctx = context("/?page=2&tag=a&tag=b&empty=");

  it("gives the whole query string, with the first value of a repeated key", async () => {
    assert.deepEqual(await Query()(ctx), { page: "2", tag: "a", empty: "" });
    assert.deepEqual(await Query()(context("/")), {});
  });

  it("gives one key, or undefined", async () => {
    assert.equal(await Query("page")(ctx), "2");
    assert.equal(await Query("tag")(ctx), "a");
    assert.equal(await Query("empty")(ctx), "");
    assert.equal(await Query("missing")(ctx), undefined);
  });

  it("carries its source, key and validator", () => {
    assert.deepEqual(Query("page", number).info, {
      source: "query",
      key: "page",
      validator: number,
    });
  });
});

describe("Header", () => {
  const ctx = context("/", {
    headers: [["X-Token", "abc"], ["accept", "text/html"], [
      "accept",
      "text/plain",
    ]],
  });

  it("gives every header, with names in lower case", async () => {
    assert.deepEqual(await Header()(ctx), {
      "x-token": "abc",
      accept: "text/html, text/plain",
    });
  });

  it("gives one header, whatever the case of its name, or undefined", async () => {
    assert.equal(await Header("x-token")(ctx), "abc");
    assert.equal(await Header("X-TOKEN")(ctx), "abc");
    assert.equal(await Header("accept")(ctx), "text/html, text/plain");
    assert.equal(await Header("missing")(ctx), undefined);
  });

  it("carries its source", () => {
    assert.deepEqual(Header("x-token").info, {
      source: "header",
      key: "x-token",
    });
  });
});

describe("Body", () => {
  it("gives the body parsed as JSON", async () => {
    assert.deepEqual(await Body()(post('{"name":"Ada","age":36}')), {
      name: "Ada",
      age: 36,
    });
    assert.deepEqual(await Body()(post("[1,2]")), [1, 2]);
    assert.equal(await Body()(post('"text"')), "text");
    assert.equal(await Body()(post("null")), null);
  });

  it("gives undefined for an empty body, and for a request without one", async () => {
    assert.equal(await Body()(post("")), undefined);
    assert.equal(await Body()(context("/")), undefined);
    assert.equal(await Body("name")(context("/")), undefined);
  });

  it("gives one property, or undefined when there is none", async () => {
    const body = '{"name":"Ada","nested":{"a":1},"none":null}';
    assert.equal(await Body("name")(post(body)), "Ada");
    assert.deepEqual(await Body("nested")(post(body)), { a: 1 });
    assert.equal(await Body("none")(post(body)), null);
    assert.equal(await Body("missing")(post(body)), undefined);
    // the body is not an object
    assert.equal(await Body("name")(post('"text"')), undefined);
    assert.equal(await Body("name")(post("null")), undefined);
  });

  it("does not look at the content type", async () => {
    const ctx = context("/", {
      method: "POST",
      body: '{"a":1}',
      headers: { "content-type": "text/plain" },
    });
    assert.deepEqual(await Body()(ctx), { a: 1 });
  });

  it("rejects with the parser's error for invalid JSON", async () => {
    await assert.rejects(() => Promise.resolve(Body()(post("{oops"))), {
      name: "SyntaxError",
    });
  });

  it("reads the body once, for every Body and Form argument", async () => {
    const ctx = post('{"a":1,"b":2}');
    assert.equal(await Body("a")(ctx), 1);
    assert.equal(await Body("b")(ctx), 2);
    assert.deepEqual(await Body()(ctx), { a: 1, b: 2 });
    // the same text, read as a form
    assert.deepEqual(await Form()(ctx), { '{"a":1,"b":2}': "" });
    assert.equal(ctx.req.bodyUsed, true);
  });

  it("carries its source, key and validator", () => {
    assert.deepEqual(Body().info, { source: "body" });
    assert.deepEqual(Body("name", number).info, {
      source: "body",
      key: "name",
      validator: number,
    });
  });
});

describe("Form", () => {
  it("gives the fields of a URL-encoded form, the first value of a repeated one", async () => {
    const ctx = post("user=ada&tag=a&tag=b&note=a+b%21&empty=");
    assert.deepEqual(await Form()(ctx), {
      user: "ada",
      tag: "a",
      note: "a b!",
      empty: "",
    });
  });

  it("gives an empty object for an empty body", async () => {
    assert.deepEqual(await Form()(post("")), {});
    assert.deepEqual(await Form()(context("/")), {});
  });

  it("gives one field, or undefined", async () => {
    const ctx = post("user=ada&tag=a&tag=b");
    assert.equal(await Form("user")(ctx), "ada");
    assert.equal(await Form("tag")(ctx), "a");
    assert.equal(await Form("missing")(ctx), undefined);
  });

  it("carries its source", () => {
    assert.deepEqual(Form("user").info, { source: "form", key: "user" });
  });
});

describe("the four call forms", () => {
  const functions = { Param, Query, Header, Body, Form };

  for (const [name, fn] of Object.entries(functions)) {
    it(`${name}: rejects a key that is not a string and a validator without parse`, () => {
      const bad = (...args: unknown[]) => () => loose(fn)(...args);
      for (const value of [1, true, null, {}, [], () => {}]) {
        assert.throws(bad(value), {
          name: "TypeError",
          message: new RegExp(
            `^${name}\\(\\): expected a key \\(a string\\) or a validator \\(an object with a parse method\\), got `,
          ),
        });
        assert.throws(bad("key", value), { name: "TypeError" });
      }
      // a validator is the last argument
      assert.throws(bad(number, "key"), {
        name: "TypeError",
        message: new RegExp(`^${name}\\(\\): a validator is the last argument`),
      });
    });

    it(`${name}: takes any object with a parse method, a class instance included`, () => {
      class Schema {
        parse(value: unknown) {
          return value;
        }
      }
      const schema = new Schema();
      assert.equal(loose(fn)(schema).info.validator, schema);
      assert.equal(loose(fn)("key", schema).info.validator, schema);
      // undefined is no argument
      assert.deepEqual(loose(fn)(undefined).info, {
        source: name.toLowerCase(),
      });
      assert.deepEqual(loose(fn)("key", undefined).info, {
        source: name.toLowerCase(),
        key: "key",
      });
    });
  }
});

describe("evaluate_args", () => {
  it("gives the values in order, awaiting the asynchronous ones", async () => {
    const ctx = context("/users/7?page=2", {
      method: "POST",
      body: '{"name":"Ada"}',
    }, { id: "7" });
    const custom: ChoWebArg<string> = (c) => `${c.req.method} ${c.params.id}`;
    const later: ChoWebArg<number> = () => Promise.resolve(42);
    assert.deepEqual(
      await evaluate_args(
        [Param("id"), Query("page"), Body("name"), custom, later],
        ctx,
      ),
      ["7", "2", "Ada", "POST 7", 42],
    );
    assert.deepEqual(await evaluate_args([], ctx), []);
  });

  it("does not run validators for a request that is not validated", async () => {
    const ctx = context("/?page=abc", {}, { id: "7" });
    // not converted, and not rejected
    assert.deepEqual(
      await evaluate_args([Param("id", number), Query("page", number)], ctx),
      ["7", "abc"],
    );
  });

  it("runs validators for a validated request: their result is the value", async () => {
    const ctx = context("/?page=2", { method: "POST", body: '{"age":"36"}' }, {
      id: "7",
    });
    mark_validated(ctx);
    const whole: ChoWebValidator<string[]> = {
      parse: (value) => Object.keys(value as object),
    };
    const later: ChoWebValidator<string> = {
      parse: (value) => Promise.resolve(`<${value}>`),
    };
    assert.deepEqual(
      await evaluate_args([
        Param("id", number),
        Query(whole),
        Body("age", number),
        Header("missing", later),
        Query("page"), // no validator: as it is
      ], ctx),
      [7, ["page"], 36, "<undefined>", "2"],
    );
  });

  it("reports what is not valid, and stops there", async () => {
    const ctx = context("/?page=abc", {}, { id: "7" });
    mark_validated(ctx);
    const calls: string[] = [];
    const spy: ChoWebArg<string> = () => {
      calls.push("after");
      return "x";
    };
    await assert.rejects(
      () =>
        evaluate_args([Param("id", number), Query("page", number), spy], ctx),
      (error: InvalidArgument) => {
        assert.ok(error instanceof InvalidArgument);
        assert.equal(error.invalid.source, "query");
        assert.equal(error.invalid.key, "page");
        assert.equal(
          (error.invalid.error as Error).message,
          "not a number: abc",
        );
        assert.equal(error.cause, error.invalid.error);
        return true;
      },
    );
    assert.deepEqual(calls, []);
  });

  it("reports a body that cannot be parsed, for a validated request only", async () => {
    const validated = post("{oops");
    mark_validated(validated);
    await assert.rejects(
      () => evaluate_args([Body()], validated),
      (error: InvalidArgument) => {
        assert.ok(error instanceof InvalidArgument);
        assert.deepEqual(
          [error.invalid.source, "key" in error.invalid],
          ["body", false],
        );
        assert.equal((error.invalid.error as Error).name, "SyntaxError");
        return true;
      },
    );
    await assert.rejects(() => evaluate_args([Body()], post("{oops")), {
      name: "SyntaxError",
    });
  });

  it("passes on what an argument of your own throws, unchanged", async () => {
    const boom = new Error("boom");
    const failing: ChoWebArg<never> = () => {
      throw boom;
    };
    const ctx = context("/");
    mark_validated(ctx);
    await assert.rejects(
      () => evaluate_args([failing], ctx),
      (error) => error === boom,
    );
  });
});
