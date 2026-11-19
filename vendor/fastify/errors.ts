/**
 * The errors of `@chojs/vendor-fastify`: the codes of its mistakes, and the function that
 * makes them.
 *
 * @module
 */

import type { ChoError } from "@chojs/core";
import { make_error } from "@chojs/core/utils";

/**
 * The codes of the errors of `@chojs/vendor-fastify`. Each is described in `README.md`.
 *
 * A mistake the core finds for the package has a code of the core
 * (`ChoCoreErrorCode` of `@chojs/core`): an unknown option is
 * `CHO_CORE_UNKNOWN_OPTION`.
 */
export type ChoFastifyErrorCode =
  | "CHO_FASTIFY_ALREADY_LINKED"
  | "CHO_FASTIFY_HOOK_FAILED"
  | "CHO_FASTIFY_MOUNT_TOO_LATE"
  | "CHO_FASTIFY_NO_SOCKET"
  | "CHO_FASTIFY_WRONG_ADAPTER";

/**
 * Make an error of `@chojs/vendor-fastify`.
 *
 * @param code The code of the mistake.
 * @param message What went wrong.
 * @param options The `cause`.
 * @returns The error, to throw.
 */
export function fastify_error(
  code: ChoFastifyErrorCode,
  message: string,
  options?: ErrorOptions,
): ChoError<ChoFastifyErrorCode> {
  return make_error(code, message, options, fastify_error);
}
