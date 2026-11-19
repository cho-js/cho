/**
 * The errors of `@chojs/web`: the codes of its mistakes, and the function
 * that makes them.
 *
 * An `HttpError` is not one of them: it is what an application throws to
 * answer a request, and it has a status, not a code (`http-error.ts`).
 *
 * @module
 */

import type { ChoError } from "@chojs/core";
import { make_error } from "@chojs/core/utils";

/**
 * The codes of the errors of `@chojs/web`. Each is described in `specs.md`,
 * section 9.
 *
 * A mistake the core finds for a web application has a code of the core
 * (`ChoCoreErrorCode` of `@chojs/core`): an unknown option of a decorator is
 * `CHO_CORE_UNKNOWN_OPTION`.
 */
export type ChoWebErrorCode =
  | "CHO_WEB_CLOSED"
  | "CHO_WEB_CREATE_FAILED"
  | "CHO_WEB_DUPLICATE_DECORATOR"
  | "CHO_WEB_DUPLICATE_ROUTE"
  | "CHO_WEB_INVALID_ARGUMENT"
  | "CHO_WEB_INVALID_EVENT"
  | "CHO_WEB_INVALID_HANDLER"
  | "CHO_WEB_INVALID_METHOD"
  | "CHO_WEB_INVALID_MIDDLEWARE"
  | "CHO_WEB_INVALID_OPTION"
  | "CHO_WEB_INVALID_ROUTE"
  | "CHO_WEB_INVALID_SOCKET"
  | "CHO_WEB_INVALID_SOCKET_RESULT"
  | "CHO_WEB_INVALID_SSE_RESULT"
  | "CHO_WEB_INVALID_STATUS"
  | "CHO_WEB_INVALID_TARGET"
  | "CHO_WEB_NO_SERVER"
  | "CHO_WEB_NO_URL_PATTERN"
  | "CHO_WEB_UNKNOWN_PARAM";

/**
 * Make an error of `@chojs/web`.
 *
 * @param code The code of the mistake.
 * @param message What went wrong.
 * @param options The `cause`.
 * @returns The error, to throw.
 */
export function web_error(
  code: ChoWebErrorCode,
  message: string,
  options?: ErrorOptions,
): ChoError<ChoWebErrorCode> {
  return make_error(code, message, options, web_error);
}
