import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { greet } from "./mod.ts";

describe("__name__", () => {
  it("greets by name", () => {
    assert.equal(greet("Ada"), "Hello, Ada, from __name__");
  });
});
