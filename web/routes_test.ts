/**
 * Tests for `routes.ts`: the request pipeline of an application, end to end,
 * through `ChoWeb.create` and a test linker, so without any HTTP runtime.
 *
 * Decorators are applied as plain function calls, so the tests run on every
 * runtime.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Injectable } from "@chojs/core/di";
import { capture, legacy, loose, with_env } from "@chojs/core/utils/test_utils";
import type { ChoWebContext } from "./context.ts";
import {
  Catch,
  Controller,
  Get,
  Head,
  Middlewares,
  Module,
  Options,
  Post,
} from "./decorators.ts";
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
    assert.equal(await (await send(app, "/")).text(), "root");
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

  it("sends strings, bytes and streams as they are, not as JSON", async () => {
    const app = await create(feature([
      controller("text", () => "plain text"),
      controller("bytes", () => new Uint8Array([1, 2, 3])),
      controller("blob", () => new Blob(["<p>hi</p>"], { type: "text/html" })),
      controller(
        "stream",
        () => new Blob(["chunk"]).stream(),
      ),
      controller("form", () => new URLSearchParams({ a: "1", b: "x y" })),
      controller("date", () => new Date(0)),
    ]));
    const type = (response: Response) =>
      response.headers.get("content-type") ?? "";

    const text = await send(app, "/text");
    assert.equal(type(text), "text/plain;charset=UTF-8");
    assert.equal(await text.text(), "plain text");

    const bytes = await send(app, "/bytes");
    assert.deepEqual([...new Uint8Array(await bytes.arrayBuffer())], [1, 2, 3]);

    const blob = await send(app, "/blob");
    assert.match(type(blob), /^text\/html/);
    assert.equal(await blob.text(), "<p>hi</p>");

    assert.equal(await (await send(app, "/stream")).text(), "chunk");

    const form = await send(app, "/form");
    assert.match(type(form), /^application\/x-www-form-urlencoded/);
    assert.equal(await form.text(), "a=1&b=x+y");

    // not a body the platform knows: JSON, like any other object
    const date = await send(app, "/date");
    assert.match(type(date), /application\/json/);
    assert.equal(await date.json(), "1970-01-01T00:00:00.000Z");
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
    assert.equal(await (await send(app, "/")).text(), "hello");
  });
});

describe("routes, HEAD and OPTIONS", () => {
  /** `GET`, `HEAD` and `OPTIONS` on the same path. */
  function files_app() {
    class Files {
      get() {
        return { name: "report" };
      }
      stat() {
        return new Response("ignored", {
          status: 200,
          headers: { "content-length": "42", "x-kind": "head" },
        });
      }
      json() {
        return { also: "ignored" };
      }
      boom() {
        throw new Error("boom");
      }
      options() {
        return new Response(null, {
          status: 204,
          headers: { allow: "GET, HEAD, OPTIONS" },
        });
      }
    }
    legacy(Get("file"), Files, "get");
    legacy(Head("file"), Files, "stat");
    legacy(Head("json"), Files, "json");
    legacy(Head("boom"), Files, "boom");
    legacy(Options("file"), Files, "options");
    Controller()(Files);
    Catch(() => Response.json({ error: "x" }, { status: 500 }))(Files);
    return feature([Files]);
  }

  it("routes them next to GET, on the same path", async () => {
    const app = await create(files_app());
    assert.deepEqual(
      app.routes.map((r) => `${r.method} ${r.path}`),
      ["GET /file", "HEAD /file", "HEAD /json", "HEAD /boom", "OPTIONS /file"],
    );
    assert.deepEqual(await (await send(app, "/file")).json(), {
      name: "report",
    });
    const options = await send(app, "/file", "OPTIONS");
    assert.equal(options.status, 204);
    assert.equal(options.headers.get("allow"), "GET, HEAD, OPTIONS");
  });

  it("sends a HEAD response without its body, keeping status and headers", async () => {
    const app = await create(files_app());

    const head = await send(app, "/file", "HEAD");
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("x-kind"), "head");
    assert.equal(head.headers.get("content-length"), "42");
    assert.equal(await head.text(), "");

    const json = await send(app, "/json", "HEAD");
    assert.equal(json.status, 200);
    assert.match(json.headers.get("content-type") ?? "", /application\/json/);
    assert.equal(await json.text(), "");

    // what an error handler answers has no body either
    const failed = await send(app, "/boom", "HEAD");
    assert.equal(failed.status, 500);
    assert.equal(await failed.text(), "");
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
    assert.equal(await response.text(), "in");
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

  it("leaves the error unhandled when the error handler returns nothing", async () => {
    // a handler that only logs must not turn a failure into a 204
    const seen: unknown[] = [];
    const Logs = controller("logs", boom);
    Catch((error) => {
      seen.push(error);
    })(Logs);
    const Async = controller("async", boom);
    Catch(async () => {
      await Promise.resolve();
    })(Async);
    const Null = controller("null", boom);
    Catch(() => null)(Null); // null is a value: it is sent, as JSON
    const linker = new TestLinker();
    const app = await ChoWeb.create(feature([Logs, Async, Null]), { linker });

    assert.equal((await send(app, "/logs")).status, 500);
    assert.equal((await send(app, "/async")).status, 500);
    assert.equal(seen.length, 1);
    assert.deepEqual(
      linker.errors.map((error) => (error as Error).message),
      ["boom", "boom"],
    );
    const sent = await send(app, "/null");
    assert.deepEqual([sent.status, await sent.json()], [200, null]);
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

describe("routes, the application's error handler", () => {
  const boom = () => {
    throw new Error("boom");
  };
  const tag = (level: string) => (error: unknown, ctx: ChoWebContext) =>
    new Response(
      `${level}: ${(error as Error).message} at ${ctx.url.pathname}`,
      { status: 500 },
    );

  it("handles the errors no @Catch handler covers, in every feature", async () => {
    const Covered = controller("covered", boom);
    Catch(tag("controller"))(Covered);
    const A = feature([Covered, controller("a", boom)]);
    const B = feature([controller("b", boom)]);
    class App {}
    Module({ imports: [A, B] })(App);
    const app = await ChoWeb.create(App, {
      linker: new TestLinker(),
      onError: tag("app"),
    });

    const text = async (path: string) => (await send(app, path)).text();
    assert.equal(await text("/covered"), "controller: boom at /covered");
    assert.equal(await text("/a"), "app: boom at /a");
    assert.equal(await text("/b"), "app: boom at /b");
    assert.equal(typeof app.graph.errorHandler, "function");
  });

  it("converts its result like a handler's, and handles middleware errors", async () => {
    const Ctrl = controller("x", () => "fine");
    Middlewares(boom)(Ctrl);
    const app = await ChoWeb.create(feature([Ctrl]), {
      linker: new TestLinker(),
      onError: (error) => ({ error: (error as Error).message }),
    });
    assert.deepEqual(await (await send(app, "/x")).json(), { error: "boom" });
  });

  it("can be a class, created in the scope of the root module", async () => {
    class Reporter {
      seen: unknown[] = [];
    }
    Injectable()(Reporter);
    class OnError {
      constructor(readonly reporter: Reporter) {}
      handle(error: unknown) {
        this.reporter.seen.push(error);
        return new Response("reported", { status: 500 });
      }
    }
    Injectable([Reporter])(OnError);
    class App {}
    Module({
      imports: [feature([controller("x", boom)])],
      providers: [Reporter, OnError],
    })(App);
    const app = await ChoWeb.create(App, {
      linker: new TestLinker(),
      onError: OnError,
    });

    assert.equal(await (await send(app, "/x")).text(), "reported");
    assert.equal(app.graph.errorHandler?.name, "OnError.handle");
  });

  it("leaves the error unhandled when it returns nothing", async () => {
    const linker = new TestLinker();
    const app = await ChoWeb.create(feature([controller("x", boom)]), {
      linker,
      onError: () => {},
    });
    assert.equal((await send(app, "/x")).status, 500);
    assert.equal((linker.errors[0] as Error).message, "boom");
  });

  it("is not called for a request that matches no route", async () => {
    let called = false;
    const app = await ChoWeb.create(feature([controller("x", () => 1)]), {
      linker: new TestLinker(),
      onError: () => {
        called = true;
      },
    });
    assert.equal((await send(app, "/nope")).status, 404);
    assert.equal(called, false);
  });

  it("rejects when it throws itself", async () => {
    const linker = new TestLinker();
    const app = await ChoWeb.create(feature([controller("x", boom)]), {
      linker,
      onError: () => {
        throw new Error("handler failed");
      },
    });
    assert.equal((await send(app, "/x")).status, 500);
    assert.equal((linker.errors[0] as Error).message, "handler failed");
  });

  it("is validated when the application is created", async () => {
    const App = feature([controller("x", () => 1)]);
    const linker = new TestLinker();
    await assert.rejects(
      ChoWeb.create(App, { linker, onError: loose("handler") }),
      {
        // the same message as @chojs/command, from the core
        message:
          "Invalid error handler \"handler\": must be a function or a class with a 'handle' method.",
      },
    );
    class NoHandle {}
    await assert.rejects(
      ChoWeb.create(App, { linker, onError: loose(NoHandle) }),
      {
        message: "Error handler class NoHandle must implement 'handle' method.",
      },
    );
    class NotProvided {
      handle() {}
    }
    await assert.rejects(ChoWeb.create(App, { linker, onError: NotProvided }), {
      message: "Failed to create error handler NotProvided in module Feature",
    });
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

  it("explains a controller declared by two modules", async () => {
    const Users = controller("users", () => []);
    const Feature = feature([Users]);
    class App {}
    Module({ imports: [Feature], controllers: [Users] })(App);
    await assert.rejects(create(App), {
      message:
        'Duplicate route "GET /users": declared by Ctrl.run and Ctrl.run. ' +
        "Its controller is declared in more than one module: declare it in one.",
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
