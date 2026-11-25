/**
 * Tests for the tree: what it records, on a folder in memory, and what
 * `commit` writes and undoes, in a temporary folder of the disk.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isChoError } from "@chojs/command";
import { files_of, memory_host, with_folder } from "./new/testing.ts";
import { commit, disk_host, list_changes, Tree } from "./tree.ts";

/** The code of what a function throws, or rejects with. */
async function code_of(fn: () => unknown): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return isChoError(error) ? error.code : error;
  }
  return undefined;
}

/** What a function rejects with: an error. */
async function error_of(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (error) {
    assert.ok(error instanceof Error);
    return error;
  }
  throw new Error("nothing was thrown");
}

/** A workspace with one file at its root, and one in a folder. */
const workspace = () =>
  memory_host({ "cho.json": "{}\n", "apps/api/main.ts": "old\n" });

describe("Tree", () => {
  it("reads through to the folder, and writes nothing in it", () => {
    const host = workspace();
    const tree = new Tree(host);
    assert.equal(tree.read("cho.json"), "{}\n");
    assert.equal(tree.read("none.json"), undefined);
    // a folder is not a file
    assert.equal(tree.read("apps"), undefined);
    assert.deepEqual(
      ["cho.json", "apps", "apps/api", "libs"].map((path) => tree.exists(path)),
      [true, true, true, false],
    );

    tree.create("libs/shared/mod.ts", "new\n");
    tree.update("cho.json", "{ }\n");
    assert.deepEqual(host.files, {
      "cho.json": "{}\n",
      "apps/api/main.ts": "old\n",
    });
  });

  it("gives back what was recorded: a file, its text, and its folders", () => {
    const tree = new Tree(workspace());
    tree.create("libs/shared/mod.ts", "new\n");
    tree.update("cho.json", "{ }\n");
    assert.equal(tree.read("libs/shared/mod.ts"), "new\n");
    assert.equal(tree.read("cho.json"), "{ }\n");
    assert.deepEqual(
      ["libs", "libs/shared", "libs/shared/mod.ts", "libs/other"].map((path) =>
        tree.exists(path)
      ),
      [true, true, true, false],
    );
  });

  it("records each folder that does not exist, once, before its file", () => {
    const tree = new Tree(workspace());
    tree.create("libs/shared/mod.ts", "a");
    tree.create("libs/shared/mod_test.ts", "b");
    tree.create("apps/admin/main.ts", "c");
    tree.create("top.txt", "d");
    assert.deepEqual(tree.changes(), [
      { kind: "folder", path: "libs" },
      { kind: "folder", path: "libs/shared" },
      { kind: "create", path: "libs/shared/mod.ts", text: "a" },
      { kind: "create", path: "libs/shared/mod_test.ts", text: "b" },
      // `apps` exists
      { kind: "folder", path: "apps/admin" },
      { kind: "create", path: "apps/admin/main.ts", text: "c" },
      { kind: "create", path: "top.txt", text: "d" },
    ]);
  });

  it("refuses to create what exists: CHO_CLI_TARGET_EXISTS", async () => {
    const tree = new Tree(workspace());
    tree.create("libs/shared/mod.ts", "new\n");
    const taken = [
      "cho.json", // a file of the folder
      "apps", // a folder of the folder
      "libs/shared/mod.ts", // a file that was recorded
      "libs/shared", // a folder that was recorded
    ];
    for (const path of taken) {
      assert.equal(
        await code_of(() => tree.create(path, "")),
        "CHO_CLI_TARGET_EXISTS",
        path,
      );
    }
    // nothing more was recorded
    assert.equal(tree.changes().length, 3);
  });

  it("refuses to update what is not a file: CHO_CLI_WRITE_FAILED", async () => {
    const tree = new Tree(workspace());
    for (const path of ["none.json", "apps"]) {
      assert.equal(
        await code_of(() => tree.update(path, "")),
        "CHO_CLI_WRITE_FAILED",
        path,
      );
    }
    assert.deepEqual(tree.changes(), []);
  });

  it("changes a file once: a second text takes the place of the first", () => {
    const tree = new Tree(workspace());
    tree.update("cho.json", "first\n");
    tree.update("cho.json", "second\n");
    tree.create("new.txt", "first\n");
    tree.update("new.txt", "second\n");
    assert.deepEqual(tree.changes(), [
      { kind: "update", path: "cho.json", text: "second\n" },
      // still a file to create
      { kind: "create", path: "new.txt", text: "second\n" },
    ]);
  });

  it("gives a copy of its changes", () => {
    const tree = new Tree(workspace());
    tree.create("new.txt", "text\n");
    const [change] = tree.changes();
    Object.assign(change!, { path: "other.txt" });
    assert.equal(tree.changes()[0]?.path, "new.txt");
  });
});

