/**
 * The flags of `cho generate`: what `@Action` declares, and what a command
 * line said with them.
 *
 * ```sh
 * cho generate controller users --project api --path apps/api/users
 * #            │          │
 * #            │          └ the name
 * #            └ the part: controller, service or module
 * ```
 *
 * As in the other commands, every question has an answer on the command
 * line, and {@link read_flags} checks them all before any question is asked.
 *
 * @module
 */

import type { ChoArgs } from "@chojs/command";
import { cli_error } from "../errors.ts";
import { is_inside } from "../new/config.ts";
import { check_flags, read_choice } from "../new/flags.ts";
import { type Part, part_mistake, PARTS } from "./parts.ts";

/** The flags, as `@Action("generate", GENERATE_FLAGS)` declares them. */
export const GENERATE_FLAGS = {
  string: ["project", "path"],
  boolean: ["yes", "dry-run"],
  alias: { y: "yes" },
  describe: {
    project: "The project the part is for",
    path: "The folder of the file, from the root of the workspace",
    yes: "Take the default of every question",
    "dry-run": "Print what would be written, and write nothing",
  },
} as const;

/** The names `ctx.args` can have: the flags, and the short name of `--yes`. */
const KNOWN = ["project", "path", "yes", "y", "dry-run"];

/** What a command line said. A field that is `undefined` was not said. */
export type Flags = {
  /** The part: the first word after `generate`. */
  part: Part | undefined;
  /** The name of the part: the second word. */
  name: string | undefined;
  /** `--project`. */
  project: string | undefined;
  /** `--path`: a folder, from the root of the workspace. */
  path: string | undefined;
  /** `--yes`: the questions that have a default are not asked. */
  yes: boolean;
  /** `--dry-run`: nothing is written. */
  dryRun: boolean;
};

/**
 * What is wrong with a folder for a part.
 *
 * @param path The folder, from the root of the workspace.
 * @returns The mistake, as a sentence with no full stop, or `undefined`.
 */
export function path_mistake(path: string): string | undefined {
  return is_inside(path)
    ? undefined
    : "A folder of the workspace, from its root, with /: apps/api/users";
}

/**
 * Read the flags of `cho generate`, and check them.
 *
 * @param args The parsed command line: `ctx.args`.
 * @returns What the command line said.
 * @throws {ChoError} `CHO_CLI_INVALID_OPTION` for a flag the command does
 *   not have, a part that is not one of the three, a third word, or a path
 *   that is not a folder of the workspace; `CHO_CLI_INVALID_NAME` for a name
 *   that is not valid.
 */
export function read_flags(args: ChoArgs): Flags {
  check_flags(args, KNOWN, "cho generate");
  if (args._.length > 2) {
    throw cli_error(
      "CHO_CLI_INVALID_OPTION",
      `cho generate takes a part and a name, and got ${args._.length} ` +
        `words: ${args._.join(" ")}`,
    );
  }
  const part = read_choice("The part", args._[0], PARTS);

  let name: string | undefined;
  if (args._[1] !== undefined) {
    name = String(args._[1]);
    const mistake = part_mistake(name);
    if (mistake !== undefined) {
      throw cli_error(
        "CHO_CLI_INVALID_NAME",
        `The name ${JSON.stringify(name)}: ${mistake}`,
      );
    }
  }

  let path: string | undefined;
  if (args.path !== undefined) {
    path = String(args.path);
    const mistake = path_mistake(path);
    if (mistake !== undefined) {
      throw cli_error(
        "CHO_CLI_INVALID_OPTION",
        `--path ${JSON.stringify(path)}: ${mistake}`,
      );
    }
  }

  return {
    part,
    name,
    project: args.project === undefined ? undefined : String(args.project),
    path,
    yes: args.yes === true,
    dryRun: args["dry-run"] === true,
  };
}
