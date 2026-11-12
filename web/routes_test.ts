/**
 * Tests for `routes.ts`: the request pipeline of an application, end to end,
 * through `ChoWeb.create` and a test linker, so without any HTTP runtime.
 *
 * Decorators are applied as plain function calls, so the tests run on every
 * runtime.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Controller, Injectable, Module } from "@chojs/core/di";
import { capture, legacy, with_env } from "@chojs/core/utils/test_utils";
import type { ChoWebContext } from "./context.ts";
import { Catch, Get, Middlewares, Post } from "./decorators.ts";
import { TestLinker } from "./testing.ts";
import type { ChoWebMiddlewareFn } from "./types.ts";
import { ChoWeb } from "./web.ts";

type Class = new () => object;

/** Create the application of a root module, with the test linker. */
function create(root: Class, prefix = "") {
  return ChoWeb.create(root, { linker: new TestLinker(), prefix });
}

/** Send a request to an application, by path and method. */
function send(app: ChoWeb<unknown>, path: string, method = "GET") {
  return app.handler(new Request(`http://localhost${path}`, { method }));
}

/** A middleware that records its name, then runs the rest of the chain. */
function recorder(seen: string[]) {
  return (name: string): ChoWebMiddlewareFn => (ctx, next) => {
    seen.push(`${name} ${ctx.url.pathname}`);
    return next();
  };
}

/** A controller with one handler, `GET <route>`. */
function controller(route: string, handler: (ctx: ChoWebContext) => unknown) {
  class Ctrl {
    run(ctx: ChoWebContext) {
      return handler(ctx);
    }
  }
  legacy(Get(""), Ctrl, "run");
  Controller({ route })(Ctrl);
  return Ctrl;
}

/** A module declaring the given controllers. */
function feature(controllers: Class[], options: Record<string, unknown> = {}) {
  class Feature {}
  Module({ ...options, controllers })(Feature);
  return Feature;
}

describe("routes", () => {
  it("lists every handler with its method, full path and name", async () => {
    class Users {
      list() {}
      get() {}
      create() {}
    }
    legacy(Get(""), Users, "list");
    legacy(Get(":id"), Users, "get");
    legacy(Post(""), Users, "create");
    Controller({ route: "users" })(Users);
    const app = await create(feature([Users], { route: "v1" }), "api");

    assert.deepEqual(
      app.routes.map((r) => [r.method, r.path, r.name]),
      [
        ["GET", "/api/v1/users", "Users.list"],
        ["GET", "/api/v1/users/:id", "Users.get"],
        ["POST", "/api/v1/users", "Users.create"],
      ],
    );
    assert.equal(app.graph.features[0]!.controllers[0]!.route, "users");
  });

  it("gives the root path to a handler with no route at any level", async () => {
    const app = await create(feature([controller("", () => "root")]));
    assert.equal(app.routes[0]!.path, "/");
    assert.equal(await (await send(app, "/")).json(), "root");
  });

  it("gives handlers a context with the request, the parameters and the URL", async () => {
    class Users {
      get(ctx: ChoWebContext) {
        return {
          id: ctx.params.id,
          method: ctx.req.method,
          q: ctx.url.searchParams.get("q"),
          native: ctx.native === undefined,
        };
      }
    }
    legacy(Get(":id"), Users, "get");
    Controller({ route: "users" })(Users);
    const app = await create(feature([Users]));

    const response = await send(app, "/users/a%20b?q=1");
    assert.deepEqual(await response.json(), {
      id: "a b",
      method: "GET",
      q: "1",
      native: true,
    });
  });

  it("converts results: JSON, a Response as is, 204 for nothing", async () => {
    const app = await create(feature([
      controller("json", () => Promise.resolve({ ok: true })),
      controller("raw", () => new Response("made", { status: 201 })),
      controller("none", () => {}),
    ]));

    assert.deepEqual(await (await send(app, "/json")).json(), { ok: true });
    const raw = await send(app, "/raw");
    assert.deepEqual([raw.status, await raw.text()], [201, "made"]);
    assert.equal((await send(app, "/none")).status, 204);
  });

  it("calls a handler on its controller instance", async () => {
    class Users {
      greeting = "hello";
      greet() {
        return this.greeting;
      }
    }
    legacy(Get(""), Users, "greet");
    Controller()(Users);
    const app = await create(feature([Users]));
    assert.equal(await (await send(app, "/")).json(), "hello");
  });
});

