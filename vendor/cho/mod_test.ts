/**
 * Tests for `@chojs/vendor-cho`: it exports the router of `@chojs/web`. The
 * router itself is tested there (`web/router_test.ts`).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as web from "@chojs/web";
import { ChoLinker, ChoRouter } from "./mod.ts";

describe("@chojs/vendor-cho", () => {
  it("exports the ChoLinker and the ChoRouter of @chojs/web", () => {
    assert.equal(ChoLinker, web.ChoLinker);
    assert.equal(ChoRouter, web.ChoRouter);
  });
});
