/**
 * Tests for the built-in router: what the router itself does. It matches each
 * request to a route with a URL pattern, and passes the request and the path
 * parameters to the route.
 *
 * Middlewares, error handlers and the conversion of results are
 * `@chojs/web`'s, and are tested there (`web/routes_test.ts`).
 *
 * Decorators are applied as plain function calls, so the tests run on every
 * runtime that has the URL Pattern API. On one that does not, only the error
 * the adapter reports is tested.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { capture, legacy, loose } from "@chojs/core/utils/test_utils";
import type { ChoWebContext } from "./context.ts";
import {
  Args,
  Catch,
  Controller,
  Get,
  Head,
  Middlewares,
  Module,
  Options,
  Post,
} from "./decorators.ts";
import { isHttpError } from "./http-error.ts";
import type { Route } from "./linker.ts";
import { Body, Param, Query } from "./args.ts";
import { around } from "./compose.ts";
import { ChoLinker, ChoRouter } from "./router.ts";
import type { ChoWebMiddlewareFn } from "./types.ts";
import { ChoWeb } from "./web.ts";

/** Whether this runtime has the URL Pattern API. */
const supported = typeof URLPattern === "function";
/** `describe`, skipped on a runtime the adapter does not support. */
const suite = supported ? describe : describe.skip;

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
        native: typeof native,
      })),
  };
}

/** A route that answers with a name, in the body and in `x-route`. */
function named(method: string, path: string, name: string): Route {
  return {
    ...echo(method, path),
    handle: () =>
      Promise.resolve(new Response(name, { headers: { "x-route": name } })),
  };
}

describe("ChoLinker, without the URL Pattern API", () => {
  it("fails when the application is linked, naming what is missing", () => {
    const global = globalThis as { URLPattern?: unknown };
    const saved = global.URLPattern;
    global.URLPattern = undefined;
    try {
      assert.throws(() => new ChoLinker().link([echo("GET", "/x")]), {
        code: "CHO_WEB_NO_URL_PATTERN",
        message:
          "ChoLinker needs the URL Pattern API (URLPattern), which this runtime does not have: give ChoWeb.create another linker, such as HonoLinker",
      });
    } finally {
      global.URLPattern = saved;
    }
  });
});

