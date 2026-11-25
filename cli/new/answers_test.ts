/**
 * Tests for the answers of `cho new`: the questions that are asked for what
 * the flags did not say. A scripted terminal answers them, with keys.
 */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { isChoError } from "@chojs/command";
import { createPrompts } from "@chojs/prompt";
import { type ScriptedKey, scriptedTerminal } from "@chojs/prompt/testing";
import { ask_answers, current_runtime, in_repository } from "./answers.ts";
import type { Flags } from "./flags.ts";
import { with_folder } from "./testing.ts";

/** What a command line said: nothing, but for what is given. */
const flags = (given: Partial<Flags> = {}): Flags => ({
  name: undefined,
  kind: undefined,
  runtime: undefined,
  project: undefined,
  appsDir: undefined,
  git: true,
  install: true,
  yes: false,
  dryRun: false,
  ...given,
});

/** Ask in a folder, with keys, and give the answers and the screen. */
async function ask(cwd: string, given: Partial<Flags>, keys: ScriptedKey[]) {
  const terminal = scriptedTerminal(keys);
  const answers = await ask_answers(flags(given), cwd, createPrompts(terminal));
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

/** The names of the runtimes, as the question shows them. */
const RUNTIME_LABELS = { deno: "Deno", node: "Node.js", bun: "Bun" };

describe("ask_answers", () => {
  it("asks every question, in order, when the flags said nothing", () =>
    with_folder(async (cwd) => {
      const { answers, screen, left } = await ask(cwd, {}, [
        "shop",
        "return",
        "down", // a command-line tool
        "return",
        "return", // the runtime: the one of cho
        "return", // the name of the project: its default
        "services",
        "return",
        "return", // git: yes
        "n", // install: no
        "return",
      ]);
      assert.deepEqual(answers, {
        name: "shop",
        kind: "cli",
        runtime: current_runtime(),
        project: "cli",
        appsDir: "services",
        git: true,
        install: false,
      });
      assert.deepEqual(screen, [
        "✔ Workspace name · shop",
        "✔ What are you building? · A command-line tool",
        `✔ Runtime · ${RUNTIME_LABELS[current_runtime()]}`,
        "✔ Project name · cli",
        "✔ Folder of the projects · services",
        "✔ Initialize a git repository? · Yes",
        "✔ Install the dependencies? · No",
      ]);
      assert.equal(left, 0);
    }));

  it("does not ask what a flag answered", () =>
    with_folder(async (cwd) => {
      const { answers, screen } = await ask(
        cwd,
        { name: "shop", kind: "web", project: "orders", git: false },
        ["down", "return", "return", "return"],
      );
      assert.deepEqual(screen, [
        // one below the runtime of cho
        `✔ Runtime · ${RUNTIME_LABELS[answers.runtime]}`,
        "✔ Folder of the projects · apps",
        "✔ Install the dependencies? · Yes",
      ]);
      assert.notEqual(answers.runtime, current_runtime());
      assert.deepEqual({ ...answers, runtime: "" }, {
        name: "shop",
        kind: "web",
        runtime: "",
        project: "orders",
        appsDir: "apps",
        git: false,
        install: true,
      });
    }));

  it("asks nothing when every answer is a flag", () =>
    with_folder(async (cwd) => {
      const { answers, screen } = await ask(cwd, {
        name: "shop",
        kind: "cli",
        runtime: "bun",
        project: "tool",
        appsDir: "packages",
        git: false,
        install: false,
      }, []);
      assert.deepEqual(screen, []);
      assert.deepEqual(answers, {
        name: "shop",
        kind: "cli",
        runtime: "bun",
        project: "tool",
        appsDir: "packages",
        git: false,
        install: false,
      });
    }));

  it("takes the default of every question with --yes", () =>
    with_folder(async (cwd) => {
      const { answers, screen } = await ask(
        cwd,
        { name: "shop", yes: true },
        [],
      );
      assert.deepEqual(screen, []);
      assert.deepEqual(answers, {
        name: "shop",
        kind: "web",
        runtime: current_runtime(),
        project: "api",
        appsDir: "apps",
        git: true,
        install: true,
      });
    }));

  it("keeps what the flags said, with --yes", () =>
    with_folder(async (cwd) => {
      const { answers } = await ask(cwd, {
        name: "shop",
        yes: true,
        kind: "cli",
        runtime: "node",
        install: false,
      }, []);
      assert.deepEqual(answers, {
        name: "shop",
        kind: "cli",
        runtime: "node",
        project: "cli", // the default of a command-line tool
        appsDir: "apps",
        git: true,
        install: false,
      });
    }));

  it("still asks for the name with --yes: it has no default", () =>
    with_folder(async (cwd) => {
      const { answers, screen } = await ask(cwd, { yes: true }, [
        "shop",
        "return",
      ]);
      assert.equal(answers.name, "shop");
      assert.deepEqual(screen, ["✔ Workspace name · shop"]);
    }));

  it("does not propose git init in a repository", () =>
    with_folder(async (cwd) => {
      await mkdir(join(cwd, ".git"));
      const { answers, screen } = await ask(
        cwd,
        { name: "shop", kind: "web", runtime: "deno", project: "api" },
        ["return", "return"],
      );
      assert.equal(answers.git, false);
      assert.deepEqual(screen, [
        "✔ Folder of the projects · apps",
        "✔ Install the dependencies? · Yes",
      ]);
      // with --yes too
      const yes = await ask(cwd, { name: "shop", yes: true }, []);
      assert.equal(yes.answers.git, false);
    }));

  it("refuses, in the question, a name that is not valid or that exists", () =>
    with_folder(async (cwd) => {
      await mkdir(join(cwd, "taken"));
      const { answers, screen } = await ask(cwd, { yes: true }, [
        "My Shop",
        "return", // not a name: the question stays open
        "ctrl+u",
        "taken",
        "return", // exists: it stays open
        "ctrl+u",
        "shop",
        "return",
      ]);
      assert.equal(answers.name, "shop");
      assert.deepEqual(screen, ["✔ Workspace name · shop"]);
    }));

  it("shows the mistake of a name under its question", () =>
    with_folder(async (cwd) => {
      await writeFile(join(cwd, "taken"), "a file");
      const terminal = scriptedTerminal(["taken", "return"]);
      // the keys end with the question open: the terminal cancels it
      const code = await code_of(() =>
        ask_answers(flags(), cwd, createPrompts(terminal))
      );
      assert.equal(code, "CHO_PROMPT_CANCELLED");
      assert.deepEqual(terminal.screens.at(-1), [
        "? Workspace name › taken",
        "✖ The folder taken exists already",
      ]);
    }));

  it("refuses a name that is a flag, and exists: CHO_CLI_TARGET_EXISTS", () =>
    with_folder(async (cwd) => {
      await mkdir(join(cwd, "shop"));
      const terminal = scriptedTerminal(["return"]);
      const code = await code_of(() =>
        ask_answers(flags({ name: "shop" }), cwd, createPrompts(terminal))
      );
      assert.equal(code, "CHO_CLI_TARGET_EXISTS");
      // before any question
      assert.equal(terminal.left, 1);
      assert.deepEqual(terminal.screen(), []);
    }));

  it("rejects when a question is cancelled: CHO_PROMPT_CANCELLED", () =>
    with_folder(async (cwd) => {
      const terminal = scriptedTerminal(["return", "ctrl+c"]);
      const code = await code_of(() =>
        ask_answers(flags({ name: "shop" }), cwd, createPrompts(terminal))
      );
      assert.equal(code, "CHO_PROMPT_CANCELLED");
    }));

  it("rejects when nobody can answer: CHO_PROMPT_NO_TERMINAL", () =>
    with_folder(async (cwd) => {
      const nobody = createPrompts(
        scriptedTerminal([], { interactive: false }),
      );
      assert.equal(
        await code_of(() => ask_answers(flags({ name: "shop" }), cwd, nobody)),
        "CHO_PROMPT_NO_TERMINAL",
      );
      // nothing to ask: nobody is needed
      const answers = await ask_answers(
        flags({ name: "shop", yes: true }),
        cwd,
        nobody,
      );
      assert.equal(answers.name, "shop");
    }));
});

describe("in_repository", () => {
  it("is true in a folder with a .git, and in the folders under it", () =>
    with_folder(async (folder) => {
      assert.equal(in_repository(folder), false);
      await mkdir(join(folder, "a", "b"), { recursive: true });
      await mkdir(join(folder, "a", ".git"));
      assert.equal(in_repository(folder), false);
      assert.equal(in_repository(join(folder, "a")), true);
      assert.equal(in_repository(join(folder, "a", "b")), true);
    }));
});
