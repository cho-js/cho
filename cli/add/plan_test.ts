/**
 * Tests for the plan of `cho add`: what adding a project records on the tree
 * of a workspace. The workspace is in memory, and nothing is written.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isChoError } from "@chojs/command";
import {
  check_config,
  KINDS,
  type ProjectChoice,
  RUNTIMES,
} from "../new/config.ts";
import { memory_host, new_workspace } from "../new/testing.ts";
import { commit, Tree } from "../tree.ts";
import { plan_project } from "./plan.ts";
import { read_workspace } from "./workspace.ts";

const LIBRARY: ProjectChoice = { type: "library" };

/** Plan a project in a workspace in memory, and give the tree and the files. */
function plan(
  name: string,
  choice: ProjectChoice,
  files = new_workspace(),
) {
  const host = memory_host({ ...files });
  const tree = new Tree(host);
  const project = plan_project(
    tree,
    read_workspace(tree),
    { name, choice, install: false },
    "3.6.0",
  );
  return { tree, host, project, before: files };
}

/** The paths of the changes of a tree, with their kinds. */
const changed = (tree: Tree) =>
  tree.changes()
    .filter((change) => change.kind !== "folder")
    .map((change) => `${change.kind} ${change.path}`);

const json = (text: string | undefined) => JSON.parse(text ?? "null");

/** The code of what a function throws. */
function code_of(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return isChoError(error) ? error.code : error;
  }
  return undefined;
}

