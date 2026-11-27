/**
 * The errors of `@chojs/asyncapi`: the codes of its mistakes, and the function that
 * makes them.
 *
 * @module
 */

import type { ChoError } from "@chojs/core";
import { make_error } from "@chojs/core/utils";

/**
 * The codes of the errors of `@chojs/asyncapi`. Each is described in `specs.md`, section 8.
 *
 * A mistake the core finds for the package has a code of the core
 * (`ChoCoreErrorCode` of `@chojs/core`): an unknown option is
 * `CHO_CORE_UNKNOWN_OPTION`.
 */
export type ChoAsyncApiErrorCode =
  | "CHO_ASYNCAPI_DUPLICATE_OPERATION_ID"
  | "CHO_ASYNCAPI_INVALID_OPTION";

/**
 * Make an error of `@chojs/asyncapi`.
 *
 * @param code The code of the mistake.
 * @param message What went wrong.
 * @param options The `cause`.
 * @returns The error, to throw.
 */
export function asyncapi_error(
  code: ChoAsyncApiErrorCode,
  message: string,
  options?: ErrorOptions,
): ChoError<ChoAsyncApiErrorCode> {
  return make_error(code, message, options, asyncapi_error);
}
