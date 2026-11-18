/**
 * Tests for `web.ts`: `ChoWeb.create` builds the application and links it
 * with the given linker.
 *
 * A fake linker records the routes it receives, so the tests do not depend on
 * any runtime adapter.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Injectable, Injector, provider, token } from "@chojs/core/di";
import { capture, legacy, with_env } from "@chojs/core/utils/test_utils";
import { Controller, Get, Middlewares, Module } from "./decorators.ts";
import type { Ctr } from "@chojs/core/di";
import type { Linked, Linker, Route } from "./linker.ts";
import { ChoRouter } from "./router.ts";
import { TestLinker } from "./testing.ts";
import type { ChoWebMiddlewareFn } from "./types.ts";
import { ChoWeb } from "./web.ts";

/** What the fake linker links: the routes, kept for the assertions. */
type Fake = { routes: readonly Route[] };

/** A linker that keeps the routes, with a handler that answers "linked". */
class FakeLinker implements Linker<Fake> {
  calls: (readonly Route[])[] = [];
  /** The routes given to `mount`, in order. */
  mounted: Route[] = [];
  /** When set, `mount` throws it: a runtime that takes no more routes. */
  refuse: Error | undefined;
  link(routes: readonly Route[]): Linked<Fake> {
    this.calls.push(routes);
    return {
      instance: { routes },
      handler: () => Promise.resolve(new Response("linked")),
      mount: (route) => {
        if (this.refuse) {
          throw this.refuse;
        }
        this.mounted.push(route);
      },
    };
  }
}

/** An app with one controller, `Users`, and one handler, `GET users`. */
function users_app(created: string[] = []) {
  class Unused {
    constructor() {
      created.push("Unused");
    }
  }
  Injectable()(Unused);
  class Users {
    constructor() {
      created.push("Users");
    }
    list() {}
  }
  legacy(Get(""), Users, "list");
  Controller({ route: "users" })(Users);
  class App {}
  Module({ providers: [Unused], controllers: [Users] })(App);
  return App;
}

describe("ChoWeb.create", () => {
  it("gives the application's routes to the linker, once", async () => {
    const linker = new FakeLinker();
    const app = await ChoWeb.create(users_app(), { linker });

    assert.equal(linker.calls.length, 1);
    const routes = linker.calls[0]!;
    assert.deepEqual(
      routes.map((r) => [r.method, r.path, r.name]),
      [["GET", "/users", "Users.list"]],
    );
    assert.equal(app.linked.instance.routes, routes);
    // a list of its own: mounted routes are added to it
    assert.deepEqual(app.routes, routes);
    assert.notEqual(app.routes, routes);
  });

  it("exposes its injector, with the instances of the application", async () => {
    class Store {}
    Injectable()(Store);
    class App {}
    Module({ providers: [Store] })(App);
    const app = await ChoWeb.create(App, { linker: new FakeLinker() });
    assert.ok(app.injector instanceof Injector);
    const store = await app.injector.resolve(Store);
    assert.ok(store instanceof Store);
    assert.equal(await app.injector.resolve(Store), store);
    // close() disposes it
    await app.close();
    await assert.rejects(app.injector.resolve(Store), {
      message: "The injector is disposed",
    });
  });

  it("gives routes that answer on their own", async () => {
    const linker = new FakeLinker();
    await ChoWeb.create(users_app(), { linker });
    const response = await linker.calls[0]![0]!.handle(
      new Request("http://localhost/users"),
    );
    assert.equal(response.status, 204);
  });

  it("applies the global prefix, and keeps the graph", async () => {
    const linker = new FakeLinker();
    const app = await ChoWeb.create(users_app(), { linker, prefix: " api " });
    assert.equal(linker.calls[0]![0]!.path, "/api/users");
    assert.equal(app.graph.route, "api");
    assert.equal(app.graph.features[0]!.controllers[0]!.route, "users");
  });

  it("creates every instance up front, used by a route or not", async () => {
    const created: string[] = [];
    await ChoWeb.create(users_app(created), { linker: new FakeLinker() });
    assert.deepEqual(created.sort(), ["Unused", "Users"]);
  });

  it("exposes the linked handler", async () => {
    const app = await ChoWeb.create(users_app(), { linker: new FakeLinker() });
    const response = await app.handler(new Request("http://localhost/users"));
    assert.equal(await response.text(), "linked");
  });

  it("rejects an invalid module graph", async () => {
    class NotAModule {}
    await assert.rejects(
      ChoWeb.create(NotAModule, { linker: new FakeLinker() }),
      { message: "Class NotAModule is not a module. Did you forget @Module?" },
    );
  });

  it("rejects an invalid global prefix", async () => {
    await assert.rejects(
      ChoWeb.create(users_app(), { linker: new FakeLinker(), prefix: "/api" }),
      {
        message:
          'Invalid route "/api" of the global prefix: it must not start or end with "/"',
      },
    );
  });

  it("rejects when a factory fails, before linking", async () => {
    class Broken {
      constructor() {
        throw new Error("no database");
      }
    }
    Injectable()(Broken);
    class App {}
    Module({ providers: [Broken] })(App);
    const linker = new FakeLinker();
    await assert.rejects(ChoWeb.create(App, { linker }), {
      message: "Failed to create Broken in module App",
    });
    assert.equal(linker.calls.length, 0);
  });
});

