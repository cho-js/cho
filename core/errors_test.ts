import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  type ChoCoreErrorCode,
  ChoError,
  core_error,
  isChoError,
  make_error,
} from "./errors.ts";
import { check_codes } from "./utils/test_utils.ts";

/** Every code of the package: the compiler wants all of them, and no other. */
const CODES: Record<ChoCoreErrorCode, true> = {
  CHO_CORE_ALREADY_DECORATED: true,
  CHO_CORE_AMBIGUOUS_TOKEN: true,
  CHO_CORE_CIRCULAR_DEPENDENCY: true,
  CHO_CORE_CREATE_FAILED: true,
  CHO_CORE_DISPOSED: true,
  CHO_CORE_DISPOSE_FAILED: true,
  CHO_CORE_DUPLICATE_CATCH: true,
  CHO_CORE_DUPLICATE_OVERRIDE: true,
  CHO_CORE_DUPLICATE_TOKEN: true,
  CHO_CORE_INVALID_ERROR_HANDLER: true,
  CHO_CORE_INVALID_EXPORT: true,
  CHO_CORE_INVALID_MIDDLEWARE: true,
  CHO_CORE_INVALID_MIDDLEWARE_RESULT: true,
  CHO_CORE_INVALID_OPTION: true,
  CHO_CORE_INVALID_OVERRIDE: true,
  CHO_CORE_INVALID_PROVIDER: true,
  CHO_CORE_INVALID_TARGET: true,
  CHO_CORE_METADATA_FORMAT: true,
  CHO_CORE_MISPLACED_PROVIDER: true,
  CHO_CORE_MISSING_MIDDLEWARE_RESULT: true,
  CHO_CORE_NEXT_CALLED_TWICE: true,
  CHO_CORE_NOT_A_CLASS: true,
  CHO_CORE_NOT_A_CONTROLLER: true,
  CHO_CORE_NOT_A_MODULE: true,
  CHO_CORE_NOT_INJECTABLE: true,
  CHO_CORE_NOT_VISIBLE: true,
  CHO_CORE_UNKNOWN_MODULE: true,
  CHO_CORE_UNKNOWN_OPTION: true,
  CHO_CORE_UNKNOWN_OVERRIDE: true,
  CHO_CORE_UNRESOLVED_DEPENDENCY: true,
};

/**
 * What another copy of the package would throw: a class of its own, marked
 * with the same registered symbol.
 */
function of_another_copy(code: string, message: string): Error {
  class ChoError extends Error {
    readonly code = code;
  }
  Object.defineProperty(ChoError.prototype, Symbol.for("cho.error"), {
    value: true,
  });
  return new ChoError(message);
}

describe("ChoError", () => {
  it("is an Error with a code, a message and a name", () => {
    const error = new ChoError("CHO_TEST", "it broke");
    assert.ok(error instanceof Error);
    assert.equal(error.code, "CHO_TEST");
    assert.equal(error.message, "it broke");
    assert.equal(error.name, "ChoError");
    assert.equal(String(error), "ChoError: it broke");
  });

  it("keeps its cause", () => {
    const cause = new Error("why");
    assert.equal(new ChoError("CHO_TEST", "it broke", { cause }).cause, cause);
    assert.equal("cause" in new ChoError("CHO_TEST", "it broke"), false);
  });

  it("shows only its code as a property of its own", () => {
    assert.deepEqual(Object.keys(new ChoError("CHO_TEST", "it broke")), [
      "code",
    ]);
  });
});

describe("isChoError", () => {
  it("is true for a ChoError", () => {
    assert.equal(isChoError(new ChoError("CHO_TEST", "it broke")), true);
  });

  it("is false for anything else", () => {
    for (
      const value of [
        new Error("x"),
        new TypeError("x"),
        Object.assign(new Error("x"), { code: "ENOENT" }),
        { code: "CHO_TEST", name: "ChoError", message: "x" },
        "CHO_TEST",
        null,
        undefined,
        42,
      ]
    ) {
      assert.equal(isChoError(value), false);
    }
  });

  it("looks for a code", () => {
    const error = new ChoError("CHO_TEST", "it broke");
    assert.equal(isChoError(error, "CHO_TEST"), true);
    assert.equal(isChoError(error, "CHO_OTHER"), false);
    assert.equal(isChoError(new Error("x"), "CHO_TEST"), false);
  });

  it("narrows the code", () => {
    const error: unknown = new ChoError("CHO_TEST", "it broke");
    if (isChoError(error, "CHO_TEST")) {
      const code: "CHO_TEST" = error.code;
      assert.equal(code, "CHO_TEST");
    } else {
      assert.fail("not recognized");
    }
  });

  it("is true for an error of another copy of the package", () => {
    const error = of_another_copy("CHO_CORE_DISPOSED", "disposed");
    assert.equal(error instanceof ChoError, false);
    assert.equal(isChoError(error), true);
    assert.equal(isChoError(error, "CHO_CORE_DISPOSED"), true);
    assert.equal(isChoError(error, "CHO_CORE_NOT_A_MODULE"), false);
  });

  it("is false for a marked object without a code", () => {
    const error = of_another_copy("x", "x");
    Object.defineProperty(error, "code", { value: 42 });
    assert.equal(isChoError(error), false);
  });
});

describe("make_error", () => {
  it("makes a ChoError", () => {
    const cause = new Error("why");
    const error = core_error("CHO_CORE_DISPOSED", "disposed", { cause });
    assert.equal(isChoError(error, "CHO_CORE_DISPOSED"), true);
    assert.equal(error.message, "disposed");
    assert.equal(error.cause, cause);
  });

  // Work after a call keeps the frame of the caller: a tail call would leave
  // none, on an engine that has them (JavaScriptCore).
  const made: unknown[] = [];

  it("starts the stack where the mistake was found", () => {
    function of_package(): ChoError {
      const error = make_error("CHO_TEST", "it broke", undefined, of_package);
      made.push(error);
      return error;
    }
    function finds_the_mistake(): ChoError {
      const error = of_package();
      made.push(error);
      return error;
    }
    const stack = finds_the_mistake().stack ?? "";
    assert.match(stack, /finds_the_mistake/);
    // Not on every engine: an engine that cannot leaves the line in.
    if ("captureStackTrace" in Error) {
      assert.doesNotMatch(stack, /of_package/);
    }
  });

  it("does the same when the function of the package returns its call", () => {
    // What each package writes. With tail calls the function has no frame:
    // it is left out all the same, and the rest of the stack is kept.
    function of_package(): ChoError {
      return make_error("CHO_TEST", "it broke", undefined, of_package);
    }
    function finds_the_mistake(): ChoError {
      const error = of_package();
      made.push(error);
      return error;
    }
    const stack = finds_the_mistake().stack ?? "";
    assert.match(stack, /finds_the_mistake/);
    if ("captureStackTrace" in Error) {
      assert.doesNotMatch(stack, /of_package|make_error/);
    }
  });
});

describe("the codes of @chojs/core", () => {
  it("are documented and tested", async () => {
    const problems = await check_codes(
      Object.keys(CODES),
      "CHO_CORE_",
      import.meta.url,
      "specs.md",
    );
    assert.deepEqual(problems ?? [], []);
  });
});
