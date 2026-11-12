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
  Catch,
  type ChoMiddlewareFn,
  Controller,
  Injectable,
  Injector,
  Middlewares,
  Module,
} from "@chojs/core/di";
import { legacy } from "@chojs/core/utils/test_utils";
import { Get, Post } from "./decorators.ts";
import { assert_route, build_http_graph } from "./build-graph.ts";

const mw_a: ChoMiddlewareFn = (_ctx, next) => next();
const mw_b: ChoMiddlewareFn = (_ctx, next) => next();
const mw_c: ChoMiddlewareFn = (_ctx, next) => next();

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
      controller!.methods.map((m) => [m.name, m.method, m.route, m.type]),
      [["list", "GET", "", "HTTP"], ["create", "POST", "new", "HTTP"]],
    );
    assert.equal(await controller!.methods[0]!.handler(), "hello");
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
      handle(_ctx: unknown, next: () => Promise<unknown>) {
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
    await controller.middlewares[0]!({}, () => Promise.resolve());
    assert.deepEqual(seen, ["auth"]);
    assert.equal(controller.errorHandler!({}, new Error("x")), "handled");
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

  it("throws on two handlers with the same method and route", async () => {
    class Users {
      a() {}
      b() {}
    }
    legacy(Get(":id"), Users, "a");
    legacy(Get(" :id "), Users, "b");
    Controller({ route: "users" })(Users);
    class App {}
    Module({ controllers: [Users] })(App);

    await assert.rejects(build_http_graph(new Injector(App), ""), {
      message:
        'Duplicate route "GET /users/:id": already declared by another method.',
    });
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
    const App = app_with((Users) => Middlewares(Auth)(Users), [Auth]);
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
    const App = app_with((Users) => Catch(OnError)(Users), [OnError]);
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

describe("assert_route", () => {
  for (
    const route of ["", "users", "users/:id", "a/b/c", "v1.2", "%20x", "~a_b-c"]
  ) {
    it(`accepts ${JSON.stringify(route)}`, () => {
      assert.doesNotThrow(() => assert_route(route, "test"));
    });
  }

  for (
    const [route, reason] of [
      ["/users", 'it must not start or end with "/"'],
      ["users/", 'it must not start or end with "/"'],
      ["a//b", 'it must not contain an empty segment ("//")'],
      ["a/./b", 'it must not contain a "." segment'],
      ["../a", 'it must not contain a ".." segment'],
      ["a b", '"a b" is not a valid URL path segment'],
      ["a?b", '"a?b" is not a valid URL path segment'],
      ["a#b", '"a#b" is not a valid URL path segment'],
      ["%zz", '"%zz" is not a valid URL path segment'],
    ] as const
  ) {
    it(`rejects ${JSON.stringify(route)}`, () => {
      assert.throws(() => assert_route(route, "test"), {
        name: "Error",
        message: `Invalid route ${JSON.stringify(route)} of test: ${reason}`,
      });
    });
  }

  it("rejects a route that is not a string, with a TypeError", () => {
    assert.throws(() => assert_route(42, "the global prefix"), {
      name: "TypeError",
      message: "Invalid route of the global prefix: expected a string, got 42",
    });
  });
});

describe("build_http_graph, anonymous classes", () => {
  it("names an anonymous middleware or error handler class <anonymous>", async () => {
    const NoHandle = (() => class {})();
    Injectable()(NoHandle);

    const WithMiddleware = app_with(
      (Users) => Middlewares(NoHandle)(Users),
      [NoHandle],
    );
    await assert.rejects(build_http_graph(new Injector(WithMiddleware), ""), {
      message: "Middleware class <anonymous> must implement 'handle' method.",
    });

    const WithCatch = app_with((Users) => Catch(NoHandle)(Users), [NoHandle]);
    await assert.rejects(build_http_graph(new Injector(WithCatch), ""), {
      message:
        "Error handler class <anonymous> must implement 'handle' method.",
    });
  });
});
