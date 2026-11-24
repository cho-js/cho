/**
 * Tests for the middlewares of an application: the `middlewares` option of
 * `ChoWeb.create`. They run around every request, a request no route matches
 * included, and `validate()` given there covers every handler.
 *
 * They run on the built-in router where the runtime has the URL Pattern API,
 * and on the linker of the tests, which every runtime has: both run what
 * `@chojs/web` gives a linker (`around`). The adapters test their own.
 *
 * Decorators are applied as plain function calls, so the tests run on every
 * runtime.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Injectable } from "@chojs/core/di";
import {
  type AnyMethodDecorator,
  capture,
  legacy,
  loose,
} from "@chojs/core/utils/test_utils";
import type { ChoValidator } from "@chojs/core";
import { Body, Param } from "./args.ts";
import type { ChoWebContext } from "./context.ts";
import {
  Args,
  Catch,
  Controller,
  Get,
  Middlewares,
  Module,
  Post,
} from "./decorators.ts";
import { HttpError } from "./http-error.ts";
import type { Linker } from "./linker.ts";
import { ChoLinker } from "./router.ts";
import { TestLinker } from "./testing.ts";
import type { ChoWebMiddlewareFn, ChoWebNext } from "./types.ts";
import { validate } from "./validate.ts";
import { ChoWeb, type ChoWebOptions } from "./web.ts";

type Class = new (...args: never[]) => object;

/** `@Args`, as a decorator the test helpers can apply by hand. */
const args = (...list: unknown[]): AnyMethodDecorator =>
  loose(Args(...loose(list)));

/** Converts to a number; anything that is not one is not valid. */
const number: ChoValidator<number> = {
  parse(value) {
    const n = Number(value);
    if (value === undefined || Number.isNaN(n)) {
      throw new Error(`expected a number, got ${value}`);
    }
    return n;
  },
};

/** A middleware that records its name and the path, then goes on. */
const record =
  (seen: string[], name: string): ChoWebMiddlewareFn => async (ctx, next) => {
    seen.push(`${name} in ${ctx.url.pathname}`);
    const response = await next();
    seen.push(`${name} out ${response.status}`);
    return response;
  };

/** The linkers the tests run on. */
const LINKERS: [string, () => Linker<unknown>][] = [
  ["the linker of the tests", () => new TestLinker()],
  ...(typeof URLPattern === "function"
    ? [["the built-in router", () => new ChoLinker()] as [
      string,
      () => Linker<unknown>,
    ]]
    : []),
];

/**
 * An application with `GET /things/:id`, which answers with the id and its
 * type, and `POST /things`, which fails.
 */
function things(
  decorate: { controller?: (ctrl: Class) => void } = {},
): Class {
  class Things {
    get(id: unknown, ctx: ChoWebContext) {
      return { id, type: typeof id, user: ctx.state.get("user") ?? null };
    }
    add() {
      throw new Error("the store is down");
    }
    gone() {
      throw new HttpError(410, "gone");
    }
  }
  legacy(Get(":id"), Things, "get");
  legacy(args(Param("id", number)), Things, "get");
  legacy(Post(""), Things, "add");
  legacy(Get("old/:id"), Things, "gone");
  decorate.controller?.(Things);
  Controller({ route: "things" })(Things);
  class App {}
  Module({ controllers: [Things] })(App);
  return App;
}

const send = (
  app: { handler: (req: Request) => Promise<Response> },
  path: string,
  init?: RequestInit,
) => app.handler(new Request(`http://localhost${path}`, init));