suite("ChoLinker.link", () => {
  it("returns a ChoRouter holding the routes, and its fetch", async () => {
    const routes = [echo("GET", "/x")];
    const linked = new ChoLinker().link(routes);
    assert.ok(linked.instance instanceof ChoRouter);
    assert.deepEqual(linked.instance.routes, routes);
    assert.equal(linked.handler, linked.instance.fetch);
    assert.equal(linked.handler.length, 1);
    assert.equal((await send(linked, "/x")).status, 200);
  });

  it("matches each route by its method and path", async () => {
    const linked = new ChoLinker().link([
      echo("GET", "/"),
      echo("GET", "/api/users"),
      echo("POST", "/api/users"),
    ]);
    assert.equal((await send(linked, "/")).status, 200);
    assert.equal((await send(linked, "/api/users")).status, 200);
    assert.equal((await send(linked, "/api/users?page=2")).status, 200);
    assert.equal((await send(linked, "/api/users", "POST")).status, 200);
    assert.equal((await send(linked, "/api/users", "PUT")).status, 404);
    assert.equal((await send(linked, "/users")).status, 404);
    // a path is matched as written: case and trailing slash count
    assert.equal((await send(linked, "/api/Users")).status, 404);
    assert.equal((await send(linked, "/api/users/")).status, 404);
  });

  for (const method of ["PUT", "PATCH", "DELETE", "OPTIONS"]) {
    it(`supports ${method}`, async () => {
      const linked = new ChoLinker().link([echo(method, "/x")]);
      const response = await send(linked, "/x", method);
      assert.equal((await response.json()).method, method);
    });
  }

  it("passes the request and the decoded parameters, and no context", async () => {
    const linked = new ChoLinker().link([
      echo("GET", "/users/:id/posts/:post"),
    ]);
    const response = await send(linked, "/users/a%20b/posts/7");
    assert.deepEqual(await response.json(), {
      method: "GET",
      params: { id: "a b", post: "7" },
      native: "undefined",
    });
  });

  it("matches one segment per parameter, and never an empty one", async () => {
    const linked = new ChoLinker().link([echo("GET", "/users/:id")]);
    const params = async (path: string) => {
      const response = await send(linked, path);
      return response.ok ? (await response.json()).params : response.status;
    };
    assert.deepEqual(await params("/users/a%2Fb"), { id: "a/b" });
    assert.equal(await params("/users/"), 404);
    assert.equal(await params("/users/1/2"), 404);
  });

  it("answers 400 to a parameter that cannot be decoded, and does not run the route", async () => {
    let calls = 0;
    const linked = new ChoLinker().link([{
      ...echo("GET", "/users/:id"),
      handle: (_req, params) => {
        calls++;
        return Promise.resolve(Response.json({ params }));
      },
    }]);
    // an encoded `%` is a value like any other
    const encoded = await send(linked, "/users/%25");
    assert.deepEqual(await encoded.json(), { params: { id: "%" } });
    assert.equal(calls, 1);
    // a `%` alone, two characters that are not hexadecimal, a sequence of
    // UTF-8 that is cut, and a byte that is not UTF-8
    for (const id of ["%", "%zz", "%E0%A4%A", "%FF", "a%2"]) {
      const response = await send(linked, `/users/${id}`);
      assert.equal(response.status, 400, id);
      assert.deepEqual(await response.json(), {
        error: 'The path parameter "id" cannot be decoded',
      }, id);
    }
    assert.equal(calls, 1);
    // a path no route matches is not decoded: it is not found
    assert.equal((await send(linked, "/nope/%")).status, 404);
  });

  it("answers 400 to a HEAD request the same way, without a body", async () => {
    const linked = new ChoLinker().link([echo("GET", "/users/:id")]);
    const response = await send(linked, "/users/%", "HEAD");
    assert.deepEqual([response.status, response.body], [400, null]);
  });

  it("matches the other characters of a path literally", async () => {
    const linked = new ChoLinker().link([
      echo("GET", "/a(b)/v1:beta/c+d/e.f"),
    ]);
    assert.equal((await send(linked, "/a(b)/v1:beta/c+d/e.f")).status, 200);
    assert.equal((await send(linked, "/ab/v1:beta/c+d/e.f")).status, 404);
    assert.equal((await send(linked, "/a(b)/v1x/c+d/e.f")).status, 404);
    assert.equal((await send(linked, "/a(b)/v1:beta/ccd/e.f")).status, 404);
    assert.equal((await send(linked, "/a(b)/v1:beta/c+d/exf")).status, 404);
  });

  it("matches routes in declaration order", async () => {
    const linked = new ChoLinker().link([
      named("GET", "/users/me", "static"),
      named("GET", "/users/:id", "param"),
    ]);
    assert.equal(await (await send(linked, "/users/me")).text(), "static");
    assert.equal(await (await send(linked, "/users/42")).text(), "param");
  });

  it("runs a HEAD route for HEAD requests, wherever it is declared", async () => {
    const linked = new ChoLinker().link([
      named("GET", "/file", "get"), // declared first: must not answer HEAD
      named("HEAD", "/file", "head"),
      named("GET", "/other", "get-other"),
      named("POST", "/posted", "post"),
    ]);
    const route = async (path: string, method: string) =>
      (await send(linked, path, method)).headers.get("x-route");
    assert.equal(await route("/file", "HEAD"), "head");
    assert.equal(await route("/file", "GET"), "get");

    // without a HEAD route, the GET route answers, without its body
    const other = await send(linked, "/other", "HEAD");
    assert.equal(other.headers.get("x-route"), "get-other");
    assert.equal(other.body, null);
    // and only the GET route
    assert.equal((await send(linked, "/posted", "HEAD")).status, 404);
  });

  it("finds a route and its parameters with match()", () => {
    const routes = [echo("GET", "/users/:id"), echo("POST", "/users")];
    const router = new ChoLinker().link(routes).instance;
    assert.deepEqual(router.match("GET", "/users/42"), {
      route: routes[0],
      params: { id: "42" },
    });
    assert.deepEqual(router.match("POST", "/users"), {
      route: routes[1],
      params: {},
    });
    assert.equal(router.match("DELETE", "/users/42"), undefined);
    assert.equal(router.match("GET", "/nope"), undefined);
    // a parameter that cannot be decoded is an error, not a match
    assert.throws(
      () => router.match("GET", "/users/%"),
      (error) => isHttpError(error) && error.status === 400,
    );
  });

  it("answers 404 when no route matches, or what notFound answers", async () => {
    const plain = await send(new ChoLinker().link([]), "/nope");
    assert.deepEqual([plain.status, await plain.text()], [404, "Not Found"]);

    const linker = new ChoLinker({
      notFound: (req) =>
        Promise.resolve(
          Response.json({ missing: new URL(req.url).pathname }, {
            status: 404,
          }),
        ),
    });
    const custom = await send(linker.link([]), "/nope");
    assert.deepEqual([custom.status, await custom.json()], [404, {
      missing: "/nope",
    }]);
  });

  it("serves several applications: each link() makes a new router", async () => {
    const linker = new ChoLinker();
    const first = linker.link([echo("GET", "/x")]);
    const second = linker.link([echo("GET", "/y")]);
    assert.notEqual(first.instance, second.instance);
    assert.equal((await send(first, "/y")).status, 404);
    assert.equal((await send(second, "/y")).status, 200);
  });

  it("answers 500 when a route rejects, and logs the error", async () => {
    const linked = new ChoLinker().link([{
      ...echo("GET", "/x"),
      handle: () => Promise.reject(new Error("boom")),
    }]);
    const { result, output } = await capture(() => send(linked, "/x"));
    assert.deepEqual(
      [result.status, await result.text()],
      [500, "Internal Server Error"],
    );
    assert.equal((output.error[0] as Error).message, "boom");
  });
});

