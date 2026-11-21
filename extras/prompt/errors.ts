/**
 * The errors of `@chojs/prompt`: the codes of its mistakes, and the function
 * that makes them.
 *
 * @module
 */

import type { ChoError } from "@chojs/core";
import { make_error } from "@chojs/core/utils";

/**
 * The codes of the errors of `@chojs/prompt`. Each is described in
 * `specs.md`, section 7.
 *
 * An option that does not exist has a code of the core:
 * `CHO_CORE_UNKNOWN_OPTION` (`ChoCoreErrorCode` of `@chojs/core`).
 */
export type ChoPromptErrorCode =
  | "CHO_PROMPT_BUSY"
  | "CHO_PROMPT_CANCELLED"
  | "CHO_PROMPT_INVALID_OPTION"
  | "CHO_PROMPT_NO_TERMINAL";

/**
 * Make an error of `@chojs/prompt`.
 *
 * @param code The code of the mistake.
 * @param message What went wrong.
 * @param options The `cause`.
 * @returns The error, to throw.
 */
export function prompt_error(
  code: ChoPromptErrorCode,
  message: string,
  options?: ErrorOptions,
): ChoError<ChoPromptErrorCode> {
  return make_error(code, message, options, prompt_error);
}
