/**
 * `HttpError`: what an application throws to answer a request with a status.
 *
 * It is not a mistake the framework found, so it is not a `ChoError` and has
 * no code. It is an error like any other for the error handlers (`@Catch`,
 * `onError`): only when none of them answers is it answered by itself, where
 * any other error is answered `500`.
 *
 * @module
 */

import { assert_known_options } from "@chojs/core/di";
import { describe } from "@chojs/core/utils";
import { web_error } from "./errors.ts";

/**
 * What marks an `HttpError`. A registered symbol: two copies of this module in
 * one process share it, where each has a class of its own.
 */
const BRAND = Symbol.for("cho.http_error");

/** The text of the statuses an `HttpError` can have (RFC 9110, and the registry). */
const STATUS_TEXT: Readonly<Record<number, string>> = {
  400: "Bad Request",
  401: "Unauthorized",
  402: "Payment Required",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  406: "Not Acceptable",
  407: "Proxy Authentication Required",
  408: "Request Timeout",
  409: "Conflict",
  410: "Gone",
  411: "Length Required",
  412: "Precondition Failed",
  413: "Content Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  416: "Range Not Satisfiable",
  417: "Expectation Failed",
  418: "I'm a teapot",
  421: "Misdirected Request",
  422: "Unprocessable Content",
  423: "Locked",
  424: "Failed Dependency",
  425: "Too Early",
  426: "Upgrade Required",
  428: "Precondition Required",
  429: "Too Many Requests",
  431: "Request Header Fields Too Large",
  451: "Unavailable For Legal Reasons",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
  505: "HTTP Version Not Supported",
  506: "Variant Also Negotiates",
  507: "Insufficient Storage",
  508: "Loop Detected",
  510: "Not Extended",
  511: "Network Authentication Required",
};

/**
 * The text of a status: `Not Found` for `404`.
 *
 * @param status A status from 400 to 599.
 * @returns Its text, or `Error` for a status that has none.
 */
export function status_text(status: number): string {
  return STATUS_TEXT[status] ?? "Error";
}

/** The options of an {@link HttpError}. */
export type HttpErrorOptions = {
  /**
   * Headers of the answer: `www-authenticate` of a `401`, `retry-after` of a
   * `429`, …
   */
  headers?: HeadersInit;
  /** The error that led to this one. It is logged, and never sent. */
  cause?: unknown;
};

/**
 * An error that answers a request with a status.
 *
 * Throw it anywhere a request is handled: in a handler, in a middleware, in a
 * function of `@Args`. An error handler (`@Catch`, `onError`) gets it first,
 * like any error. When none answers, the request is answered with the status,
 * the headers, and a JSON body:
 *
 * ```json
 * { "error": "no such user" }
 * ```
 *
 * **Below 500 the message is sent to the client**: write it for the client.
 * From 500 only the text of the status is sent (`Internal Server Error`), and
 * the message is for the logs.
 *
 * @example
 * ```ts
 * @Get(":id")
 * @Args(Param("id"))
 * get(id: string) {
 *   const user = users.get(id);
 *   if (!user) {
 *     throw new HttpError(404, "no such user");
 *   }
 *   return user;
 * }
 * ```
 *
 * @example With headers, and with the error that led to it
 * ```ts
 * throw new HttpError(401, "token expired", {
 *   headers: { "www-authenticate": "Bearer" },
 * });
 * throw new HttpError(503, "the database is down", { cause: error });
 * ```
 */
export class HttpError extends Error {
  /** The status of the answer: from 400 to 599. */
  readonly status: number;
  /** The headers of the answer. */
  readonly headers: Headers;

  /**
   * Make an error that answers with a status.
   *
   * @param status The status: a whole number from 400 to 599.
   * @param message What went wrong. Default: the text of the status
   *   (`Not Found`).
   * @param options The headers of the answer, and the cause.
   * @throws {ChoError} `CHO_WEB_INVALID_STATUS` when the status is not one an
   *   error can have; `CHO_WEB_INVALID_OPTION` when the message is not a
   *   string, or the headers are not headers; `CHO_CORE_UNKNOWN_OPTION` for
   *   an option that does not exist.
   */
  constructor(
    status: number,
    message?: string,
    options: HttpErrorOptions = {},
  ) {
    if (!Number.isInteger(status) || status < 400 || status > 599) {
      throw web_error(
        "CHO_WEB_INVALID_STATUS",
        `HttpError: the status must be a whole number from 400 to 599, got ${
          describe(status)
        }`,
      );
    }
    if (message !== undefined && typeof message !== "string") {
      throw web_error(
        "CHO_WEB_INVALID_OPTION",
        `HttpError: the message must be a string, got ${describe(message)}`,
      );
    }
    if (typeof options !== "object" || options === null) {
      throw web_error(
        "CHO_WEB_INVALID_OPTION",
        `HttpError: the options must be an object, got ${describe(options)}`,
      );
    }
    assert_known_options("HttpError", options, ["cause", "headers"]);
    let headers: Headers;
    try {
      headers = new Headers(options.headers);
    } catch (cause) {
      throw web_error(
        "CHO_WEB_INVALID_OPTION",
        `HttpError: the headers must be what new Headers() takes, got ${
          describe(options.headers)
        }`,
        { cause },
      );
    }
    super(
      message || status_text(status),
      "cause" in options ? { cause: options.cause } : undefined,
    );
    this.status = status;
    this.headers = headers;
  }

  /**
   * The answer of the error: its status, its headers, and
   * `{ "error": "<message>" }` as JSON. From 500 the body has the text of the
   * status in place of the message.
   *
   * It is what a request is answered with when no error handler answers. An
   * error handler calls it to answer the same way after doing something of
   * its own.
   *
   * @returns A new response for each call.
   *
   * @example
   * ```ts
   * onError: (error, ctx) => {
   *   if (isHttpError(error)) {
   *     metrics.count(error.status, ctx.url.pathname);
   *     return error.toResponse();
   *   }
   * },
   * ```
   */
  toResponse(): Response {
    return Response.json(
      { error: this.status < 500 ? this.message : status_text(this.status) },
      { status: this.status, headers: new Headers(this.headers) },
    );
  }
}

// The name is on the prototype, as the name of a native error is.
Object.defineProperties(HttpError.prototype, {
  name: { value: "HttpError", writable: true, configurable: true },
  [BRAND]: { value: true },
});

/**
 * Whether a value is an {@link HttpError}.
 *
 * It does not use `instanceof`, which is false for an error made by another
 * copy of the package: a middleware of another package can bring one.
 *
 * @param value What was thrown.
 * @returns `true` for an `HttpError`.
 *
 * @example
 * ```ts
 * @Catch((error) => {
 *   if (isHttpError(error) && error.status === 404) {
 *     return new Response("nothing here", { status: 404 });
 *   }
 * })
 * ```
 */
export function isHttpError(value: unknown): value is HttpError {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const error = value as {
    [BRAND]?: unknown;
    status?: unknown;
    toResponse?: unknown;
  };
  return error[BRAND] === true && typeof error.status === "number" &&
    typeof error.toResponse === "function";
}
