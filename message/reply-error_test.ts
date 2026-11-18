/** Tests for `reply-error.ts`: the error that says what who asked is told. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loose } from "@chojs/core/utils/test_utils";
import { isReplyError, ReplyError } from "./reply-error.ts";

describe("ReplyError", () => {
  it("has a code, and its description as its message", () => {
    const error = new ReplyError(404, "Not Found");
    assert.equal(error.code, 404);
    assert.equal(error.description, "Not Found");
    assert.equal(error.message, "Not Found");
    assert.equal(error.name, "ReplyError");
    assert.ok(error instanceof Error);
    assert.equal(String(error), "ReplyError: Not Found");
  });

  it("keeps its cause", () => {
    const cause = new Error("no row");
    assert.equal(new ReplyError(404, "Not Found", { cause }).cause, cause);
    assert.equal("cause" in new ReplyError(404, "Not Found"), false);
  });

  it("refuses a code that is not a whole number of 1 or more", () => {
    for (const code of [0, -1, 1.5, NaN, "404", undefined]) {
      assert.throws(() => new ReplyError(loose(code), "Not Found"), {
        code: "CHO_MESSAGE_INVALID_REPLY_ERROR",
        message: /^ReplyError: the code must be a whole number, 1 or more, got/,
      });
    }
  });

  it("refuses a description that is not a string of one line", () => {
    for (const description of [undefined, 404, "", "  ", "two\nlines"]) {
      assert.throws(() => new ReplyError(404, loose(description)), {
        code: "CHO_MESSAGE_INVALID_REPLY_ERROR",
        message: /^ReplyError: the description must be a string of one line/,
      });
    }
  });

  it("refuses options that are not an object, or not known", () => {
    assert.throws(() => new ReplyError(404, "Not Found", loose(null)), {
      code: "CHO_MESSAGE_INVALID_REPLY_ERROR",
      message: "ReplyError: the options must be an object, got null",
    });
    assert.throws(
      () => new ReplyError(404, "Not Found", loose({ value: "x" })),
      {
        code: "CHO_CORE_UNKNOWN_OPTION",
        message: 'ReplyError: unknown option "value". Known options: cause',
      },
    );
  });
});

describe("isReplyError", () => {
  it("recognizes a reply error, and its code", () => {
    const error = new ReplyError(404, "Not Found");
    assert.equal(isReplyError(error), true);
    assert.equal(isReplyError(error, 404), true);
    assert.equal(isReplyError(error, 500), false);
  });

  it("recognizes one of another copy of the package", () => {
    class Other extends Error {
      code = 409;
    }
    Object.defineProperty(
      Other.prototype,
      Symbol.for("cho.message.reply_error"),
      { value: true },
    );
    assert.equal(isReplyError(new Other("Conflict"), 409), true);
  });

  it("refuses anything else", () => {
    for (
      const value of [
        undefined,
        null,
        "Not Found",
        new Error("Not Found"),
        { code: 404, message: "Not Found" },
      ]
    ) {
      assert.equal(isReplyError(value), false);
    }
  });
});
