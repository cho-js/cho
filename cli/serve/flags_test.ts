/**
 * Tests for the flags of `cho serve`: the name of the project, its
 * arguments, and the flags of the command.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type ChoArgs, isChoError } from "@chojs/command";
import { read_flags } from "./flags.ts";

/**
 * What `@chojs/command` gives for a command line of `cho serve`: the words
 * that are not flags, together, and `watch` with its default.
 */
function parsed(argv: string[], given: Record<string, unknown> = {}) {
  const dashes = argv.indexOf("--");
  const words = argv.filter((word, at) =>
    word !== "--" && (dashes !== -1 && at > dashes || !word.startsWith("--"))
  );
  const args: ChoArgs = { _: words.slice(1), watch: true, ...given };
  return read_flags(args, argv);
}

describe("read_flags", () => {
  it("says nothing when the command line said nothing", () => {
    assert.deepEqual(parsed(["serve"]), {
      name: undefined,
      args: [],
      runtime: undefined,
      watch: true,
    });
  });

  it("reads the name, and the flags of the command", () => {
    assert.deepEqual(
      parsed(["serve", "api", "--runtime", "bun", "--no-watch"], {
        _: ["api"],
        runtime: "bun",
        watch: false,
      }),
      { name: "api", args: [], runtime: "bun", watch: false },
    );
  });

  it("gives the project the words after its name, and after --, as they are", () => {
    assert.deepEqual(
      parsed(["serve", "tool", "hello", "--", "--name", "Ada L", "--watch"]),
      {
        name: "tool",
        args: ["hello", "--name", "Ada L", "--watch"],
        runtime: undefined,
        watch: true,
      },
    );
    assert.deepEqual(parsed(["serve", "tool", "--", "007"]).args, ["007"]);
  });

  it("takes no name from the words after --", () => {
    const flags = parsed(["serve", "--", "hello", "world"]);
    assert.equal(flags.name, undefined);
    assert.deepEqual(flags.args, ["hello", "world"]);
    // `--` with nothing after it
    assert.deepEqual(parsed(["serve", "api", "--"]), {
      name: "api",
      args: [],
      runtime: undefined,
      watch: true,
    });
  });

  it("refuses a flag the command does not have, and says where it could go", () => {
    assert.throws(
      () =>
        parsed(["serve", "tool", "hello"], {
          _: ["tool", "hello"],
          name: "Ada",
        }),
      (error) =>
        isChoError(error, "CHO_CLI_INVALID_OPTION") &&
        error.message ===
          "--name: cho serve has no such flag. A flag of the project goes " +
            "after --. See cho serve --help",
    );
  });

  it("refuses a runtime that is not one of the three", () => {
    assert.throws(
      () => parsed(["serve", "api"], { _: ["api"], runtime: "pnpm" }),
      (error) =>
        isChoError(error, "CHO_CLI_INVALID_OPTION") &&
        error.message === "--runtime pnpm: not one of deno, node, bun",
    );
  });
});
