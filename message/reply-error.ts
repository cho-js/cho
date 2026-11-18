/**
 * An error that says what who asked is told: {@link ReplyError}. It is to a
 * message what `HttpError` is to a request of `@chojs/web`.
 *
 * @module
 */

import { assert_known_options } from "@chojs/core/di";
import { describe } from "@chojs/core/utils";
import { message_error } from "./errors.ts";

/**
 * What marks a {@link ReplyError}. It is on the prototype, under a symbol
 * every copy of the package shares, so that an error of another copy of
 * `@chojs/message` is still one: `instanceof` would not see it.
 */
const BRAND = Symbol.for("cho.message.reply_error");

/** The options of {@link ReplyError}. */
export type ReplyErrorOptions = {
  /** The error that led to this one. It is logged, and never sent. */
  cause?: unknown;
};

/**
 * An error with a code and a description, for who asked.
 *
 * - **A handler throws one** to say what a requester is told: an adapter
 *   whose broker has replies answers with its code and its description, in
 *   place of what it tells for any other error.
 * - **Who asks gets one**: `ChoMessageClient.request` rejects with it when
 *   the other side answered with an error.
 *
 * It is an error like any other for the rest: it goes to the nearest error
 * handler first, and a message that asks for no reply fails with it.
 *
 * @example
 * ```ts
 * @Subscribe(GetPrice)
 * price(request: { id: number }) {
 *   const order = this.orders.find(request.id);
 *   if (!order) {
 *     throw new ReplyError(404, "Not Found");
 *   }
 *   return { id: order.id, price: order.price };
 * }
 *
 * // who asked
 * try {
 *   await client.request(GetPrice, { id: 7 });
 * } catch (error) {
 *   if (isReplyError(error, 404)) {
 *     // no such order
 *   }
 * }
 * ```
 */
export class ReplyError extends Error {
  /** The code of the error: `404`, `409`, … */
  readonly code: number;

  /**
   * Make an error for who asked.
   *
   * @param code The code: a whole number, 1 or more. The codes of HTTP are
   *   the ones a requester expects (`400`, `404`, `409`, `500`).
   * @param description What went wrong, in a few words, on one line: it is
   *   sent. It is the `message` of the error.
   * @param options The cause.
   * @throws {ChoError} `CHO_MESSAGE_INVALID_REPLY_ERROR` when the code is not
   *   a whole number of 1 or more, when the description is not a string of
   *   one line, or when the options are not an object;
   *   `CHO_CORE_UNKNOWN_OPTION` for an option that does not exist.
   */
  constructor(
    code: number,
    description: string,
    options: ReplyErrorOptions = {},
  ) {
    if (!Number.isInteger(code) || code < 1) {
      throw message_error(
        "CHO_MESSAGE_INVALID_REPLY_ERROR",
        `ReplyError: the code must be a whole number, 1 or more, got ${
          describe(code)
        }`,
      );
    }
    if (
      typeof description !== "string" || description.trim() === "" ||
      /[\r\n]/.test(description)
    ) {
      throw message_error(
        "CHO_MESSAGE_INVALID_REPLY_ERROR",
        `ReplyError: the description must be a string of one line, got ${
          describe(description)
        }`,
      );
    }
    if (typeof options !== "object" || options === null) {
      throw message_error(
        "CHO_MESSAGE_INVALID_REPLY_ERROR",
        `ReplyError: the options must be an object, got ${describe(options)}`,
      );
    }
    assert_known_options("ReplyError", options, ["cause"]);
    super(
      description,
      "cause" in options ? { cause: options.cause } : undefined,
    );
    this.code = code;
  }

  /** What went wrong, for who asked: the `message` of the error. */
  get description(): string {
    return this.message;
  }
}
Object.defineProperty(ReplyError.prototype, "name", {
  value: "ReplyError",
  writable: true,
  configurable: true,
});
Object.defineProperty(ReplyError.prototype, BRAND, { value: true });

/**
 * Whether a value is a {@link ReplyError}, of any copy of the package.
 *
 * @param value Any value: what was caught.
 * @param code A code: the error must have it too.
 * @returns `true` for a reply error, with the code when one is given.
 *
 * @example
 * ```ts
 * if (isReplyError(error, 404)) {
 *   return undefined;
 * }
 * ```
 */
export function isReplyError(
  value: unknown,
  code?: number,
): value is ReplyError {
  return typeof value === "object" && value !== null &&
    (value as Record<symbol, unknown>)[BRAND] === true &&
    (code === undefined || (value as ReplyError).code === code);
}
