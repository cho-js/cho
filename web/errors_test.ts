import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isChoError } from "@chojs/core";
import { check_codes } from "@chojs/core/utils/test_utils";
import { type ChoWebErrorCode, web_error } from "./errors.ts";

/** Every code of the package: the compiler wants all of them, and no other. */
const CODES: Record<ChoWebErrorCode, true> = {
  CHO_WEB_CLOSED: true,
  CHO_WEB_CREATE_FAILED: true,
  CHO_WEB_DUPLICATE_DECORATOR: true,
  CHO_WEB_DUPLICATE_ROUTE: true,
  CHO_WEB_INVALID_ARGUMENT: true,
  CHO_WEB_INVALID_EVENT: true,
  CHO_WEB_INVALID_HANDLER: true,
  CHO_WEB_INVALID_METHOD: true,
  CHO_WEB_INVALID_MIDDLEWARE: true,
  CHO_WEB_INVALID_OPTION: true,
  CHO_WEB_INVALID_ROUTE: true,
  CHO_WEB_INVALID_SOCKET: true,
  CHO_WEB_INVALID_SOCKET_RESULT: true,
  CHO_WEB_INVALID_SSE_RESULT: true,
  CHO_WEB_INVALID_STATUS: true,
  CHO_WEB_INVALID_TARGET: true,
  CHO_WEB_NO_SERVER: true,
  CHO_WEB_NO_URL_PATTERN: true,
  CHO_WEB_UNKNOWN_PARAM: true,
};

describe("the errors of @chojs/web", () => {
  it("are ChoErrors, with a code, a message and a cause", () => {
    const cause = new Error("why");
    const error = web_error("CHO_WEB_CLOSED", "it broke", { cause });
    assert.equal(isChoError(error, "CHO_WEB_CLOSED"), true);
    assert.equal(error.name, "ChoError");
    assert.equal(error.message, "it broke");
    assert.equal(error.cause, cause);
  });

  it("have a stack that starts where the mistake was found", () => {
    const made: unknown[] = [];
    function finds_the_mistake() {
      const error = web_error("CHO_WEB_CLOSED", "it broke");
      // Work after the call: a tail call would leave no frame for this
      // function, on an engine that has them.
      made.push(error);
      return error;
    }
    const stack = finds_the_mistake().stack ?? "";
    assert.match(stack, /finds_the_mistake/);
    if ("captureStackTrace" in Error) {
      assert.doesNotMatch(stack, /web_error/);
    }
  });

  it("have codes that are documented and tested", async () => {
    const problems = await check_codes(
      Object.keys(CODES),
      "CHO_WEB_",
      import.meta.url,
      "specs.md",
    );
    assert.deepEqual(problems ?? [], []);
  });
});
