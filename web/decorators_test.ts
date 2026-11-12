/**
 * Tests for `decorators.ts`: the HTTP method decorators write the handler's
 * method and route under the private `HTTP` key.
 *
 * Decorators are applied as plain function calls, so the tests run on every
 * runtime.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Middlewares, read_metadata_object } from "@chojs/core/di";
import { legacy, tc39 } from "@chojs/core/utils/test_utils";
import { Delete, Get, Post, Put } from "./decorators.ts";
import { HTTP } from "./keys.ts";

describe("HTTP method decorators", () => {
  for (
    const [decorator, method] of [
      [Get, "GET"],
      [Post, "POST"],
      [Put, "PUT"],
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
    const mw = () => Promise.resolve();
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
});
