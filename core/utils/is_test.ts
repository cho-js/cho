/**
 * Tests for `is.ts`: telling classes from other functions.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isClass, isClassImplement } from "./is.ts";

describe("isClass", () => {
  it("is true for classes, abstract or derived", () => {
    class Base {}
    abstract class Abstract {}
    class Derived extends Base {}
    assert.equal(isClass(Base), true);
    assert.equal(isClass(Abstract), true);
    assert.equal(isClass(Derived), true);
  });

  it("is false for functions and other values", () => {
    function plain() {}
    for (const value of [plain, () => {}, async () => {}, {}, "Base", null]) {
      assert.equal(isClass(value), false, String(value));
    }
  });
});

describe("isClassImplement", () => {
  it("is true for a class whose prototype has the method", () => {
    class Handler {
      handle() {}
    }
    class Derived extends Handler {}
    assert.equal(isClassImplement(Handler, "handle"), true);
    assert.equal(isClassImplement(Derived, "handle"), true);
  });

  it("is false without the method, or for a function", () => {
    class Plain {}
    class Field {
      handle = () => {}; // an instance field, not on the prototype
    }
    function handler() {}
    assert.equal(isClassImplement(Plain, "handle"), false);
    assert.equal(isClassImplement(Field, "handle"), false);
    assert.equal(isClassImplement(handler, "handle"), false);
  });
});
