/**
 * The errors of `@chojs/vendor-hono`: the codes of its mistakes, and the function that
 * makes them.
 *
 * @module
 */

import type { ChoError } from "@chojs/core";
import { make_error } from "@chojs/core/utils";

/**
 * The codes of the errors of `@chojs/vendor-hono`. Each is described in `README.md`.
 *
 * A mistake the core finds for the package has a code of the core
 * (`ChoCoreErrorCode` of `@chojs/core`): an unknown option is
 * `CHO_CORE_UNKNOWN_OPTION`.
 */
export type ChoHonoErrorCode =
  | "CHO_HONO_ALREADY_LINKED"
  | "CHO_HONO_WRONG_ADAPTER";

/**
 * Make an error of `@chojs/vendor-hono`.
 *
 * @param code The code of the mistake.
 * @param message What went wrong.
 * @param options The `cause`.
 * @returns The error, to throw.
 */
export function hono_error(
  code: ChoHonoErrorCode,
  message: string,
  options?: ErrorOptions,
): ChoError<ChoHonoErrorCode> {
  return make_error(code, message, options, hono_error);
}
