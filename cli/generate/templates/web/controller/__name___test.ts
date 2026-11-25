import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { __Name__ } from "./__name__.ts";

describe("__Name__", () => {
  it("says hello", () => {
    // a method of a controller is a method: a test calls it
    assert.deepEqual(new __Name__().hello(), {
      message: "Hello from __name__",
    });
  });
});
