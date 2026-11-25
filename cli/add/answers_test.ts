/**
 * Tests for the answers of `cho add`: the questions that are asked for what
 * the flags did not say. A scripted terminal answers them, with keys, and
 * the workspace is in memory.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isChoError } from "@chojs/command";
import { createPrompts } from "@chojs/prompt";
import { type ScriptedKey, scriptedTerminal } from "@chojs/prompt/testing";
import { memory_host, new_workspace } from "../new/testing.ts";
import { Tree } from "../tree.ts";
import { ask_answers, folder_of, name_problem } from "./answers.ts";
import type { Flags } from "./flags.ts";
import { read_workspace } from "./workspace.ts";

/** What a command line said: nothing, but for what is given. */
const flags = (given: Partial<Flags> = {}): Flags => ({
  name: undefined,
  type: undefined,
  kind: undefined,
  install: true,
  yes: false,
  dryRun: false,
  ...given,
});

/** The workspace `shop`, with `api`, and a folder `libs/taken`. */
function workspace() {
  const tree = new Tree(memory_host({
    ...new_workspace(),
    "libs/taken/notes.txt": "mine\n",
  }));
  return { tree, workspace: read_workspace(tree) };
}

/** Ask, with keys, and give the answers and the screen. */
async function ask(given: Partial<Flags>, keys: ScriptedKey[]) {
  const terminal = scriptedTerminal(keys);
  const { tree, workspace: read } = workspace();
  const answers = await ask_answers(
    flags(given),
    read,
    tree,
    createPrompts(terminal),
  );
  // asking records nothing
  assert.deepEqual(tree.changes(), []);
  return { answers, screen: terminal.screen(), left: terminal.left };
}

/** The code of what a function rejects with. */
async function code_of(fn: () => Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (error) {
    return isChoError(error) ? error.code : error;
  }
  return undefined;
}

describe("ask_answers", () => {
  it("asks every question of an application, in order", async () => {
    const { answers, screen, left } = await ask({}, [
      "return", // an application
      "down", // a command-line tool
      "return",
      "admin",
      "return",
      "n", // install: no
      "return",
    ]);
    assert.deepEqual(answers, {
      name: "admin",
      choice: { type: "application", kind: "cli" },
      install: false,
    });
    assert.deepEqual(screen, [
      "✔ What are you adding? · An application",
      "✔ What are you building? · A command-line tool",
      "✔ Project name · admin",
      "✔ Install the dependencies? · No",
    ]);
    assert.equal(left, 0);
  });

  it("does not ask the kind of a library: it has none", async () => {
    const { answers, screen } = await ask({}, [
      "down", // a library
      "return",
      "shared",
      "return",
      "return", // install: yes
    ]);
    assert.deepEqual(answers, {
      name: "shared",
      choice: { type: "library" },
      install: true,
    });
    assert.deepEqual(screen, [
      "✔ What are you adding? · A library",
      "✔ Project name · shared",
      "✔ Install the dependencies? · Yes",
    ]);
  });

  it("does not ask what a flag answered", async () => {
    const { answers, screen } = await ask(
      { name: "admin", kind: "web", type: "application", install: false },
      [],
    );
    assert.deepEqual(screen, []);
    assert.deepEqual(answers, {
      name: "admin",
      choice: { type: "application", kind: "web" },
      install: false,
    });
  });

  it("takes the defaults with --yes, and still asks the name: it has none", async () => {
    const { answers, screen } = await ask({ yes: true }, ["admin", "return"]);
    assert.deepEqual(screen, ["✔ Project name · admin"]);
    assert.deepEqual(answers, {
      name: "admin",
      choice: { type: "application", kind: "web" },
      install: true,
    });
    const library = await ask(
      { yes: true, type: "library", name: "shared" },
      [],
    );
    assert.deepEqual(library.answers.choice, { type: "library" });
  });

  it("shows the mistake of a name under the question, and asks again", async () => {
    const { answers, screen } = await ask({ type: "library", yes: true }, [
      "My Lib",
      "return",
      ...Array<ScriptedKey>(6).fill("backspace"),
      "taken", // a folder of `libs`
      "return",
      ...Array<ScriptedKey>(5).fill("backspace"),
      "api", // a project of the workspace
      "return",
      ...Array<ScriptedKey>(3).fill("backspace"),
      "shared",
      "return",
    ]);
    assert.equal(answers.name, "shared");
    assert.deepEqual(screen, ["✔ Project name · shared"]);
  });

  it("refuses a name that is a project of the workspace: CHO_CLI_PROJECT_EXISTS", async () => {
    assert.equal(
      await code_of(() => ask({ name: "api", yes: true }, [])),
      "CHO_CLI_PROJECT_EXISTS",
    );
    // a library of that name too: a name is one project
    assert.equal(
      await code_of(() => ask({ name: "api", type: "library" }, [])),
      "CHO_CLI_PROJECT_EXISTS",
    );
  });

  it("refuses a name whose folder exists: CHO_CLI_TARGET_EXISTS", async () => {
    assert.equal(
      await code_of(() => ask({ name: "taken", type: "library" }, [])),
      "CHO_CLI_TARGET_EXISTS",
    );
    // an application of that name goes in `apps`, where there is none
    const { answers } = await ask({ name: "taken", yes: true }, []);
    assert.equal(answers.name, "taken");
  });

  it("rejects with CHO_PROMPT_CANCELLED when a question is cancelled", async () => {
    assert.equal(
      await code_of(() => ask({}, ["ctrl+c"])),
      "CHO_PROMPT_CANCELLED",
    );
  });
});

describe("name_problem", () => {
  it("says why a name is taken, as a sentence for a question", () => {
    const { tree, workspace: read } = workspace();
    assert.deepEqual(name_problem("api", read, tree, { type: "library" }), {
      code: "CHO_CLI_PROJECT_EXISTS",
      mistake: "The workspace has a project named api already",
    });
    assert.deepEqual(name_problem("taken", read, tree, { type: "library" }), {
      code: "CHO_CLI_TARGET_EXISTS",
      mistake: "The folder libs/taken exists already",
    });
    assert.equal(
      name_problem("shared", read, tree, { type: "library" }),
      undefined,
    );
  });
});

describe("folder_of", () => {
  it("is the folder of the applications, or the one of the libraries", () => {
    const { config } = workspace().workspace;
    assert.equal(folder_of(config, { type: "library" }), "libs");
    assert.equal(
      folder_of(config, { type: "application", kind: "web" }),
      "apps",
    );
  });

  it("takes the defaults of a cho.json that names no folder", () => {
    const config = { version: 1, runtime: "deno", projects: {} } as const;
    assert.equal(folder_of(config, { type: "library" }), "libs");
    assert.equal(
      folder_of(config, { type: "application", kind: "cli" }),
      "apps",
    );
    assert.equal(
      folder_of({ ...config, libsDir: "packages" }, { type: "library" }),
      "packages",
    );
  });
});
