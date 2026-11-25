/**
 * Tests for the answers of `cho generate`: the questions that are asked for
 * what the command line did not say. A scripted terminal answers them, with
 * keys, and the workspace is in memory.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isChoError } from "@chojs/command";
import { createPrompts } from "@chojs/prompt";
import { type ScriptedKey, scriptedTerminal } from "@chojs/prompt/testing";
import type { ChoConfig } from "../new/config.ts";
import { memory_host } from "../new/testing.ts";
import { Tree } from "../tree.ts";
import { application_of, ask_answers, folder_mistake } from "./answers.ts";
import type { Flags } from "./flags.ts";

/** A workspace with a web application, a tool, and a library. */
const config: ChoConfig = {
  version: 1,
  runtime: "deno",
  projects: {
    api: { kind: "web", root: "apps/api" },
    tool: { kind: "cli", root: "apps/tool" },
    shared: { type: "library", root: "libs/shared" },
  },
};

/** The same, with one application. */
const one: ChoConfig = {
  ...config,
  projects: { api: config.projects.api!, shared: config.projects.shared! },
};

/** The files of the workspace: `apps/api/users.ts` is there already. */
const FILES = { "apps/api/app.ts": "", "apps/api/users.ts": "" };

/** What a command line said: nothing, but for what is given. */
const flags = (given: Partial<Flags> = {}): Flags => ({
  part: undefined,
  name: undefined,
  project: undefined,
  path: undefined,
  yes: false,
  dryRun: false,
  ...given,
});

/** Ask, with keys, and give the answers and the screen. */
async function ask(
  given: Partial<Flags>,
  keys: ScriptedKey[],
  inside = "",
  settings = config,
) {
  const terminal = scriptedTerminal(keys);
  const tree = new Tree(memory_host({ ...FILES }));
  const answers = await ask_answers(
    flags(given),
    settings,
    tree,
    inside,
    createPrompts(terminal),
  );
  // asking records nothing
  assert.deepEqual(tree.changes(), []);
  return { answers, screen: terminal.screen(), left: terminal.left };
}

/** The code of what a function throws, or rejects with. */
async function code_of(fn: () => unknown): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return isChoError(error) ? error.code : error;
  }
  return undefined;
}

