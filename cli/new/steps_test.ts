/**
 * Tests for the steps: `run` runs real programs, in a temporary folder.
 *
 * The installation is not run here: it downloads packages. It is a command
 * like the others, and `tools/pty.sh` and the release are where it is seen.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { capture } from "@chojs/core/utils/test_utils";
import { isChoError } from "@chojs/command";
import {
  GIT_INIT,
  INSTALL,
  print_dry_run,
  run,
  run_program,
  run_steps,
} from "./steps.ts";
import { with_folder } from "./testing.ts";

describe("run", () => {
  it("is true for a program that succeeds, in the folder it is given", () =>
    with_folder(async (folder) => {
      // git is on the machine of whoever works on this repository
      assert.equal(await run(GIT_INIT, folder), true);
      assert.equal(existsSync(join(folder, ".git")), true);
    }));

  it("is false for a program that fails", () =>
    with_folder(async (folder) => {
      // `false` does nothing, and fails
      assert.equal(await run("false", folder), false);
    }));

  it("is false for a program that is not installed, and throws nothing", () =>
    with_folder(async (folder) => {
      assert.equal(await run("cho-no-such-program --version", folder), false);
    }));
});

describe("run_steps", () => {
  it("runs each step under a line that names it, and gives the ones that failed", () =>
    with_folder(async (folder) => {
      const { result, output } = await capture(() =>
        run_steps(["false", GIT_INIT, "cho-no-such-program"], folder)
      );
      // a step that fails does not stop the next one
      assert.deepEqual(result, ["false", "cho-no-such-program"]);
      assert.deepEqual(output.log, [
        "Running false",
        `Running ${GIT_INIT}`,
        "Running cho-no-such-program",
      ]);
      assert.equal(existsSync(join(folder, ".git")), true);
    }));
});

describe("run_program", () => {
  it("gives the exit code of the program", () =>
    with_folder(async (folder) => {
      assert.equal(await run_program("sh", ["-c", "exit 0"], folder), 0);
      assert.equal(await run_program("sh", ["-c", "exit 3"], folder), 3);
    }));

  it("runs it in the folder, with each argument as it is", () =>
    with_folder(async (folder) => {
      // `$1` is one argument, with its space, and `$2` is not a flag of sh
      const script = 'test "$1" = "a b" && test "$2" = "--watch" && ' +
        "touch here.txt";
      assert.equal(
        await run_program("sh", ["-c", script, "sh", "a b", "--watch"], folder),
        0,
      );
      assert.equal(existsSync(join(folder, "here.txt")), true);
    }));

  it("gives 128 and the number of the signal that ended the program", () =>
    with_folder(async (folder) => {
      // the shell ends itself, as Ctrl+C would end it
      assert.equal(
        await run_program("sh", ["-c", "kill -INT $$"], folder),
        130,
      );
    }));

  it("rejects for a program that is not installed: CHO_CLI_NOT_STARTED", () =>
    with_folder(async (folder) => {
      await assert.rejects(
        run_program("cho-no-such-program", ["--version"], folder),
        (error) =>
          isChoError(error, "CHO_CLI_NOT_STARTED") &&
          error.message.startsWith("Could not start cho-no-such-program: ") &&
          error.message.endsWith("Is it installed?"),
      );
    }));
});

describe("print_dry_run", () => {
  it("prints the files that would be written, and the steps that would run", async () => {
    const { output } = await capture(() =>
      print_dry_run([
        { kind: "folder", path: "libs" },
        { kind: "create", path: "libs/mod.ts", text: "" },
        { kind: "update", path: "cho.json", text: "" },
      ], ["npm install"])
    );
    assert.deepEqual(output.log, [
      "Dry run: nothing is written, and nothing is run.",
      "\n  create  libs/mod.ts\n  update  cho.json\n",
      "Would run npm install",
    ]);
  });
});

describe("the commands of the steps", () => {
  it("install with the program of each runtime", () => {
    assert.deepEqual(INSTALL, {
      deno: "deno install",
      node: "npm install",
      bun: "bun install",
    });
  });

  it("make a repository, and no commit", () => {
    assert.equal(GIT_INIT, "git init --quiet");
  });
});
