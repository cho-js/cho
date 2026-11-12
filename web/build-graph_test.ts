/**
 * Tests for `build-graph.ts`: building the HTTP graph of an application from
 * its injector.
 *
 * Decorators are applied as plain function calls, so the tests run on every
 * runtime.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  add_to_metadata_object,
  Controller,
  Injectable,
  Injector,
  Module,
} from "@chojs/core/di";
import { legacy, loose } from "@chojs/core/utils/test_utils";
import { Catch, Get, Middlewares, Post } from "./decorators.ts";
import { build_http_graph } from "./build-graph.ts";
import { create_context } from "./context.ts";
import type { ChoWebMiddlewareFn } from "./types.ts";

const mw_a: ChoWebMiddlewareFn = (_ctx, next) => next();
const mw_b: ChoWebMiddlewareFn = (_ctx, next) => next();
const mw_c: ChoWebMiddlewareFn = (_ctx, next) => next();

/** A context for calling graph functions directly. */
const ctx = () => create_context(new Request("http://localhost/"));

describe("build_http_graph", () => {
  it("builds the four route levels, with handlers bound to the controller", async () => {
    class Users {
      greeting = "hello";
      list() {
        return this.greeting;
      }
      create() {}
    }
    legacy(Get(""), Users, "list");
    legacy(Post(" new "), Users, "create");
    Controller({ route: "users" })(Users);
    class App {}
    Module({ route: "v1", controllers: [Users] })(App);

    const graph = await build_http_graph(new Injector(App), "api");
    assert.equal(graph.route, "api");
    const [feature] = graph.features;
    assert.equal(feature!.route, "v1");
    const [controller] = feature!.controllers;
    assert.equal(controller!.route, "users");
    assert.deepEqual(
      controller!.methods.map((m) => [m.name, m.method, m.route]),
      [["list", "GET", ""], ["create", "POST", "new"]],
    );
    assert.equal(await controller!.methods[0]!.handler(ctx()), "hello");
  });

  it("only makes features of modules with controllers", async () => {
    class Users {
      list() {}
    }
    legacy(Get(""), Users, "list");
    Controller()(Users);
    class Feature {}
    Module({ controllers: [Users] })(Feature);
    class Shared {}
    Module({ route: "ignored" })(Shared);
    class App {}
    Module({ imports: [Shared, Feature] })(App);

    const graph = await build_http_graph(new Injector(App), "");
    assert.equal(graph.features.length, 1);
    assert.equal(graph.features[0]!.route, "");
  });

  it("skips methods without an HTTP decorator", async () => {
    class Users {
      list() {}
      helper() {}
    }
    legacy(Get(""), Users, "list");
    legacy(Middlewares(mw_a), Users, "helper");
    Controller()(Users);
    class App {}
    Module({ controllers: [Users] })(App);

    const graph = await build_http_graph(new Injector(App), "");
    const names = graph.features[0]!.controllers[0]!.methods.map((m) => m.name);
    assert.deepEqual(names, ["list"]);
  });

  it("collects middlewares and error handlers at every level", async () => {
    const on_feature = () => "feature";
    const on_controller = () => "controller";
    const on_method = () => "method";
    class Users {
      list() {}
    }
    legacy(Get(""), Users, "list");
    legacy(Middlewares(mw_c), Users, "list");
    legacy(Catch(on_method), Users, "list");
    Controller()(Users);
    Middlewares(mw_b)(Users);
    Catch(on_controller)(Users);
    class App {}
    Module({ controllers: [Users] })(App);
    Middlewares(mw_a)(App);
    Catch(on_feature)(App);

    const graph = await build_http_graph(new Injector(App), "");
    const feature = graph.features[0]!;
    const controller = feature.controllers[0]!;
    const method = controller.methods[0]!;
    assert.deepEqual(feature.middlewares, [mw_a]);
    assert.deepEqual(controller.middlewares, [mw_b]);
    assert.deepEqual(method.middlewares, [mw_c]);
    assert.equal(feature.errorHandler, on_feature);
    assert.equal(controller.errorHandler, on_controller);
    assert.equal(method.errorHandler, on_method);
  });

  it("creates middleware and error handler classes with the injector", async () => {
    const seen: string[] = [];
    class Auth {
      handle(_ctx: unknown, next: () => Promise<Response>) {
        seen.push("auth");
        return next();
      }
    }
    Injectable()(Auth);
    class OnError {
      handle() {
        return "handled";
      }
    }
    Injectable()(OnError);
    class Users {
      list() {}
    }
    legacy(Get(""), Users, "list");
    Controller()(Users);
    Middlewares(Auth)(Users);
    Catch(OnError)(Users);
    class App {}
    Module({ providers: [Auth, OnError], controllers: [Users] })(App);

    const graph = await build_http_graph(new Injector(App), "");
    const controller = graph.features[0]!.controllers[0]!;
    await controller.middlewares[0]!(
      ctx(),
      () => Promise.resolve(new Response()),
    );
    assert.deepEqual(seen, ["auth"]);
    assert.equal(controller.errorHandler!(new Error("x"), ctx()), "handled");
    // named after their class, for error messages
    assert.equal(controller.middlewares[0]!.name, "Auth.handle");
    assert.equal(controller.errorHandler!.name, "OnError.handle");
  });

  it("ignores user options named like the middlewares or error handler", async () => {
    class Users {
      list() {}
    }
    legacy(Get(""), Users, "list");
    Controller({ middlewares: [mw_a], errorHandler: () => 1 })(Users);
    class App {}
    Module({ controllers: [Users] })(App);

    const graph = await build_http_graph(new Injector(App), "");
    const controller = graph.features[0]!.controllers[0]!;
    assert.deepEqual(controller.middlewares, []);
    assert.equal(controller.errorHandler, null);
  });

  it("leaves out controllers without a route handler, and features left empty", async () => {
    const created: string[] = [];
    class Auth {
      constructor() {
        created.push("Auth");
      }
      handle() {}
    }
    Injectable()(Auth);
    class Helper {
      constructor() {
        created.push("Helper");
      }
      run() {}
    }
    legacy(Middlewares(mw_a), Helper, "run"); // metadata, but no route
    Controller()(Helper);
    class NoRoutes {}
    Module({ providers: [Auth], controllers: [Helper] })(NoRoutes);
    Middlewares(Auth)(NoRoutes);
    class Users {
      list() {}
    }
    legacy(Get(""), Users, "list");
    Controller()(Users);
    class App {}
    Module({ imports: [NoRoutes], controllers: [Users, Helper] })(App);

    const graph = await build_http_graph(new Injector(App), "");
    assert.equal(graph.features.length, 1);
    assert.equal(graph.features[0]!.controllers.length, 1);
    assert.deepEqual(created, []);
  });

  it("checks every route of a controller before creating it", async () => {
    let created = 0;
    class Users {
      constructor() {
        created++;
      }
      list() {}
    }
    // an invalid route that did not go through @Get, which rejects it
    add_to_metadata_object(Users.prototype.list, {
      [Symbol.for("chojs.web.http")]: { method: "GET", route: "a//b" },
    });
    Controller()(Users);
    class App {}
    Module({ controllers: [Users] })(App);

    await assert.rejects(build_http_graph(new Injector(App), ""), {
      message:
        'Invalid route "a//b" of method list of controller Users: it must not contain an empty segment ("//")',
    });
    assert.equal(created, 0);
  });

  it("throws on an invalid route", async () => {
    class Users {
      list() {}
    }
    legacy(Get(""), Users, "list");
    Controller({ route: "a//b" })(Users);
    class App {}
    Module({ controllers: [Users] })(App);

    await assert.rejects(build_http_graph(new Injector(App), ""), {
      message:
        'Invalid route "a//b" of controller Users: it must not contain an empty segment ("//")',
    });
  });
});

