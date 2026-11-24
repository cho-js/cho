/**
 * Tests for `HttpError`: the class, and how a request that throws one is
 * answered, through `ChoWeb.create` with the test linker and with the
 * built-in router.
 *
 * Decorators are applied as plain function calls, so the tests run on every
 * runtime.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Injectable } from "@chojs/core/di";
import { capture, legacy, loose, with_env } from "@chojs/core/utils/test_utils";
import { Body, Param } from "./args.ts";
import type { ChoWebContext } from "./context.ts";
import {
  Args,
  Catch,
  Controller,
  Get,
  Head,
  Middlewares,
  Module,
  Post,
  Sse,
} from "./decorators.ts";
import { HttpError, isHttpError, status_text } from "./http-error.ts";
import { ChoLinker } from "./router.ts";
import { TestLinker } from "./testing.ts";
import type { ChoWebErrorHandlerFn, ChoWebMiddlewareFn } from "./types.ts";
import { validate } from "./validate.ts";
import { ChoWeb, type ChoWebOptions } from "./web.ts";

type Decoration = Parameters<typeof legacy>[0];

/**
 * An application with one controller, `things`, with one handler, `get`, at
 * `GET /things/:id`.
 *
 * @param handler The handler.
 * @param decorations Other decorators of the handler.
 * @param options The options of `ChoWeb.create`, the decorators of the
 *   controller, and the providers of the module.
 */
async function create(
  handler: (...args: never[]) => unknown,
  decorations: Decoration[] = [],
  { of_controller = [], providers = [], ...options }:
    & ChoWebOptions<unknown>
    & {
      of_controller?: ((ctr: new () => object) => void)[];
      providers?: (new () => object)[];
    } = {},
) {
  class Things {
    get(...args: never[]) {
      return handler.apply(this, args);
    }
  }
  legacy(Get(":id"), Things, "get");
  for (const decoration of decorations) {
    legacy(decoration, Things, "get");
  }
  for (const decorate of of_controller) {
    decorate(Things);
  }
  Controller({ route: "things" })(Things);
  class App {}
  Module({ controllers: [Things], providers })(App);
  const linker = new TestLinker();
  const app = await ChoWeb.create(App, { linker, ...options });
  return { app, linker };
}

/** Send a request to an application. */
function send(
  app: { handler: (req: Request) => Promise<Response> },
  path: string,
  init?: RequestInit,
): Promise<Response> {
  return app.handler(new Request(`http://localhost${path}`, init));
}

/** The status, the content type and the body of a response. */
async function answer(response: Response) {
  return {
    status: response.status,
    // Bun adds a charset to the type of a JSON response.
    type: response.headers.get("content-type")?.split(";")[0],
    body: await response.json(),
  };
}

/** What another copy of the package would throw. */
function of_another_copy(status: number, message: string): Error {
  class HttpError extends Error {
    readonly status = status;
    toResponse() {
      return Response.json({ error: this.message }, { status: this.status });
    }
  }
  Object.defineProperty(HttpError.prototype, Symbol.for("cho.http_error"), {
    value: true,
  });
  return new HttpError(message);
}