describe("routes, middlewares", () => {
  it("runs the feature's, the controller's, then the handler's", async () => {
    const seen: string[] = [];
    const mw = recorder(seen);
    class Users {
      list() {
        seen.push("handler");
      }
    }
    legacy(Get(""), Users, "list");
    legacy(Middlewares(mw("method")), Users, "list");
    Controller()(Users);
    Middlewares(mw("controller-1"), mw("controller-2"))(Users);
    const App = feature([Users]);
    Middlewares(mw("feature"))(App);

    await send(await create(App), "/");
    assert.deepEqual(seen, [
      "feature /",
      "controller-1 /",
      "controller-2 /",
      "method /",
      "handler",
    ]);
  });

  it("never runs a feature's middlewares for another feature, or without a match", async () => {
    const seen: string[] = [];
    const mw = recorder(seen);
    // neither feature has a route: they share the root
    const Admin = feature([controller("admin", () => 1)]);
    Middlewares(mw("admin"))(Admin);
    const Public = feature([controller("public", () => 1)]);
    class App {}
    Module({ imports: [Admin, Public] })(App);
    const app = await create(App);

    assert.equal((await send(app, "/public")).status, 200);
    assert.equal((await send(app, "/nope")).status, 404);
    assert.deepEqual(seen, []);
    await send(app, "/admin");
    assert.deepEqual(seen, ["admin /admin"]);
  });

  it("never runs a controller's middlewares for a sibling controller", async () => {
    const seen: string[] = [];
    const mw = recorder(seen);
    class A {
      a() {}
    }
    legacy(Get("a"), A, "a");
    Controller()(A); // no route
    Middlewares(mw("A"))(A);
    class B {
      b() {}
      c() {}
    }
    legacy(Get("b"), B, "b");
    legacy(Get("c"), B, "c");
    legacy(Middlewares(mw("B.b")), B, "b");
    Controller()(B);
    const app = await create(feature([A, B]));

    await send(app, "/c");
    assert.deepEqual(seen, []);
    await send(app, "/b");
    await send(app, "/a");
    assert.deepEqual(seen, ["B.b /b", "A /a"]);
  });

  it("lets a middleware answer early, replace the response, and share state", async () => {
    const deny: ChoWebMiddlewareFn = (ctx, next) =>
      ctx.url.searchParams.has("token")
        ? next()
        : new Response("denied", { status: 401 });
    const user: ChoWebMiddlewareFn = (ctx, next) => {
      ctx.state.set("user", "ada");
      return next();
    };
    const stamp: ChoWebMiddlewareFn = async (_ctx, next) => {
      const response = await next();
      response.headers.set("x-stamp", "1");
      return response;
    };
    const Ctrl = controller("me", (ctx) => ({ user: ctx.state.get("user") }));
    Middlewares(deny, user, stamp)(Ctrl);
    const app = await create(feature([Ctrl]));

    assert.equal((await send(app, "/me")).status, 401);
    const ok = await send(app, "/me?token=1");
    assert.deepEqual(await ok.json(), { user: "ada" });
    assert.equal(ok.headers.get("x-stamp"), "1");
  });

  it("creates middleware classes with their dependencies", async () => {
    class Tokens {
      valid(token: string | null) {
        return token === "secret";
      }
    }
    Injectable()(Tokens);
    class Auth {
      constructor(readonly tokens: Tokens) {}
      handle(ctx: ChoWebContext, next: () => Promise<Response>) {
        return this.tokens.valid(ctx.req.headers.get("authorization"))
          ? next()
          : new Response("unauthorized", { status: 401 });
      }
    }
    Injectable([Tokens])(Auth);
    const Ctrl = controller("admin", () => "in");
    Middlewares(Auth)(Ctrl);
    class App {}
    Module({ providers: [Tokens, Auth], controllers: [Ctrl] })(App);
    const app = await create(App);

    assert.equal((await send(app, "/admin")).status, 401);
    const response = await app.handler(
      new Request("http://localhost/admin", {
        headers: { authorization: "secret" },
      }),
    );
    assert.equal(await response.json(), "in");
  });
});

