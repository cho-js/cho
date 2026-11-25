/**
 * The errors of the `cho` tool.
 *
 * A mistake the tool finds is a `ChoError` of the framework: an `Error` with
 * a `code`. The code is stable, where the message is for people.
 *
 * {@link print_error} is what a command does with an error: it prints it,
 * and gives the exit code.
 *
 * @module
 */

import { ChoError, isChoError } from "@chojs/command";

/** The codes of the errors of the tool. `specs.md`, section 10, has each. */
export type ChoCliErrorCode =
  | "CHO_CLI_INVALID_CONFIG"
  | "CHO_CLI_INVALID_MANIFEST"
  | "CHO_CLI_INVALID_NAME"
  | "CHO_CLI_INVALID_OPTION"
  | "CHO_CLI_NO_WORKSPACE"
  | "CHO_CLI_PROJECT_EXISTS"
  | "CHO_CLI_TARGET_EXISTS"
  | "CHO_CLI_WRITE_FAILED";

/**
 * Make an error of the tool.
 *
 * @param code The code of the mistake.
 * @param message What went wrong.
 * @param options The `cause`, when an error of the system led to this one.
 * @returns The error, to throw.
 */
export function cli_error(
  code: ChoCliErrorCode,
  message: string,
  options?: ErrorOptions,
): ChoError<ChoCliErrorCode> {
  return new ChoError(code, message, options);
}

/** The exit code of a command that was interrupted: 128, and the signal. */
const CANCELLED = 130;

/**
 * Print the error of a command, and give its exit code.
 *
 * @param error What the command threw.
 * @param command The command, as it is typed: `cho new`.
 * @returns `130` for a question that was cancelled, `1` for anything else.
 */
export function print_error(error: unknown, command: string): number {
  if (isChoError(error, "CHO_PROMPT_CANCELLED")) {
    console.error("Cancelled.");
    return CANCELLED;
  }
  if (isChoError(error, "CHO_PROMPT_NO_TERMINAL")) {
    console.error(
      "Error: There is no terminal to ask on. Give every answer as a flag, " +
        `or --yes for the defaults: see ${command} --help`,
    );
    return 1;
  }
  console.error(
    `Error: ${error instanceof Error ? error.message : String(error)}`,
  );
  return 1;
}
