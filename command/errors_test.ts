import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isChoError } from "@chojs/core";
import { check_codes } from "@chojs/core/utils/test_utils";
import { type ChoCommandErrorCode, command_error } from "./errors.ts";

/** Every code of the package: the compiler wants all of them, and no other. */
const CODES: Record<ChoCommandErrorCode, true> = {
  CHO_COMMAND_AMBIGUOUS_CLASS: true,
  CHO_COMMAND_DUPLICATE_ACTION: true,
  CHO_COMMAND_DUPLICATE_DECORATOR: true,
  CHO_COMMAND_DUPLICATE_MAIN: true,
  CHO_COMMAND_INVALID_ARGUMENT: true,
  CHO_COMMAND_INVALID_FLAGS: true,
  CHO_COMMAND_INVALID_METHOD: true,
  CHO_COMMAND_INVALID_TARGET: true,
  CHO_COMMAND_MIXED_COMMANDS: true,
  CHO_COMMAND_NOT_VISIBLE: true,
  CHO_COMMAND_NO_COMMANDS: true,
  CHO_COMMAND_RESERVED_FLAG: true,
};

describe("the errors of @chojs/command", () => {
  it("are ChoErrors, with a code, a message and a cause", () => {
    const cause = new Error("why");
    const error = command_error("CHO_COMMAND_AMBIGUOUS_CLASS", "it broke", {
      cause,
    });
    assert.equal(isChoError(error, "CHO_COMMAND_AMBIGUOUS_CLASS"), true);
    assert.equal(error.name, "ChoError");
    assert.equal(error.message, "it broke");
    assert.equal(error.cause, cause);
  });

  it("have a stack that starts where the mistake was found", () => {
    const made: unknown[] = [];
    function finds_the_mistake() {
      const error = command_error("CHO_COMMAND_AMBIGUOUS_CLASS", "it broke");
      // Work after the call: a tail call would leave no frame for this
      // function, on an engine that has them.
      made.push(error);
      return error;
    }
    const stack = finds_the_mistake().stack ?? "";
    assert.match(stack, /finds_the_mistake/);
    if ("captureStackTrace" in Error) {
      assert.doesNotMatch(stack, /command_error/);
    }
  });

  it("have codes that are documented and tested", async () => {
    const problems = await check_codes(
      Object.keys(CODES),
      "CHO_COMMAND_",
      import.meta.url,
      "specs.md",
    );
    assert.deepEqual(problems ?? [], []);
  });
});
