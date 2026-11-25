/**
 * The errors of `@chojs/vendor-cho`: the codes of its mistakes, and the function that
 * makes them.
 *
 * @module
 */

import type { ChoError } from "@chojs/core";
import { make_error } from "@chojs/core/utils";

/**
 * The codes of the errors of `@chojs/vendor-cho`. Each is described in `specs.md`,
 * section 14.
 *
 * A mistake the core finds for the package has a code of the core
 * (`ChoCoreErrorCode` of `@chojs/core`): an unknown option is
 * `CHO_CORE_UNKNOWN_OPTION`.
 */
export type ChoVendorErrorCode =
  | "CHO_VENDOR_BODY_TOO_LARGE"
  | "CHO_VENDOR_INVALID_OPTION";

/**
 * Make an error of `@chojs/vendor-cho`.
 *
 * @param code The code of the mistake.
 * @param message What went wrong.
 * @param options The `cause`.
 * @returns The error, to throw.
 */
export function vendor_error(
  code: ChoVendorErrorCode,
  message: string,
  options?: ErrorOptions,
): ChoError<ChoVendorErrorCode> {
  return make_error(code, message, options, vendor_error);
}
