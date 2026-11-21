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
import { GIT_INIT, INSTALL, run } from "./steps.ts";
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
