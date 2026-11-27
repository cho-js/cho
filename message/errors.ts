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
  | "CHO_MESSAGE_INVALID_CLIENT"
  | "CHO_MESSAGE_INVALID_CONTRACT"
  | "CHO_MESSAGE_INVALID_INJECTOR"
  | "CHO_MESSAGE_INVALID_MESSAGE"
  | "CHO_MESSAGE_INVALID_OPTION"
  | "CHO_MESSAGE_INVALID_REPLY"
  | "CHO_MESSAGE_INVALID_REPLY_ERROR"
  | "CHO_MESSAGE_INVALID_TARGET"
  | "CHO_MESSAGE_INVALID_TOPIC"
  | "CHO_MESSAGE_INVALID_VALUE"
  | "CHO_MESSAGE_NO_LINKER"
  | "CHO_MESSAGE_NO_REPLIES"
  | "CHO_MESSAGE_NO_RESPONDERS"
  | "CHO_MESSAGE_REQUEST_TIMEOUT"
  | "CHO_MESSAGE_UNEXPECTED_REPLY"
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

/**
 * Make the error of a request that got no answer. It is for the senders of
 * the adapters: `ChoMessageClient.request` rejects with what they throw.
 *
 * @param code `CHO_MESSAGE_NO_RESPONDERS` when the broker says that nobody
 *   listens; `CHO_MESSAGE_REQUEST_TIMEOUT` when no answer came in time.
 * @param topic The topic of the request.
 * @param options The `cause`: the error of the client library.
 * @returns The error, to throw.
 */
export function request_error(
  code: "CHO_MESSAGE_NO_RESPONDERS" | "CHO_MESSAGE_REQUEST_TIMEOUT",
  topic: string,
  options?: ErrorOptions,
): ChoError<ChoMessageErrorCode> {
  return make_error(
    code,
    code === "CHO_MESSAGE_NO_RESPONDERS"
      ? `No answer to the request of "${topic}": nobody listens to it`
      : `No answer to the request of "${topic}": the time to wait is over`,
    options,
    request_error,
  );
}
