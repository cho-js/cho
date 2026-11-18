import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isChoError } from "@chojs/core";
import { check_codes } from "@chojs/core/utils/test_utils";
import { type ChoNatsErrorCode, nats_error } from "./errors.ts";

/** Every code of the package: the compiler wants all of them, and no other. */
const CODES: Record<ChoNatsErrorCode, true> = {
  CHO_NATS_ALREADY_LINKED: true,
  CHO_NATS_CONNECTION_CLOSED: true,
  CHO_NATS_CONSUMER_FAILED: true,
  CHO_NATS_DEAD_LETTER_FAILED: true,
  CHO_NATS_DUPLICATE_CONSUMER: true,
  CHO_NATS_INVALID_CONNECTION: true,
  CHO_NATS_INVALID_DEAD_LETTER: true,
  CHO_NATS_INVALID_JETSTREAM: true,
  CHO_NATS_INVALID_OPTION: true,
  CHO_NATS_NOT_STARTED: true,
  CHO_NATS_REPLY_FAILED: true,
  CHO_NATS_STREAM_NOT_FOUND: true,
  CHO_NATS_SUBSCRIPTION_FAILED: true,
};

describe("the errors of @chojs/vendor-nats", () => {
  it("are ChoErrors, with a code, a message and a cause", () => {
    const cause = new Error("why");
    const error = nats_error("CHO_NATS_ALREADY_LINKED", "it broke", { cause });
    assert.equal(isChoError(error, "CHO_NATS_ALREADY_LINKED"), true);
    assert.equal(error.name, "ChoError");
    assert.equal(error.message, "it broke");
    assert.equal(error.cause, cause);
  });

  it("have a stack that starts where the mistake was found", () => {
    const made: unknown[] = [];
    function finds_the_mistake() {
      const error = nats_error("CHO_NATS_ALREADY_LINKED", "it broke");
      // Work after the call: a tail call would leave no frame for this
      // function, on an engine that has them.
      made.push(error);
      return error;
    }
    const stack = finds_the_mistake().stack ?? "";
    assert.match(stack, /finds_the_mistake/);
    if ("captureStackTrace" in Error) {
      assert.doesNotMatch(stack, /nats_error/);
    }
  });

  it("have codes that are documented and tested", async () => {
    const problems = await check_codes(
      Object.keys(CODES),
      "CHO_NATS_",
      import.meta.url,
      "specs.md",
    );
    assert.deepEqual(problems ?? [], []);
  });
});