describe("HttpError", () => {
  it("is an Error with a status, a message and a name", () => {
    const error = new HttpError(404, "no such user");
    assert.ok(error instanceof Error);
    assert.equal(error.status, 404);
    assert.equal(error.message, "no such user");
    assert.equal(error.name, "HttpError");
    assert.equal(String(error), "HttpError: no such user");
    assert.deepEqual([...error.headers], []);
  });

  it("has the text of its status as its message, without one", () => {
    assert.equal(new HttpError(404).message, "Not Found");
    assert.equal(new HttpError(401, "").message, "Unauthorized");
    assert.equal(new HttpError(503, undefined).message, "Service Unavailable");
  });

  it("has a message for a status that has no text", () => {
    assert.equal(new HttpError(499).message, "Error");
    assert.equal(status_text(599), "Error");
  });

  it("keeps its headers, whatever they are given as", () => {
    for (
      const headers of [
        { "retry-after": "30" },
        [["retry-after", "30"]] as [string, string][],
        new Headers({ "retry-after": "30" }),
      ]
    ) {
      const error = new HttpError(429, "slow down", { headers });
      assert.equal(error.headers.get("retry-after"), "30");
    }
  });

  it("keeps its cause", () => {
    const cause = new Error("no connection");
    const error = new HttpError(503, "the database is down", { cause });
    assert.equal(error.cause, cause);
    assert.equal("cause" in new HttpError(503), false);
  });

  it("rejects a status that an error cannot have", () => {
    for (const status of [200, 302, 399, 600, 404.5, NaN, "404", undefined]) {
      assert.throws(() => new HttpError(loose(status)), {
        code: "CHO_WEB_INVALID_STATUS",
        message:
          /^HttpError: the status must be a whole number from 400 to 599, got /,
      });
    }
  });

  it("rejects a message that is not a string", () => {
    assert.throws(() => new HttpError(404, loose(42)), {
      code: "CHO_WEB_INVALID_OPTION",
      message: "HttpError: the message must be a string, got 42",
    });
  });

  it("rejects options that are not options", () => {
    assert.throws(() => new HttpError(404, "x", loose(null)), {
      code: "CHO_WEB_INVALID_OPTION",
    });
    assert.throws(() => new HttpError(404, "x", loose({ header: {} })), {
      code: "CHO_CORE_UNKNOWN_OPTION",
      message:
        'HttpError: unknown option "header". Known options: cause, headers',
    });
  });

  it("rejects headers that are not headers, with the reason as the cause", () => {
    assert.throws(
      () => new HttpError(404, "x", { headers: loose(42) }),
      (error: { code?: string; cause?: unknown }) => {
        assert.equal(error.code, "CHO_WEB_INVALID_OPTION");
        assert.ok(error.cause instanceof Error);
        return true;
      },
    );
  });

  describe("toResponse", () => {
    it("answers with the status, and the message as JSON", async () => {
      const response = new HttpError(404, "no such user").toResponse();
      assert.deepEqual(await answer(response), {
        status: 404,
        type: "application/json",
        body: { error: "no such user" },
      });
    });

    it("sends the headers", () => {
      const response = new HttpError(401, "token expired", {
        headers: { "www-authenticate": "Bearer", "x-reason": "expired" },
      }).toResponse();
      assert.equal(response.headers.get("www-authenticate"), "Bearer");
      assert.equal(response.headers.get("x-reason"), "expired");
    });

    it("does not send the message of a status from 500", async () => {
      const error = new HttpError(503, "db.internal:5432 refused", {
        cause: new Error("secret"),
      });
      assert.deepEqual(await answer(error.toResponse()), {
        status: 503,
        type: "application/json",
        body: { error: "Service Unavailable" },
      });
      assert.deepEqual(
        (await answer(new HttpError(599, "x").toResponse())).body,
        { error: "Error" },
      );
    });

    it("makes a response for each call, with headers of its own", () => {
      const error = new HttpError(400, "bad");
      const first = error.toResponse();
      first.headers.set("x-changed", "1");
      assert.notEqual(error.toResponse(), first);
      assert.equal(error.toResponse().headers.has("x-changed"), false);
      assert.equal(error.headers.has("x-changed"), false);
    });
  });
});

describe("isHttpError", () => {
  it("is true for an HttpError", () => {
    assert.equal(isHttpError(new HttpError(404)), true);
  });

  it("is false for anything else", () => {
    for (
      const value of [
        new Error("x"),
        Object.assign(new Error("x"), { status: 404 }),
        { status: 404, name: "HttpError", message: "x", toResponse() {} },
        new Response(null, { status: 404 }),
        404,
        null,
        undefined,
      ]
    ) {
      assert.equal(isHttpError(value), false);
    }
  });

  it("is true for an error of another copy of the package", () => {
    const error = of_another_copy(404, "no such user");
    assert.equal(error instanceof HttpError, false);
    assert.equal(isHttpError(error), true);
  });
});

