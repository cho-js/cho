import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isChoError } from "@chojs/command";
import { check_codes } from "@chojs/core/utils/test_utils";
import { type ChoCliErrorCode, cli_error } from "./errors.ts";

/** Every code of the tool: the compiler wants all of them, and no other. */
const CODES: Record<ChoCliErrorCode, true> = {
  CHO_CLI_INVALID_CONFIG: true,
  CHO_CLI_INVALID_NAME: true,
  CHO_CLI_INVALID_OPTION: true,
  CHO_CLI_TARGET_EXISTS: true,
  CHO_CLI_WRITE_FAILED: true,
};

describe("the errors of the tool", () => {
  it("are ChoErrors, with a code, a message and a cause", () => {
    const cause = new Error("why");
    const error = cli_error("CHO_CLI_WRITE_FAILED", "it broke", { cause });
    assert.equal(isChoError(error, "CHO_CLI_WRITE_FAILED"), true);
    assert.equal(error.name, "ChoError");
    assert.equal(error.message, "it broke");
    assert.equal(error.cause, cause);
  });

  it("have codes that are documented and tested", async () => {
    const problems = await check_codes(
      Object.keys(CODES),
      "CHO_CLI_",
      import.meta.url,
      "../specs.md",
    );
    assert.deepEqual(problems ?? [], []);
  });
});
