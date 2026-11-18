import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isChoError } from "@chojs/core";
import { check_codes } from "@chojs/core/utils/test_utils";
import { type ChoKafkaErrorCode, kafka_error } from "./errors.ts";

/** Every code of the package: the compiler wants all of them, and no other. */
const CODES: Record<ChoKafkaErrorCode, true> = {
  CHO_KAFKA_ALREADY_LINKED: true,
  CHO_KAFKA_CONSUME_FAILED: true,
  CHO_KAFKA_DEAD_LETTER_FAILED: true,
  CHO_KAFKA_INVALID_DEAD_LETTER: true,
  CHO_KAFKA_INVALID_OPTION: true,
  CHO_KAFKA_INVALID_TOPIC: true,
  CHO_KAFKA_NO_DEAD_LETTER: true,
  CHO_KAFKA_NOT_LINKED: true,
};

describe("the errors of @chojs/vendor-kafka", () => {
  it("are ChoErrors, with a code, a message and a cause", () => {
    const cause = new Error("why");
    const error = kafka_error("CHO_KAFKA_ALREADY_LINKED", "it broke", {
      cause,
    });
    assert.equal(isChoError(error, "CHO_KAFKA_ALREADY_LINKED"), true);
    assert.equal(error.name, "ChoError");
    assert.equal(error.message, "it broke");
    assert.equal(error.cause, cause);
  });

  it("have a stack that starts where the mistake was found", () => {
    const made: unknown[] = [];
    function finds_the_mistake() {
      const error = kafka_error("CHO_KAFKA_ALREADY_LINKED", "it broke");
      // Work after the call: a tail call would leave no frame for this
      // function, on an engine that has them.
      made.push(error);
      return error;
    }
    const stack = finds_the_mistake().stack ?? "";
    assert.match(stack, /finds_the_mistake/);
    if ("captureStackTrace" in Error) {
      assert.doesNotMatch(stack, /kafka_error/);
    }
  });

  it("have codes that are documented and tested", async () => {
    const problems = await check_codes(
      Object.keys(CODES),
      "CHO_KAFKA_",
      import.meta.url,
      "specs.md",
    );
    assert.deepEqual(problems ?? [], []);
  });
});
