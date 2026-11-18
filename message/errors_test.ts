import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isChoError } from "@chojs/core";
import { check_codes } from "@chojs/core/utils/test_utils";
import { type ChoMessageErrorCode, message_error } from "./errors.ts";

/** Every code of the package: the compiler wants all of them, and no other. */
const CODES: Record<ChoMessageErrorCode, true> = {
  CHO_MESSAGE_CLOSED: true,
  CHO_MESSAGE_CREATE_FAILED: true,
  CHO_MESSAGE_DUPLICATE_DECORATOR: true,
  CHO_MESSAGE_DUPLICATE_TOPIC: true,
  CHO_MESSAGE_INVALID_INJECTOR: true,
  CHO_MESSAGE_INVALID_TARGET: true,
  CHO_MESSAGE_INVALID_TOPIC: true,
  CHO_MESSAGE_INVALID_VALUE: true,
  CHO_MESSAGE_NO_LINKER: true,
  CHO_MESSAGE_UNKNOWN_TOPIC: true,
};

describe("the errors of @chojs/message", () => {
  it("are ChoErrors, with a code, a message and a cause", () => {
    const cause = new Error("why");
    const error = message_error("CHO_MESSAGE_CLOSED", "it broke", { cause });
    assert.equal(isChoError(error, "CHO_MESSAGE_CLOSED"), true);
    assert.equal(error.name, "ChoError");
    assert.equal(error.message, "it broke");
    assert.equal(error.cause, cause);
  });

  it("have a stack that starts where the mistake was found", () => {
    const made: unknown[] = [];
    function finds_the_mistake() {
      const error = message_error("CHO_MESSAGE_CLOSED", "it broke");
      // Work after the call: a tail call would leave no frame for this
      // function, on an engine that has them.
      made.push(error);
      return error;
    }
    const stack = finds_the_mistake().stack ?? "";
    assert.match(stack, /finds_the_mistake/);
    if ("captureStackTrace" in Error) {
      assert.doesNotMatch(stack, /message_error/);
    }
  });

  it("have codes that are documented and tested", async () => {
    const problems = await check_codes(
      Object.keys(CODES),
      "CHO_MESSAGE_",
      import.meta.url,
      "specs.md",
    );
    assert.deepEqual(problems ?? [], []);
  });
});