describe("a request that throws an HttpError", () => {
  it("is answered with its status, from a handler", async () => {
    const { app, linker } = await create(() => {
      throw new HttpError(404, "no such thing");
    });
    assert.deepEqual(await answer(await send(app, "/things/1")), {
      status: 404,
      type: "application/json",
      body: { error: "no such thing" },
    });
    // The route answered: nothing reached the adapter.
    assert.deepEqual(linker.errors, []);
  });

  it("is answered with its headers", async () => {
    const { app } = await create(() => {
      throw new HttpError(401, "token expired", {
        headers: { "www-authenticate": "Bearer" },
      });
    });
    const response = await send(app, "/things/1");
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), "Bearer");
  });

  it("is answered from an async handler", async () => {
    const { app } = await create(async () => {
      await Promise.resolve();
      throw new HttpError(409, "taken");
    });
    assert.equal((await send(app, "/things/1")).status, 409);
  });

  it("is answered from a middleware function", async () => {
    const guard: ChoWebMiddlewareFn = () => {
      throw new HttpError(403, "not yours");
    };
    let called = false;
    const { app } = await create(() => {
      called = true;
    }, [loose(Middlewares(guard))]);
    assert.deepEqual((await answer(await send(app, "/things/1"))).body, {
      error: "not yours",
    });
    assert.equal(called, false);
  });

  it("is answered from a middleware class", async () => {
    class Guard {
      handle() {
        throw new HttpError(403, "not yours");
      }
    }
    Injectable()(Guard);
    const { app } = await create(() => "never", [loose(Middlewares(Guard))], {
      providers: [Guard],
    });
    assert.equal((await send(app, "/things/1")).status, 403);
  });

  it("is answered from a function of @Args", async () => {
    const number = (ctx: ChoWebContext) => {
      const id = Number(ctx.params.id);
      if (!Number.isInteger(id)) {
        throw new HttpError(400, "the id must be a number");
      }
      return id;
    };
    const { app } = await create((id: number) => ({ id }), [
      loose(Args(number)),
    ]);
    assert.equal((await send(app, "/things/7")).status, 200);
    assert.deepEqual(await answer(await send(app, "/things/x")), {
      status: 400,
      type: "application/json",
      body: { error: "the id must be a number" },
    });
  });

  it("does not send the message of a status from 500", async () => {
    const { app } = await create(() => {
      throw new HttpError(502, "upstream 10.0.0.7 timed out");
    });
    assert.deepEqual(await answer(await send(app, "/things/1")), {
      status: 502,
      type: "application/json",
      body: { error: "Bad Gateway" },
    });
  });

  it("is answered when it comes from another copy of the package", async () => {
    const { app } = await create(() => {
      throw of_another_copy(410, "gone for good");
    });
    assert.deepEqual((await answer(await send(app, "/things/1"))).body, {
      error: "gone for good",
    });
  });

  it("leaves any other error to the adapter", async () => {
    const failure = Object.assign(new Error("boom"), { status: 404 });
    const { app, linker } = await create(() => {
      throw failure;
    });
    assert.equal((await send(app, "/things/1")).status, 500);
    assert.deepEqual(linker.errors, [failure]);
  });
});

describe("an HttpError and the error handlers", () => {
  const thrown = new HttpError(404, "no such thing");
  const fail = () => {
    throw thrown;
  };

  it("goes to @Catch first, which answers", async () => {
    const seen: unknown[] = [];
    const on_error: ChoWebErrorHandlerFn = (error) => {
      seen.push(error);
      return new Response("handled", { status: 418 });
    };
    const { app } = await create(fail, [loose(Catch(on_error))]);
    const response = await send(app, "/things/1");
    assert.equal(response.status, 418);
    assert.equal(await response.text(), "handled");
    assert.deepEqual(seen, [thrown]);
  });

  it("answers for itself when @Catch returns nothing", async () => {
    let seen = 0;
    const { app } = await create(fail, [loose(Catch(() => void seen++))]);
    assert.deepEqual(await answer(await send(app, "/things/1")), {
      status: 404,
      type: "application/json",
      body: { error: "no such thing" },
    });
    assert.equal(seen, 1);
  });

  it("goes to the @Catch of the controller", async () => {
    const { app } = await create(fail, [], {
      of_controller: [loose(Catch(() => new Response(null, { status: 410 })))],
    });
    assert.equal((await send(app, "/things/1")).status, 410);
  });

  it("goes to onError, which answers", async () => {
    const { app } = await create(fail, [], {
      onError: (error) =>
        isHttpError(error)
          ? Response.json({ title: error.message, status: error.status }, {
            status: error.status,
            headers: { "content-type": "application/problem+json" },
          })
          : undefined,
    });
    const response = await send(app, "/things/1");
    assert.equal(
      response.headers.get("content-type"),
      "application/problem+json",
    );
    assert.deepEqual(await response.json(), {
      title: "no such thing",
      status: 404,
    });
  });

  it("answers for itself when onError returns nothing", async () => {
    const { app } = await create(fail, [], { onError: () => undefined });
    assert.equal((await send(app, "/things/1")).status, 404);
  });

  it("is answered through toResponse by a handler that adds to it", async () => {
    const { app } = await create(fail, [], {
      onError: (error) => {
        if (isHttpError(error)) {
          const response = error.toResponse();
          response.headers.set("x-request", "42");
          return response;
        }
      },
    });
    const response = await send(app, "/things/1");
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("x-request"), "42");
  });

  it("is the answer when an error handler throws it for another error", async () => {
    const { app, linker } = await create(() => {
      throw new RangeError("out of stock");
    }, [
      loose(Catch((error) => {
        if (error instanceof RangeError) {
          throw new HttpError(409, error.message);
        }
      })),
    ]);
    assert.deepEqual(await answer(await send(app, "/things/1")), {
      status: 409,
      type: "application/json",
      body: { error: "out of stock" },
    });
    assert.deepEqual(linker.errors, []);
  });

  it("leaves another error an error handler throws to the adapter", async () => {
    const failure = new Error("the handler broke");
    const { app, linker } = await create(fail, [
      loose(Catch(() => {
        throw failure;
      })),
    ]);
    assert.equal((await send(app, "/things/1")).status, 500);
    assert.deepEqual(linker.errors, [failure]);
  });
});

