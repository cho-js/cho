/**
 * Tests for the Hono adapter: CHO web applications linked to Hono, checked end
 * to end with real `Request`s.
 *
 * Decorators are applied as plain function calls, so the tests run on every
 * runtime.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Hono } from "hono";
import {
  Catch,
  type ChoMiddlewareFn,
  ChoWeb,
  Controller,
  Get,
  Middlewares,
  Module,
  Post,
} from "@chojs/web";
import { AppRef, ControllerRef, FeatureRef, MethodRef } from "@chojs/web/graph";
import { capture, legacy } from "@chojs/core/utils/test_utils";
import { HonoLinked, HonoLinker } from "./mod.ts";

/** Whether a value looks like Hono's request context. */
function is_context(value: unknown): boolean {
  return typeof (value as { req?: { url?: unknown } })?.req?.url === "string";
}

/** Send a request to an application, by method and path. */
function send(app: ChoWeb<unknown>, path: string, method = "GET") {
  return app.handler(new Request(`http://localhost${path}`, { method }));
}

/** The `Users` controller of most tests: `GET users`, `GET users/:id`, `POST users`. */
function users_controller() {
  class Users {
    prefix = "user-";
    list() {
      return [1, 2];
    }
    // deno-lint-ignore no-explicit-any
    get(ctx: any) {
      return { id: this.prefix + ctx.req.param("id") };
    }
    async create() {
      await Promise.resolve();
      return new Response("created", { status: 201 });
    }
  }
  legacy(Get(""), Users, "list");
  legacy(Get(":id"), Users, "get");
  legacy(Post(""), Users, "create");
  Controller({ route: "users" })(Users);
  return Users;
}

