/**
 * Tests for the flags of `cho new`: what a command line said, and the
 * mistakes that are found before any question.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type ChoArgs, isChoError } from "@chojs/command";
import { read_flags } from "./flags.ts";

/**
 * A parsed command line, as `@chojs/command` gives it for the flags of `new`:
 * the booleans are always there, with their default.
 */
const args = (given: Record<string, unknown> = {}): ChoArgs => ({
  _: [],
  yes: false,
  y: false,
  git: true,
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
      kind: undefined,
      runtime: undefined,
      project: undefined,
      appsDir: undefined,
      git: true,
      install: true,
      yes: false,
      dryRun: false,
    });
  });

  it("reads the name, and every flag", () => {
    const flags = read_flags(args({
      _: ["shop"],
      kind: "cli",
      runtime: "bun",
      project: "tool",
      "apps-dir": "packages",
      git: false,
      install: false,
      yes: true,
      y: true,
      "dry-run": true,
    }));
    assert.deepEqual(flags, {
      name: "shop",
      kind: "cli",
      runtime: "bun",
      project: "tool",
      appsDir: "packages",
      git: false,
      install: false,
      yes: true,
      dryRun: true,
    });
  });

  it("refuses a flag the command does not have: CHO_CLI_INVALID_OPTION", () => {
    assert.deepEqual(mistake_of({ kindd: "web" }), {
      code: "CHO_CLI_INVALID_OPTION",
      message: "--kindd: cho new has no such flag. See cho new --help",
    });
  });

  it("refuses a value that is not one of the choices of its flag", () => {
    assert.deepEqual(mistake_of({ kind: "message" }), {
      code: "CHO_CLI_INVALID_OPTION",
      message: "--kind message: not one of web, cli",
    });
    assert.deepEqual(mistake_of({ runtime: "pnpm" }), {
      code: "CHO_CLI_INVALID_OPTION",
      message: "--runtime pnpm: not one of deno, node, bun",
    });
    // `--kind`, with no value
    assert.equal(mistake_of({ kind: "" })?.code, "CHO_CLI_INVALID_OPTION");
  });

  it("refuses a second name", () => {
    assert.deepEqual(mistake_of({ _: ["shop", "extra"] }), {
      code: "CHO_CLI_INVALID_OPTION",
      message: "cho new takes one name, and got 2: shop extra",
    });
  });

  it("refuses a name that is not valid: CHO_CLI_INVALID_NAME", () => {
    assert.deepEqual(mistake_of({ _: ["My-Shop"] }), {
      code: "CHO_CLI_INVALID_NAME",
      message: 'The name of the workspace "My-Shop": Lower case letters, ' +
        "digits and -, starting with a letter",
    });
    // a name, not a path
    assert.equal(mistake_of({ _: ["a/b"] })?.code, "CHO_CLI_INVALID_NAME");
    assert.deepEqual(mistake_of({ project: "nul" }), {
      code: "CHO_CLI_INVALID_NAME",
      message: '--project "nul": Windows keeps the name "nul" for a device',
    });
    assert.deepEqual(mistake_of({ "apps-dir": "../apps" }), {
      code: "CHO_CLI_INVALID_NAME",
      message: '--apps-dir "../apps": Lower case letters, digits and -, ' +
        "starting with a letter",
    });
    assert.deepEqual(mistake_of({ project: "" }), {
      code: "CHO_CLI_INVALID_NAME",
      message: '--project "": A name is needed',
    });
  });
});
