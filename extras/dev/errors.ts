/**
 * The errors of `@chojs/dev`: the codes of its mistakes, and the function that
 * makes them.
 *
 * @module
 */

import type { ChoError } from "@chojs/core";
import { make_error } from "@chojs/core/utils";

/**
 * The codes of the errors of `@chojs/dev`. Each is described in `specs.md`,
 * section 8.
 *
 * A mistake the core finds for the package has a code of the core
 * (`ChoCoreErrorCode` of `@chojs/core`): an unknown option is
 * `CHO_CORE_UNKNOWN_OPTION`, and a target that is a class with no `@Module` is
 * `CHO_CORE_NOT_A_MODULE`.
 */
export type ChoDevErrorCode =
  | "CHO_DEV_INVALID_OPTION"
  | "CHO_DEV_INVALID_TARGET"
  | "CHO_DEV_UNKNOWN_NODE";

/**
 * Make an error of `@chojs/dev`.
 *
 * @param code The code of the mistake.
 * @param message What went wrong.
 * @param options The `cause`.
 * @returns The error, to throw.
 */
export function dev_error(
  code: ChoDevErrorCode,
  message: string,
  options?: ErrorOptions,
): ChoError<ChoDevErrorCode> {
  return make_error(code, message, options, dev_error);
}
