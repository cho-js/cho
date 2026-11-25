import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { __Name__ } from "./__name__.ts";

describe("__Name__", () => {
  it("says hello", () => {
    // a service is a class: a test creates it, with no injector
    assert.equal(new __Name__().hello(), "Hello from __name__");
  });
});