for (const [where, linker] of LINKERS) {
  /** Create an application on this linker. */
  const create = (app: Class, options: ChoWebOptions<unknown> = {}) =>
    ChoWeb.create(app, { ...options, linker: linker() });

  describe(`the middlewares of an application, on ${where}`, () => {
    it("run for every request, in order, a request no route matches included", async () => {
      const seen: string[] = [];
      const app = await create(things(), {
        middlewares: [record(seen, "a"), record(seen, "b")],
      });
      assert.equal((await send(app, "/things/7")).status, 200);
      assert.equal((await send(app, "/nope")).status, 404);
      assert.deepEqual(seen, [
        "a in /things/7",
        "b in /things/7",
        "b out 200",
        "a out 200",
        "a in /nope",
        "b in /nope",
        "b out 404",
        "a out 404",
      ]);
      await app.close();
    });

    it("run before the middlewares of the route, and see the response its error handler made", async () => {
      const seen: string[] = [];
      const app = await create(
        things({
          controller: (ctrl) => {
            Middlewares(record(seen, "controller"))(ctrl);
            Catch(() => new Response("handled", { status: 503 }))(ctrl);
          },
        }),
        { middlewares: [record(seen, "app")] },
      );
      const { result } = await capture(() =>
        send(app, "/things", { method: "POST" })
      );
      assert.equal(await result.text(), "handled");
      assert.deepEqual(seen, [
        "app in /things",
        "controller in /things",
        // the controller's middleware saw the error, not a response
        "app out 503",
      ]);
      await app.close();
    });

    it("see the answer of an HttpError", async () => {
      const seen: string[] = [];
      const app = await create(things(), {
        middlewares: [record(seen, "app")],
      });
      assert.equal((await send(app, "/things/old/1")).status, 410);
      assert.deepEqual(seen, ["app in /things/old/1", "app out 410"]);
      await app.close();
    });

    it("can answer by themselves, and change the response", async () => {
      const guard: ChoWebMiddlewareFn = (ctx, next) =>
        ctx.req.headers.has("authorization")
          ? next()
          : new Response("who are you?", { status: 401 });
      const stamp: ChoWebMiddlewareFn = async (_ctx, next) => {
        const response = await next();
        const headers = new Headers(response.headers);
        headers.set("x-app", "1");
        return new Response(response.body, {
          status: response.status,
          headers,
        });
      };
      const app = await create(things(), { middlewares: [stamp, guard] });
      const refused = await send(app, "/things/7");
      assert.deepEqual(
        [refused.status, refused.headers.get("x-app"), await refused.text()],
        [401, "1", "who are you?"],
      );
      // also for a request no route matches
      assert.equal((await send(app, "/nope")).status, 401);
      const allowed = await send(app, "/things/7", {
        headers: { authorization: "Bearer x" },
      });
      assert.deepEqual([allowed.status, allowed.headers.get("x-app")], [
        200,
        "1",
      ]);
      await app.close();
    });

    it("share their state with the route", async () => {
      const after: unknown[] = [];
      const app = await create(things(), {
        middlewares: [async (ctx, next) => {
          ctx.state.set("user", "ada");
          const response = await next();
          after.push(ctx.state.get("user"));
          return response;
        }],
      });
      assert.equal((await (await send(app, "/things/7")).json()).user, "ada");
      assert.deepEqual(after, ["ada"]);
      await app.close();
    });

    it("run around a mounted route", async () => {
      const seen: string[] = [];
      const app = await create(things(), {
        middlewares: [record(seen, "app")],
      });
      app.mount("GET", "health", () => "ok");
      assert.equal(await (await send(app, "/health")).text(), "ok");
      assert.deepEqual(seen, ["app in /health", "app out 200"]);
      await app.close();
    });

    it("can be a class, created in the scope of the root module", async () => {
      class Names {
        readonly user = "grace";
      }
      Injectable()(Names);
      class SetUser {
        constructor(readonly names: Names) {}
        handle(ctx: ChoWebContext, next: ChoWebNext) {
          ctx.state.set("user", this.names.user);
          return next();
        }
      }
      Injectable([Names])(SetUser);
      class Things {
        get(ctx: ChoWebContext) {
          return { user: ctx.state.get("user") };
        }
      }
      legacy(Get(""), Things, "get");
      Controller({ route: "things" })(Things);
      class App {}
      Module({ providers: [Names, SetUser], controllers: [Things] })(App);

      const app = await create(App, { middlewares: [SetUser] });
      assert.deepEqual(await (await send(app, "/things")).json(), {
        user: "grace",
      });
      // The graph holds what was created: the bound method.
      assert.equal(app.graph.middlewares.length, 1);
      assert.equal(typeof app.graph.middlewares[0], "function");
      await app.close();
    });

    it("answer 500, and log, when one of them fails", async () => {
      const app = await create(things(), {
        middlewares: [() => {
          throw new Error("broken middleware");
        }],
      });
      const { result, output } = await capture(() => send(app, "/things/7"));
      assert.equal(result.status, 500);
      // The built-in router logs it; the linker of the tests keeps it.
      if (where === "the built-in router") {
        assert.equal((output.error[0] as Error).message, "broken middleware");
      }
      await app.close();
    });
  });

  describe(`validate() for a whole application, on ${where}`, () => {
    it("covers every handler: values are converted, and a request that is not valid is answered 400", async () => {
      const app = await create(things(), { middlewares: [validate()] });
      assert.deepEqual(await (await send(app, "/things/7")).json(), {
        id: 7,
        type: "number",
        user: null,
      });
      const invalid = await send(app, "/things/abc");
      assert.equal(invalid.status, 400);
      assert.deepEqual(await invalid.json(), {
        error: "Invalid request",
        source: "param",
        key: "id",
        issues: [{ message: "expected a number, got abc" }],
      });
      await app.close();
    });

    it("is known to the graph", async () => {
      const validated = (app: ChoWeb<unknown>) =>
        app.graph.features[0]!.controllers[0]!.methods.map((m) => m.validated);
      const covered = await create(things(), { middlewares: [validate()] });
      assert.deepEqual(validated(covered), [true, true, true]);
      const plain = await create(things());
      assert.deepEqual(validated(plain), [false, false, false]);
      assert.deepEqual(plain.graph.middlewares, []);
      await covered.close();
      await plain.close();
    });

    it("answers with its onInvalid, and the nearest one decides", async () => {
      const of_app = validate({
        onInvalid: () => new Response("of the application", { status: 422 }),
      });
      const app = await create(things(), { middlewares: [of_app] });
      assert.equal(
        await (await send(app, "/things/abc")).text(),
        "of the application",
      );
      await app.close();

      const nearer = await create(
        things({
          controller: (ctrl) =>
            Middlewares(
              validate({ onInvalid: () => new Response("of the controller") }),
            )(ctrl),
        }),
        { middlewares: [of_app] },
      );
      assert.equal(
        await (await send(nearer, "/things/abc")).text(),
        "of the controller",
      );
      await nearer.close();
    });

    it("does not validate a handler without it", async () => {
      const app = await create(things());
      assert.deepEqual(await (await send(app, "/things/abc")).json(), {
        id: "abc",
        type: "string",
        user: null,
      });
      await app.close();
    });
  });
}

