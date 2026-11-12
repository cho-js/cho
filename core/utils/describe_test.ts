/**
 * Tests for `describe.ts`: readable names of values, for error messages.
 */

import { describe as suite, it } from "node:test";
import assert from "node:assert/strict";
import { describe } from "./describe.ts";
import { token } from "../di/tokens.ts";

suite("describe", () => {
  it("names classes and functions", () => {
    class Logger {}
    function factory() {}
    assert.equal(describe(Logger), "Logger");
    assert.equal(describe(factory), "factory");
  });

  it("names anonymous classes and functions <anonymous>", () => {
    assert.equal(describe((() => class {})()), "<anonymous>");
    assert.equal(describe((() => () => {})()), "<anonymous>");
  });

  it("quotes strings", () => {
    assert.equal(describe("Db"), '"Db"');
    assert.equal(describe(""), '""');
  });

  it("uses String() for anything else", () => {
    assert.equal(describe(Symbol("key")), "Symbol(key)");
    assert.equal(describe(token("URL")), "InjectionToken(URL)");
    assert.equal(describe(42), "42");
    assert.equal(describe(null), "null");
    assert.equal(describe(undefined), "undefined");
  });
});
