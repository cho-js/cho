/**
 * Tests for the manifests: the one of a workspace, and what adding a project
 * changes in it. The manifests of a project are tested with the plan
 * (`plan_test.ts`).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isChoError } from "@chojs/command";
import {
  json_text,
  package_name,
  with_member,
  workspace_manifest,
} from "./manifests.ts";

describe("workspace_manifest", () => {
  it("names the folders of the projects, each once", () => {
    assert.deepEqual(workspace_manifest("shop", ["apps", "libs"]), {
      name: "shop",
      private: true,
      type: "module",
      workspaces: ["apps/*", "libs/*"],
    });
    assert.deepEqual(
      (workspace_manifest("shop", ["libs", "libs"]) as { workspaces: string[] })
        .workspaces,
      ["libs/*"],
    );
  });
});

describe("package_name", () => {
  it("is the name of the project, in the scope of the workspace", () => {
    assert.equal(package_name("shop", "shared"), "@shop/shared");
  });
});

describe("json_text", () => {
  it("is JSON with two spaces, and a last line that ends", () => {
    assert.equal(json_text({ a: [1] }), '{\n  "a": [\n    1\n  ]\n}\n');
  });
});

describe("with_member", () => {
  const manifest = (workspaces: unknown) => ({ name: "shop", workspaces });

  it("changes nothing when a pattern has the project already", () => {
    const covered = [
      ["apps/*", "libs/*"],
      ["./libs/*"],
      ["libs/shared"],
      ["./libs/shared"],
    ];
    for (const workspaces of covered) {
      assert.equal(
        with_member(manifest(workspaces), "libs/shared"),
        undefined,
        workspaces.join(" "),
      );
    }
  });

  it("adds the folder of the project, after the others, and keeps the rest", () => {
    const before = { ...manifest(["apps/*"]), private: true };
    assert.deepEqual(with_member(before, "libs/shared"), {
      name: "shop",
      workspaces: ["apps/*", "libs/*"],
      private: true,
    });
    // what was read is not changed
    assert.deepEqual(before.workspaces, ["apps/*"]);
    // another project of the folder is not this one
    assert.deepEqual(
      with_member(manifest(["libs/other"]), "libs/shared")?.workspaces,
      ["libs/other", "libs/*"],
    );
  });

  it("refuses workspaces that are not a list of folders: CHO_CLI_INVALID_MANIFEST", () => {
    for (const workspaces of [undefined, "apps/*", { packages: [] }, [1]]) {
      assert.throws(
        () => with_member(manifest(workspaces), "libs/shared"),
        (error) =>
          isChoError(error, "CHO_CLI_INVALID_MANIFEST") &&
          error.message.startsWith("package.json: workspaces: must be a list"),
      );
    }
  });
});
