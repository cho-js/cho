/**
 * Tests for the flags of `cho generate`: the part, the name, and the
 * mistakes that are found before any question.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type ChoArgs, isChoError } from "@chojs/command";
import { path_mistake, read_flags } from "./flags.ts";

/**
 * A parsed command line, as `@chojs/command` gives it for the flags of
 * `generate`: the booleans are always there, with their default.
 */
const args = (given: Record<string, unknown> = {}): ChoArgs => ({
  _: [],
  yes: false,
  y: false,
  "dry-run": false,
  ...given,
});

/** The code and the message of the error `read_flags` throws. */
function mistake_of(given: Record<string, unknown>) {
  try {
    read_flags(args(given));
  } catch (error) {
    assert.equal(isChoError(error), true);
    const { code, message } = error as { code: string; message: string };
    return { code, message };
  }
  return undefined;
}

describe("read_flags", () => {
  it("says nothing when the command line said nothing", () => {
    assert.deepEqual(read_flags(args()), {
      part: undefined,
      name: undefined,
      project: undefined,
      path: undefined,
      yes: false,
      dryRun: false,
    });
  });

  it("reads the part, the name, and every flag", () => {
    const flags = read_flags(args({
      _: ["service", "userStore"],
      project: "api",
      path: "apps/api/store",
      yes: true,
      y: true,
      "dry-run": true,
    }));
    assert.deepEqual(flags, {
      part: "service",
      name: "userStore",
      project: "api",
      path: "apps/api/store",
      yes: true,
      dryRun: true,
    });
    // the part alone: the name is asked
    assert.equal(read_flags(args({ _: ["module"] })).name, undefined);
  });

  it("refuses a part that is not one of the three: CHO_CLI_INVALID_OPTION", () => {
    assert.deepEqual(mistake_of({ _: ["users"] }), {
      code: "CHO_CLI_INVALID_OPTION",
      message: "The part users: not one of controller, service, module",
    });
  });

  it("refuses a name that is not valid: CHO_CLI_INVALID_NAME", () => {
    assert.deepEqual(mistake_of({ _: ["controller", "users.controller"] }), {
      code: "CHO_CLI_INVALID_NAME",
      message: 'The name "users.controller": Letters and digits, starting ' +
        "with a letter: users, userProfile or user-profile",
    });
  });

  it("refuses a third word, and a flag the command does not have", () => {
    assert.deepEqual(mistake_of({ _: ["controller", "users", "orders"] }), {
      code: "CHO_CLI_INVALID_OPTION",
      message: "cho generate takes a part and a name, and got 3 words: " +
        "controller users orders",
    });
    assert.deepEqual(mistake_of({ kind: "web" }), {
      code: "CHO_CLI_INVALID_OPTION",
      message: "--kind: cho generate has no such flag. See cho generate --help",
    });
  });

  it("refuses a path that is not a folder of the workspace", () => {
    for (const path of ["../api", "/apps/api", "apps/api/", "./apps", ""]) {
      assert.deepEqual(mistake_of({ path }), {
        code: "CHO_CLI_INVALID_OPTION",
        message: `--path ${JSON.stringify(path)}: A folder of the ` +
          "workspace, from its root, with /: apps/api/users",
      }, path);
    }
  });
});

describe("path_mistake", () => {
  it("says nothing of a folder of the workspace", () => {
    assert.equal(path_mistake("apps/api"), undefined);
    assert.equal(path_mistake("apps/api/users/http"), undefined);
  });
});
