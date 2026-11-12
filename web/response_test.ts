/**
 * Tests for `response.ts`: converting a returned value to a `Response`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { to_response } from "./response.ts";

describe("to_response", () => {
  it("returns a Response as is", () => {
    const response = new Response("ok", { status: 201 });
    assert.equal(to_response(response), response);
  });

  it("answers 204 with no body for undefined", async () => {
    const response = to_response(undefined);
    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
  });

  for (
    const [value, body] of [
      [{ id: 1 }, '{"id":1}'],
      [[1, 2], "[1,2]"],
      ["text", '"text"'],
      [0, "0"],
      [false, "false"],
      [null, "null"],
    ] as const
  ) {
    it(`sends ${body} as JSON`, async () => {
      const response = to_response(value);
      assert.equal(response.status, 200);
      assert.match(
        response.headers.get("content-type") ?? "",
        /application\/json/,
      );
      assert.equal(await response.text(), body);
    });
  }
});
