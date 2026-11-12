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

  it("never throws, even when String() does", () => {
    const throwing = {
      toString() {
        throw new Error("boom");
      },
    };
    assert.equal(describe(Object.create(null)), "[object Object]");
    assert.equal(describe(throwing), "[object Object]");
  });

  it("falls back to <unknown> when nothing can name the value", () => {
    const hostile = Object.create(null, {
      [Symbol.toStringTag]: {
        get() {
          throw new Error("boom");
        },
      },
    });
    assert.equal(describe(hostile), "<unknown>");
  });
});
