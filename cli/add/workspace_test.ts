/**
 * Tests for the workspace of `cho add`: finding it from a folder, on the
 * disk, and reading its files, in memory.
 */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isChoError } from "@chojs/command";
import { memory_host, new_workspace, with_folder } from "../new/testing.ts";
import { Tree } from "../tree.ts";
import { find_workspace, read_workspace } from "./workspace.ts";

/** The code and the message of the error of reading a workspace. */
function mistake_of(files: Record<string, string>) {
  try {
    read_workspace(new Tree(memory_host(files)));
  } catch (error) {
    assert.equal(isChoError(error), true);
    const { code, message } = error as { code: string; message: string };
    return { code, message };
  }
  return undefined;
}

describe("find_workspace", () => {
  it("is the folder that has a cho.json: the current one, or one above it", () =>
    with_folder(async (folder) => {
      const root = join(folder, "shop");
      const deep = join(root, "apps", "api", "src");
      await mkdir(deep, { recursive: true });
      await writeFile(join(root, "cho.json"), "{}\n");
      assert.equal(find_workspace(root), root);
      assert.equal(find_workspace(deep), root);
    }));

  it("is the nearest one, when a workspace is in another", () =>
    with_folder(async (folder) => {
      const inner = join(folder, "inner");
      await mkdir(inner);
      await writeFile(join(folder, "cho.json"), "{}\n");
      await writeFile(join(inner, "cho.json"), "{}\n");
      assert.equal(find_workspace(inner), inner);
    }));

  it("refuses a folder that is in no workspace: CHO_CLI_NO_WORKSPACE", () =>
    with_folder((folder) => {
      assert.throws(
        () => find_workspace(folder),
        (error) =>
          isChoError(error, "CHO_CLI_NO_WORKSPACE") &&
          error.message ===
            "There is no cho.json here, or in a folder above: this is " +
              "not a workspace. cho new creates one.",
      );
      return Promise.resolve();
    }));
});

describe("read_workspace", () => {
  it("reads the settings, and the name and the manifest of the workspace", () => {
    const workspace = read_workspace(new Tree(memory_host(new_workspace())));
    assert.equal(workspace.name, "shop");
    assert.equal(workspace.config.runtime, "deno");
    assert.deepEqual(Object.keys(workspace.config.projects), ["api"]);
    assert.deepEqual(workspace.manifest.workspaces, ["apps/*", "libs/*"]);
  });

  it("refuses a folder with no cho.json: CHO_CLI_NO_WORKSPACE", () => {
    assert.equal(mistake_of({})?.code, "CHO_CLI_NO_WORKSPACE");
  });

  it("refuses a cho.json that is not JSON, or not right: CHO_CLI_INVALID_CONFIG", () => {
    const files = new_workspace();
    const comment = mistake_of({ ...files, "cho.json": "// mine\n{}" });
    assert.equal(comment?.code, "CHO_CLI_INVALID_CONFIG");
    assert.match(comment!.message, /^cho\.json: not JSON: /);

    assert.deepEqual(mistake_of({ ...files, "cho.json": "[]" }), {
      code: "CHO_CLI_INVALID_CONFIG",
      message: "cho.json: must be an object",
    });
    assert.deepEqual(
      mistake_of({ ...files, "cho.json": '{"version":1,"projects":{}}' }),
      {
        code: "CHO_CLI_INVALID_CONFIG",
        message: 'cho.json: runtime: must be "deno", "node" or "bun"',
      },
    );
  });

  it("refuses a workspace with no package.json: CHO_CLI_INVALID_MANIFEST", () => {
    const { "package.json": _, ...files } = new_workspace();
    assert.deepEqual(mistake_of(files), {
      code: "CHO_CLI_INVALID_MANIFEST",
      message: "package.json: there is none at the root of the workspace.",
    });
    // what cho 3.7 created for Deno
    const old = mistake_of({ ...files, "deno.json": "{}\n" });
    assert.equal(old?.code, "CHO_CLI_INVALID_MANIFEST");
    assert.match(
      old!.message,
      /It has a deno\.json: it was made for Deno alone/,
    );
  });

  it("refuses a package.json that is not an object of JSON", () => {
    const files = new_workspace();
    for (const text of ["{", "[]", '"shop"']) {
      assert.equal(
        mistake_of({ ...files, "package.json": text })?.code,
        "CHO_CLI_INVALID_MANIFEST",
        text,
      );
    }
  });

  it("refuses a package.json whose name is not the name of a workspace", () => {
    const files = new_workspace();
    assert.deepEqual(
      mistake_of({ ...files, "package.json": '{"name":"@acme/shop"}' }),
      {
        code: "CHO_CLI_INVALID_MANIFEST",
        message: "package.json: name: not the name of a workspace. Lower " +
          "case letters, digits and -, starting with a letter",
      },
    );
    assert.deepEqual(mistake_of({ ...files, "package.json": "{}" }), {
      code: "CHO_CLI_INVALID_MANIFEST",
      message: "package.json: name: not the name of a workspace. It must " +
        "be a text",
    });
  });
});
