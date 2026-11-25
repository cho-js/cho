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
import { GIT_INIT, INSTALL, print_dry_run, run, run_steps } from "./steps.ts";
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