describe("list_changes", () => {
  it("lists the files, each on its line, and no folder", () => {
    const tree = new Tree(workspace());
    tree.create("libs/shared/mod.ts", "new\n");
    tree.update("cho.json", "{ }\n");
    assert.equal(
      list_changes(tree.changes()),
      "  create  libs/shared/mod.ts\n  update  cho.json",
    );
  });
});

describe("commit", () => {
  it("writes the changes of a tree in memory", async () => {
    const host = workspace();
    const tree = new Tree(host);
    tree.create("libs/shared/mod.ts", "new\n");
    tree.update("cho.json", "{ }\n");
    await commit(tree);
    assert.deepEqual(host.files, {
      "cho.json": "{ }\n",
      "apps/api/main.ts": "old\n",
      "libs/shared/mod.ts": "new\n",
    });
  });

  it("writes the changes in a folder of the disk, in its folders", () =>
    with_folder(async (folder) => {
      await writeFile(join(folder, "cho.json"), "{}\n");
      const tree = new Tree(disk_host(folder));
      assert.equal(tree.read("cho.json"), "{}\n");
      assert.equal(tree.read("none.json"), undefined);
      tree.create("libs/shared/mod.ts", "new\n");
      tree.create(".gitignore", "node_modules/\n");
      tree.update("cho.json", "{ }\n");
      await commit(tree);

      assert.deepEqual(await files_of(folder), [
        ".gitignore",
        "cho.json",
        "libs/shared/mod.ts",
      ]);
      const read = (...path: string[]) =>
        readFile(join(folder, ...path), "utf8");
      assert.equal(await read("libs", "shared", "mod.ts"), "new\n");
      assert.equal(await read("cho.json"), "{ }\n");
    }));

  it("refuses a folder that appeared since it was recorded: CHO_CLI_TARGET_EXISTS", () =>
    with_folder(async (folder) => {
      await writeFile(join(folder, "cho.json"), "{}\n");
      const tree = new Tree(disk_host(folder));
      tree.update("cho.json", "{ }\n");
      tree.create("libs/shared/mod.ts", "new\n");
      // someone makes the folder, with a file, before the commit
      await mkdir(join(folder, "libs"));
      await writeFile(join(folder, "libs", "mine.txt"), "kept");

      const error = await error_of(() => commit(tree));
      assert.equal(isChoError(error, "CHO_CLI_TARGET_EXISTS"), true);
      assert.equal(error.message, "libs exists already. Nothing was written.");
      // the update that was written before it is undone
      assert.deepEqual(await files_of(folder), ["cho.json", "libs/mine.txt"]);
      assert.equal(await readFile(join(folder, "cho.json"), "utf8"), "{}\n");
    }));

  it("never replaces, and never removes, a file that appeared", () =>
    with_folder(async (folder) => {
      const tree = new Tree(disk_host(folder));
      tree.create("first.txt", "first\n");
      tree.create("second.txt", "second\n");
      await writeFile(join(folder, "second.txt"), "mine");

      assert.equal(await code_of(() => commit(tree)), "CHO_CLI_TARGET_EXISTS");
      assert.deepEqual(await files_of(folder), ["second.txt"]);
      assert.equal(await readFile(join(folder, "second.txt"), "utf8"), "mine");
    }));

  it("undoes every change when one fails: CHO_CLI_WRITE_FAILED", () =>
    with_folder(async (folder) => {
      await writeFile(join(folder, "cho.json"), "{}\n");
      await mkdir(join(folder, "apps"));
      const tree = new Tree(disk_host(folder));
      tree.update("cho.json", "{ }\n");
      tree.create("libs/shared/mod.ts", "new\n");
      tree.create("libs/shared/mod_test.ts", "new\n");
      tree.create("apps/api/main.ts", "new\n");
      // `apps` becomes a file: `apps/api` has no folder to be in
      await rm(join(folder, "apps"), { recursive: true });
      await writeFile(join(folder, "apps"), "a file");

      const error = await error_of(() => commit(tree));
      assert.equal(isChoError(error, "CHO_CLI_WRITE_FAILED"), true);
      assert.match(error.message, /^Could not write apps\/api: /);
      assert.match(error.message, /Nothing was written\.$/);
      // the cause is the error of the system
      assert.ok(error.cause instanceof Error);
      // the files, the folders and the update are gone
      assert.deepEqual(await files_of(folder), ["apps", "cho.json"]);
      assert.equal(existsSync(join(folder, "libs")), false);
      assert.equal(await readFile(join(folder, "cho.json"), "utf8"), "{}\n");
    }));

  it("says so when the root is not there: CHO_CLI_WRITE_FAILED", () =>
    with_folder(async (folder) => {
      const tree = new Tree(disk_host(join(folder, "gone")));
      tree.create("shop/cho.json", "{}\n");
      assert.equal(await code_of(() => commit(tree)), "CHO_CLI_WRITE_FAILED");
      assert.deepEqual(await files_of(folder), []);
    }));
});