describe("an HttpError, in every kind of route", () => {
  it("has no body for a HEAD route", async () => {
    class Things {
      head() {
        throw new HttpError(404, "no such thing");
      }
    }
    legacy(Head(":id"), Things, "head");
    Controller({ route: "things" })(Things);
    class App {}
    Module({ controllers: [Things] })(App);
    const app = await ChoWeb.create(App, { linker: new TestLinker() });
    const response = await send(app, "/things/1", { method: "HEAD" });
    assert.equal(response.status, 404);
    assert.equal(response.body, null);
    assert.equal(
      response.headers.get("content-type")?.split(";")[0],
      "application/json",
    );
  });

  it("is answered from a mounted route, and from its middleware", async () => {
    class App {}
    Module({})(App);
    const app = await ChoWeb.create(App, { linker: new TestLinker() });
    app.mount("GET", "health", () => {
      throw new HttpError(503, "starting");
    });
    app.mount("GET", "admin", () => "never", {
      middlewares: [() => {
        throw new HttpError(401);
      }],
    });
    assert.deepEqual(await answer(await send(app, "/health")), {
      status: 503,
      type: "application/json",
      body: { error: "Service Unavailable" },
    });
    assert.deepEqual((await answer(await send(app, "/admin"))).body, {
      error: "Unauthorized",
    });
  });

  it("is answered from an @Sse handler, before the stream starts", async () => {
    class Feed {
      events() {
        throw new HttpError(404, "no such feed");
      }
    }
    legacy(loose(Sse("events")), Feed, "events");
    Controller({ route: "feed" })(Feed);
    class App {}
    Module({ controllers: [Feed] })(App);
    const app = await ChoWeb.create(App, { linker: new TestLinker() });
    assert.deepEqual(await answer(await send(app, "/feed/events")), {
      status: 404,
      type: "application/json",
      body: { error: "no such feed" },
    });
  });

  it("is answered from onInvalid of validate()", async () => {
    const schema = {
      parse(value: unknown) {
        if (typeof (value as { name?: unknown } | null)?.name !== "string") {
          throw new Error("name is required");
        }
        return value;
      },
    };
    class Things {
      create(body: unknown) {
        return body;
      }
    }
    legacy(Post(""), Things, "create");
    legacy(loose(Args(Body(schema))), Things, "create");
    legacy(
      loose(Middlewares(validate({
        onInvalid: ({ source }) => {
          throw new HttpError(422, `bad ${source}`);
        },
      }))),
      Things,
      "create",
    );
    Controller({ route: "things" })(Things);
    class App {}
    Module({ controllers: [Things] })(App);
    const app = await ChoWeb.create(App, { linker: new TestLinker() });
    const response = await send(app, "/things", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.deepEqual(await answer(response), {
      status: 422,
      type: "application/json",
      body: { error: "bad body" },
    });
  });

  it("keeps the parameter of the route out of the way", async () => {
    const { app } = await create((id: string) => {
      throw new HttpError(404, `no thing ${id}`);
    }, [loose(Args(Param("id")))]);
    assert.deepEqual((await answer(await send(app, "/things/9"))).body, {
      error: "no thing 9",
    });
  });
});

describe("an HttpError, with the built-in router", () => {
  /** An application with `GET /things/:id`, on the built-in router. */
  async function with_router(
    { middlewares = [], ...options }:
      & NonNullable<ConstructorParameters<typeof ChoLinker>[0]>
      & { middlewares?: ChoWebMiddlewareFn[] },
  ) {
    class Things {
      get() {
        return "a thing";
      }
    }
    legacy(Get(":id"), Things, "get");
    Controller({ route: "things" })(Things);
    class App {}
    Module({ controllers: [Things] })(App);
    return await ChoWeb.create(App, {
      linker: new ChoLinker(options),
      middlewares,
    });
  }

  it("is answered from a route", async () => {
    class Things {
      get() {
        throw new HttpError(404, "no such thing");
      }
    }
    legacy(Get(":id"), Things, "get");
    Controller({ route: "things" })(Things);
    class App {}
    Module({ controllers: [Things] })(App);
    const app = await ChoWeb.create(App);
    const { output } = await capture(async () => {
      assert.deepEqual(await answer(await send(app, "/things/1")), {
        status: 404,
        type: "application/json",
        body: { error: "no such thing" },
      });
      // A GET route answers a HEAD request, without the body.
      const head = await send(app, "/things/1", { method: "HEAD" });
      assert.equal(head.status, 404);
      assert.equal(head.body, null);
    });
    // Nothing failed: nothing is written.
    assert.deepEqual(output.error, []);
  });

  it("is answered from a middleware of the application", async () => {
    const app = await with_router({
      middlewares: [(ctx, next) => {
        if (!ctx.req.headers.has("authorization")) {
          throw new HttpError(401, "who are you?", {
            headers: { "www-authenticate": "Bearer" },
          });
        }
        return next();
      }],
    });
    const { output } = await capture(async () => {
      const response = await send(app, "/things/1");
      assert.equal(response.headers.get("www-authenticate"), "Bearer");
      assert.deepEqual(await answer(response), {
        status: 401,
        type: "application/json",
        body: { error: "who are you?" },
      });
      // Also for a request no route matches.
      assert.equal((await send(app, "/nothing")).status, 401);
      const head = await send(app, "/things/1", { method: "HEAD" });
      assert.equal(head.status, 401);
      assert.equal(head.body, null);
      const allowed = await send(app, "/things/1", {
        headers: { authorization: "Bearer x" },
      });
      assert.equal(await allowed.text(), "a thing");
    });
    assert.deepEqual(output.error, []);
  });

  it("is answered from notFound", async () => {
    const app = await with_router({
      notFound: (req) => {
        throw new HttpError(404, `nothing at ${new URL(req.url).pathname}`);
      },
    });
    assert.deepEqual(await answer(await send(app, "/nothing")), {
      status: 404,
      type: "application/json",
      body: { error: "nothing at /nothing" },
    });
  });

  it("still answers 500, and logs, for any other error", async () => {
    const app = await with_router({
      middlewares: [() => {
        throw new Error("boom");
      }],
    });
    const { output } = await capture(async () => {
      assert.equal((await send(app, "/things/1")).status, 500);
    });
    assert.equal(output.error.length, 1);
  });
});

describe("an HttpError, debug logging", () => {
  /** What a request that throws `error` logs, with `cho:web` enabled. */
  async function logs_of(error: HttpError, on_error?: ChoWebErrorHandlerFn) {
    const { output } = await capture(async () => {
      let created!: ReturnType<typeof create>;
      // The logger is created when create() starts, synchronously.
      with_env({ CHO_DEBUG: undefined, CHO_DEBUGLOG: "cho:web" }, () => {
        created = create(() => {
          throw error;
        }, on_error ? [loose(Catch(on_error))] : []);
      });
      const { app } = await created;
      await send(app, "/things/1");
    });
    return output.error.map(String).join(" ");
  }

  it("logs a status below 500 as what was answered, not as an error", async () => {
    for (const on_error of [undefined, () => undefined]) {
      const logs = await logs_of(new HttpError(404, "no such thing"), on_error);
      assert.match(logs, /GET \/things\/1 answered 404: no such thing/);
      assert.doesNotMatch(logs, /ERROR/);
    }
  });

  it("logs a status from 500 as an error", async () => {
    const logs = await logs_of(new HttpError(503, "the database is down"));
    assert.match(logs, /ERROR GET \/things\/1 answered 503:/);
    assert.match(logs, /the database is down/);
  });
});