describe("ChoWeb.create, without a linker", () => {
  // The built-in router needs the URL Pattern API to link an application.
  const supported = typeof URLPattern === "function";
  const on_supported = supported ? it : it.skip;

  on_supported("links the application with the built-in router", async () => {
    const app = await ChoWeb.create(users_app());
    // typed as the router: no cast is needed to use it
    const router: ChoRouter = app.linked.instance;
    assert.ok(router instanceof ChoRouter);
    assert.equal(router.match("GET", "/users")?.route, app.routes[0]);
    const get = (path: string) =>
      app.handler(new Request(`http://localhost${path}`));
    assert.equal((await get("/users")).status, 204);
    assert.equal((await get("/nope")).status, 404);
  });

  on_supported("takes the other options", async () => {
    const app = await ChoWeb.create(users_app(), { prefix: "api" });
    assert.deepEqual(app.routes.map((r) => r.path), ["/api/users"]);
    const response = await app.handler(
      new Request("http://localhost/api/users"),
    );
    assert.equal(response.status, 204);
  });

  it("uses the given linker, when there is one", async () => {
    const linker = new FakeLinker();
    const app = await ChoWeb.create(users_app(), { linker });
    assert.equal(app.linked.instance.routes, linker.calls[0]);
  });
});

describe("ChoWeb.create, debug logging", () => {
  const OFF = { CHO_DEBUG: undefined, CHO_DEBUGLOG: undefined };

  /** Create the app with the given environment, and return what it logged. */
  async function logs_of(
    vars: Record<string, string | undefined>,
    root: Ctr,
  ): Promise<string> {
    const { output } = await capture(async () => {
      let created!: Promise<unknown>;
      // the logger is created when create() starts, synchronously
      with_env(vars, () => {
        created = ChoWeb.create(root, { linker: new FakeLinker() });
      });
      await created.catch(() => {});
    });
    return output.error.map(String).join(" ");
  }

  it("logs nothing unless the cho:web context is enabled", async () => {
    assert.equal(await logs_of(OFF, users_app()), "");
  });

  it("logs every route with its handler", async () => {
    const logs = await logs_of(
      { ...OFF, CHO_DEBUGLOG: "cho:web" },
      users_app(),
    );
    assert.match(logs, /cho:web GET \/users -> Users\.list/);
    assert.match(logs, /application App created/);
  });

  it("logs why the application cannot be created", async () => {
    class NotAModule {}
    const logs = await logs_of({ ...OFF, CHO_DEBUGLOG: "cho:web" }, NotAModule);
    assert.match(
      logs,
      /ERROR cannot create application NotAModule: Error: Class NotAModule is not a module/,
    );
  });
});

