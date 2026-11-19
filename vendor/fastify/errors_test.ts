import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isChoError } from "@chojs/core";
import { check_codes } from "@chojs/core/utils/test_utils";
import { type ChoFastifyErrorCode, fastify_error } from "./errors.ts";

/** Every code of the package: the compiler wants all of them, and no other. */
const CODES: Record<ChoFastifyErrorCode, true> = {
  CHO_FASTIFY_ALREADY_LINKED: true,
  CHO_FASTIFY_HOOK_FAILED: true,
  CHO_FASTIFY_MOUNT_TOO_LATE: true,
  CHO_FASTIFY_NO_SOCKET: true,
  CHO_FASTIFY_WRONG_ADAPTER: true,
};

describe("the errors of @chojs/vendor-fastify", () => {
  it("are ChoErrors, with a code, a message and a cause", () => {
    const cause = new Error("why");
    const error = fastify_error("CHO_FASTIFY_ALREADY_LINKED", "it broke", {
      cause,
    });
    assert.equal(isChoError(error, "CHO_FASTIFY_ALREADY_LINKED"), true);
    assert.equal(error.name, "ChoError");
    assert.equal(error.message, "it broke");
    assert.equal(error.cause, cause);
  });

  it("have a stack that starts where the mistake was found", () => {
    const made: unknown[] = [];
    function finds_the_mistake() {
      const error = fastify_error("CHO_FASTIFY_ALREADY_LINKED", "it broke");
      // Work after the call: a tail call would leave no frame for this
      // function, on an engine that has them.
      made.push(error);
      return error;
    }
    const stack = finds_the_mistake().stack ?? "";
    assert.match(stack, /finds_the_mistake/);
    if ("captureStackTrace" in Error) {
      assert.doesNotMatch(stack, /fastify_error/);
    }
  });

  it("have codes that are documented and tested", async () => {
    const problems = await check_codes(
      Object.keys(CODES),
      "CHO_FASTIFY_",
      import.meta.url,
      "README.md",
    );
    assert.deepEqual(problems ?? [], []);
  });
});