suite("ChoLinker, mounting a route", () => {
  it("adds the route after the others, at any time", async () => {
    const linked = new ChoLinker().link([named("GET", "/a", "a")]);
    assert.equal((await send(linked, "/b")).status, 404); // it has answered

    const route = named("GET", "/b", "b");
    linked.mount(route);

    assert.equal(await (await send(linked, "/b")).text(), "b");
    assert.equal(await (await send(linked, "/a")).text(), "a");
    assert.deepEqual(linked.instance.routes.map((r) => r.path), ["/a", "/b"]);
    assert.equal(linked.instance.match("GET", "/b")?.route, route);
  });

  it("matches a mounted route last", async () => {
    const linked = new ChoLinker().link([named("GET", "/:slug", "declared")]);
    linked.mount(named("GET", "/docs", "mounted"));
    linked.mount(named("GET", "/docs/openapi.json", "document"));
    assert.equal(await (await send(linked, "/docs")).text(), "declared");
    assert.equal(
      await (await send(linked, "/docs/openapi.json")).text(),
      "document",
    );
  });

  it("answers a HEAD request with a mounted GET route, or with a mounted HEAD route", async () => {
    const linked = new ChoLinker().link([named("GET", "/a", "get a")]);
    linked.mount(named("GET", "/b", "get b"));
    const from_get = await send(linked, "/b", "HEAD");
    assert.deepEqual(
      [from_get.status, from_get.headers.get("x-route"), from_get.body],
      [200, "get b", null],
    );
    // a HEAD route mounted after the GET route of its path answers first
    linked.mount(named("HEAD", "/a", "head a"));
    const head = await send(linked, "/a", "HEAD");
    assert.equal(head.headers.get("x-route"), "head a");
    assert.equal(
      (await send(linked, "/a")).headers.get("x-route"),
      "get a",
    );
  });

  it("runs the middlewares of the application around a mounted route", async () => {
    const seen: string[] = [];
    const linked = new ChoLinker().link([], {
      around: around([async (ctx, next) => {
        seen.push(`in ${ctx.url.pathname}`);
        const response = await next();
        seen.push(`out ${response.status}`);
        return response;
      }]),
    });
    linked.mount(named("GET", "/x/:id", "x"));
    assert.equal(await (await send(linked, "/x/1")).text(), "x");
    assert.deepEqual(seen, ["in /x/1", "out 200"]);
  });

  it("serves the routes ChoWeb mounts", async () => {
    class App {}
    Module({})(App);
    const app = await ChoWeb.create(App, { prefix: "api" });
    app.mount("GET", "docs/:page", (ctx) => ({ page: ctx.params.page }));
    assert.deepEqual(await (await send(app, "/docs/intro")).json(), {
      page: "intro",
    });
    assert.equal(app.linked.instance.routes.length, 1);
    assert.equal((await send(app, "/docs/intro", "HEAD")).body, null);
  });
});

