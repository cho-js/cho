/**
 * The errors of `@chojs/openapi`: the codes of its mistakes, and the function that
 * makes them.
 *
 * @module
 */

import type { ChoError } from "@chojs/core";
import { make_error } from "@chojs/core/utils";

/**
 * The codes of the errors of `@chojs/openapi`. Each is described in `specs.md`, section 8.
 *
 * A mistake the core finds for the package has a code of the core
 * (`ChoCoreErrorCode` of `@chojs/core`): an unknown option is
 * `CHO_CORE_UNKNOWN_OPTION`.
 */
export type ChoOpenApiErrorCode =
  | "CHO_OPENAPI_DUPLICATE_OPERATION_ID"
  | "CHO_OPENAPI_INVALID_OPTION"
  | "CHO_OPENAPI_UNKNOWN_SECURITY_SCHEME"
  | "CHO_OPENAPI_UNKNOWN_UI";

/**
 * Make an error of `@chojs/openapi`.
 *
 * @param code The code of the mistake.
 * @param message What went wrong.
 * @param options The `cause`.
 * @returns The error, to throw.
 */
export function openapi_error(
  code: ChoOpenApiErrorCode,
  message: string,
  options?: ErrorOptions,
): ChoError<ChoOpenApiErrorCode> {
  return make_error(code, message, options, openapi_error);
}
