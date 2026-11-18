/**
 * The errors of `@chojs/message`: the codes of its mistakes, and the function that
 * makes them.
 *
 * @module
 */

import type { ChoError } from "@chojs/core";
import { make_error } from "@chojs/core/utils";

/**
 * The codes of the errors of `@chojs/message`. Each is described in `specs.md`, section 9.
 *
 * A mistake the core finds for the package has a code of the core
 * (`ChoCoreErrorCode` of `@chojs/core`): an unknown option is
 * `CHO_CORE_UNKNOWN_OPTION`.
 */
export type ChoMessageErrorCode =
  | "CHO_MESSAGE_CLOSED"
  | "CHO_MESSAGE_CREATE_FAILED"
  | "CHO_MESSAGE_DUPLICATE_DECORATOR"
  | "CHO_MESSAGE_DUPLICATE_TOPIC"
  | "CHO_MESSAGE_INVALID_ARGUMENT"
  | "CHO_MESSAGE_INVALID_INJECTOR"
  | "CHO_MESSAGE_INVALID_MESSAGE"
  | "CHO_MESSAGE_INVALID_REPLY"
  | "CHO_MESSAGE_INVALID_TARGET"
  | "CHO_MESSAGE_INVALID_TOPIC"
  | "CHO_MESSAGE_INVALID_VALUE"
  | "CHO_MESSAGE_NO_LINKER"
  | "CHO_MESSAGE_UNKNOWN_TOPIC";

/**
 * Make an error of `@chojs/message`.
 *
 * @param code The code of the mistake.
 * @param message What went wrong.
 * @param options The `cause`.
 * @returns The error, to throw.
 */
export function message_error(
  code: ChoMessageErrorCode,
  message: string,
  options?: ErrorOptions,
): ChoError<ChoMessageErrorCode> {
  return make_error(code, message, options, message_error);
}
