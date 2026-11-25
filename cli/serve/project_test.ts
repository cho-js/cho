/**
 * Tests for the project `cho serve` runs: which one it is, and the checks
 * before it runs. The workspace is in memory.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isChoError } from "@chojs/command";
import type { ChoConfig } from "../new/config.ts";
import { memory_host } from "../new/testing.ts";
import { Tree } from "../tree.ts";
import { check_ready, pick_project } from "./project.ts";

/** A workspace with a web application, a tool, and a library. */
const config: ChoConfig = {
  version: 1,
  runtime: "deno",
  projects: {
    api: { kind: "web", root: "apps/api" },
    tool: { type: "application", kind: "cli", root: "apps/tool" },
    shared: { type: "library", root: "libs/shared" },
  },
};

/** The same, with one application. */
const one: ChoConfig = {
  ...config,
  projects: { api: config.projects.api!, shared: config.projects.shared! },
};

/** The code and the message of what a function throws. */
function mistake_of(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    assert.equal(isChoError(error), true);
    const { code, message } = error as { code: string; message: string };
    return { code, message };
  }
  return undefined;
}

describe("pick_project", () => {
  it("is the project that is named, from any folder", () => {
    for (const inside of ["", "apps/api", "libs/shared/src"]) {
      assert.deepEqual(pick_project(config, "tool", inside, "deno"), {
        name: "tool",
        project: config.projects.tool,
      });
    }
  });

  it("is the project the current folder is in, when none is named", () => {
    assert.equal(
      pick_project(config, undefined, "apps/api", "deno").name,
      "api",
    );
    assert.equal(
      pick_project(config, undefined, "apps/tool/src/deep", "deno").name,
      "tool",
    );
    // a folder that starts like a project is not in it
    assert.equal(
      mistake_of(() => pick_project(config, undefined, "apps/api-old", "deno"))
        ?.code,
      "CHO_CLI_UNKNOWN_PROJECT",
    );
  });

  it("is the deepest project, when one is in the folder of another", () => {
    const nested: ChoConfig = {
      ...config,
      projects: {
        outer: { kind: "web", root: "apps" },
        inner: { kind: "cli", root: "apps/inner" },
      },
    };
    assert.equal(
      pick_project(nested, undefined, "apps/inner/src", "deno").name,
      "inner",
    );
    assert.equal(
      pick_project(nested, undefined, "apps/x", "deno").name,
      "outer",
    );
  });

  it("is the application of the workspace, when it has one only", () => {
    assert.equal(pick_project(one, undefined, "", "deno").name, "api");
    assert.equal(pick_project(one, undefined, "docs", "deno").name, "api");
  });

  it("asks for a name when nothing says which: CHO_CLI_UNKNOWN_PROJECT", () => {
    assert.deepEqual(
      mistake_of(() => pick_project(config, undefined, "", "deno")),
      {
        code: "CHO_CLI_UNKNOWN_PROJECT",
        message: "Which project? Name one: cho serve <project>. The " +
          "applications of the workspace: api, tool",
      },
    );
    const empty: ChoConfig = { ...config, projects: {} };
    assert.match(
      mistake_of(() => pick_project(empty, undefined, "", "deno"))!.message,
      /The applications of the workspace: none$/,
    );
  });

  it("refuses a name that is not a project: CHO_CLI_UNKNOWN_PROJECT", () => {
    assert.deepEqual(
      mistake_of(() => pick_project(config, "web", "", "deno")),
      {
        code: "CHO_CLI_UNKNOWN_PROJECT",
        message: "The workspace has no project named web. Its projects: api, " +
          "tool, shared",
      },
    );
  });

  it("refuses a library, and gives the command of its tests: CHO_CLI_NOT_AN_APPLICATION", () => {
    assert.deepEqual(
      mistake_of(() => pick_project(config, "shared", "", "bun")),
      {
        code: "CHO_CLI_NOT_AN_APPLICATION",
        message: "shared is a library: it does not run. Its tests do, in " +
          "libs/shared: bun test",
      },
    );
    // from its folder too
    assert.equal(
      mistake_of(() => pick_project(config, undefined, "libs/shared", "deno"))
        ?.code,
      "CHO_CLI_NOT_AN_APPLICATION",
    );
  });
});

describe("check_ready", () => {
  const api = {
    name: "api",
    project: { kind: "web", root: "apps/api" },
  } as const;
  const installed = {
    "package.json": "{}",
    "apps/api/main.ts": "",
    "node_modules/.package-lock.json": "{}",
  };
  const tree = (files: Record<string, string>) => new Tree(memory_host(files));

  it("says nothing of a project that can run", () => {
    assert.equal(
      mistake_of(() => check_ready(tree(installed), api, "deno")),
      undefined,
    );
  });

  it("refuses an entry that is not a file: CHO_CLI_INVALID_CONFIG", () => {
    const { "apps/api/main.ts": _, ...files } = installed;
    assert.deepEqual(mistake_of(() => check_ready(tree(files), api, "deno")), {
      code: "CHO_CLI_INVALID_CONFIG",
      message:
        "cho.json: projects.api.entry: there is no file apps/api/main.ts",
    });
    // the entry cho.json names
    const server = { ...api, project: { ...api.project, entry: "server.ts" } };
    assert.match(
      mistake_of(() => check_ready(tree(installed), server, "deno"))!.message,
      /there is no file apps\/api\/server\.ts$/,
    );
  });

  it("refuses a workspace whose packages are not installed: CHO_CLI_NOT_INSTALLED", () => {
    const { "node_modules/.package-lock.json": _, ...files } = installed;
    assert.deepEqual(mistake_of(() => check_ready(tree(files), api, "bun")), {
      code: "CHO_CLI_NOT_INSTALLED",
      message: "The packages of the workspace are not installed. Run bun " +
        "install at its root, then cho serve again.",
    });
  });

  it("does not look for node_modules in a workspace with no package.json", () => {
    // what cho 3.7 created for Deno: the packages are those of JSR
    const files = { "deno.json": "{}", "apps/api/main.ts": "" };
    assert.equal(
      mistake_of(() => check_ready(tree(files), api, "deno")),
      undefined,
    );
  });
});
