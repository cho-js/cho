/**
 * Tests for the Hono adapter: what the adapter itself does. It registers each
 * route with its method and path, and passes the request, the path parameters
 * and Hono's context to the route.
 *
 * Middlewares, error handlers and the conversion of results are
 * `@chojs/web`'s, and are tested there (`web/routes_test.ts`).
 *
 * Decorators are applied as plain function calls, so the tests run on every
 * runtime.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import { cors } from "hono/cors";
import {
  Args,
  Body,
  Catch,
  ChoWeb,
  type ChoWebContext,
  type ChoWebMiddlewareFn,
  Controller,
  Get,
  Head,
  Middlewares,
  Module,
  Options,
  Param,
  Post,
  Query,
} from "@chojs/web";
import type { Route } from "@chojs/web/linker";
import { capture, legacy, loose } from "@chojs/core/utils/test_utils";
import { HonoLinked, HonoLinker } from "./mod.ts";

/** Send a request to a `fetch`-style handler, by path and method. */
function send(
  to: { handler: (req: Request) => Promise<Response> },
  path: string,
  method = "GET",
) {
  return to.handler(new Request(`http://localhost${path}`, { method }));
}

/** A route that answers with what it was called with. */
function echo(method: string, path: string): Route {
  return {
    method,
    path,
    name: `echo ${method} ${path}`,
    handle: (req, params, native) =>
      Promise.resolve(Response.json({
        method: req.method,
        params,
        native: typeof (native as { req?: unknown })?.req,
      })),
  };
}

describe("HonoLinker.link", () => {
  it("returns a HonoLinked holding a Hono app and its fetch", async () => {
    const linked = new HonoLinker().link([echo("GET", "/x")]);
    assert.ok(linked instanceof HonoLinked);
    assert.ok(linked.instance instanceof Hono);
    assert.equal((await send(linked, "/x")).status, 200);
  });

  it("registers each route with its method and path", async () => {
    const linked = new HonoLinker().link([
      echo("GET", "/"),
      echo("GET", "/api/users"),
      echo("POST", "/api/users"),
    ]);
    assert.equal((await send(linked, "/")).status, 200);
    assert.equal((await send(linked, "/api/users")).status, 200);
    assert.equal((await send(linked, "/api/users", "POST")).status, 200);
    assert.equal((await send(linked, "/api/users", "PUT")).status, 404);
    assert.equal((await send(linked, "/users")).status, 404);
  });

  for (const method of ["PUT", "PATCH", "DELETE", "OPTIONS"]) {
    it(`supports ${method}`, async () => {
      const linked = new HonoLinker().link([echo(method, "/x")]);
      const response = await send(linked, "/x", method);
      assert.equal((await response.json()).method, method);
    });
  }

  it("passes the request, the decoded parameters and Hono's context", async () => {
    const linked = new HonoLinker().link([
      echo("GET", "/users/:id/posts/:post"),
    ]);
    const response = await send(linked, "/users/a%20b/posts/7");
    assert.deepEqual(await response.json(), {
      method: "GET",
      params: { id: "a b", post: "7" },
      native: "object",
    });
  });

  it("matches routes in declaration order", async () => {
    const named = (path: string, name: string): Route => ({
      ...echo("GET", path),
      handle: () => Promise.resolve(new Response(name)),
    });
    const linked = new HonoLinker().link([
      named("/users/me", "static"),
      named("/users/:id", "param"),
    ]);
    assert.equal(await (await send(linked, "/users/me")).text(), "static");
    assert.equal(await (await send(linked, "/users/42")).text(), "param");
  });

  it("runs a HEAD route for HEAD requests, wherever it is declared", async () => {
    const named = (method: string, path: string, name: string): Route => ({
      ...echo(method, path),
      handle: () =>
        Promise.resolve(new Response(null, { headers: { "x-route": name } })),
    });
    const linked = new HonoLinker().link([
      named("GET", "/file", "get"), // declared first: must not answer HEAD
      named("HEAD", "/file", "head"),
      named("GET", "/other", "get-other"),
    ]);

    const route = async (path: string, method: string) =>
      (await send(linked, path, method)).headers.get("x-route");
    assert.equal(await route("/file", "HEAD"), "head");
    assert.equal(await route("/file", "GET"), "get");
    // without a HEAD route, Hono answers HEAD from the GET route
    assert.equal(await route("/other", "HEAD"), "get-other");
  });

  it("serves one application: a second link() throws", () => {
    const linker = new HonoLinker();
    linker.link([echo("GET", "/x")]);
    assert.throws(() => linker.link([echo("GET", "/y")]), {
      message:
        "HonoLinker.link() was already called: use one linker for one application",
    });
  });

  it("answers 500 when a route rejects, and logs the error", async () => {
    const linked = new HonoLinker().link([{
      ...echo("GET", "/x"),
      handle: () => Promise.reject(new Error("boom")),
    }]);
    // Hono's default error handler logs the error to console.error: capture
    // it, so the test output stays clean.
    const { result, output } = await capture(() => send(linked, "/x"));
    assert.equal(result.status, 500);
    assert.equal((output.error[0] as Error).message, "boom");
  });
});

