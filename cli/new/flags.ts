/**
 * The flags of `cho new`: what `@Action` declares, and what a command line
 * said with them.
 *
 * Every question of the command has a flag. {@link read_flags} checks them
 * all before any question is asked: a mistake on the command line is not
 * found after five answers.
 *
 * @module
 */

import type { ChoArgs } from "@chojs/command";
import { type Kind, KINDS, type Runtime, RUNTIMES } from "./config.ts";
import { cli_error } from "./errors.ts";
import { name_mistake } from "./names.ts";

/**
 * The flags, as `@Action("new", NEW_FLAGS)` declares them.
 *
 * `git` and `install` are on unless they are turned off: `--no-git`,
 * `--no-install`.
 */
export const NEW_FLAGS = {
  string: ["kind", "runtime", "project", "apps-dir"],
  boolean: ["yes", "git", "install"],
  negatable: ["git", "install"],
  alias: { y: "yes" },
  default: { git: true, install: true },
  describe: {
    kind: `What the project is: ${KINDS.join(" or ")}`,
    runtime: `The runtime of the workspace: ${RUNTIMES.join(", ")}`,
    project: "The name of the project",
    "apps-dir": "The folder of the projects",
    git: "Run git init",
    install: "Install the packages",
    yes: "Take the default of every question",
  },
} as const;

/** The names `ctx.args` can have: the flags, and the short name of `--yes`. */
const KNOWN = [
  "kind",
  "runtime",
  "project",
  "apps-dir",
  "yes",
  "y",
  "git",
  "install",
];

/** What a command line said. A field that is `undefined` was not said. */
export type Flags = {
  /** The name of the workspace: the first word after `new`. */
  name: string | undefined;
  /** `--kind`. */
  kind: Kind | undefined;
  /** `--runtime`. */
  runtime: Runtime | undefined;
  /** `--project`. */
  project: string | undefined;
  /** `--apps-dir`. */
  appsDir: string | undefined;
  /** `false` for `--no-git`: `git init` is not run, and not proposed. */
  git: boolean;
  /** `false` for `--no-install`: nothing is installed, and it is not proposed. */
  install: boolean;
  /** `--yes`: the questions that have a default are not asked. */
  yes: boolean;
};

/**
 * Check a flag whose value is one of a list.
 *
 * @returns The value, or `undefined` when the flag was not given.
 */
function read_choice<T extends string>(
  flag: string,
  value: unknown,
  choices: readonly T[],
): T | undefined {
  if (value === undefined) {
    return undefined;
  }
  const choice = choices.find((one) => one === value);
  if (choice === undefined) {
    throw cli_error(
      "CHO_CLI_INVALID_OPTION",
      `${flag} ${value}: not one of ${choices.join(", ")}`,
    );
  }
  return choice;
}

/**
 * Check a flag whose value is a name.
 *
 * @returns The name, or `undefined` when the flag was not given.
 */
function read_name(flag: string, value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const name = String(value);
  const mistake = name_mistake(name);
  if (mistake !== undefined) {
    throw cli_error(
      "CHO_CLI_INVALID_NAME",
      `${flag} ${JSON.stringify(name)}: ${mistake}`,
    );
  }
  return name;
}

/**
 * Read the flags of `cho new`, and check them.
 *
 * @param args The parsed command line: `ctx.args`.
 * @returns What the command line said.
 * @throws {ChoError} `CHO_CLI_INVALID_OPTION` for a flag the command does
 *   not have, a value that is not one of the choices of its flag, or a
 *   second name; `CHO_CLI_INVALID_NAME` for a name that is not valid.
 */
export function read_flags(args: ChoArgs): Flags {
  for (const flag of Object.keys(args)) {
    // `_` holds the words that are not flags
    if (flag !== "_" && !KNOWN.includes(flag)) {
      throw cli_error(
        "CHO_CLI_INVALID_OPTION",
        `--${flag}: cho new has no such flag. See cho new --help`,
      );
    }
  }
  if (args._.length > 1) {
    throw cli_error(
      "CHO_CLI_INVALID_OPTION",
      `cho new takes one name, and got ${args._.length}: ${args._.join(" ")}`,
    );
  }
  return {
    name: read_name("The name of the workspace", args._[0]),
    kind: read_choice("--kind", args.kind, KINDS),
    runtime: read_choice("--runtime", args.runtime, RUNTIMES),
    project: read_name("--project", args.project),
    appsDir: read_name("--apps-dir", args["apps-dir"]),
    git: args.git !== false,
    install: args.install !== false,
    yes: args.yes === true,
  };
}
