/**
 * The errors of `@chojs/command`: the codes of its mistakes, and the function that
 * makes them.
 *
 * @module
 */

import type { ChoError } from "@chojs/core";
import { make_error } from "@chojs/core/utils";

/**
 * The codes of the errors of `@chojs/command`. Each is described in `specs.md`, section 7.
 *
 * A mistake the core finds for the package has a code of the core
 * (`ChoCoreErrorCode` of `@chojs/core`): an unknown option is
 * `CHO_CORE_UNKNOWN_OPTION`.
 */
export type ChoCommandErrorCode =
  | "CHO_COMMAND_AMBIGUOUS_CLASS"
  | "CHO_COMMAND_DUPLICATE_ACTION"
  | "CHO_COMMAND_DUPLICATE_DECORATOR"
  | "CHO_COMMAND_DUPLICATE_MAIN"
  | "CHO_COMMAND_INVALID_ARGUMENT"
  | "CHO_COMMAND_INVALID_FLAGS"
  | "CHO_COMMAND_INVALID_METHOD"
  | "CHO_COMMAND_INVALID_TARGET"
  | "CHO_COMMAND_MIXED_COMMANDS"
  | "CHO_COMMAND_NOT_VISIBLE"
  | "CHO_COMMAND_NO_COMMANDS"
  | "CHO_COMMAND_RESERVED_FLAG";

/**
 * Make an error of `@chojs/command`.
 *
 * @param code The code of the mistake.
 * @param message What went wrong.
 * @param options The `cause`.
 * @returns The error, to throw.
 */
export function command_error(
  code: ChoCommandErrorCode,
  message: string,
  options?: ErrorOptions,
): ChoError<ChoCommandErrorCode> {
  return make_error(code, message, options, command_error);
}