describe("HonoLinker, HEAD and OPTIONS with ChoWeb", () => {
  it("serves @Head and @Options handlers", async () => {
    class Files {
      get() {
        return { name: "report" };
      }
      stat() {
        return new Response("no body", { headers: { "x-size": "42" } });
      }
      options() {
        return new Response(null, { status: 204, headers: { allow: "GET" } });
      }
    }
    legacy(Get(":name"), Files, "get");
    legacy(Head(":name"), Files, "stat");
    legacy(Options(":name"), Files, "options");
    Controller({ route: "files" })(Files);
    class App {}
    Module({ controllers: [Files] })(App);
    const app = await ChoWeb.create(App, { linker: new HonoLinker() });

    const head = await send(app, "/files/report", "HEAD");
    assert.equal(head.headers.get("x-size"), "42");
    assert.equal(await head.text(), "");
    assert.deepEqual(await (await send(app, "/files/report")).json(), {
      name: "report",
    });
    const options = await send(app, "/files/report", "OPTIONS");
    assert.deepEqual(
      [options.status, options.headers.get("allow")],
      [204, "GET"],
    );
  });
});

describe("HonoLinker, with ChoWeb", () => {
  /** `GET users`, `GET users/:id` and `POST users`, behind a middleware. */
  function users_app() {
    const stamp: ChoWebMiddlewareFn = async (_ctx, next) => {
      const response = await next();
      response.headers.set("x-stamp", "1");
      return response;
    };
    class Users {
      prefix = "user-";
      list() {
        return [1, 2];
      }
      get(ctx: ChoWebContext) {
        return {
          id: this.prefix + ctx.params.id,
          hono: typeof (ctx.native as { req: { path: string } }).req.path,
        };
      }
      create() {
        throw new Error("read only");
      }
    }
    legacy(Get(""), Users, "list");
    legacy(Get(":id"), Users, "get");
    legacy(Post(""), Users, "create");
    Controller({ route: "users" })(Users);
    Middlewares(stamp)(Users);
    Catch((error) => new Response((error as Error).message, { status: 405 }))(
      Users,
    );
    class App {}
    Module({ route: "v1", controllers: [Users] })(App);
    return App;
  }

  it("serves an application end to end, with the global prefix", async () => {
    const app = await ChoWeb.create(users_app(), {
      linker: new HonoLinker(),
      prefix: "api",
    });
    assert.ok(app.linked.instance instanceof Hono);

    const list = await send(app, "/api/v1/users");
    assert.deepEqual(await list.json(), [1, 2]);
    assert.equal(list.headers.get("x-stamp"), "1");
    assert.deepEqual(await (await send(app, "/api/v1/users/42")).json(), {
      id: "user-42",
      hono: "string",
    });
    const failed = await send(app, "/api/v1/users", "POST");
    assert.deepEqual([failed.status, await failed.text()], [405, "read only"]);
    assert.equal((await send(app, "/v1/users")).status, 404);
  });

  it("registers the routes on a given Hono app, after its middlewares", async () => {
    const hono = new Hono();
    hono.use(cors({ origin: "https://example.com" }));
    hono.notFound((ctx) => ctx.text("nothing here", 404));
    const app = await ChoWeb.create(users_app(), {
      linker: new HonoLinker(hono),
    });

    assert.equal(app.linked.instance, hono);
    const list = await app.handler(
      new Request("http://localhost/v1/users", {
        headers: { origin: "https://example.com" },
      }),
    );
    assert.deepEqual(await list.json(), [1, 2]);
    assert.equal(
      list.headers.get("access-control-allow-origin"),
      "https://example.com",
    );
    assert.equal(await (await send(app, "/nope")).text(), "nothing here");
  });
});

describe("HonoLinker, handler arguments", () => {
  it("gives a handler its path parameters, its query and its body", async () => {
    class Users {
      update(
        id: string,
        notify: string | undefined,
        body: unknown,
        ctx: ChoWebContext,
      ) {
        return {
          id,
          notify,
          body,
          hono: typeof (ctx.native as { req: { path: string } }).req.path,
        };
      }
    }
    legacy(Post(":id"), Users, "update");
    legacy(loose(Args(Param("id"), Query("notify"), Body())), Users, "update");
    Controller({ route: "users" })(Users);
    class App {}
    Module({ controllers: [Users] })(App);
    const app = await ChoWeb.create(App, { linker: new HonoLinker() });

    const response = await app.handler(
      new Request("http://localhost/users/a%20b?notify=1", {
        method: "POST",
        body: '{"name":"Ada"}',
      }),
    );
    assert.deepEqual(await response.json(), {
      id: "a b",
      notify: "1",
      body: { name: "Ada" },
      hono: "string",
    });
  });
});