suite("ChoLinker, HEAD and OPTIONS with ChoWeb", () => {
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
      list() {
        return ["report"];
      }
    }
    legacy(Get(":name"), Files, "get");
    legacy(Head(":name"), Files, "stat");
    legacy(Options(":name"), Files, "options");
    legacy(Get(""), Files, "list");
    Controller({ route: "files" })(Files);
    class App {}
    Module({ controllers: [Files] })(App);
    const app = await ChoWeb.create(App, { linker: new ChoLinker() });

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
    // no @Head for the list: @Get answers, with its headers and no body
    const list = await send(app, "/files", "HEAD");
    const type = (await send(app, "/files")).headers.get("content-type");
    assert.match(type ?? "", /^application\/json/);
    assert.deepEqual(
      [list.status, list.headers.get("content-type"), await list.text()],
      [200, type, ""],
    );
  });
});

suite("ChoLinker, with ChoWeb", () => {
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
        return { id: this.prefix + ctx.params.id, native: typeof ctx.native };
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
      linker: new ChoLinker(),
      prefix: "api",
    });
    assert.ok(app.linked.instance instanceof ChoRouter);

    const list = await send(app, "/api/v1/users");
    assert.deepEqual(await list.json(), [1, 2]);
    assert.equal(list.headers.get("x-stamp"), "1");
    assert.deepEqual(await (await send(app, "/api/v1/users/42")).json(), {
      id: "user-42",
      native: "undefined",
    });
    const failed = await send(app, "/api/v1/users", "POST");
    assert.deepEqual([failed.status, await failed.text()], [405, "read only"]);
    assert.equal((await send(app, "/v1/users")).status, 404);
  });

  it("answers unmatched requests with the linker's notFound", async () => {
    const app = await ChoWeb.create(users_app(), {
      linker: new ChoLinker({
        notFound: () => new Response("nothing here", { status: 404 }),
      }),
    });
    assert.equal(await (await send(app, "/nope")).text(), "nothing here");
    assert.deepEqual(await (await send(app, "/v1/users")).json(), [1, 2]);
  });
});

suite("ChoLinker, handler arguments", () => {
  it("gives a handler its path parameters, its query and its body", async () => {
    class Users {
      update(id: string, notify: string | undefined, body: unknown) {
        return { id, notify, body };
      }
    }
    legacy(Post(":id"), Users, "update");
    legacy(loose(Args(Param("id"), Query("notify"), Body())), Users, "update");
    Controller({ route: "users" })(Users);
    class App {}
    Module({ controllers: [Users] })(App);
    const app = await ChoWeb.create(App, { linker: new ChoLinker() });

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
    });
  });
});

