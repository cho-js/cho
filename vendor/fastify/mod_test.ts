/**
 * Tests for the Fastify adapter: what the adapter itself does. It registers
 * each route with its method and path, builds a standard `Request` from
 * Fastify's, and passes it, the path parameters and Fastify's request and
 * reply to the route.
 *
 * Middlewares, error handlers and the conversion of results are
 * `@chojs/web`'s, and are tested there (`web/routes_test.ts`).
 *
 * The adapter supports Node.js only: on the other runtimes the tests are
 * skipped. Decorators are applied as plain function calls.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
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
import { engine } from "@chojs/core/utils";
import { legacy, loose } from "@chojs/core/utils/test_utils";
import {
  type FastifyHook,
  FastifyLinked,
  FastifyLinker,
  type FastifyNative,
  fromFastify,
} from "./mod.ts";

/** `describe`, skipped on a runtime the adapter does not support. */
const suite = engine() === "node" ? describe : describe.skip;

/** Send a request to a `fetch`-style handler, by path and method. */
function send(
  to: { handler: (req: Request) => Promise<Response> },
  path: string,
  method = "GET",
  init: RequestInit = {},
) {
  return to.handler(
    new Request(`http://localhost${path}`, { method, ...init }),
  );
}

/** A route that answers with what it was called with. */
function echo(method: string, path: string): Route {
  return {
    method,
    path,
    name: `echo ${method} ${path}`,
    handle: async (req, params, native) => {
      const { request, reply } = native as FastifyNative;
      return Response.json({
        method: req.method,
        url: req.url,
        type: req.headers.get("content-type"),
        body: req.body === null ? null : await req.text(),
        params,
        native: [typeof request.raw, typeof reply.send],
      });
    },
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

suite("FastifyLinker.link", () => {
  it("returns a FastifyLinked holding a Fastify app and a handler", async () => {
    const fastify = Fastify();
    const linked = new FastifyLinker(fastify).link([echo("GET", "/x")]);
    assert.ok(linked instanceof FastifyLinked);
    assert.equal(linked.instance, fastify);
    assert.equal((await send(linked, "/x")).status, 200);
    // without a given app, the linker makes one
    const made = new FastifyLinker().link([echo("GET", "/x")]);
    assert.equal(typeof made.instance.listen, "function");
    assert.equal((await send(made, "/x")).status, 200);
  });

  it("registers each route with its method and path", async () => {
    const linked = new FastifyLinker().link([
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
      const linked = new FastifyLinker().link([echo(method, "/x")]);
      const response = await send(linked, "/x", method);
      assert.equal((await response.json()).method, method);
    });
  }

  it("passes a standard Request, the decoded parameters and Fastify's request and reply", async () => {
    const linked = new FastifyLinker().link([
      echo("GET", "/users/:id/posts/:post"),
    ]);
    const response = await send(linked, "/users/a%20b/posts/7?full=1");
    assert.deepEqual(await response.json(), {
      method: "GET",
      url: "http://localhost/users/a%20b/posts/7?full=1",
      type: null,
      body: null,
      params: { id: "a b", post: "7" },
      native: ["object", "function"],
    });
  });

  it("passes the headers of the request, repeated ones included", async () => {
    const linked = new FastifyLinker().link([{
      ...echo("GET", "/x"),
      handle: (req) =>
        Promise.resolve(Response.json({
          token: req.headers.get("x-token"),
          accept: req.headers.get("accept"),
        })),
    }]);
    const response = await send(linked, "/x", "GET", {
      headers: [["x-token", "abc"], ["accept", "text/html"], [
        "accept",
        "text/plain",
      ]],
    });
    assert.deepEqual(await response.json(), {
      token: "abc",
      accept: "text/html, text/plain",
    });
  });

  it("leaves the body to the Request: Fastify parses nothing", async () => {
    const linked = new FastifyLinker().link([echo("POST", "/x")]);
    const post = async (body: string, type?: string) => {
      const response = await send(linked, "/x", "POST", {
        body,
        ...(type ? { headers: { "content-type": type } } : {}),
      });
      const { type: seen, body: read } = await response.json();
      return [response.status, seen, read];
    };
    assert.deepEqual(await post('{"a":1}', "application/json"), [
      200,
      "application/json",
      '{"a":1}',
    ]);
    // not valid JSON: Fastify would answer 400 before the route runs
    assert.deepEqual(await post("{oops", "application/json"), [
      200,
      "application/json",
      "{oops",
    ]);
    assert.deepEqual(await post("hi", "application/x-unknown"), [
      200,
      "application/x-unknown",
      "hi",
    ]);
    // a POST without a body
    const empty = await send(linked, "/x", "POST");
    assert.equal((await empty.json()).body, "");
  });

  it("matches one segment per parameter, and never an empty one", async () => {
    const linked = new FastifyLinker().link([echo("GET", "/users/:id")]);
    const params = async (path: string) => {
      const response = await send(linked, path);
      return response.ok ? (await response.json()).params : response.status;
    };
    assert.deepEqual(await params("/users/a%2Fb"), { id: "a/b" });
    assert.equal(await params("/users/"), 404);
    assert.equal(await params("/users/1/2"), 404);
    // Fastify answers 400 to a path that cannot be decoded
    assert.equal(await params("/users/%E0%A4%A"), 400);
  });

  it("matches the other characters of a path literally", async () => {
    const linked = new FastifyLinker().link([
      echo("GET", "/a(b)/v1:beta/c+d/e.f"),
    ]);
    assert.equal((await send(linked, "/a(b)/v1:beta/c+d/e.f")).status, 200);
    assert.equal((await send(linked, "/ab/v1:beta/c+d/e.f")).status, 404);
    assert.equal((await send(linked, "/a(b)/v1x/c+d/e.f")).status, 404);
    assert.equal((await send(linked, "/a(b)/v1:beta/ccd/e.f")).status, 404);
    assert.equal((await send(linked, "/a(b)/v1:beta/c+d/exf")).status, 404);
  });

  it("lets a static path win over a parameter, wherever it is declared", async () => {
    const linked = new FastifyLinker().link([
      named("GET", "/users/:id", "param"),
      named("GET", "/users/me", "static"),
    ]);
    assert.equal(await (await send(linked, "/users/me")).text(), "static");
    assert.equal(await (await send(linked, "/users/42")).text(), "param");
  });

  it("runs a HEAD route for HEAD requests, wherever it is declared", async () => {
    const linked = new FastifyLinker().link([
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
    assert.equal(await other.text(), "");
    // and only the GET route
    assert.equal((await send(linked, "/posted", "HEAD")).status, 404);
  });

  it("sends the status, the headers and the body of the response", async () => {
    const linked = new FastifyLinker().link([
      {
        ...echo("GET", "/made"),
        handle: () =>
          Promise.resolve(
            new Response("made", {
              status: 201,
              headers: [["set-cookie", "a=1"], ["set-cookie", "b=2"], [
                "x-one",
                "1",
              ]],
            }),
          ),
      },
      {
        ...echo("GET", "/none"),
        handle: () => Promise.resolve(new Response(null, { status: 204 })),
      },
    ]);
    const made = await send(linked, "/made");
    assert.deepEqual(
      [made.status, made.headers.get("x-one"), await made.text()],
      [201, "1", "made"],
    );
    assert.deepEqual(made.headers.getSetCookie(), ["a=1", "b=2"]);
    const none = await send(linked, "/none");
    assert.deepEqual([none.status, none.body], [204, null]);
  });

  it("serves one application: a second link() throws", () => {
    const linker = new FastifyLinker();
    linker.link([echo("GET", "/x")]);
    assert.throws(() => linker.link([echo("GET", "/y")]), {
      message:
        "FastifyLinker.link() was already called: use one linker for one application",
    });
  });

  it("gives a route that rejects to Fastify's error handler", async () => {
    const boom: Route = {
      ...echo("GET", "/x"),
      handle: () => Promise.reject(new Error("boom")),
    };
    // Fastify's default: 500, with the error as JSON
    const plain = await send(new FastifyLinker().link([boom]), "/x");
    assert.equal(plain.status, 500);
    assert.equal((await plain.json()).message, "boom");

    const fastify = Fastify();
    fastify.setErrorHandler((error, _request, reply) =>
      reply.status(502).send(`handled: ${(error as Error).message}`)
    );
    const custom = await send(new FastifyLinker(fastify).link([boom]), "/x");
    assert.deepEqual(
      [custom.status, await custom.text()],
      [502, "handled: boom"],
    );
  });

  it("registers the routes on a given Fastify app, under its hooks", async () => {
    const fastify = Fastify();
    fastify.addHook("onRequest", (_request, reply, done) => {
      reply.header("x-hook", "1");
      done();
    });
    fastify.setNotFoundHandler((_request, reply) =>
      reply.status(404).send("nothing here")
    );
    // a route of the application itself: Fastify still parses its body
    fastify.post("/own", (request) => ({ parsed: request.body }));
    const linked = new FastifyLinker(fastify).link([echo("POST", "/x")]);

    const response = await send(linked, "/x", "POST", { body: "hi" });
    assert.equal(response.headers.get("x-hook"), "1");
    assert.equal((await response.json()).body, "hi");
    assert.equal(await (await send(linked, "/nope")).text(), "nothing here");
    const own = await send(linked, "/own", "POST", {
      body: '{"a":1}',
      headers: { "content-type": "application/json" },
    });
    assert.deepEqual(await own.json(), { parsed: { a: 1 } });
  });
});

suite("FastifyLinker, on a listening server", () => {
  it("serves requests over HTTP, and streams the body to the route", async () => {
    const linked = new FastifyLinker().link([echo("POST", "/x/:id")]);
    const address = await linked.instance.listen({
      port: 0,
      host: "127.0.0.1",
    });
    try {
      const response = await fetch(`${address}/x/7?a=1`, {
        method: "POST",
        body: "over the wire",
        headers: { "content-type": "text/plain" },
      });
      assert.deepEqual(await response.json(), {
        method: "POST",
        url: `${address}/x/7?a=1`,
        type: "text/plain",
        body: "over the wire",
        params: { id: "7" },
        native: ["object", "function"],
      });
    } finally {
      await linked.instance.close();
    }
  });

  it("aborts the signal of the Request when the client goes away", async () => {
    const started = Promise.withResolvers<AbortSignal>();
    const linked = new FastifyLinker().link([{
      ...echo("GET", "/slow"),
      handle: (req) => {
        started.resolve(req.signal);
        return new Promise<Response>((resolve) =>
          req.signal.addEventListener(
            "abort",
            () => resolve(new Response("gone")),
          )
        );
      },
    }]);
    const address = await linked.instance.listen({
      port: 0,
      host: "127.0.0.1",
    });
    try {
      const client = new AbortController();
      const pending = fetch(`${address}/slow`, { signal: client.signal });
      const signal = await started.promise;
      assert.equal(signal.aborted, false);
      const aborted = new Promise((resolve) =>
        signal.addEventListener("abort", resolve)
      );
      client.abort();
      await assert.rejects(pending);
      await aborted;
      assert.equal(signal.aborted, true);
    } finally {
      await linked.instance.close();
    }
  });
});

suite("FastifyLinker, HEAD and OPTIONS with ChoWeb", () => {
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
    const app = await ChoWeb.create(App, { linker: new FastifyLinker() });

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

suite("FastifyLinker, with ChoWeb", () => {
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
          fastify: typeof (ctx.native as FastifyNative).request.ip,
        };
      }
      async create(ctx: ChoWebContext) {
        const { name } = await ctx.req.json();
        if (!name) {
          throw new Error("no name");
        }
        return new Response(name, { status: 201 });
      }
    }
    legacy(Get(""), Users, "list");
    legacy(Get(":id"), Users, "get");
    legacy(Post(""), Users, "create");
    Controller({ route: "users" })(Users);
    Middlewares(stamp)(Users);
    Catch((error) => new Response((error as Error).message, { status: 422 }))(
      Users,
    );
    class App {}
    Module({ route: "v1", controllers: [Users] })(App);
    return App;
  }

  it("serves an application end to end, with the global prefix", async () => {
    const app = await ChoWeb.create(users_app(), {
      linker: new FastifyLinker(),
      prefix: "api",
    });
    assert.equal(typeof app.linked.instance.listen, "function");

    const list = await send(app, "/api/v1/users");
    assert.deepEqual(await list.json(), [1, 2]);
    assert.equal(list.headers.get("x-stamp"), "1");
    assert.deepEqual(await (await send(app, "/api/v1/users/42")).json(), {
      id: "user-42",
      fastify: "string",
    });
    const json = { "content-type": "application/json" };
    const created = await send(app, "/api/v1/users", "POST", {
      body: '{"name":"Ada"}',
      headers: json,
    });
    assert.deepEqual([created.status, await created.text()], [201, "Ada"]);
    const failed = await send(app, "/api/v1/users", "POST", {
      body: "{}",
      headers: json,
    });
    assert.deepEqual([failed.status, await failed.text()], [422, "no name"]);
    assert.equal((await send(app, "/v1/users")).status, 404);
  });

  it("serves the application over HTTP with listen()", async () => {
    const app = await ChoWeb.create(users_app(), {
      linker: new FastifyLinker(),
    });
    const fastify = app.linked.instance;
    const address = await fastify.listen({ port: 0, host: "127.0.0.1" });
    try {
      const response = await fetch(`${address}/v1/users`, {
        method: "POST",
        body: '{"name":"Grace"}',
        headers: { "content-type": "application/json" },
      });
      assert.deepEqual(
        [response.status, await response.text()],
        [201, "Grace"],
      );
    } finally {
      await fastify.close();
      await app.close();
    }
  });
});

suite("FastifyLinker, handler arguments", () => {
  /** An application with `POST users/:id`, which answers with its arguments. */
  function users_app() {
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
    return ChoWeb.create(App, { linker: new FastifyLinker() });
  }
  const expected = { id: "a b", notify: "1", body: { name: "Ada" } };

  it("gives a handler its path parameters, its query and its body", async () => {
    const app = await users_app();
    const response = await send(app, "/users/a%20b?notify=1", "POST", {
      body: '{"name":"Ada"}',
      headers: { "content-type": "application/json" },
    });
    assert.deepEqual(await response.json(), expected);
  });

  it("reads the body from the stream of a real connection", async () => {
    const app = await users_app();
    const fastify = app.linked.instance;
    const address = await fastify.listen({ port: 0, host: "127.0.0.1" });
    try {
      const response = await fetch(`${address}/users/a%20b?notify=1`, {
        method: "POST",
        body: '{"name":"Ada"}',
        headers: { "content-type": "application/json" },
      });
      assert.deepEqual(await response.json(), expected);
    } finally {
      await fastify.close();
      await app.close();
    }
  });
});

suite("fromFastify", () => {
  type Class = new () => object;

  /** A controller with `GET x`, which answers with what `handler` returns. */
  function controller(
    handler: (ctx: ChoWebContext) => unknown,
    ...middlewares: ChoWebMiddlewareFn[]
  ) {
    class Ctrl {
      run(ctx: ChoWebContext) {
        return handler(ctx);
      }
    }
    legacy(Get(""), Ctrl, "run");
    Controller({ route: "x" })(Ctrl);
    if (middlewares.length > 0) {
      Middlewares(...middlewares)(Ctrl);
    }
    return Ctrl;
  }

  /** The application of one controller, on Fastify. */
  function create(ctrl: Class, fastify = Fastify()) {
    class App {}
    Module({ controllers: [ctrl] })(App);
    return ChoWeb.create(App, { linker: new FastifyLinker(fastify) });
  }

  /** Send `GET /x`, and give the status and the body. */
  async function get(app: ChoWeb<unknown>, init: RequestInit = {}) {
    const response = await send(app, "/x", "GET", init);
    return [response.status, await response.text()];
  }

  it("runs an asynchronous hook, then the rest of the chain", async () => {
    type WithUser = { user?: string };
    const hook: FastifyHook = async (request) => {
      await Promise.resolve();
      (request as WithUser).user = "ada";
    };
    const app = await create(
      controller(
        // the hook and the handler share Fastify's request
        (ctx) => ((ctx.native as FastifyNative).request as WithUser).user,
        fromFastify(hook),
      ),
    );
    assert.deepEqual(await get(app), [200, "ada"]);
  });

  it("runs a hook in the callback style", async () => {
    const seen: string[] = [];
    const hook: FastifyHook = (request, _reply, done) => {
      seen.push(request.url);
      done();
    };
    const app = await create(controller(() => "ok", fromFastify(hook)));
    assert.deepEqual(await get(app), [200, "ok"]);
    assert.deepEqual(seen, ["/x"]);
  });

  it("calls the hook on the Fastify application of the route", async () => {
    const fastify = Fastify();
    fastify.decorate("secret", "s3cret");
    const hook: FastifyHook = function (_request, reply) {
      reply.header("x-secret", (this as unknown as { secret: string }).secret);
      return Promise.resolve();
    };
    const app = await create(
      controller(() => "ok", fromFastify(hook)),
      fastify,
    );
    const response = await send(app, "/x");
    assert.equal(response.headers.get("x-secret"), "s3cret");
    assert.equal(await response.text(), "ok");
  });

  for (
    const [style, hook] of [
      [
        "an asynchronous hook that returns the reply",
        (_request, reply) =>
          Promise.resolve(reply.code(401).send({ error: "unauthorized" })),
      ],
      ["an asynchronous hook that sends the reply", async (_request, reply) => {
        await Promise.resolve();
        reply.code(401).send({ error: "unauthorized" });
      }],
      [
        "a callback hook that sends and does not call done",
        (_request, reply) => {
          reply.code(401).send({ error: "unauthorized" });
        },
      ],
    ] as [string, FastifyHook][]
  ) {
    it(`stops the chain when the hook answers: ${style}`, async () => {
      let called = false;
      const app = await create(
        controller(() => {
          called = true;
        }, fromFastify(hook)),
      );
      assert.deepEqual(await get(app), [401, '{"error":"unauthorized"}']);
      assert.equal(called, false);
    });
  }

  it("lets a hook redirect", async () => {
    const hook: FastifyHook = (_request, reply) => {
      reply.redirect("/login");
    };
    const app = await create(controller(() => "never", fromFastify(hook)));
    const response = await send(app, "/x");
    assert.deepEqual(
      [response.status, response.headers.get("location")],
      [302, "/login"],
    );
  });

  it("answers once when the application has an asynchronous onSend hook", async () => {
    const fastify = Fastify();
    fastify.addHook("onSend", async (_request, reply, payload) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      reply.header("x-on-send", "1");
      return payload;
    });
    const hook: FastifyHook = (_request, reply) =>
      Promise.resolve(reply.code(403).send("forbidden"));
    const app = await create(
      controller(() => "never", fromFastify(hook)),
      fastify,
    );
    const response = await send(app, "/x");
    assert.deepEqual(
      [response.status, response.headers.get("x-on-send")],
      [403, "1"],
    );
    assert.equal(await response.text(), "forbidden");
  });

  it("gives the CHO middlewares around it the status and headers of the answer", async () => {
    const seen: unknown[] = [];
    const outer: ChoWebMiddlewareFn = async (_ctx, next) => {
      const response = await next();
      seen.push([response.status, response.headers.get("x-reason")]);
      return response;
    };
    const hook: FastifyHook = (_request, reply) =>
      Promise.resolve(reply.code(429).header("x-reason", "limit").send("slow"));
    const app = await create(
      controller(() => "never", outer, fromFastify(hook)),
    );
    assert.deepEqual(await get(app), [429, "slow"]);
    assert.deepEqual(seen, [[429, "limit"]]);
  });

  it("keeps its place among the CHO middlewares", async () => {
    const seen: string[] = [];
    const cho = (name: string): ChoWebMiddlewareFn => (_ctx, next) => {
      seen.push(name);
      return next();
    };
    const hook = (name: string): FastifyHook => (_request, _reply, done) => {
      seen.push(name);
      done();
    };
    const app = await create(
      controller(
        () => "ok",
        cho("a"),
        fromFastify(hook("b")),
        cho("c"),
        fromFastify(hook("d")),
      ),
    );
    assert.deepEqual(await get(app), [200, "ok"]);
    assert.deepEqual(seen, ["a", "b", "c", "d"]);
  });

  for (
    const [style, hook] of [
      ["throws", () => {
        throw new Error("broken hook");
      }],
      ["rejects", () => Promise.reject(new Error("broken hook"))],
      ["calls done with an error", (_request, _reply, done) => {
        done(new Error("broken hook"));
      }],
    ] as [string, FastifyHook][]
  ) {
    it(`gives the error to the CHO error handlers when the hook ${style}`, async () => {
      const ctrl = controller(() => "never", fromFastify(hook));
      Catch((error) =>
        new Response(`caught: ${(error as Error).message}`, { status: 502 })
      )(ctrl);
      assert.deepEqual(await get(await create(ctrl)), [
        502,
        "caught: broken hook",
      ]);
    });
  }

  it("leaves an unhandled error of the hook to Fastify's error handler", async () => {
    const app = await create(
      controller(
        () => "never",
        fromFastify(() => Promise.reject(new Error("broken hook"))),
      ),
    );
    const [status, body] = await get(app);
    assert.equal(status, 500);
    assert.equal(JSON.parse(body as string).message, "broken hook");
  });

  it("works over HTTP, on a listening server", async () => {
    const guard: FastifyHook = (request, reply, done) => {
      if (request.headers["x-key"] === "k") {
        done();
      } else {
        reply.code(401).send("no key");
      }
    };
    const app = await create(controller(() => "ok", fromFastify(guard)));
    const fastify = app.linked.instance;
    const address = await fastify.listen({ port: 0, host: "127.0.0.1" });
    try {
      const refused = await fetch(`${address}/x`);
      assert.deepEqual([refused.status, await refused.text()], [401, "no key"]);
      const allowed = await fetch(`${address}/x`, {
        headers: { "x-key": "k" },
      });
      assert.deepEqual([allowed.status, await allowed.text()], [200, "ok"]);
    } finally {
      await fastify.close();
      await app.close();
    }
  });

  it("refuses to run on another adapter", async () => {
    const ctrl = controller(
      () => "never",
      fromFastify((_request, _reply, done) => done()),
    );
    Catch((error) => new Response((error as Error).message, { status: 500 }))(
      ctrl,
    );
    class App {}
    Module({ controllers: [ctrl] })(App);
    // a linker with no Fastify request: `ctx.native` is undefined
    const app = await ChoWeb.create(App, {
      linker: {
        link: (routes) => ({
          instance: routes,
          handler: (req) => routes[0]!.handle(req),
        }),
      },
    });
    assert.equal(
      await (await send(app, "/x")).text(),
      "fromFastify(): a Fastify hook runs on the Fastify adapter only: create the application with a FastifyLinker",
    );
  });
});