describe("ChoWeb, closing and overrides", () => {
  /** An app whose `GET /` answers with the name of its `Db`. */
  function db_app(log: string[]) {
    class Db {
      name = "real";
      [Symbol.asyncDispose]() {
        log.push(`closed ${this.name}`);
        return Promise.resolve();
      }
    }
    Injectable()(Db);
    class Home {
      constructor(readonly db: Db) {}
      get() {
        return this.db.name;
      }
    }
    legacy(Get(""), Home, "get");
    Controller({ dependencies: [Db] })(Home);
    class App {}
    Module({ providers: [Db], controllers: [Home] })(App);
    return { App, Db };
  }

  it("close() disposes the application's instances, once", async () => {
    const log: string[] = [];
    const app = await ChoWeb.create(db_app(log).App, {
      linker: new FakeLinker(),
    });
    assert.deepEqual(log, []);
    await app.close();
    await app.close();
    assert.deepEqual(log, ["closed real"]);
  });

  it("answers 503 after close(), without running a route", async () => {
    let handled = 0;
    const linker: Linker<null> = {
      link: () => ({
        instance: null,
        handler: () => {
          handled++;
          return Promise.resolve(new Response("ok"));
        },
        mount: () => {},
      }),
    };
    const app = await ChoWeb.create(db_app([]).App, { linker });
    const handler = app.handler; // servers keep the function
    const request = () => new Request("http://localhost/");

    assert.equal((await handler(request())).status, 200);
    await app.close();
    const refused = await handler(request());
    assert.deepEqual(
      [refused.status, await refused.text()],
      [503, "Service Unavailable"],
    );
    assert.equal(handled, 1);
  });

  it("passes every argument of the server on to the linked handler", async () => {
    const seen: unknown[][] = [];
    const linked = {
      instance: null,
      handler(...args: unknown[]) {
        seen.push([this === linked, ...args.slice(1)]);
        return Promise.resolve(new Response("ok"));
      },
      mount: () => {},
    };
    const app = await ChoWeb.create(db_app([]).App, {
      linker: { link: () => linked as Linked<null> },
    });
    const info = { remoteAddr: "x" };
    // Deno passes the connection info, Bun the server, Workers env and ctx
    await (app.handler as (...args: unknown[]) => Promise<Response>)(
      new Request("http://localhost/"),
      info,
      "ctx",
    );
    assert.deepEqual(seen, [[true, info, "ctx"]]);
    // Deno.serve gives no request to a handler that declares no parameter
    assert.equal(app.handler.length, 1);
  });

  it("is closed at the end of an `await using` block", async () => {
    const log: string[] = [];
    {
      await using _app = await ChoWeb.create(db_app(log).App, {
        linker: new FakeLinker(),
      });
    }
    assert.deepEqual(log, ["closed real"]);
  });

  it("disposes what was created when the application cannot be created", async () => {
    const log: string[] = [];
    const { App } = db_app(log);
    await assert.rejects(
      ChoWeb.create(App, { linker: new FakeLinker(), prefix: "/bad" }),
      /Invalid route "\/bad" of the global prefix/,
    );
    assert.deepEqual(log, ["closed real"]);
  });

  it("leaves nothing created when one module fails while another is starting", async () => {
    const log: string[] = [];
    const FAIL = token<object>("FAIL");
    const SLOW = token<object>("SLOW");
    class A {}
    Module({
      providers: [provider({
        provide: FAIL,
        factory: () => Promise.reject(new Error("no")),
      })],
    })(A);
    class B0 {}
    Module({
      providers: [provider({
        provide: SLOW,
        // ready after module A has failed
        factory: () => new Promise((resolve) => setTimeout(resolve, 5, {})),
      })],
      exports: [SLOW],
    })(B0);
    class Conn {
      constructor() {
        log.push("opened");
      }
      [Symbol.dispose]() {
        log.push("closed");
      }
    }
    Injectable([SLOW])(Conn);
    class B {}
    Module({ imports: [B0], providers: [Conn] })(B);
    class App {}
    Module({ imports: [A, B] })(App);

    await assert.rejects(ChoWeb.create(App, { linker: new FakeLinker() }), {
      message: "Failed to create InjectionToken(FAIL) in module A",
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual(log, []);
  });

  it("replaces providers with the overrides option", async () => {
    const { App, Db } = db_app([]);
    const linker = new FakeLinker();
    await ChoWeb.create(App, {
      linker,
      overrides: [
        provider({
          provide: Db,
          factory: () => ({ name: "fake" }) as InstanceType<typeof Db>,
        }),
      ],
    });
    const response = await linker.calls[0]![0]!.handle(
      new Request("http://localhost/"),
    );
    assert.equal(await response.text(), "fake");
  });
});

describe("ChoWeb.mount", () => {
  /** Send a request to an application, by path and method. */
  const send = (app: ChoWeb<unknown>, path: string, method = "GET") =>
    app.handler(new Request(`http://localhost${path}`, { method }));

  /** A middleware that records its name, then goes on. */
  const record =
    (seen: string[], name: string): ChoWebMiddlewareFn => (_ctx, next) => {
      seen.push(name);
      return next();
    };

  it("adds a route after the declared ones, and gives it to the linker", async () => {
    const linker = new FakeLinker();
    const app = await ChoWeb.create(users_app(), { linker });
    const graph = JSON.stringify(app.graph.features.map((f) => f.route));

    app.mount("GET", "health", function health() {
      return "ok";
    });

    assert.deepEqual(
      app.routes.map((r) => [r.method, r.path, r.name]),
      [["GET", "/users", "Users.list"], ["GET", "/health", "health"]],
    );
    assert.deepEqual(linker.mounted, [app.routes[1]]);
    // the linker was given the declared routes only, once
    assert.equal(linker.calls.length, 1);
    assert.equal(linker.calls[0]!.length, 1);
    // not a declared route: the graph is unchanged
    assert.equal(
      JSON.stringify(app.graph.features.map((f) => f.route)),
      graph,
    );
    assert.equal(app.graph.features[0]!.controllers[0]!.methods.length, 1);
  });

  it("does not put the route under the global prefix", async () => {
    const app = await ChoWeb.create(users_app(), {
      linker: new TestLinker(),
      prefix: "api",
    });
    app.mount("GET", "docs", () => "docs");
    app.mount("GET", "", () => "root");
    app.mount("GET", " internal/docs ", () => "internal");

    assert.deepEqual(app.routes.map((r) => r.path), [
      "/api/users",
      "/docs",
      "/",
      "/internal/docs",
    ]);
    assert.equal(await (await send(app, "/docs")).text(), "docs");
    assert.equal(await (await send(app, "/")).text(), "root");
    assert.equal(await (await send(app, "/internal/docs")).text(), "internal");
    assert.equal((await send(app, "/api/docs")).status, 404);
  });

  it("converts what the handler returns, like a declared handler", async () => {
    const app = await ChoWeb.create(users_app(), { linker: new TestLinker() });
    app.mount("GET", "json/:id", (ctx) => ({ id: ctx.params.id }));
    app.mount("GET", "nothing", () => {});
    app.mount(
      "POST",
      "response",
      async (ctx) => new Response(await ctx.req.text(), { status: 201 }),
    );

    const json = await send(app, "/json/42");
    // Bun adds a charset to the type of a JSON response
    assert.match(json.headers.get("content-type") ?? "", /^application\/json/);
    assert.deepEqual(await json.json(), { id: "42" });
    assert.equal((await send(app, "/nothing")).status, 204);
    const response = await app.handler(
      new Request("http://localhost/response", { method: "POST", body: "hi" }),
    );
    assert.deepEqual([response.status, await response.text()], [201, "hi"]);
  });

  it("sends the response of a HEAD route without its body", async () => {
    const app = await ChoWeb.create(users_app(), { linker: new TestLinker() });
    app.mount("HEAD", "x", () => new Response("body", { status: 200 }));
    const response = await send(app, "/x", "HEAD");
    assert.deepEqual([response.status, response.body], [200, null]);
  });

  it("runs its middlewares, in order, and none of the application's", async () => {
    const seen: string[] = [];
    class Users {
      list() {
        return "users";
      }
    }
    legacy(Get(""), Users, "list");
    Middlewares(record(seen, "controller"))(Users);
    Controller({ route: "users" })(Users);
    class App {}
    Middlewares(record(seen, "feature"))(App);
    Module({ controllers: [Users] })(App);
    const app = await ChoWeb.create(App, { linker: new TestLinker() });

    app.mount("GET", "x", () => (seen.push("handler"), "x"), {
      middlewares: [record(seen, "a"), record(seen, "b")],
    });
    app.mount("GET", "stopped", () => "never", {
      middlewares: [() => new Response("no", { status: 401 })],
    });

    assert.equal(await (await send(app, "/x")).text(), "x");
    assert.deepEqual(seen, ["a", "b", "handler"]);
    assert.equal((await send(app, "/stopped")).status, 401);
    seen.length = 0;
    assert.equal(await (await send(app, "/users")).text(), "users");
    assert.deepEqual(seen, ["feature", "controller"]);
  });

  it("gives its errors to the error handler of the application", async () => {
    const app = await ChoWeb.create(users_app(), {
      linker: new TestLinker(),
      onError: (error, ctx) =>
        new Response(`${ctx.url.pathname}: ${(error as Error).message}`, {
          status: 500,
        }),
    });
    app.mount("GET", "boom", () => {
      throw new Error("boom");
    });
    app.mount("GET", "late", () => "never", {
      middlewares: [() => Promise.reject(new Error("refused"))],
    });

    assert.equal(await (await send(app, "/boom")).text(), "/boom: boom");
    assert.equal(await (await send(app, "/late")).text(), "/late: refused");
  });

  it("rejects, for the runtime to answer, without an error handler", async () => {
    const linker = new TestLinker();
    const app = await ChoWeb.create(users_app(), { linker });
    const error = new Error("boom");
    app.mount("GET", "boom", () => {
      throw error;
    });
    assert.equal((await send(app, "/boom")).status, 500);
    assert.deepEqual(linker.errors, [error]);
  });

  it("names the route after its handler, or as it is told", async () => {
    const app = await ChoWeb.create(users_app(), { linker: new FakeLinker() });
    app.mount("GET", "a", function named() {});
    app.mount("GET", "b", () => {});
    app.mount("GET", "c", function ignored() {}, { name: "openapi document" });
    assert.deepEqual(app.routes.slice(1).map((r) => r.name), [
      "named",
      "mounted",
      "openapi document",
    ]);
  });

  it("rejects a method, a route, a handler, a middleware or an option that is wrong", async () => {
    const app = await ChoWeb.create(users_app(), { linker: new FakeLinker() });
    const mount = app.mount.bind(app) as (...args: unknown[]) => void;
    const ok = () => {};

    assert.throws(() => mount("get", "x", ok), {
      name: "TypeError",
      message:
        'ChoWeb.mount(): method must be one of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, got "get"',
    });
    assert.throws(() => mount("GET", "/x", ok), {
      message:
        'Invalid route "/x" of ChoWeb.mount(): it must not start or end with "/"',
    });
    assert.throws(() => mount("GET", "a/*", ok), {
      message: /^Invalid route "a\/\*" of ChoWeb\.mount\(\): .* wildcards/,
    });
    assert.throws(() => mount("GET", 7, ok), {
      name: "TypeError",
      message: "Invalid route of ChoWeb.mount(): expected a string, got 7",
    });
    assert.throws(() => mount("GET", "x", "handler"), {
      name: "TypeError",
      message:
        'ChoWeb.mount(): the handler of GET /x must be a function, got "handler"',
    });
    assert.throws(() => mount("GET", "x", ok, { middlewares: [ok, 3] }), {
      name: "TypeError",
      message:
        "ChoWeb.mount(): middleware 2 of GET /x must be a function, got 3",
    });
    assert.throws(() => mount("GET", "x", ok, { middleware: [] }), {
      message:
        'ChoWeb.mount(): unknown option "middleware". Known options: middlewares, name',
    });
    // nothing was mounted
    assert.equal(app.routes.length, 1);
  });

  it("rejects a route the application already has", async () => {
    const app = await ChoWeb.create(users_app(), { linker: new FakeLinker() });
    assert.throws(() => app.mount("GET", "users", () => {}, { name: "mine" }), {
      message:
        'Duplicate route "GET /users": declared by Users.list and mounted as mine',
    });
    app.mount("POST", "users", () => {}); // another method: another route
    app.mount("GET", "docs/:id", () => {}, { name: "first" });
    // the name of a parameter makes no difference
    assert.throws(
      () => app.mount("GET", "docs/:name", () => {}, { name: "second" }),
      {
        message:
          'Duplicate route "GET /docs/:id": mounted as first and mounted as second',
      },
    );
    assert.equal(app.routes.length, 3);
  });

  it("leaves the application as it was when the runtime refuses the route", async () => {
    const linker = new FakeLinker();
    const app = await ChoWeb.create(users_app(), { linker });
    linker.refuse = new Error("already serving");
    assert.throws(() => app.mount("GET", "x", () => {}), linker.refuse);
    assert.equal(app.routes.length, 1);
    // so the route can be mounted once the runtime takes it
    linker.refuse = undefined;
    app.mount("GET", "x", () => {});
    assert.equal(app.routes.length, 2);
  });

  it("throws once the application is closed", async () => {
    const linker = new FakeLinker();
    const app = await ChoWeb.create(users_app(), { linker });
    await app.close();
    assert.throws(() => app.mount("GET", "x", () => {}), {
      message: "The application is closed",
    });
    assert.deepEqual(linker.mounted, []);
  });

  it("logs the mounted route to cho:web", async () => {
    const app = await ChoWeb.create(users_app(), { linker: new FakeLinker() });
    const { output } = await capture(() => {
      with_env(
        { CHO_DEBUG: undefined, CHO_DEBUGLOG: "cho:web" },
        () => app.mount("GET", "docs", () => {}, { name: "docs page" }),
      );
      return Promise.resolve();
    });
    assert.match(
      output.error.map(String).join(" "),
      /cho:web GET \/docs -> docs page \(mounted\)/,
    );
  });
});