suite("ChoLinker, the middlewares of the application", () => {
  /** A middleware that records its name and the path, then goes on. */
  const record =
    (seen: string[], name: string): ChoWebMiddlewareFn => async (ctx, next) => {
      seen.push(`${name} in ${ctx.url.pathname}`);
      const response = await next();
      seen.push(`${name} out ${response.status}`);
      return response;
    };

  it("run for every request, in order, a request no route matches included", async () => {
    const seen: string[] = [];
    const linked = new ChoLinker().link([named("GET", "/x", "x")], {
      around: around([record(seen, "a"), record(seen, "b")]),
    });

    assert.equal(await (await send(linked, "/x")).text(), "x");
    assert.equal((await send(linked, "/nope")).status, 404);
    assert.deepEqual(seen, [
      "a in /x",
      "b in /x",
      "b out 200",
      "a out 200",
      "a in /nope",
      "b in /nope",
      "b out 404",
      "a out 404",
    ]);
  });

  it("receive the parameters of the route that matched, or none", async () => {
    const params: unknown[] = [];
    const linked = new ChoLinker().link([echo("GET", "/users/:id")], {
      around: around([(ctx, next) => {
        params.push(ctx.params);
        return next();
      }]),
    });
    await send(linked, "/users/a%20b");
    await send(linked, "/nope");
    assert.deepEqual(params, [{ id: "a b" }, {}]);
  });

  it("wrap the 400 of a parameter that cannot be decoded, with no parameters", async () => {
    const seen: string[] = [];
    const params: unknown[] = [];
    const linked = new ChoLinker().link([echo("GET", "/users/:id")], {
      around: around([record(seen, "a"), (ctx, next) => {
        params.push(ctx.params);
        return next();
      }]),
    });
    assert.equal((await send(linked, "/users/%")).status, 400);
    assert.deepEqual(seen, ["a in /users/%", "a out 400"]);
    assert.deepEqual(params, [{}]);
  });

  it("can answer by themselves, and change the response", async () => {
    let handled = 0;
    const route: Route = {
      ...echo("GET", "/x"),
      handle: () => {
        handled++;
        return Promise.resolve(new Response("x"));
      },
    };
    const guard: ChoWebMiddlewareFn = (ctx, next) =>
      ctx.req.headers.has("x-key")
        ? next()
        : new Response("no key", { status: 401 });
    const stamp: ChoWebMiddlewareFn = async (_ctx, next) => {
      const response = await next();
      response.headers.set("x-stamp", "1");
      return response;
    };
    const linked = new ChoLinker().link([route], {
      around: around([stamp, guard]),
    });

    const refused = await send(linked, "/x");
    assert.deepEqual(
      [refused.status, refused.headers.get("x-stamp"), handled],
      [401, "1", 0],
    );
    const allowed = await linked.handler(
      new Request("http://localhost/x", { headers: { "x-key": "k" } }),
    );
    assert.deepEqual([await allowed.text(), handled], ["x", 1]);
  });

  it("wrap the notFound option, and the answer to a HEAD request", async () => {
    const seen: string[] = [];
    const linked = new ChoLinker({
      notFound: () => new Response("nothing here", { status: 404 }),
    }).link([named("GET", "/x", "x")], { around: around([record(seen, "a")]) });
    assert.equal(await (await send(linked, "/nope")).text(), "nothing here");
    const head = await send(linked, "/x", "HEAD");
    assert.deepEqual([head.status, head.body], [200, null]);
    assert.deepEqual(seen, [
      "a in /nope",
      "a out 404",
      "a in /x",
      "a out 200",
    ]);
  });

  it("see a route that rejects as a 500 response", async () => {
    const seen: string[] = [];
    const linked = new ChoLinker().link([{
      ...echo("GET", "/x"),
      handle: () => Promise.reject(new Error("boom")),
    }], { around: around([record(seen, "a")]) });
    const { result, output } = await capture(() => send(linked, "/x"));
    assert.equal(result.status, 500);
    assert.equal((output.error[0] as Error).message, "boom");
    assert.deepEqual(seen, ["a in /x", "a out 500"]);
  });

  it("answer 500 when one of them fails, and log the error", async () => {
    const failing: ChoWebMiddlewareFn = () => {
      throw new Error("broken middleware");
    };
    const linked = new ChoLinker().link([
      echo("GET", "/x"),
    ], { around: around([failing]) });
    const { result, output } = await capture(() => send(linked, "/x"));
    assert.deepEqual(
      [result.status, await result.text()],
      [500, "Internal Server Error"],
    );
    assert.equal((output.error[0] as Error).message, "broken middleware");
  });

  it("share their state with the middlewares and the handler of the route", async () => {
    class Ctrl {
      get(ctx: ChoWebContext) {
        return { from_router: ctx.state.get("user") ?? null };
      }
    }
    legacy(Get(""), Ctrl, "get");
    Controller({ route: "x" })(Ctrl);
    class App {}
    Module({ controllers: [Ctrl] })(App);
    const seen: unknown[] = [];
    const app = await ChoWeb.create(App, {
      middlewares: [async (ctx, next) => {
        ctx.state.set("user", "ada");
        const response = await next();
        // and what the route sets comes back
        seen.push(ctx.state.get("user"));
        return response;
      }],
    });
    assert.deepEqual(
      await (await app.handler(new Request("http://localhost/x"))).json(),
      { from_router: "ada" },
    );
    assert.deepEqual(seen, ["ada"]);
  });

  it("can replace the request the route receives", async () => {
    const linked = new ChoLinker().link([{
      ...echo("GET", "/x"),
      handle: (req) =>
        Promise.resolve(new Response(req.headers.get("x-added") ?? "none")),
    }], {
      around: around([(ctx, next) => {
        (ctx as { req: Request }).req = new Request(ctx.req, {
          headers: { "x-added": "1" },
        });
        return next();
      }]),
    });
    assert.equal(await (await send(linked, "/x")).text(), "1");
  });

  it("are not an option of the router: giving them there throws", () => {
    assert.throws(
      () => new ChoLinker(loose({ middlewares: [() => {}] })).link([]),
      {
        code: "CHO_WEB_INVALID_OPTION",
        message:
          'ChoLinker: "middlewares" is not an option of the router: give the middlewares of the application to ChoWeb.create(App, { middlewares })',
      },
    );
  });
});
