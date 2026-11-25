import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { __Name__ } from "./__name__.ts";

describe("__Name__", () => {
  it("says hello", () => {
    // a method of a controller is a method: a test calls it, and reads what
    // it printed
    const lines: string[] = [];
    const log = console.log;
    console.log = (...values: unknown[]) => void lines.push(values.join(" "));
    try {
      new __Name__().hello();
    } finally {
      console.log = log;
    }
    assert.deepEqual(lines, ["Hello from __name__"]);
  });
});