describe("validate(), where the request is answered", () => {
  it("answers at the end of the chain: a middleware below it sees the 400, and no error", async () => {
    const seen: unknown[] = [];
    const below: ChoWebMiddlewareFn = async (_ctx, next) => {
      try {
        const response = await next();
        seen.push(response.status);
        return response;
      } catch (error) {
        seen.push(error);
        throw error;
      }
    };
    const errors: unknown[] = [];
    const app = await ChoWeb.create(
      things({
        controller: (ctrl) => {
          Middlewares(validate(), below)(ctrl);
          Catch((error) => void errors.push(error))(ctrl);
        },
      }),
      { linker: new TestLinker() },
    );
    assert.equal((await send(app, "/things/abc")).status, 400);
    assert.deepEqual(seen, [400]);
    // A request that is not valid is not an error: no error handler runs.
    assert.deepEqual(errors, []);
    await app.close();
  });

  it("lets an HttpError of onInvalid answer, as anywhere", async () => {
    const app = await ChoWeb.create(things(), {
      linker: new TestLinker(),
      middlewares: [
        validate({
          onInvalid: () => {
            throw new HttpError(422, "not a thing");
          },
        }),
      ],
    });
    const response = await send(app, "/things/abc");
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), { error: "not a thing" });
    await app.close();
  });

  it("covers a body that cannot be parsed", async () => {
    class Things {
      add(body: unknown) {
        return { body };
      }
    }
    legacy(Post(""), Things, "add");
    legacy(args(Body()), Things, "add");
    Controller({ route: "things" })(Things);
    class App {}
    Module({ controllers: [Things] })(App);
    const app = await ChoWeb.create(App, {
      linker: new TestLinker(),
      middlewares: [validate()],
    });
    const response = await send(app, "/things", { method: "POST", body: "{" });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).source, "body");
    await app.close();
  });
});

describe("the middlewares option of ChoWeb.create", () => {
  it("must be an array", async () => {
    await assert.rejects(
      ChoWeb.create(things(), {
        linker: new TestLinker(),
        middlewares: loose(validate()),
      }),
      {
        code: "CHO_WEB_INVALID_OPTION",
        message: /^ChoWeb\.create\(\): "middlewares" must be an array, got /,
      },
    );
  });

  it("takes functions, and classes with a handle method", async () => {
    await assert.rejects(
      ChoWeb.create(things(), {
        linker: new TestLinker(),
        middlewares: loose(["cors"]),
      }),
      { code: "CHO_CORE_INVALID_MIDDLEWARE" },
    );
    class NoHandle {}
    await assert.rejects(
      ChoWeb.create(things(), {
        linker: new TestLinker(),
        middlewares: loose([NoHandle]),
      }),
      { code: "CHO_CORE_INVALID_MIDDLEWARE" },
    );
  });

  it("rejects a class the root module cannot inject", async () => {
    class Hidden {
      handle(_ctx: ChoWebContext, next: ChoWebNext) {
        return next();
      }
    }
    Injectable()(Hidden);
    await capture(() =>
      assert.rejects(
        ChoWeb.create(things(), {
          linker: new TestLinker(),
          middlewares: [Hidden],
        }),
        (error: Error & { code?: string; cause?: { code?: string } }) =>
          error.code === "CHO_WEB_CREATE_FAILED" &&
          error.cause?.code === "CHO_CORE_NOT_VISIBLE",
      )
    );
  });

  it("gives a linker nothing to run when there are none", async () => {
    let given: unknown;
    const linker: Linker<null> = {
      link: (_routes, options) => {
        given = options;
        return {
          instance: null,
          handler: () => Promise.resolve(new Response()),
          mount: () => {},
        };
      },
    };
    await (await ChoWeb.create(things(), { linker })).close();
    assert.deepEqual(given, {});
    await (await ChoWeb.create(things(), {
      linker,
      middlewares: [(_ctx, next) => next()],
    })).close();
    assert.equal(typeof (given as { around?: unknown }).around, "function");
  });
});
