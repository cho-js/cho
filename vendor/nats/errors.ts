/**
 * The errors of `@chojs/vendor-nats`: the codes of its mistakes, and the function that
 * makes them.
 *
 * @module
 */

import type { ChoError } from "@chojs/core";
import { make_error } from "@chojs/core/utils";

/**
 * The codes of the errors of `@chojs/vendor-nats`. Each is described in `specs.md`, section 6.
 *
 * A mistake the core finds for the package has a code of the core
 * (`ChoCoreErrorCode` of `@chojs/core`): an unknown option is
 * `CHO_CORE_UNKNOWN_OPTION`.
 */
export type ChoNatsErrorCode =
  | "CHO_NATS_ALREADY_LINKED"
  | "CHO_NATS_CONNECTION_CLOSED"
  | "CHO_NATS_INVALID_CONNECTION"
  | "CHO_NATS_INVALID_OPTION"
  | "CHO_NATS_NOT_STARTED"
  | "CHO_NATS_REPLY_FAILED"
  | "CHO_NATS_SUBSCRIPTION_FAILED";

/**
 * Make an error of `@chojs/vendor-nats`.
 *
 * @param code The code of the mistake.
 * @param message What went wrong.
 * @param options The `cause`.
 * @returns The error, to throw.
 */
export function nats_error(
  code: ChoNatsErrorCode,
  message: string,
  options?: ErrorOptions,
): ChoError<ChoNatsErrorCode> {
  return make_error(code, message, options, nats_error);
}
