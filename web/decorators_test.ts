/**
 * Tests for `decorators.ts`: the HTTP method decorators write the handler's
 * method and route under the private `HTTP` key.
 *
 * Decorators are applied as plain function calls, so the tests run on every
 * runtime.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { read_metadata_object } from "@chojs/core/di";
import { legacy, loose, tc39 } from "@chojs/core/utils/test_utils";
import {
  Catch,
  Delete,
  Get,
  Middlewares,
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
      assert.deepEqual(read_metadata_object(run), {
        [HTTP]: { method, route: ":id" },
      });
    });

    it(`${method}: writes the method and route (legacy)`, () => {
      class Users {
        run() {}
      }
      legacy(decorator("list"), Users, "run");
      assert.deepEqual(read_metadata_object(Users.prototype.run), {
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
    const record = read_metadata_object<Record<PropertyKey, unknown>>(
      Users.prototype.run,
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
    assert.equal(read_metadata_object(Users.prototype.run), undefined);
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
    for (const target of [Users, Users.prototype.run]) {
      const record = read_metadata_object<Record<PropertyKey, unknown>>(
        target,
      )!;
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
