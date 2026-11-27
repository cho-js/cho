import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isChoError } from "@chojs/core";
import { check_codes } from "@chojs/core/utils/test_utils";
import { asyncapi_error, type ChoAsyncApiErrorCode } from "./errors.ts";

/** Every code of the package: the compiler wants all of them, and no other. */
const CODES: Record<ChoAsyncApiErrorCode, true> = {
  CHO_ASYNCAPI_DUPLICATE_OPERATION_ID: true,
  CHO_ASYNCAPI_INVALID_OPTION: true,
};

describe("the errors of @chojs/asyncapi", () => {
  it("are ChoErrors, with a code, a message and a cause", () => {
    const cause = new Error("why");
    const error = asyncapi_error(
      "CHO_ASYNCAPI_DUPLICATE_OPERATION_ID",
      "it broke",
      { cause },
    );
    assert.equal(
      isChoError(error, "CHO_ASYNCAPI_DUPLICATE_OPERATION_ID"),
      true,
    );
    assert.equal(error.name, "ChoError");
    assert.equal(error.message, "it broke");
    assert.equal(error.cause, cause);
  });

  it("have a stack that starts where the mistake was found", () => {
    const made: unknown[] = [];
    function finds_the_mistake() {
      const error = asyncapi_error(
        "CHO_ASYNCAPI_DUPLICATE_OPERATION_ID",
        "it broke",
      );
      // Work after the call: a tail call would leave no frame for this
      // function, on an engine that has them.
      made.push(error);
      return error;
    }
    const stack = finds_the_mistake().stack ?? "";
    assert.match(stack, /finds_the_mistake/);
    if ("captureStackTrace" in Error) {
      assert.doesNotMatch(stack, /asyncapi_error/);
    }
  });

  it("have codes that are documented and tested", async () => {
    const problems = await check_codes(
      Object.keys(CODES),
      "CHO_ASYNCAPI_",
      import.meta.url,
      "specs.md",
    );
    assert.deepEqual(problems ?? [], []);
  });
});