describe("HonoLinker", () => {
  it("routes each handler at its feature, controller and handler route", async () => {
    class App {}
    Module({ route: "v1", controllers: [users_controller()] })(App);
    const app = await ChoWeb.create(App, { linker: new HonoLinker() });

    assert.deepEqual(await (await send(app, "/v1/users")).json(), [1, 2]);
    assert.deepEqual(await (await send(app, "/v1/users/42")).json(), {
      id: "user-42",
    });
    assert.equal((await send(app, "/users")).status, 404);
  });

  it("sends a result as JSON, and a Response as is, awaiting async handlers", async () => {
    class App {}
    Module({ controllers: [users_controller()] })(App);
    const app = await ChoWeb.create(App, { linker: new HonoLinker() });

    const json = await send(app, "/users");
    assert.equal(json.status, 200);
    assert.match(json.headers.get("content-type") ?? "", /application\/json/);

    const created = await send(app, "/users", "POST");
    assert.equal(created.status, 201);
    assert.equal(await created.text(), "created");
  });

  it("runs the feature's, the controller's, then the handler's middlewares", async () => {
    const order: string[] = [];
    const mw = (name: string): ChoMiddlewareFn => async (_ctx, next) => {
      order.push(name);
      await next();
    };
    class Users {
      list() {
        order.push("handler");
        return [];
      }
    }
    legacy(Get(""), Users, "list");
    legacy(Middlewares(mw("method")), Users, "list");
    Controller()(Users);
    Middlewares(mw("controller"))(Users);
    class App {}
    Module({ controllers: [Users] })(App);
    Middlewares(mw("feature"))(App);
    const app = await ChoWeb.create(App, { linker: new HonoLinker() });

    await send(app, "/");
    assert.deepEqual(order, ["feature", "controller", "method", "handler"]);
  });

  it("lets a middleware answer without calling next", async () => {
    let called = false;
    // deno-lint-ignore no-explicit-any
    const deny: ChoMiddlewareFn = (ctx: any) =>
      Promise.resolve(ctx.text("denied", 401));
    class Users {
      list() {
        called = true;
      }
    }
    legacy(Get(""), Users, "list");
    Controller()(Users);
    Middlewares(deny)(Users);
    class App {}
    Module({ controllers: [Users] })(App);
    const app = await ChoWeb.create(App, { linker: new HonoLinker() });

    const response = await send(app, "/");
    assert.equal(response.status, 401);
    assert.equal(called, false);
  });

  it("uses the handler's error handler, called with (error, ctx)", async () => {
    const seen: unknown[] = [];
    class Users {
      list() {
        throw new Error("boom");
      }
    }
    legacy(Get(""), Users, "list");
    legacy(
      Catch((error, ctx) => {
        seen.push(error, ctx);
        return new Response("method", { status: 418 });
      }),
      Users,
      "list",
    );
    Controller()(Users);
    class App {}
    Module({ controllers: [Users] })(App);
    const app = await ChoWeb.create(App, { linker: new HonoLinker() });

    const response = await send(app, "/");
    assert.equal(response.status, 418);
    assert.equal((seen[0] as Error).message, "boom");
    assert.equal(is_context(seen[1]), true);
  });

  it("falls back to the controller's error handler, then the feature's", async () => {
    // The controller's and feature's handlers go to Hono's onError, which
    // calls them with (error, ctx), as the handler-level ones are.
    let controller_ctx: unknown;
    const failing = (route: string) => {
      class Failing {
        run() {
          throw new Error(route);
        }
      }
      legacy(Get(""), Failing, "run");
      Controller({ route })(Failing);
      return Failing;
    };
    const Caught = failing("caught");
    Catch((error, ctx) => {
      controller_ctx = ctx;
      return new Response(`controller: ${(error as Error).message}`, {
        status: 503,
      });
    })(Caught);
    const Uncaught = failing("uncaught");
    class App {}
    Module({ controllers: [Caught, Uncaught] })(App);
    Catch((error) =>
      new Response(`feature: ${(error as Error).message}`, { status: 502 })
    )(App);
    const app = await ChoWeb.create(App, { linker: new HonoLinker() });

    const caught = await send(app, "/caught");
    assert.equal(caught.status, 503);
    assert.equal(await caught.text(), "controller: caught");
    assert.equal(is_context(controller_ctx), true);
    const uncaught = await send(app, "/uncaught");
    assert.equal(uncaught.status, 502);
    assert.equal(await uncaught.text(), "feature: uncaught");
  });

  it("answers 500 without an error handler, and logs the error", async () => {
    class Users {
      list() {
        throw new Error("boom");
      }
    }
    legacy(Get(""), Users, "list");
    Controller()(Users);
    class App {}
    Module({ controllers: [Users] })(App);
    const app = await ChoWeb.create(App, { linker: new HonoLinker() });

    // Hono's default error handler logs the error to console.error: capture
    // it, so the test output stays clean.
    const { result, output } = await capture(() => send(app, "/"));
    assert.equal(result.status, 500);
    assert.equal((output.error[0] as Error).message, "boom");
  });

  it("does not apply the global prefix yet", async () => {
    // A known bug (web/issues.md #1). Update this test when it is fixed:
    // "/api/users" should answer, and "/users" should be 404.
    class App {}
    Module({ controllers: [users_controller()] })(App);
    const app = await ChoWeb.create(App, {
      linker: new HonoLinker(),
      prefix: "api",
    });

    assert.equal((await send(app, "/api/users")).status, 404);
    assert.equal((await send(app, "/users")).status, 200);
  });

  describe("link", () => {
    /** A graph with one handler at `/x`, for the given HTTP method. */
    function graph_of(method: string): AppRef {
      const graph = new AppRef("");
      const feature = new FeatureRef("", [], null);
      const controller = new ControllerRef("", [], null, {});
      controller.methods.push(
        new MethodRef(
          "x",
          "x",
          method,
          "HTTP",
          [],
          null,
          () => Promise.resolve({ method }),
        ),
      );
      feature.controllers.push(controller);
      graph.features.push(feature);
      return graph;
    }

    it("returns a HonoLinked holding a Hono app and its fetch", async () => {
      const linked = new HonoLinker().link(graph_of("GET"));
      assert.ok(linked instanceof HonoLinked);
      assert.ok(linked.instance instanceof Hono);
      const response = await linked.handler(new Request("http://localhost/x"));
      assert.deepEqual(await response.json(), { method: "GET" });
    });

    it("supports PATCH", async () => {
      const linked = new HonoLinker().link(graph_of("PATCH"));
      const response = await linked.handler(
        new Request("http://localhost/x", { method: "PATCH" }),
      );
      assert.deepEqual(await response.json(), { method: "PATCH" });
    });

    it("throws on an HTTP method it does not support", () => {
      assert.throws(() => new HonoLinker().link(graph_of("OPTIONS")), {
        message: "Unsupported HTTP method: OPTIONS",
      });
    });
  });
});
