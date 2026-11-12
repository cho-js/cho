/**
 * Tests for `path.ts`: route validation.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { assert_route, normalize_route } from "./path.ts";

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

describe("assert_route, the route syntax", () => {
  it("has no wildcards", () => {
    for (const route of ["*", "files/*", "a*b"]) {
      assert.throws(() => assert_route(route, "test"), {
        message: new RegExp(
          'has a "\\*": wildcards are not part of the route syntax$',
        ),
      });
    }
  });

  it("accepts :name parameters only", () => {
    for (const route of [":id", "users/:user_id/posts/:postId", ":_x1"]) {
      assert.doesNotThrow(() => assert_route(route, "test"));
    }
    for (const route of [":", ":1id", ":a:b", ":id.json", "users/:"]) {
      assert.throws(() => assert_route(route, "test"), {
        message:
          /is not a valid parameter: write ":name", with letters, digits and "_"$/,
      });
    }
    // a ":" that does not start the segment is a plain character
    assert.doesNotThrow(() => assert_route("a:b", "test"));
  });
});

describe("normalize_route", () => {
  it("trims the route, then validates it", () => {
    assert.equal(normalize_route(" users/:id ", "test"), "users/:id");
    assert.throws(() => normalize_route(" /users ", "test"), {
      message:
        'Invalid route "/users" of test: it must not start or end with "/"',
    });
  });
});
