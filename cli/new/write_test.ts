/**
 * Tests for the writing of a workspace, in a temporary folder of the disk.
 */

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isChoError } from "@chojs/command";
import { files_of, with_folder } from "./testing.ts";
import { write_workspace } from "./write.ts";

const FILES = [
  { path: "cho.json", text: "{}\n" },
  { path: ".gitignore", text: "node_modules/\n" },
  { path: "apps/api/main.ts", text: "console.log(1);\n" },
  { path: "apps/api/app.ts", text: "export {};\n" },
];

/** The code of what a function rejects with. */
async function code_of(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return isChoError(error) ? error.code : error;
  }
  return undefined;
}

describe("write_workspace", () => {
  it("creates the folder, and writes every file, in its folders", () =>
    with_folder(async (folder) => {
      const target = join(folder, "shop");
      await write_workspace(target, FILES);
      assert.deepEqual(await files_of(target), [
        ".gitignore",
        "apps/api/app.ts",
        "apps/api/main.ts",
        "cho.json",
      ]);
      assert.equal(
        await readFile(join(target, "apps", "api", "main.ts"), "utf8"),
        "console.log(1);\n",
      );
    }));

  it("refuses a folder that exists, and touches nothing: CHO_CLI_TARGET_EXISTS", () =>
    with_folder(async (folder) => {
      const target = join(folder, "shop");
      await mkdir(target);
      await writeFile(join(target, "mine.txt"), "kept");

      assert.equal(
        await code_of(() => write_workspace(target, FILES)),
        "CHO_CLI_TARGET_EXISTS",
      );
      assert.deepEqual(await files_of(target), ["mine.txt"]);
    }));

  it("refuses an empty folder, and a file of that name", () =>
    with_folder(async (folder) => {
      await mkdir(join(folder, "empty"));
      await writeFile(join(folder, "file"), "kept");
      for (const name of ["empty", "file"]) {
        assert.equal(
          await code_of(() => write_workspace(join(folder, name), FILES)),
          "CHO_CLI_TARGET_EXISTS",
        );
      }
      assert.deepEqual(await files_of(folder), ["file"]);
    }));

  it("removes the folder when a file cannot be written: CHO_CLI_WRITE_FAILED", () =>
    with_folder(async (folder) => {
      const target = join(folder, "shop");
      // `apps` is a file, so `apps/api/main.ts` has no folder to be in
      const files = [
        { path: "cho.json", text: "{}\n" },
        { path: "apps", text: "a file" },
        { path: "apps/api/main.ts", text: "" },
      ];
      let error: unknown;
      try {
        await write_workspace(target, files);
      } catch (thrown) {
        error = thrown;
      }
      assert.equal(isChoError(error, "CHO_CLI_WRITE_FAILED"), true);
      assert.match((error as Error).message, /^Could not write .*main\.ts: /);
      assert.match((error as Error).message, /was removed\.$/);
      // the cause is the error of the system
      assert.ok((error as Error).cause instanceof Error);
      assert.deepEqual(await files_of(folder), []);
    }));

  it("says so when the folder cannot be created: CHO_CLI_WRITE_FAILED", () =>
    with_folder(async (folder) => {
      // its parent does not exist
      const target = join(folder, "missing", "shop");
      assert.equal(
        await code_of(() => write_workspace(target, FILES)),
        "CHO_CLI_WRITE_FAILED",
      );
      assert.deepEqual(await files_of(folder), []);
    }));
});
