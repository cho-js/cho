/**
 * Tests for `is.ts`: telling classes from other functions.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { is_class, is_class_implement } from "./is.ts";

describe("is_class", () => {
  it("is true for classes, abstract or derived", () => {
    class Base {}
    abstract class Abstract {}
    class Derived extends Base {}
    assert.equal(is_class(Base), true);
    assert.equal(is_class(Abstract), true);
    assert.equal(is_class(Derived), true);
  });

  it("is false for functions and other values", () => {
    function plain() {}
    for (const value of [plain, () => {}, async () => {}, {}, "Base", null]) {
      assert.equal(is_class(value), false, String(value));
    }
  });
});

describe("is_class_implement", () => {
  it("is true for a class whose prototype has the method", () => {
    class Handler {
      handle() {}
    }
    class Derived extends Handler {}
    assert.equal(is_class_implement(Handler, "handle"), true);
    assert.equal(is_class_implement(Derived, "handle"), true);
  });

  it("is false without the method, or for a function", () => {
    class Plain {}
    class Field {
      handle = () => {}; // an instance field, not on the prototype
    }
    function handler() {}
    assert.equal(is_class_implement(Plain, "handle"), false);
    assert.equal(is_class_implement(Field, "handle"), false);
    assert.equal(is_class_implement(handler, "handle"), false);
  });
});