describe("routes, error handlers", () => {
  const boom = () => {
    throw new Error("boom");
  };

  it("uses the nearest: the handler's, the controller's, then the feature's", async () => {
    const tag = (level: string) => (error: unknown, ctx: ChoWebContext) =>
      new Response(
        `${level}: ${(error as Error).message} at ${ctx.url.pathname}`,
        { status: 500 },
      );
    class Own {
      run() {
        boom();
      }
      other() {
        boom();
      }
    }
    legacy(Get("run"), Own, "run");
    legacy(Get("other"), Own, "other");
    legacy(Catch(tag("method")), Own, "run");
    Controller({ route: "own" })(Own);
    Catch(tag("controller"))(Own);
    const Bare = controller("bare", boom);
    const App = feature([Own, Bare]);
    Catch(tag("feature"))(App);
    const app = await create(App);

    assert.equal(
      await (await send(app, "/own/run")).text(),
      "method: boom at /own/run",
    );
    assert.equal(
      await (await send(app, "/own/other")).text(),
      "controller: boom at /own/other",
    );
    assert.equal(
      await (await send(app, "/bare")).text(),
      "feature: boom at /bare",
    );
  });

  it("converts an error handler's result like a handler's, awaiting it", async () => {
    const Ctrl = controller("x", boom);
    Catch(async (error) => {
      await Promise.resolve();
      return { error: (error as Error).message };
    })(Ctrl);
    const app = await create(feature([Ctrl]));

    const response = await send(app, "/x");
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { error: "boom" });
  });

  it("handles an error thrown by a middleware", async () => {
    const Ctrl = controller("x", () => "fine");
    Middlewares(boom)(Ctrl);
    Catch((error) => new Response((error as Error).message, { status: 502 }))(
      Ctrl,
    );
    const app = await create(feature([Ctrl]));
    assert.equal(await (await send(app, "/x")).text(), "boom");
  });

  it("creates error handler classes with the injector", async () => {
    class OnError {
      prefix = "caught";
      handle(error: unknown, ctx: ChoWebContext) {
        return new Response(
          `${this.prefix} ${(error as Error).message} ${ctx.params.id}`,
          { status: 500 },
        );
      }
    }
    Injectable()(OnError);
    class Users {
      get() {
        boom();
      }
    }
    legacy(Get(":id"), Users, "get");
    Controller({ route: "users" })(Users);
    Catch(OnError)(Users);
    class App {}
    Module({ providers: [OnError], controllers: [Users] })(App);
    const app = await create(App);

    assert.equal(await (await send(app, "/users/7")).text(), "caught boom 7");
  });

  it("rejects without an error handler, and when the error handler throws", async () => {
    const Bare = controller("bare", boom);
    const Worse = controller("worse", boom);
    Catch(() => {
      throw new Error("handler failed");
    })(Worse);
    const linker = new TestLinker();
    const app = await ChoWeb.create(feature([Bare, Worse]), { linker });

    assert.equal((await send(app, "/bare")).status, 500);
    assert.equal((await send(app, "/worse")).status, 500);
    assert.deepEqual(
      linker.errors.map((error) => (error as Error).message),
      ["boom", "handler failed"],
    );
  });

  it("logs the errors given to an error handler to cho:web", async () => {
    const Ctrl = controller("x", boom);
    Catch(() => new Response("caught", { status: 500 }))(Ctrl);
    const App = feature([Ctrl]);
    const logs = async (vars: Record<string, string | undefined>) => {
      const { output } = await capture(async () => {
        let created!: Promise<ChoWeb<unknown>>;
        with_env(vars, () => {
          created = create(App);
        });
        await send(await created, "/x");
      });
      return output.error.map(String).join(" ");
    };
    const OFF = { CHO_DEBUG: undefined, CHO_DEBUGLOG: undefined };

    assert.equal(await logs(OFF), "");
    assert.match(
      await logs({ ...OFF, CHO_DEBUGLOG: "cho:web" }),
      /ERROR GET \/x failed: Error: boom/,
    );
  });
});

describe("routes, duplicates", () => {
  it("rejects two handlers with the same method and path, naming both", async () => {
    class Users {
      a() {}
      b() {}
    }
    legacy(Get(":id"), Users, "a");
    legacy(Get(" :id "), Users, "b");
    Controller({ route: "users" })(Users);
    await assert.rejects(create(feature([Users])), {
      message:
        'Duplicate route "GET /users/:id": declared by Users.a and Users.b',
    });
  });

  it("rejects paths that differ only by a parameter name, across features", async () => {
    class A {
      get() {}
    }
    legacy(Get("items/:id"), A, "get");
    Controller()(A);
    class B {
      find() {}
    }
    legacy(Get(":name"), B, "find");
    Controller({ route: "items" })(B);
    class App {}
    Module({ imports: [feature([A]), feature([B])] })(App);
    await assert.rejects(create(App), {
      message: 'Duplicate route "GET /items/:id": declared by A.get and B.find',
    });
  });

  it("accepts the same path with another method", async () => {
    class Users {
      list() {}
      create() {}
    }
    legacy(Get(""), Users, "list");
    legacy(Post(""), Users, "create");
    Controller()(Users);
    const app = await create(feature([Users]));
    assert.equal(app.routes.length, 2);
  });
});