describe("ask_answers", () => {
  it("asks every question, in order, when the command line said nothing", async () => {
    const { answers, screen, left } = await ask({}, [
      "down", // a service
      "return",
      "userStore",
      "return",
      "down", // the second application
      "return",
      "apps/tool/store", // another folder than the one that is proposed
      "return",
    ]);
    assert.deepEqual(answers, {
      part: "service",
      name: "userStore",
      project: "tool",
      folder: "apps/tool/store",
    });
    assert.deepEqual(screen, [
      "✔ What are you generating? · A service",
      "✔ Name · userStore",
      "✔ Project · tool",
      "✔ Folder · apps/tool/store",
    ]);
    assert.equal(left, 0);
  });

  it("proposes the project of the current folder, and its folder", async () => {
    const { answers, screen } = await ask(
      { part: "controller", name: "orders" },
      ["return", "return"],
      "apps/tool/src",
    );
    assert.deepEqual(screen, [
      "✔ Project · tool",
      "✔ Folder · apps/tool",
    ]);
    assert.deepEqual(answers, {
      part: "controller",
      name: "orders",
      project: "tool",
      folder: "apps/tool",
    });
  });

  it("does not ask the project of a workspace with one application", async () => {
    const { answers, screen } = await ask(
      { part: "module", name: "orders" },
      ["return"],
      "libs/shared",
      one,
    );
    assert.deepEqual(screen, ["✔ Folder · apps/api"]);
    assert.equal(answers.project, "api");
  });

  it("asks nothing when every answer is on the command line", async () => {
    const { answers, screen } = await ask({
      part: "service",
      name: "UserStore",
      project: "api",
      path: "apps/api/store",
    }, []);
    assert.deepEqual(screen, []);
    assert.deepEqual(answers, {
      part: "service",
      name: "UserStore",
      project: "api",
      folder: "apps/api/store",
    });
  });

  it("takes the defaults with --yes: the project of the folder, and its root", async () => {
    const { answers, screen } = await ask(
      { part: "controller", name: "orders", yes: true },
      [],
      "apps/tool",
    );
    assert.deepEqual(screen, []);
    assert.deepEqual([answers.project, answers.folder], ["tool", "apps/tool"]);
  });

  it("still asks the part and the name with --yes: they have no default", async () => {
    const { answers, screen } = await ask(
      { yes: true },
      [
        "return",
        "orders",
        "return",
      ],
      "",
      one,
    );
    assert.deepEqual(screen, [
      "✔ What are you generating? · A controller",
      "✔ Name · orders",
    ]);
    assert.deepEqual(answers, {
      part: "controller",
      name: "orders",
      project: "api",
      folder: "apps/api",
    });
  });

  it("cannot say which project with --yes, from a folder that is in none: CHO_CLI_UNKNOWN_PROJECT", async () => {
    const given = { part: "controller", name: "orders", yes: true } as const;
    assert.equal(
      await code_of(() => ask(given, [])),
      "CHO_CLI_UNKNOWN_PROJECT",
    );
    // a library is not where a part goes
    assert.equal(
      await code_of(() => ask(given, [], "libs/shared")),
      "CHO_CLI_UNKNOWN_PROJECT",
    );
  });

  it("shows the mistake of a name, and of a folder, under its question", async () => {
    const { answers, screen } = await ask({
      part: "controller",
      project: "api",
    }, [
      "users.controller",
      "return",
      ...Array<ScriptedKey>(11).fill("backspace"),
      "return", // `users`, whose file is in `apps/api`
      "return", // the folder that is proposed: refused, the file exists
      "apps/api/http",
      "return",
    ]);
    assert.deepEqual(answers, {
      part: "controller",
      name: "users",
      project: "api",
      folder: "apps/api/http",
    });
    assert.deepEqual(screen, [
      "✔ Name · users",
      "✔ Folder · apps/api/http",
    ]);
  });

  it("refuses a --project that is not an application", async () => {
    const given = { part: "controller", name: "orders" } as const;
    assert.equal(
      await code_of(() => ask({ ...given, project: "nosuch" }, [])),
      "CHO_CLI_UNKNOWN_PROJECT",
    );
    assert.equal(
      await code_of(() => ask({ ...given, project: "shared" }, [])),
      "CHO_CLI_NOT_AN_APPLICATION",
    );
  });

  it("refuses a --path that is not in the project: CHO_CLI_INVALID_OPTION", async () => {
    const given = {
      part: "controller",
      name: "orders",
      project: "api",
    } as const;
    for (const path of ["apps/tool", "libs/shared", "apps/api-old", "apps"]) {
      assert.equal(
        await code_of(() => ask({ ...given, path }, [])),
        "CHO_CLI_INVALID_OPTION",
        path,
      );
    }
  });

  it("refuses a file that exists: CHO_CLI_TARGET_EXISTS", async () => {
    // from the flags, and from the default of --yes
    assert.equal(
      await code_of(() =>
        ask({ part: "service", name: "users", project: "api", yes: true }, [])
      ),
      "CHO_CLI_TARGET_EXISTS",
    );
    assert.equal(
      await code_of(() =>
        ask({
          part: "service",
          name: "Users",
          project: "api",
          path: "apps/api",
        }, [])
      ),
      "CHO_CLI_TARGET_EXISTS",
    );
  });

  it("rejects with CHO_PROMPT_CANCELLED when a question is cancelled", async () => {
    assert.equal(
      await code_of(() => ask({}, ["ctrl+c"])),
      "CHO_PROMPT_CANCELLED",
    );
  });
});

describe("application_of", () => {
  it("is the application of a name", () => {
    assert.equal(application_of(config, "tool"), config.projects.tool);
  });

  it("says why a library is not where a part goes", () => {
    assert.throws(
      () => application_of(config, "shared"),
      (error) =>
        isChoError(error, "CHO_CLI_NOT_AN_APPLICATION") &&
        error.message ===
          "shared is a library: it is plain TypeScript, with no package of " +
            "CHO. A part is generated in an application.",
    );
  });

  it("names the projects, for a name that is none of them", () => {
    assert.throws(
      () => application_of(config, "web"),
      (error) =>
        isChoError(error, "CHO_CLI_UNKNOWN_PROJECT") &&
        error.message ===
          "The workspace has no project named web. Its projects: api, tool, " +
            "shared",
    );
  });
});

describe("folder_mistake", () => {
  const tree = new Tree(memory_host({ ...FILES }));
  const check = (folder: string, file = "orders") =>
    folder_mistake(folder, "apps/api", file, tree);

  it("says nothing of the folder of the project, or of one under it", () => {
    assert.equal(check("apps/api"), undefined);
    assert.equal(check("apps/api/orders/http"), undefined);
  });

  it("refuses a folder that is not in the project", () => {
    for (const folder of ["apps", "apps/tool", "apps/api-old", "libs/shared"]) {
      assert.equal(
        check(folder),
        "A folder of the project: apps/api, or one under it",
        folder,
      );
    }
    assert.match(check("../api")!, /^A folder of the workspace/);
  });

  it("refuses the folder where the file of the part is already", () => {
    assert.equal(
      check("apps/api", "users"),
      "apps/api/users.ts exists already",
    );
    assert.equal(check("apps/api/http", "users"), undefined);
  });
});
