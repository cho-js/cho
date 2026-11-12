/**
 * Tests for `engine.ts`: detecting the JavaScript runtime.
 *
 * The tests run on Deno, Node.js and Bun: each run checks that the runtime it
 * runs on is detected, and only that one.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  engine,
  isBunRt,
  isCloudflareRt,
  isDenoRt,
  isEdgeRt,
  isNodeRt,
} from "./engine.ts";

/** The runtime the tests run on, detected independently of `engine.ts`. */
const actual = "Deno" in globalThis
  ? "deno"
  : "Bun" in globalThis
  ? "bun"
  : "node";

describe("engine", () => {
  it(`detects the current runtime (${actual})`, () => {
    assert.equal(engine(), actual);
  });

  it("is consistent with the is*Rt checks", () => {
    assert.equal(isDenoRt(), actual === "deno");
    assert.equal(isBunRt(), actual === "bun");
    assert.equal(isCloudflareRt(), false);
    assert.equal(isEdgeRt(), false);
    if (actual === "node") assert.equal(isNodeRt(), true);
  });

  it("detects an edge runtime by its EdgeRuntime global, first", () => {
    const g = globalThis as { EdgeRuntime?: unknown };
    g.EdgeRuntime = "edge-runtime";
    try {
      assert.equal(isEdgeRt(), true);
      assert.equal(engine(), "edge");
    } finally {
      delete g.EdgeRuntime;
    }
  });
});
