/**
 * The flags of `cho add`: what `@Action` declares, and what a command line
 * said with them.
 *
 * As in `cho new`, every question has a flag, and {@link read_flags} checks
 * them all before any question is asked.
 *
 * @module
 */

import type { ChoArgs } from "@chojs/command";
import { type Kind, KINDS, type ProjectType, TYPES } from "../new/config.ts";
import { cli_error } from "../errors.ts";
import { check_args, read_choice, read_name } from "../new/flags.ts";

/**
 * The flags, as `@Action("add", ADD_FLAGS)` declares them.
 *
 * `install` is on unless it is turned off: `--no-install`.
 */
export const ADD_FLAGS = {
  string: ["type", "kind"],
  boolean: ["yes", "install", "dry-run"],
  negatable: ["install"],
  alias: { y: "yes" },
  default: { install: true },
  describe: {
    type: `What the project is: ${TYPES.join(" or ")}`,
    kind: `What an application is built with: ${KINDS.join(" or ")}`,
    install: "Install the packages",
    yes: "Take the default of every question",
    "dry-run": "Print what would be written, and write nothing",
  },
} as const;

/** The names `ctx.args` can have: the flags, and the short name of `--yes`. */
const KNOWN = ["type", "kind", "yes", "y", "install", "dry-run"];

/** What a command line said. A field that is `undefined` was not said. */
export type Flags = {
  /** The name of the project: the first word after `add`. */
  name: string | undefined;
  /** `--type`. `application`, too, when `--kind` was given alone. */
  type: ProjectType | undefined;
  /** `--kind`. */
  kind: Kind | undefined;
  /** `false` for `--no-install`: nothing is installed, and it is not proposed. */
  install: boolean;
  /** `--yes`: the questions that have a default are not asked. */
  yes: boolean;
  /** `--dry-run`: nothing is written, and nothing is run. */
  dryRun: boolean;
};

/**
 * Read the flags of `cho add`, and check them.
 *
 * @param args The parsed command line: `ctx.args`.
 * @returns What the command line said.
 * @throws {ChoError} `CHO_CLI_INVALID_OPTION` for a flag the command does
 *   not have, a value that is not one of the choices of its flag, a second
 *   name, or a kind for a library; `CHO_CLI_INVALID_NAME` for a name that
 *   is not valid.
 */
export function read_flags(args: ChoArgs): Flags {
  check_args(args, KNOWN, "cho add");
  const kind = read_choice("--kind", args.kind, KINDS);
  let type = read_choice("--type", args.type, TYPES);
  if (kind !== undefined) {
    if (type === "library") {
      throw cli_error(
        "CHO_CLI_INVALID_OPTION",
        `--kind ${kind}: a library has no kind. It is plain TypeScript`,
      );
    }
    // only an application has a kind: the flag answers both questions
    type = "application";
  }
  return {
    name: read_name("The name of the project", args._[0]),
    type,
    kind,
    install: args.install !== false,
    yes: args.yes === true,
    dryRun: args["dry-run"] === true,
  };
}
