/**
 * The `help` command: `cho help`, and `cho help <command>`.
 *
 * `@chojs/command` already writes the help of an application, for `--help`.
 * So the command writes nothing itself: it runs the command line that asks
 * for the same help.
 *
 * @module
 */

import {
  Action,
  type ChoCommandContext,
  Controller,
  Help,
  token,
} from "@chojs/command";

/**
 * Runs a command line of the application, and resolves to its exit code. A
 * command asks for it to run another one.
 */
export const RUN = token<(argv: string[]) => Promise<number>>("RUN");

/** The commands that say how the tool is used. */
@Controller({ dependencies: [RUN] })
export class HelpCommands {
  readonly #run: (argv: string[]) => Promise<number>;

  /** @param run Runs a command line of the application. */
  constructor(run: (argv: string[]) => Promise<number>) {
    this.#run = run;
  }

  /**
   * `cho help` is `cho --help`, and `cho help <command>` is
   * `cho <command> --help`.
   *
   * @param ctx The context of the run: its first argument names a command.
   * @returns The exit code.
   */
  @Help(
    "Show the help of cho, or of one of its commands\n\n" +
      "  cho help            every command\n" +
      "  cho help <command>  one command, and its options",
  )
  @Action("help")
  help(ctx: ChoCommandContext): Promise<number> {
    const [command] = ctx.args._;
    return this.#run(
      command === undefined ? ["--help"] : [String(command), "--help"],
    );
  }
}
