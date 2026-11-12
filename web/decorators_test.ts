/**
 * Tests for `decorators.ts`: the HTTP method decorators write the handler's
 * method and route under the private `HTTP` key.
 *
 * Decorators are applied as plain function calls, so the tests run on every
 * runtime.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  read_metadata_object,
  read_method_metadata,
  token,
} from "@chojs/core/di";
import { legacy, loose, tc39, tc39_record } from "@chojs/core/utils/test_utils";
import {
  Catch,
  Controller,
  Delete,
  Get,
  Middlewares,
  Module,
  Patch,
  Post,
  Put,
} from "./decorators.ts";
import { HTTP } from "./keys.ts";

describe("HTTP method decorators", () => {
  for (
    const [decorator, method] of [
      [Get, "GET"],
      [Post, "POST"],
      [Put, "PUT"],
      [Patch, "PATCH"],
      [Delete, "DELETE"],
    ] as const
  ) {
    it(`${method}: writes the method and route (TC39)`, () => {
      function run() {}
      tc39(decorator(":id"), run, "run");
      assert.deepEqual(tc39_record(run), {
        [HTTP]: { method, route: ":id" },
      });
    });

    it(`${method}: writes the method and route (legacy)`, () => {
      class Users {
        run() {}
      }
      legacy(decorator("list"), Users, "run");
      assert.deepEqual(read_method_metadata(Users, "run"), {
        [HTTP]: { method, route: "list" },
      });
    });
  }

  it("keeps what other decorators wrote on the method", () => {
    const mw = () => new Response();
    class Users {
      run() {}
    }
    legacy(Middlewares(mw), Users, "run");
    legacy(Get(""), Users, "run");
    const record = read_method_metadata<Record<PropertyKey, unknown>>(
      Users,
      "run",
    )!;
    assert.deepEqual(record[HTTP], { method: "GET", route: "" });
    assert.equal(Object.getOwnPropertySymbols(record).length, 2);
  });

  it("rejects anything but a method", () => {
    assert.throws(() => Get("")(class {}, undefined as never), {
      name: "TypeError",
      message: "@Get() can only decorate a method",
    });
  });

  it("rejects an invalid route, when the class is defined", () => {
    class Users {
      run() {}
    }
    assert.throws(() => legacy(Get("/users"), Users, "run"), {
      message:
        'Invalid route "/users" of @Get() on method run: it must not start or end with "/"',
    });
    assert.throws(() => legacy(Get(loose(42)), Users, "run"), {
      name: "TypeError",
    });
    assert.equal(read_method_metadata(Users, "run"), undefined);
  });

  it("rejects a second HTTP method decorator on a method", () => {
    class Users {
      run() {}
    }
    legacy(Post("x"), Users, "run");
    assert.throws(() => legacy(Get("y"), Users, "run"), {
      message:
        'Cannot add @Get() to method run: it already handles POST "x". A method can have one HTTP method decorator.',
    });
  });

  it("rejects static, private and symbol-named methods", () => {
    class Users {
      static run() {}
    }
    assert.throws(
      () => legacy(Get(""), Users, "run", { isStatic: true }),
      {
        name: "TypeError",
        message:
          "@Get() cannot decorate static method run: a handler must not be static",
      },
    );
    assert.throws(
      () => tc39(Get(""), () => {}, "#run", { isPrivate: true }),
      {
        name: "TypeError",
        message:
          "@Get() cannot decorate private method #run: a handler must be public",
      },
    );
    assert.throws(() => tc39(Get(""), () => {}, Symbol("run")), {
      name: "TypeError",
      message:
        "@Get() cannot decorate method Symbol(run): a handler must have a string name",
    });
  });
});

describe("@Middlewares and @Catch", () => {
  const MIDDLEWARES = Symbol.for("chojs.core.middlewares");
  const ERROR_HANDLER = Symbol.for("chojs.core.errorHandler");

  it("write the core's records, on a class and on a method", () => {
    const mw = () => new Response();
    const on_error = () => "handled";
    class Users {
      run() {}
    }
    Middlewares(mw)(Users);
    Catch(on_error)(Users);
    legacy(Middlewares(mw), Users, "run");
    legacy(Catch(on_error), Users, "run");
    for (
      const record of [
        read_metadata_object<Record<PropertyKey, unknown>>(Users)!,
        read_method_metadata<Record<PropertyKey, unknown>>(Users, "run")!,
      ]
    ) {
      assert.deepEqual(record[MIDDLEWARES], [mw]);
      assert.equal(record[ERROR_HANDLER], on_error);
    }
  });

  it("reject what is not a function or a class", () => {
    assert.throws(() => Middlewares(loose("auth"))(class {}), {
      message: 'all middlewares must be functions: "auth"',
    });
    assert.throws(() => Catch(loose(1))(class {}), {
      message: "the error handler must be a function or a class: 1",
    });
  });
});

const LIMIT = token<number>("LIMIT");

describe("@Module and @Controller", () => {
  it("store the route as an option of the core's record", () => {
    class Users {}
    Controller({ route: "users" })(Users);
    class App {}
    Module({ route: "v1", controllers: [Users] })(App);

    const record = (target: new () => object) =>
      read_metadata_object<Record<PropertyKey, unknown>>(target)!;
    assert.equal(record(Users)["route"], "users");
    assert.equal(record(App)["route"], "v1");
    assert.deepEqual(record(App)[Symbol.for("chojs.core.controllers")], [
      Users,
    ]);
  });

  it("reject a misspelled option, in the types and at runtime", () => {
    class Store {}
    assert.throws(
      // @ts-expect-error `deps` is not an option: it is `dependencies`
      () => Controller({ deps: [Store] })(class {}),
      {
        message:
          '@Controller(): unknown option "deps". Known options: dependencies, route',
      },
    );
    assert.throws(
      // @ts-expect-error `provider` is not an option: it is `providers`
      () => Module({ provider: [Store] })(class {}),
      {
        message:
          '@Module(): unknown option "provider". Known options: dependencies, imports, providers, controllers, exports, route',
      },
    );
    assert.throws(
      // @ts-expect-error middlewares are declared with @Middlewares
      () => Controller({ middlewares: [() => new Response()] })(class {}),
      { message: /unknown option "middlewares"/ },
    );
  });

  it("check the dependencies against the constructor", () => {
    class Store {}
    class Users {
      constructor(readonly store: Store, readonly limit: number) {}
    }
    // Type-only: never called.
    const _check = () => {
      Controller({ route: "users", dependencies: [Store, LIMIT] })(Users);
      // @ts-expect-error wrong order
      Controller({ route: "users", dependencies: [LIMIT, Store] })(Users);
      // @ts-expect-error the constructor needs dependencies
      Controller({ route: "users" })(Users);
      // @ts-expect-error the same check, for @Module
      Module({ dependencies: [Store] })(Users);
    };
  });
});
