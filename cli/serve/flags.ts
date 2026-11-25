/**
 * The flags of `cho serve`: what `@Action` declares, and what a command line
 * said with them.
 *
 * ```sh
 * cho serve tool hello -- --name Ada
 * #         │    │        └ after `--`: for the project, as they are
 * #         │    └ after the name: for the project too
 * #         └ the name of the project
 * ```
 *
 * A flag before `--` is one of `cho serve`. So a flag of the project goes
 * after `--`, where `cho` reads nothing.
 *
 * @module
 */

import type { ChoArgs } from "@chojs/command";
import { type Runtime, RUNTIMES } from "../new/config.ts";
import { check_flags, read_choice } from "../new/flags.ts";

/**
 * The flags, as `@Action("serve", SERVE_FLAGS)` declares them.
 *
 * `watch` is on unless it is turned off: `--no-watch`.
 */
export const SERVE_FLAGS = {
  string: ["runtime"],
  boolean: ["watch"],
  negatable: ["watch"],
  default: { watch: true },
  describe: {
    runtime: `The runtime to run it on, for this run: ${RUNTIMES.join(", ")}`,
    watch: "Run it again when a file changes",
  },
} as const;

/** The names `ctx.args` can have. */
const KNOWN = ["runtime", "watch"];

/** What a command line said. A field that is `undefined` was not said. */
export type Flags = {
  /** The name of the project: the first word after `serve`. */
  name: string | undefined;
  /** The arguments of the project: the words after its name, and after `--`. */
  args: string[];
  /** `--runtime`. */
  runtime: Runtime | undefined;
  /** `false` for `--no-watch`: the project is not run again on a change. */
  watch: boolean;
};

/**
 * Read the flags of `cho serve`, and check them.
 *
 * The parser puts the words after `--` with the ones before it. The command
 * line, as it was given, says where `--` is: with no name before it, the
 * words after it are not taken for one.
 *
 * @param args The parsed command line: `ctx.args`.
 * @param argv The command line, as it was given: `ctx.argv`.
 * @returns What the command line said.
 * @throws {ChoError} `CHO_CLI_INVALID_OPTION` for a flag the command does
 *   not have, or a runtime that is not one of the three.
 */
export function read_flags(args: ChoArgs, argv: readonly string[]): Flags {
  check_flags(
    args,
    KNOWN,
    "cho serve",
    "A flag of the project goes after --. ",
  );
  const words = args._.map(String);
  const dashes = argv.indexOf("--");
  const after = dashes === -1 ? 0 : argv.length - dashes - 1;
  // the words before `--`: the name, then arguments of the project
  const [name, ...before] = words.slice(0, words.length - after);
  return {
    name,
    args: [...before, ...words.slice(words.length - after)],
    runtime: read_choice("--runtime", args.runtime, RUNTIMES),
    watch: args.watch !== false,
  };
}
