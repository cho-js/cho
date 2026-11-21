/**
 * The answers of `cho new`: what the flags said, and what the questions ask
 * for the rest.
 *
 * | Answer                 | Flag                 | Default                 |
 * | ---------------------- | -------------------- | ----------------------- |
 * | Name of the workspace  | The first word       | None                    |
 * | Kind of the project    | `--kind`             | `web`                   |
 * | Runtime                | `--runtime`          | The one `cho` runs on   |
 * | Name of the project    | `--project`          | `api`, or `cli`         |
 * | Folder of the projects | `--apps-dir`         | `apps`                  |
 * | A git repository       | `--no-git` says no   | Yes                     |
 * | Install                | `--no-install`       | Yes                     |
 *
 * A flag answers its question. `--yes` takes the default of every question
 * that is left, and has one.
 *
 * @module
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { type ChoPrompts, createPrompts } from "@chojs/prompt";
import { DEFAULTS, type Kind, type Runtime } from "./config.ts";
import { cli_error } from "./errors.ts";
import type { Flags } from "./flags.ts";
import { name_mistake } from "./names.ts";

/** What `cho new` creates a workspace from: every question, answered. */
export type Answers = {
  /** The name of the workspace: the folder that is created. */
  name: string;
  /** The kind of the first project. */
  kind: Kind;
  /** The runtime of the workspace. */
  runtime: Runtime;
  /** The name of the first project. */
  project: string;
  /** The folder of the projects. */
  appsDir: string;
  /** Whether to run `git init`. */
  git: boolean;
  /** Whether to install the packages. */
  install: boolean;
};

/** The name a project has by default, for each kind. */
export const PROJECT_NAMES: Record<Kind, string> = { web: "api", cli: "cli" };

/**
 * The runtime `cho` is running on: the default of the question. A tool that
 * was installed with Deno proposes Deno.
 *
 * @returns The runtime.
 */
export function current_runtime(): Runtime {
  if ("Deno" in globalThis) {
    return "deno";
  }
  if ("Bun" in globalThis) {
    return "bun";
  }
  return "node";
}

/**
 * Whether a folder is in a git repository: it, or a folder above it, has a
 * `.git`. There, `git init` would make a repository in a repository.
 *
 * @param folder The folder.
 */
export function in_repository(folder: string): boolean {
  if (existsSync(join(folder, ".git"))) {
    return true;
  }
  const parent = dirname(folder);
  // the root is its own parent
  return parent === folder ? false : in_repository(parent);
}

/**
 * Ask what the flags did not say.
 *
 * The questions are asked in the order of the table of this module. Nothing
 * is written while they are asked: a question that is cancelled leaves
 * nothing behind.
 *
 * @param flags What the command line said: `read_flags`.
 * @param cwd The folder the workspace is created in.
 * @param ask The questions. Default: those of `@chojs/prompt`, on the
 *   terminal of the process. A test gives those of a scripted terminal.
 * @returns The answers.
 * @throws {ChoError} `CHO_CLI_TARGET_EXISTS` when the name is a flag, and
 *   its folder exists. As rejections of a question: `CHO_PROMPT_CANCELLED`,
 *   and `CHO_PROMPT_NO_TERMINAL` when nobody can answer.
 */
export async function ask_answers(
  flags: Flags,
  cwd: string,
  ask: ChoPrompts = createPrompts(),
): Promise<Answers> {
  const { yes } = flags;

  // The name has no default: `--yes` does not answer it.
  let name = flags.name;
  if (name === undefined) {
    name = await ask.text({
      message: "Workspace name",
      validate: (value) =>
        name_mistake(value) ??
          (existsSync(join(cwd, value))
            ? `The folder ${value} exists already`
            : undefined),
    });
  } else if (existsSync(join(cwd, name))) {
    throw cli_error(
      "CHO_CLI_TARGET_EXISTS",
      `The folder ${name} exists already. Nothing was written.`,
    );
  }

  let kind = flags.kind;
  if (kind === undefined) {
    kind = yes ? "web" : await ask.select({
      message: "What are you building?",
      choices: [
        { value: "web", label: "A web application", hint: "@chojs/web" },
        { value: "cli", label: "A command-line tool", hint: "@chojs/command" },
      ],
    });
  }

  let runtime = flags.runtime;
  if (runtime === undefined) {
    runtime = yes ? current_runtime() : await ask.select({
      message: "Runtime",
      choices: [
        { value: "deno", label: "Deno" },
        { value: "node", label: "Node.js", hint: "npm" },
        { value: "bun", label: "Bun" },
      ],
      default: current_runtime(),
    });
  }

  let project = flags.project;
  if (project === undefined) {
    project = yes ? PROJECT_NAMES[kind] : await ask.text({
      message: "Project name",
      default: PROJECT_NAMES[kind],
      validate: name_mistake,
    });
  }

  let appsDir = flags.appsDir;
  if (appsDir === undefined) {
    appsDir = yes ? DEFAULTS.appsDir : await ask.text({
      message: "Folder of the projects",
      default: DEFAULTS.appsDir,
      validate: name_mistake,
    });
  }

  // Not proposed in a repository: the workspace is a part of it already.
  let git = flags.git && !in_repository(cwd);
  if (git && !yes) {
    git = await ask.confirm({
      message: "Initialize a git repository?",
      default: true,
    });
  }

  let install = flags.install;
  if (install && !yes) {
    install = await ask.confirm({
      message: "Install the dependencies?",
      default: true,
    });
  }

  return { name, kind, runtime, project, appsDir, git, install };
}
