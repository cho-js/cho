/**
 * The errors of the `cho` tool.
 *
 * A mistake the tool finds is a `ChoError` of the framework: an `Error` with
 * a `code`. The code is stable, where the message is for people.
 *
 * @module
 */

import { ChoError } from "@chojs/command";

/** The codes of the errors of the tool. `specs.md`, section 9, has each. */
export type ChoCliErrorCode =
  | "CHO_CLI_INVALID_CONFIG"
  | "CHO_CLI_INVALID_NAME"
  | "CHO_CLI_INVALID_OPTION"
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
