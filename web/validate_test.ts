/**
 * Tests for `validate.ts`: the validation middleware runs the validators of
 * the arguments of the handlers it covers, and answers for a request that is
 * not valid.
 *
 * Decorators are applied as plain function calls, so the tests run on every
 * runtime. The validators are written by hand, in the shape of a zod schema.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  type AnyMethodDecorator,
  capture,
  legacy,
  loose,
  with_env,
} from "@chojs/core/utils/test_utils";
import { Body, Form, Header, Param, Query } from "./args.ts";
import {
  Args,
  Catch,
  Controller,
  Get,
  Middlewares,
  Module,
  Post,
} from "./decorators.ts";
import { TestLinker } from "./testing.ts";
import type { ChoWebMiddlewareFn, ChoWebValidator } from "./types.ts";
import { validate } from "./validate.ts";
import { ChoWeb } from "./web.ts";

type Class = new () => object;

/** `@Args`, as a decorator the test helpers can apply by hand. */
const args = (...list: unknown[]): AnyMethodDecorator =>
  loose(Args(...loose(list)));

/** An error with `issues`, as a zod error has. */
class Issues extends Error {
  readonly issues: { path: string[]; message: string }[];
  constructor(...issues: { path: string[]; message: string }[]) {
    super("invalid");
    this.issues = issues;
  }
}

/** Converts to a number; anything that is not one is not valid. */
const number: ChoWebValidator<number> = {
  parse(value) {
    const n = Number(value);
    if (value === undefined || Number.isNaN(n)) {
      throw new Error(`expected a number, got ${value}`);
    }
    return n;
  },
};

/** An object with a `name` that is a string, as a zod object schema. */
const user: ChoWebValidator<{ name: string }> = {
  parse(value) {
    const name = (value as { name?: unknown } | null | undefined)?.name;
    if (typeof name !== "string") {
      throw new Issues({ path: ["name"], message: "Required" });
    }
    return { name };
  },
};

/** A controller with one handler, which answers with what it receives. */
function echo(
  decorator: AnyMethodDecorator,
  list: unknown[],
  ...more: AnyMethodDecorator[]
) {
  class Ctrl {
    run(...values: unknown[]) {
      return values.slice(0, -1);
    }
  }
  legacy(decorator, Ctrl, "run");
  legacy(args(...list), Ctrl, "run");
  for (const one of more) {
    legacy(one, Ctrl, "run");
  }
  Controller({ route: "x" })(Ctrl);
  return Ctrl;
}

/** The application of some controllers. */
function create(controllers: Class[], options: Record<string, unknown> = {}) {
  class Feature {}
  Module({ ...options, controllers })(Feature);
  return ChoWeb.create(Feature, { linker: new TestLinker() });
}

/** Send a request, and give its status and its body as JSON. */
async function send(
  app: ChoWeb<unknown>,
  path: string,
  init: RequestInit = {},
) {
  const response = await app.handler(
    new Request(`http://localhost${path}`, init),
  );
  const text = await response.text();
  return [response.status, text === "" ? undefined : JSON.parse(text)];
}

const post = (body: string): RequestInit => ({ method: "POST", body });

