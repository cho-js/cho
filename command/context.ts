/**
 * The command context: what the command methods, the middlewares and the
 * error handlers of a `@chojs/command` application receive.
 *
 * @module
 */

import type { ChoArgs } from "./args.ts";

/**
 * The context of one run: one command line, and the command it runs.
 *
 * @example
 * ```ts
 * @Controller()
 * class Files {
 *   // ./fs copy a.txt b.txt --force
 *   @Action("copy", { boolean: ["force"] })
 *   copy(ctx: ChoCommandContext) {
 *     ctx.args._;     // ["a.txt", "b.txt"]
 *     ctx.args.force; // true
 *     ctx.command;    // "copy"
 *   }
 * }
 * ```
 */
export interface ChoCommandContext {
  /**
   * The parsed command line: the positionals in `_`, and the flags. In
   * multi-command mode, `_` does not include the command name. The reserved
   * `--help` and `--version` flags are never in it.
   */
  readonly args: ChoArgs;
  /** The command line, as it was given to `run()`. */
  readonly argv: readonly string[];
  /** The command that runs: `"main"`, or the name of the action. */
  readonly command: string;
  /**
   * Values shared during the run: a middleware sets one (an opened
   * configuration, say) for the middlewares and the command after it.
   */
  readonly state: Map<PropertyKey, unknown>;
}

/**
 * Create the context of a run.
 *
 * @param args The parsed command line.
 * @param argv The command line, as given to `run()`.
 * @param command The command that runs.
 * @returns The context.
 */
export function create_context(
  args: ChoArgs,
  argv: readonly string[],
  command: string,
): ChoCommandContext {
  return { args, argv: [...argv], command, state: new Map() };
}
