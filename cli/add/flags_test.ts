/**
 * Tests for the flags of `cho add`: what a command line said, and the
 * mistakes that are found before any question.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type ChoArgs, isChoError } from "@chojs/command";
import { read_flags } from "./flags.ts";

/**
 * A parsed command line, as `@chojs/command` gives it for the flags of `add`:
 * the booleans are always there, with their default.
 */
const args = (given: Record<string, unknown> = {}): ChoArgs => ({
  _: [],
  yes: false,
  y: false,
  install: true,
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
      name: undefined,
      type: undefined,
      kind: undefined,
      install: true,
      yes: false,
      dryRun: false,
    });
  });

  it("reads the name, and every flag", () => {
    const flags = read_flags(args({
      _: ["shared"],
      type: "library",
      install: false,
      yes: true,
      y: true,
      "dry-run": true,
    }));
    assert.deepEqual(flags, {
      name: "shared",
      type: "library",
      kind: undefined,
      install: false,
      yes: true,
      dryRun: true,
    });
  });

  it("takes a kind as an application: only an application has one", () => {
    const flags = read_flags(args({ kind: "cli" }));
    assert.deepEqual([flags.type, flags.kind], ["application", "cli"]);
    const both = read_flags(args({ type: "application", kind: "web" }));
    assert.deepEqual([both.type, both.kind], ["application", "web"]);
  });

  it("refuses a kind for a library: CHO_CLI_INVALID_OPTION", () => {
    assert.deepEqual(mistake_of({ type: "library", kind: "web" }), {
      code: "CHO_CLI_INVALID_OPTION",
      message: "--kind web: a library has no kind. It is plain TypeScript",
    });
  });

  it("refuses a flag the command does not have, and a second name", () => {
    assert.deepEqual(mistake_of({ runtime: "bun" }), {
      code: "CHO_CLI_INVALID_OPTION",
      message: "--runtime: cho add has no such flag. See cho add --help",
    });
    assert.deepEqual(mistake_of({ _: ["shared", "extra"] }), {
      code: "CHO_CLI_INVALID_OPTION",
      message: "cho add takes one name, and got 2: shared extra",
    });
  });

  it("refuses a value that is not one of the choices of its flag", () => {
    assert.deepEqual(mistake_of({ type: "lib" }), {
      code: "CHO_CLI_INVALID_OPTION",
      message: "--type lib: not one of application, library",
    });
    assert.deepEqual(mistake_of({ kind: "message" }), {
      code: "CHO_CLI_INVALID_OPTION",
      message: "--kind message: not one of web, cli",
    });
  });

  it("refuses a name that is not valid: CHO_CLI_INVALID_NAME", () => {
    assert.deepEqual(mistake_of({ _: ["libs/shared"] }), {
      code: "CHO_CLI_INVALID_NAME",
      message: 'The name of the project "libs/shared": Lower case letters, ' +
        "digits and -, starting with a letter",
    });
  });
});