describe("validate", () => {
  it("validates the arguments of a handler, and gives it what the validators return", async () => {
    const app = await create([
      echo(
        Post(":id"),
        [Param("id", number), Query("page", number), Body(user), Query("q")],
        Middlewares(validate()),
      ),
    ]);
    assert.deepEqual(
      await send(app, "/x/7?page=2&q=a", post('{"name":"Ada","extra":1}')),
      // converted, and reduced to what the validator gives
      [200, [7, 2, { name: "Ada" }, "a"]],
    );
  });

  for (
    const [source, argument, path, init] of [
      ["param", Param("id", number), "/x/abc", {}],
      ["query", Query("id", number), "/x/1?id=abc", {}],
      ["header", Header("id", number), "/x/1", { headers: { id: "abc" } }],
      ["body", Body("id", number), "/x/1", post('{"id":"abc"}')],
      ["form", Form("id", number), "/x/1", post("id=abc")],
    ] as const
  ) {
    it(`answers 400 for a ${source} argument that is not valid`, async () => {
      let called = false;
      class Ctrl {
        run() {
          called = true;
        }
      }
      legacy(Post(":id"), Ctrl, "run");
      legacy(args(argument), Ctrl, "run");
      legacy(Middlewares(validate()), Ctrl, "run");
      Controller({ route: "x" })(Ctrl);
      const app = await create([Ctrl]);
      assert.deepEqual(await send(app, path, { method: "POST", ...init }), [
        400,
        {
          error: "Invalid request",
          source,
          key: "id",
          issues: [{ message: "expected a number, got abc" }],
        },
      ]);
      assert.equal(called, false);
    });
  }

  it("gives the issues of the validator's error, and no key for a whole source", async () => {
    const app = await create([
      echo(Post(""), [Body(user)], Middlewares(validate())),
    ]);
    assert.deepEqual(await send(app, "/x", post('{"name":1}')), [400, {
      error: "Invalid request",
      source: "body",
      issues: [{ path: ["name"], message: "Required" }],
    }]);
  });

  it("answers 400 for a body that cannot be parsed", async () => {
    const app = await create([
      echo(Post(""), [Body()], Middlewares(validate())),
    ]);
    const [status, answer] = await send(app, "/x", post("{oops"));
    assert.equal(status, 400);
    assert.deepEqual([answer.error, answer.source], [
      "Invalid request",
      "body",
    ]);
    assert.equal(answer.issues.length, 1);
    assert.equal(typeof answer.issues[0].message, "string");
  });

  it("awaits an asynchronous validator", async () => {
    const later: ChoWebValidator<string> = {
      async parse(value) {
        await Promise.resolve();
        if (value !== "ok") {
          throw new Error("not ok");
        }
        return "checked";
      },
    };
    const app = await create([
      echo(Get(""), [Query("v", later)], Middlewares(validate())),
    ]);
    assert.deepEqual(await send(app, "/x?v=ok"), [200, ["checked"]]);
    assert.deepEqual((await send(app, "/x?v=no"))[0], 400);
  });

  it("covers the handlers of a controller, and of a feature", async () => {
    const on_controller = echo(Get(":id"), [Param("id", number)]);
    Middlewares(validate())(on_controller);
    assert.deepEqual(await send(await create([on_controller]), "/x/abc"), [
      400,
      {
        error: "Invalid request",
        source: "param",
        key: "id",
        issues: [{ message: "expected a number, got abc" }],
      },
    ]);

    class Feature {}
    Module({ controllers: [echo(Get(":id"), [Param("id", number)])] })(Feature);
    Middlewares(validate())(Feature);
    const app = await ChoWeb.create(Feature, { linker: new TestLinker() });
    assert.deepEqual((await send(app, "/x/abc"))[0], 400);
    assert.deepEqual(await send(app, "/x/7"), [200, [7]]);
  });

  it("validates after every middleware of the route, wherever it is declared", async () => {
    const guard: ChoWebMiddlewareFn = (ctx, next) =>
      ctx.req.headers.has("authorization")
        ? next()
        : new Response('"unauthorized"', { status: 401 });
    // the validation middleware is on the feature, the guard on the handler
    class Feature {}
    Module({
      controllers: [echo(Post(""), [Body(user)], Middlewares(guard))],
    })(Feature);
    Middlewares(validate())(Feature);
    const app = await ChoWeb.create(Feature, { linker: new TestLinker() });

    // not authorized: the body is never read, valid or not
    assert.deepEqual(await send(app, "/x", post("{oops")), [
      401,
      "unauthorized",
    ]);
    const authorized = { headers: { authorization: "yes" } };
    assert.deepEqual(
      (await send(app, "/x", { ...post("{oops"), ...authorized }))[0],
      400,
    );
  });

  it("leaves other errors to the error handlers", async () => {
    class Ctrl {
      run() {
        throw new Error("down");
      }
    }
    legacy(Post(""), Ctrl, "run");
    legacy(args(Body(user)), Ctrl, "run");
    legacy(Middlewares(validate()), Ctrl, "run");
    legacy(
      Catch((error) =>
        Response.json({ caught: (error as Error).message }, { status: 503 })
      ),
      Ctrl,
      "run",
    );
    Controller({ route: "x" })(Ctrl);
    const app = await create([Ctrl]);
    assert.deepEqual(await send(app, "/x", post('{"name":"Ada"}')), [503, {
      caught: "down",
    }]);
    // and an invalid request never reaches @Catch
    assert.deepEqual((await send(app, "/x", post("{}")))[0], 400);
  });

  it("answers with what onInvalid returns, converted like a handler's result", async () => {
    const seen: unknown[] = [];
    const custom = validate({
      onInvalid: ({ source, key, error }, ctx) => {
        seen.push([source, key, (error as Error).message, ctx.url.pathname]);
        return Response.json({ bad: source }, { status: 422 });
      },
    });
    const app = await create([
      echo(Get(":id"), [Param("id", number)], Middlewares(custom)),
    ]);
    assert.deepEqual(await send(app, "/x/abc"), [422, { bad: "param" }]);
    assert.deepEqual(seen, [[
      "param",
      "id",
      "expected a number, got abc",
      "/x/abc",
    ]]);

    // a plain value is sent as JSON, with status 200
    const plain = validate({ onInvalid: () => ({ ok: false }) });
    const second = await create([
      echo(Get(":id"), [Param("id", number)], Middlewares(plain)),
    ]);
    assert.deepEqual(await send(second, "/x/abc"), [200, { ok: false }]);
  });

  it("falls back to the default answer when onInvalid returns nothing", async () => {
    const logged: string[] = [];
    const logging = validate({
      onInvalid: ({ source }) => {
        logged.push(source);
      },
    });
    const app = await create([
      echo(Get(":id"), [Param("id", number)], Middlewares(logging)),
    ]);
    const [status, answer] = await send(app, "/x/abc");
    assert.deepEqual([status, answer.error, logged], [400, "Invalid request", [
      "param",
    ]]);
  });

  it("makes a new middleware each time", () => {
    assert.notEqual(validate(), validate());
    assert.equal(typeof validate(), "function");
  });
});

describe("validate, when it is missing", () => {
  const OFF = { CHO_DEBUG: undefined, CHO_DEBUGLOG: undefined };

  /** Create an application, and return what it logged. */
  async function logs_of(controllers: Class[]): Promise<string> {
    const { output } = await capture(async () => {
      let created!: Promise<unknown>;
      with_env({ ...OFF, CHO_DEBUGLOG: "cho:web" }, () => {
        created = create(controllers);
      });
      await created;
    });
    return output.error.map(String).join(" ");
  }

  it("logs each handler that has a validator and is not validated", async () => {
    const logs = await logs_of([
      echo(Get(":id"), [Param("id", number)]),
    ]);
    assert.match(
      logs,
      /cho:web Ctrl\.run has an argument with a validator and no validate\(\) middleware: it is not validated/,
    );
  });

  it("logs nothing for a validated handler, or for one without a validator", async () => {
    const covered = echo(
      Get(":id"),
      [Param("id", number)],
      Middlewares(validate()),
    );
    const plain = echo(Get("plain/:id"), [Param("id")]);
    const logs = await logs_of([covered, plain]);
    assert.doesNotMatch(logs, /no validate\(\) middleware/);
  });
});