describe("plan_project", () => {
  it("plans a library: its files in the folder of the libraries, and cho.json", () => {
    const { tree, project, host, before } = plan("shared", LIBRARY);
    assert.deepEqual(project, {
      type: "library",
      root: "libs/shared",
      entry: "mod.ts",
    });
    // `libs/*` is in package.json from the first day: it is not changed
    assert.deepEqual(changed(tree), [
      "create libs/shared/package.json",
      "create libs/shared/tsconfig.json",
      "create libs/shared/mod.ts",
      "create libs/shared/mod_test.ts",
      "update cho.json",
    ]);
    assert.equal(
      json(tree.read("libs/shared/package.json")).name,
      "@shop/shared",
    );
    // nothing is written while it plans
    assert.deepEqual(host.files, before);
  });

  it("plans an application: the project of a new workspace, in the folder of the applications", () => {
    const { tree, project } = plan("admin", {
      type: "application",
      kind: "cli",
    });
    assert.deepEqual(project, {
      type: "application",
      kind: "cli",
      root: "apps/admin",
      entry: "main.ts",
      module: "app.ts",
    });
    assert.deepEqual(changed(tree), [
      "create apps/admin/package.json",
      "create apps/admin/tsconfig.json",
      "create apps/admin/app.ts",
      "create apps/admin/app_test.ts",
      "create apps/admin/main.ts",
      "update cho.json",
    ]);
    assert.deepEqual(json(tree.read("apps/admin/package.json")).dependencies, {
      "@chojs/command": "npm:@jsr/chojs__command@^3.6.0",
    });
    assert.match(tree.read("apps/admin/main.ts")!, /name: "admin"/);
  });

  it("adds the project to cho.json, after the others, and keeps the rest", () => {
    const { tree, before } = plan("shared", LIBRARY);
    const config = check_config(json(tree.read("cho.json")));
    assert.deepEqual(Object.keys(config.projects), ["api", "shared"]);
    assert.deepEqual(config.projects.shared, {
      type: "library",
      root: "libs/shared",
      entry: "mod.ts",
    });
    const { projects: _, ...rest } = config;
    const { projects: __, ...was } = json(before["cho.json"]);
    assert.deepEqual(rest, was);
    assert.deepEqual(
      config.projects.api,
      json(before["cho.json"]).projects.api,
    );
  });

  it("puts a project in the folder cho.json names for its type", () => {
    const files = new_workspace({ appsDir: "services" });
    const config = json(files["cho.json"]);
    files["cho.json"] = JSON.stringify({ ...config, libsDir: "packages" });

    const library = plan("shared", LIBRARY, files);
    assert.equal(library.project.root, "packages/shared");
    // no pattern of package.json has the folder: it is added
    assert.deepEqual(changed(library.tree).slice(-2), [
      "update cho.json",
      "update package.json",
    ]);
    assert.deepEqual(json(library.tree.read("package.json")), {
      name: "shop",
      private: true,
      type: "module",
      workspaces: ["services/*", "libs/*", "packages/*"],
    });

    const application = plan(
      "admin",
      { type: "application", kind: "web" },
      files,
    );
    assert.equal(application.project.root, "services/admin");
    assert.equal(application.tree.read("package.json"), files["package.json"]);
  });

  it("works in a workspace of Node.js or of Bun that cho 3.7 made", () => {
    // no libsDir, no type, and `apps/*` alone
    const files = {
      "cho.json": JSON.stringify({
        version: 1,
        runtime: "bun",
        appsDir: "apps",
        projects: { api: { kind: "web", root: "apps/api" } },
      }),
      "package.json": JSON.stringify({
        name: "shop",
        private: true,
        type: "module",
        workspaces: ["apps/*"],
      }),
      "apps/api/main.ts": "",
    };
    const { tree } = plan("shared", LIBRARY, files);
    assert.deepEqual(json(tree.read("package.json")).workspaces, [
      "apps/*",
      "libs/*",
    ]);
    const config = check_config(json(tree.read("cho.json")));
    assert.deepEqual(config.projects.api, { kind: "web", root: "apps/api" });
    assert.equal(config.projects.shared?.root, "libs/shared");
  });

  for (const runtime of RUNTIMES) {
    it(`plans the same files on ${runtime}: a workspace does not depend on its runtime`, () => {
      const on = (choice: ProjectChoice) =>
        plan("more", choice, new_workspace({ runtime })).tree.changes()
          .filter((change) => change.path !== "cho.json");
      const deno = (choice: ProjectChoice) =>
        plan("more", choice).tree.changes()
          .filter((change) => change.path !== "cho.json");
      assert.deepEqual(on(LIBRARY), deno(LIBRARY));
      for (const kind of KINDS) {
        const choice: ProjectChoice = { type: "application", kind };
        assert.deepEqual(on(choice), deno(choice));
      }
    });
  }

  it("refuses a name that is taken, and records nothing", () => {
    const host = memory_host({
      ...new_workspace(),
      "libs/taken/notes.txt": "mine\n",
    });
    const tree = new Tree(host);
    const workspace = read_workspace(tree);
    const add = (name: string) =>
      plan_project(
        tree,
        workspace,
        { name, choice: LIBRARY, install: false },
        "3.6.0",
      );
    assert.equal(code_of(() => add("api")), "CHO_CLI_PROJECT_EXISTS");
    assert.equal(code_of(() => add("taken")), "CHO_CLI_TARGET_EXISTS");
    assert.deepEqual(tree.changes(), []);
  });

  it("refuses a package.json whose workspaces is not a list: CHO_CLI_INVALID_MANIFEST", () => {
    const files = new_workspace();
    files["package.json"] = JSON.stringify({ name: "shop" });
    assert.equal(
      code_of(() => plan("shared", LIBRARY, files)),
      "CHO_CLI_INVALID_MANIFEST",
    );
  });

  it("commits to a workspace that is whole: a second project is planned on it", async () => {
    const first = plan("shared", LIBRARY);
    await commit(first.tree);
    const second = plan("admin", { type: "application", kind: "web" }, {
      ...first.host.files,
    });
    await commit(second.tree);
    const config = check_config(json(second.host.files["cho.json"]));
    assert.deepEqual(Object.keys(config.projects), ["api", "shared", "admin"]);
    for (const project of Object.values(config.projects)) {
      const entry = project.entry ?? "main.ts";
      assert.ok(`${project.root}/${entry}` in second.host.files);
    }
  });
});
