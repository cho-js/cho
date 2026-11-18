/**
 * The errors of `@chojs/vendor-kafka`: the codes of its mistakes, and the function that
 * makes them.
 *
 * @module
 */

import type { ChoError } from "@chojs/core";
import { make_error } from "@chojs/core/utils";

/**
 * The codes of the errors of `@chojs/vendor-kafka`. Each is described in `specs.md`, section 5.
 *
 * A mistake the core finds for the package has a code of the core
 * (`ChoCoreErrorCode` of `@chojs/core`): an unknown option is
 * `CHO_CORE_UNKNOWN_OPTION`.
 */
export type ChoKafkaErrorCode =
  | "CHO_KAFKA_ALREADY_LINKED"
  | "CHO_KAFKA_CONSUME_FAILED"
  | "CHO_KAFKA_DEAD_LETTER_FAILED"
  | "CHO_KAFKA_INVALID_DEAD_LETTER"
  | "CHO_KAFKA_INVALID_OPTION"
  | "CHO_KAFKA_INVALID_TOPIC"
  | "CHO_KAFKA_NO_DEAD_LETTER";

/**
 * Make an error of `@chojs/vendor-kafka`.
 *
 * @param code The code of the mistake.
 * @param message What went wrong.
 * @param options The `cause`.
 * @returns The error, to throw.
 */
export function kafka_error(
  code: ChoKafkaErrorCode,
  message: string,
  options?: ErrorOptions,
): ChoError<ChoKafkaErrorCode> {
  return make_error(code, message, options, kafka_error);
}