/** An app whose only controller is `Users` with a `GET` handler. */
function app_with(
  setup: (users: new () => object) => void,
  providers: (new () => object)[] = [],
) {
  class Users {
    list() {}
  }
  legacy(Get(""), Users, "list");
  Controller()(Users);
  setup(Users);
  class App {}
  Module({ providers, controllers: [Users] })(App);
  return App;
}

describe("build_http_graph, invalid middlewares and error handlers", () => {
  it("rejects a middleware class without a handle method", async () => {
    class Auth {}
    Injectable()(Auth);
    const App = app_with((Users) => Middlewares(loose(Auth))(Users), [Auth]);
    await assert.rejects(build_http_graph(new Injector(App), ""), {
      message: "Middleware class Auth must implement 'handle' method.",
    });
  });

  it("rejects a middleware class the injector cannot create", async () => {
    class Auth {
      handle() {}
    }
    const App = app_with((Users) => Middlewares(Auth)(Users)); // not provided
    await assert.rejects(build_http_graph(new Injector(App), ""), (error) => {
      assert.ok(error instanceof Error);
      assert.equal(
        error.message,
        "Failed to create middleware Auth in module App",
      );
      assert.equal(
        (error.cause as Error).message,
        "Auth is not visible in module App",
      );
      return true;
    });
  });

  it("rejects a middleware that is neither a function nor a class", async () => {
    // @Middlewares rejects it, so write the core record directly.
    const App = app_with((Users) =>
      add_to_metadata_object(Users, {
        [Symbol.for("chojs.core.middlewares")]: ["auth"],
      })
    );
    await assert.rejects(build_http_graph(new Injector(App), ""), {
      message:
        "Invalid middleware \"auth\": must be a function or a class with a 'handle' method.",
    });
  });

  it("rejects an error handler class without a handle method", async () => {
    class OnError {}
    Injectable()(OnError);
    const App = app_with((Users) => Catch(loose(OnError))(Users), [OnError]);
    await assert.rejects(build_http_graph(new Injector(App), ""), {
      message: "Error handler class OnError must implement 'handle' method.",
    });
  });

  it("rejects an error handler class the injector cannot create", async () => {
    class OnError {
      handle() {}
    }
    const App = app_with((Users) => Catch(OnError)(Users)); // not provided
    await assert.rejects(build_http_graph(new Injector(App), ""), (error) => {
      assert.ok(error instanceof Error);
      assert.equal(
        error.message,
        "Failed to create error handler OnError in module App",
      );
      assert.ok(error.cause instanceof Error);
      return true;
    });
  });
});

describe("build_http_graph, anonymous classes", () => {
  it("names an anonymous middleware or error handler class <anonymous>", async () => {
    const NoHandle = (() => class {})();
    Injectable()(NoHandle);

    const WithMiddleware = app_with(
      (Users) => Middlewares(loose(NoHandle))(Users),
      [NoHandle],
    );
    await assert.rejects(build_http_graph(new Injector(WithMiddleware), ""), {
      message: "Middleware class <anonymous> must implement 'handle' method.",
    });

    const WithCatch = app_with(
      (Users) => Catch(loose(NoHandle))(Users),
      [NoHandle],
    );
    await assert.rejects(build_http_graph(new Injector(WithCatch), ""), {
      message:
        "Error handler class <anonymous> must implement 'handle' method.",
    });
  });
});
