/**
 * Tests for the middlewares of an application on the Fastify adapter: the
 * `middlewares` option of `ChoWeb.create`, which the adapter runs around each
 * route, and around its answer to a request no route matches.
 *
 * Requests go through `app.handler`, which is Fastify's `inject()`.
 * Decorators are applied as plain function calls. The suites run on Node.js
 * only, as the adapter does.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import Fastify, { type FastifyInstance } from "fastify";
import {
  Args,
  Body,
  ChoWeb,
  type ChoWebContext,
  type ChoWebMiddlewareFn,
  type ChoWebOptions,
  Controller,
  Get,
  HttpError,
  Middlewares,
  Module,
  Param,
  Post,
  validate,
} from "@chojs/web";
import { engine } from "@chojs/core/utils";
import { legacy, loose } from "@chojs/core/utils/test_utils";
import * as vendor from "../cho/mod.ts";
import {
  type FastifyHook,
  FastifyLinker,
  type FastifyNative,
  fromFastify,
} from "./mod.ts";

/** `describe`, skipped on a runtime the adapter does not support. */
const suite = engine() === "node" ? describe : describe.skip;

/** Converts to a number; anything that is not one is not valid. */
const number = {
  parse(value: unknown) {
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

/**
 * An application on Fastify, with `GET /things/:id`, which answers with the id
 * and what the middlewares left, `POST /things`, which fails, and
 * `GET /things/old/:id`, which answers with an `HttpError`.
 */
function create(
  options: ChoWebOptions<FastifyInstance> = {},
  fastify = Fastify(),
) {
  class Things {
    get(id: unknown, ctx: ChoWebContext) {
      return {
        id,
        type: typeof id,
        user: ctx.state.get("user") ?? null,
        added: ctx.req.headers.get("x-added"),
      };
    }
    add() {
      throw new Error("the store is down");
    }
    gone() {
      throw new HttpError(410, "gone");
    }
  }
  legacy(Get(":id"), Things, "get");
  legacy(loose(Args(Param("id", number))), Things, "get");
  legacy(Post(""), Things, "add");
  legacy(Get("old/:id"), Things, "gone");
  Controller({ route: "things" })(Things);
  class App {}
  Module({ controllers: [Things] })(App);
  return ChoWeb.create(App, { ...options, linker: new FastifyLinker(fastify) });
}

const send = (
  app: { handler: (req: Request) => Promise<Response> },
  path: string,
  init?: RequestInit,
) => app.handler(new Request(`http://localhost${path}`, init));

suite("FastifyLinker, the middlewares of the application", () => {
  it("run for every request, in order, a request no route matches included", async () => {
    const seen: string[] = [];
    const app = await create({
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

  it("have Fastify's request and reply, and the parameters of the route", async () => {
    const seen: unknown[] = [];
    const app = await create({
      middlewares: [(ctx, next) => {
        seen.push(
          { ...ctx.params },
          typeof (ctx.native as FastifyNative).request.ip,
        );
        return next();
      }],
    });
    await send(app, "/things/7");
    // No route, no parameters.
    await send(app, "/nope");
    assert.deepEqual(seen, [{ id: "7" }, "string", {}, "string"]);
    await app.close();
  });

  it("answer a request no route matches as Fastify does, also a HEAD request", async () => {
    const seen: string[] = [];
    const app = await create({ middlewares: [record(seen, "a")] });
    const response = await send(app, "/nope?x=1");
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      message: "Route GET:/nope?x=1 not found",
      error: "Not Found",
      statusCode: 404,
    });
    const head = await send(app, "/nope", { method: "HEAD" });
    assert.deepEqual([head.status, await head.text()], [404, ""]);
    // An empty parameter is not a match, on every adapter.
    assert.equal((await send(app, "/things/")).status, 404);
    assert.deepEqual(seen, [
      "a in /nope",
      "a out 404",
      "a in /nope",
      "a out 404",
      "a in /things/",
      "a out 404",
    ]);
    await app.close();
  });

  it("refuse a Fastify application with a not-found handler of its own", async () => {
    const fastify = Fastify();
    fastify.setNotFoundHandler((_request, reply) =>
      reply.code(404).send("mine")
    );
    const app = await create(
      { middlewares: [(_ctx, next) => next()] },
      fastify,
    );
    await assert.rejects(send(app, "/things/7"), {
      code: "CHO_FASTIFY_NOT_FOUND_SET",
    });
    await fastify.close().catch(() => {});

    // Without middlewares, the handler of the application stays.
    const kept = Fastify();
    kept.setNotFoundHandler((_request, reply) => reply.code(404).send("mine"));
    const plain = await create({}, kept);
    assert.equal(await (await send(plain, "/nope")).text(), "mine");
    await plain.close();
    await kept.close();
  });

  it("see the answer of an HttpError; a route that fails goes through them, to Fastify's error handler", async () => {
    const seen: string[] = [];
    const failed: unknown[] = [];
    const watch: ChoWebMiddlewareFn = async (_ctx, next) => {
      try {
        return await next();
      } catch (error) {
        failed.push((error as Error).message);
        throw error;
      }
    };
    const app = await create({ middlewares: [record(seen, "a"), watch] });
    assert.equal((await send(app, "/things/old/1")).status, 410);
    assert.equal((await send(app, "/things", { method: "POST" })).status, 500);
    assert.deepEqual(seen, [
      "a in /things/old/1",
      "a out 410",
      "a in /things",
    ]);
    assert.deepEqual(failed, ["the store is down"]);
    await app.close();
  });

  it("can answer by themselves, and replace the response", async () => {
    const guard: ChoWebMiddlewareFn = (ctx, next) =>
      ctx.req.headers.has("authorization")
        ? next()
        : new Response("who are you?", { status: 401 });
    const stamp: ChoWebMiddlewareFn = async (_ctx, next) => {
      const response = await next();
      const headers = new Headers(response.headers);
      headers.set("x-app", "1");
      return new Response(response.body, { status: response.status, headers });
    };
    const app = await create({ middlewares: [stamp, guard] });
    const refused = await send(app, "/things/7");
    assert.deepEqual(
      [refused.status, refused.headers.get("x-app"), await refused.text()],
      [401, "1", "who are you?"],
    );
    assert.equal((await send(app, "/nope")).status, 401);
    const allowed = await send(app, "/things/7", {
      headers: { authorization: "Bearer x" },
    });
    assert.deepEqual(
      [allowed.status, allowed.headers.get("x-app"), (await allowed.json()).id],
      [200, "1", "7"],
    );
    await app.close();
  });

  it("answer with the status of an HttpError they throw", async () => {
    const app = await create({
      middlewares: [() => {
        throw new HttpError(401, "who are you?", {
          headers: { "www-authenticate": "Bearer" },
        });
      }],
    });
    const response = await send(app, "/things/7");
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate"), "Bearer");
    assert.deepEqual(await response.json(), { error: "who are you?" });
    await app.close();
  });

  it("go to Fastify's error handler when one of them fails", async () => {
    const app = await create({
      middlewares: [() => {
        throw new Error("broken middleware");
      }],
    });
    assert.equal((await send(app, "/things/7")).status, 500);
    assert.equal((await send(app, "/nope")).status, 500);
    await app.close();
  });

  it("share their state with the route, and the request they replaced", async () => {
    const after: unknown[] = [];
    const app = await create({
      middlewares: [async (ctx, next) => {
        ctx.state.set("user", "ada");
        (ctx as { req: Request }).req = new Request(ctx.req, {
          headers: { "x-added": "1" },
        });
        const response = await next();
        after.push(ctx.state.get("user"));
        return response;
      }],
    });
    const body = await (await send(app, "/things/7")).json();
    assert.deepEqual([body.user, body.added], ["ada", "1"]);
    assert.deepEqual(after, ["ada"]);
    await app.close();
  });

  it("run around a mounted route", async () => {
    const seen: string[] = [];
    const app = await create({ middlewares: [record(seen, "a")] });
    app.mount("GET", "health", () => "ok");
    assert.equal(await (await send(app, "/health")).text(), "ok");
    assert.deepEqual(seen, ["a in /health", "a out 200"]);
    await app.close();
  });

  it("answer the preflight request of a path with no OPTIONS route", async () => {
    const preflight: ChoWebMiddlewareFn = (ctx, next) =>
      ctx.req.method === "OPTIONS"
        ? new Response(null, {
          status: 204,
          headers: { "access-control-allow-origin": "*" },
        })
        : next();
    const app = await create({ middlewares: [preflight] });
    const response = await send(app, "/things/7", { method: "OPTIONS" });
    assert.deepEqual(
      [response.status, response.headers.get("access-control-allow-origin")],
      [204, "*"],
    );
    await app.close();
  });

  it("take a Fastify hook, with fromFastify", async () => {
    const guard: FastifyHook = (request, reply, done) => {
      if (request.headers.authorization) {
        done();
      } else {
        reply.code(401).send("who are you?");
      }
    };
    const app = await create({ middlewares: [fromFastify(guard)] });
    const refused = await send(app, "/things/7");
    assert.deepEqual([refused.status, await refused.text()], [
      401,
      "who are you?",
    ]);
    assert.equal((await send(app, "/nope")).status, 401);
    const allowed = await send(app, "/things/7", {
      headers: { authorization: "Bearer x" },
    });
    assert.equal(allowed.status, 200);
    await app.close();
  });

  it("answer for an application with no route", async () => {
    class App {}
    Module({})(App);
    const app = await ChoWeb.create(App, {
      linker: new FastifyLinker(),
      middlewares: [() => new Response("closed", { status: 503 })],
    });
    assert.equal(await (await send(app, "/anything")).text(), "closed");
    await app.close();
  });

  it("do nothing to an application without them", async () => {
    const app = await create();
    assert.equal((await (await send(app, "/things/7")).json()).id, "7");
    assert.equal((await send(app, "/nope")).status, 404);
    await app.close();
  });
});

suite("FastifyLinker, validate() for a whole application", () => {
  it("covers every handler: values are converted, and a request that is not valid is answered 400", async () => {
    const app = await create({ middlewares: [validate()] });
    const valid = await (await send(app, "/things/7")).json();
    assert.deepEqual([valid.id, valid.type], [7, "number"]);
    const invalid = await send(app, "/things/abc");
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), {
      error: "Invalid request",
      source: "param",
      key: "id",
      issues: [{ message: "expected a number, got abc" }],
    });
    assert.ok(
      app.graph.features[0]!.controllers[0]!.methods.every((m) => m.validated),
    );
    await app.close();
  });

  it("does not validate without it", async () => {
    const app = await create();
    const body = await (await send(app, "/things/abc")).json();
    assert.deepEqual([body.id, body.type], ["abc", "string"]);
    await app.close();
  });
});

suite(
  "FastifyLinker, the middlewares of @chojs/vendor-cho for the application",
  () => {
    const lines: string[] = [];

    /** `GET users` and `POST users`, behind a token for the second. */
    function users() {
      class Users {
        list(ctx: ChoWebContext) {
          return { id: ctx.state.get(vendor.REQUEST_ID), users: ["ada"] };
        }
        create(user: unknown) {
          return Response.json(user, { status: 201 });
        }
      }
      legacy(Get(""), Users, "list");
      legacy(Post(""), Users, "create");
      legacy(loose(Args(Body())), Users, "create");
      legacy(
        Middlewares(vendor.bearerAuth({ token: "t0ken" })),
        Users,
        "create",
      );
      Controller({ route: "users" })(Users);
      class App {}
      Module({ controllers: [Users] })(App);
      return ChoWeb.create(App, {
        linker: new FastifyLinker(),
        middlewares: [
          vendor.logger({ log: (line) => lines.push(line) }),
          vendor.requestId(),
          vendor.cors({ origin: "https://example.com" }),
          vendor.secureHeaders(),
          vendor.bodyLimit({ maxSize: 20 }),
          vendor.timeout({ ms: 1000 }),
        ],
      });
    }

    it("answers a request through all of them", async () => {
      const app = await users();
      const response = await send(app, "/users", {
        headers: { origin: "https://example.com", "x-request-id": "abc-1" },
      });
      // the request id reached the handler, through the state
      assert.deepEqual(await response.json(), { id: "abc-1", users: ["ada"] });
      assert.deepEqual(
        [
          "x-request-id",
          "access-control-allow-origin",
          "x-content-type-options",
        ].map((name) => response.headers.get(name)),
        ["abc-1", "https://example.com", "nosniff"],
      );
      assert.match(lines.at(-1)!, /^GET \/users 200 \d+ms$/);
      await app.close();
    });

    it("refuses what each of them refuses, and answers a preflight request of any path", async () => {
      const app = await users();
      const post = (init: RequestInit) =>
        send(app, "/users", { method: "POST", ...init });

      assert.equal((await post({ body: "{}" })).status, 401);
      const too_large = await post({
        body: JSON.stringify({ name: "a name that is too long" }),
        headers: { authorization: "Bearer t0ken" },
      });
      assert.equal(too_large.status, 413);
      const created = await post({
        body: '{"name":"Ada"}',
        headers: { authorization: "Bearer t0ken" },
      });
      assert.deepEqual([created.status, await created.json()], [201, {
        name: "Ada",
      }]);
      // a preflight request of a path with no OPTIONS route
      const preflight = await send(app, "/users", {
        method: "OPTIONS",
        headers: {
          origin: "https://example.com",
          "access-control-request-method": "POST",
        },
      });
      assert.equal(preflight.status, 204);
      assert.deepEqual(lines.slice(-4).map((line) => line.split(" ")[2]), [
        "401",
        "413",
        "201",
        "204",
      ]);
      await app.close();
    });
  },
);
