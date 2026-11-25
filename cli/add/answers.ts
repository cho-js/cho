/**
 * The answers of `cho add`: what the flags said, and what the questions ask
 * for the rest.
 *
 * | Answer              | Flag             | Default       |
 * | ------------------- | ---------------- | ------------- |
 * | Type of the project | `--type`         | `application` |
 * | Kind                | `--kind`         | `web`         |
 * | Name of the project | The first word   | None          |
 * | Install             | `--no-install`   | Yes           |
 *
 * The kind is the one of an application: it is not asked for a library. The
 * runtime is not asked: it is the one of `cho.json`.
 *
 * @module
 */

import { type ChoPrompts, createPrompts } from "@chojs/prompt";
import { type ChoConfig, DEFAULTS, type ProjectChoice } from "../new/config.ts";
import { cli_error } from "../errors.ts";
import { KIND_CHOICES } from "../new/answers.ts";
import { name_mistake } from "../new/names.ts";
import type { Tree } from "../tree.ts";
import type { Flags } from "./flags.ts";
import type { Workspace } from "./workspace.ts";

/** What `cho add` adds a project from: every question, answered. */
export type Answers = {
  /** The name of the project. */
  name: string;
  /** The type of the project, and the kind of an application. */
  choice: ProjectChoice;
  /** Whether to install the packages. */
  install: boolean;
};

/**
 * The folder a new project is created in: the one of the applications, or
 * the one of the libraries.
 *
 * @param config The settings of the workspace.
 * @param choice The type of the project.
 * @returns The folder, from the root of the workspace.
 */
export function folder_of(config: ChoConfig, choice: ProjectChoice): string {
  return choice.type === "library"
    ? config.libsDir ?? DEFAULTS.libsDir
    : config.appsDir ?? DEFAULTS.appsDir;
}

/** Why a name cannot be the one of a new project. */
export type NameProblem = {
  /** The code of the error, when the name is a flag. */
  code: "CHO_CLI_PROJECT_EXISTS" | "CHO_CLI_TARGET_EXISTS";
  /** The mistake, as a sentence with no full stop. */
  mistake: string;
};

/**
 * Why a name cannot be the one of a new project: the workspace has a project
 * of that name, or its folder exists.
 *
 * @param name The name. It follows the rule of a name.
 * @param workspace The workspace.
 * @param tree The tree of the workspace.
 * @param choice The type of the project: it says where the project goes.
 * @returns The problem, or `undefined` when the name is free.
 */
export function name_problem(
  name: string,
  workspace: Workspace,
  tree: Tree,
  choice: ProjectChoice,
): NameProblem | undefined {
  if (name in workspace.config.projects) {
    return {
      code: "CHO_CLI_PROJECT_EXISTS",
      mistake: `The workspace has a project named ${name} already`,
    };
  }
  const root = `${folder_of(workspace.config, choice)}/${name}`;
  if (tree.exists(root)) {
    return {
      code: "CHO_CLI_TARGET_EXISTS",
      mistake: `The folder ${root} exists already`,
    };
  }
  return undefined;
}

/**
 * Ask what the flags did not say.
 *
 * The questions are asked in the order of the table of this module. Nothing
 * is written while they are asked.
 *
 * @param flags What the command line said: `read_flags`.
 * @param workspace The workspace the project is added to.
 * @param tree The tree of the workspace: a name whose folder exists is
 *   refused.
 * @param ask The questions. Default: those of `@chojs/prompt`, on the
 *   terminal of the process. A test gives those of a scripted terminal.
 * @returns The answers.
 * @throws {ChoError} When the name is a flag: `CHO_CLI_PROJECT_EXISTS` for a
 *   project of the workspace, and `CHO_CLI_TARGET_EXISTS` for a folder that
 *   exists. As rejections of a question: `CHO_PROMPT_CANCELLED`, and
 *   `CHO_PROMPT_NO_TERMINAL` when nobody can answer.
 */
export async function ask_answers(
  flags: Flags,
  workspace: Workspace,
  tree: Tree,
  ask: ChoPrompts = createPrompts(),
): Promise<Answers> {
  const { yes } = flags;

  let type = flags.type;
  if (type === undefined) {
    type = yes ? DEFAULTS.type : await ask.select({
      message: "What are you adding?",
      choices: [
        { value: "application", label: "An application", hint: "it runs" },
        { value: "library", label: "A library", hint: "plain TypeScript" },
      ],
    });
  }

  let choice: ProjectChoice = { type: "library" };
  if (type === "application") {
    let kind = flags.kind;
    if (kind === undefined) {
      kind = yes ? "web" : await ask.select({
        message: "What are you building?",
        choices: KIND_CHOICES,
      });
    }
    choice = { type, kind };
  }

  // The name has no default: `--yes` does not answer it.
  let name = flags.name;
  if (name === undefined) {
    name = await ask.text({
      message: "Project name",
      validate: (value) =>
        name_mistake(value) ??
          name_problem(value, workspace, tree, choice)?.mistake,
    });
  } else {
    const problem = name_problem(name, workspace, tree, choice);
    if (problem) {
      throw cli_error(
        problem.code,
        `${problem.mistake}. Nothing was written.`,
      );
    }
  }

  let install = flags.install;
  if (install && !yes) {
    install = await ask.confirm({
      message: "Install the dependencies?",
      default: true,
    });
  }

  return { name, choice, install };
}
