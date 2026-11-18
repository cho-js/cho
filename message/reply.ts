/**
 * The reply of a message: {@link ChoMessageReply}, a reply with headers that
 * a handler returns, and `to_reply`, which converts what a handler or an
 * error handler returned into the reply (what `to_response` is for
 * `@chojs/web`).
 *
 * @module
 */

import { assert_known_options } from "@chojs/core/di";
import { describe } from "@chojs/core/utils";
import { message_error } from "./errors.ts";
import type { Reply } from "./linker.ts";

const encoder = new TextEncoder();
const EMPTY = new Uint8Array(0);

/**
 * What marks a {@link ChoMessageReply}. It is on the prototype, under a
 * symbol every copy of the package shares, so that a reply made by another
 * copy of `@chojs/message` is still one: `instanceof` would not see it.
 */
const BRAND = Symbol.for("cho.message.reply");

/** The options of {@link ChoMessageReply}. */
export type ChoMessageReplyOptions = {
  /** The headers of the reply: names and values, as strings. */
  readonly headers?: Readonly<Record<string, string>> | undefined;
};

/**
 * A reply with headers. A handler, or an error handler, returns one when the
 * reply needs more than its value: what a `Response` with headers is for a
 * handler of `@chojs/web`.
 *
 * The value becomes the bytes of the reply as a returned value does: bytes
 * and strings as they are, anything else as JSON. With no value, the reply
 * is empty: it is still a reply.
 *
 * Headers are sent by an adapter whose broker has replies with headers, such
 * as `@chojs/vendor-nats`.
 *
 * @example
 * ```ts
 * @Subscribe("price")
 * price(ctx: ChoMessageContext) {
 *   const { id } = ctx.json<{ id: string }>();
 *   return new ChoMessageReply({ id, total: 42 }, {
 *     headers: { "content-type": "application/json", "cache": "60" },
 *   });
 * }
 * ```
 */
export class ChoMessageReply {
  /** The value of the reply, as the handler gave it. */
  readonly value: unknown;
  /** The headers of the reply. Empty when it has none. */
  readonly headers: Readonly<Record<string, string>>;

  /**
   * Make a reply.
   *
   * @param value The value: bytes, a string, or what JSON can hold. Nothing:
   *   an empty reply.
   * @param options The headers.
   * @throws {ChoError} `CHO_MESSAGE_INVALID_REPLY` when the options are not
   *   an object, when `headers` is not an object of strings, or when the
   *   value is another `ChoMessageReply`. `CHO_CORE_UNKNOWN_OPTION` for an
   *   option that does not exist.
   */
  constructor(value?: unknown, options: ChoMessageReplyOptions = {}) {
    if (typeof options !== "object" || options === null) {
      throw invalid(
        `expected options, such as { headers: { "content-type": "application/json" } }, got ${
          describe(options)
        }`,
      );
    }
    assert_known_options("new ChoMessageReply()", options, ["headers"]);
    if (is_reply(value)) {
      throw invalid("the value of a reply cannot be another reply");
    }
    const { headers = {} } = options;
    if (
      typeof headers !== "object" || headers === null || Array.isArray(headers)
    ) {
      throw invalid(
        `"headers" is an object of strings, got ${describe(headers)}`,
      );
    }
    const checked: Record<string, string> = {};
    for (const [name, text] of Object.entries(headers)) {
      if (name === "" || typeof text !== "string") {
        throw invalid(
          name === ""
            ? "a header has no name"
            : `the header ${JSON.stringify(name)} is a string, got ${
              describe(text)
            }`,
        );
      }
      checked[name] = text;
    }
    this.value = value;
    this.headers = Object.freeze(checked);
  }
}
Object.defineProperty(ChoMessageReply.prototype, BRAND, { value: true });

/** An error of what was given to `new ChoMessageReply()`. */
function invalid(reason: string) {
  return message_error(
    "CHO_MESSAGE_INVALID_REPLY",
    `new ChoMessageReply(): ${reason}`,
  );
}

/**
 * Whether a value is a {@link ChoMessageReply}, of any copy of the package.
 *
 * @param value Any value.
 * @returns `true` for a reply made with `new ChoMessageReply()`.
 */
export function is_reply(value: unknown): value is ChoMessageReply {
  return typeof value === "object" && value !== null &&
    (value as Record<symbol, unknown>)[BRAND] === true;
}

/**
 * The reply for a returned value (already awaited):
 *
 * - `undefined` is no reply;
 * - bytes are sent as they are: a `Uint8Array`, another typed array or a
 *   `DataView` (the bytes they show), an `ArrayBuffer`;
 * - a string is sent as its UTF-8 bytes;
 * - anything else is sent as JSON, in UTF-8: objects, arrays, numbers,
 *   booleans, `null`, dates, class instances;
 * - a {@link ChoMessageReply} is its value, converted by the rules above (no
 *   value is an empty reply), with its headers when it has some.
 *
 * @param value The value a handler or an error handler returned.
 * @param name Where the value comes from, for the message of the error:
 *   `"OrdersController.created"`.
 * @returns The reply, or `undefined` when there is none.
 * @throws {ChoError} `CHO_MESSAGE_INVALID_REPLY` when the value cannot be a
 *   reply: a function or a symbol, or what `JSON.stringify` throws for (a
 *   `bigint`, a cycle), whose error is the `cause`.
 *
 * @example
 * ```ts
 * to_reply({ id: 1 }, name);               // the bytes of {"id":1}
 * to_reply("hello", name);                 // the bytes of hello
 * to_reply(new Uint8Array([1, 2]), name);  // the two bytes
 * to_reply(null, name);                    // the bytes of null
 * to_reply(undefined, name);               // undefined: no reply
 * to_reply(new ChoMessageReply("hi", { headers: { a: "1" } }), name);
 *                                          // the bytes of hi, and the header
 * ```
 */
export function to_reply(value: unknown, name: string): Reply | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (is_reply(value)) {
    const made = to_reply(value.value, name) ?? { value: EMPTY };
    // A reply has `headers` only when there are some.
    return Object.keys(value.headers).length > 0
      ? { value: made.value, headers: value.headers }
      : made;
  }
  if (value instanceof Uint8Array) {
    return { value };
  }
  if (value instanceof ArrayBuffer) {
    return { value: new Uint8Array(value) };
  }
  if (ArrayBuffer.isView(value)) {
    return {
      value: new Uint8Array(value.buffer, value.byteOffset, value.byteLength),
    };
  }
  if (typeof value === "string") {
    return { value: encoder.encode(value) };
  }
  let json: string | undefined;
  try {
    json = JSON.stringify(value);
  } catch (cause) {
    throw message_error(
      "CHO_MESSAGE_INVALID_REPLY",
      `Invalid reply of ${name}: ${
        describe(value)
      } cannot be serialized as JSON`,
      { cause },
    );
  }
  // What JSON has no text for: a function, a symbol.
  if (json === undefined) {
    throw message_error(
      "CHO_MESSAGE_INVALID_REPLY",
      `Invalid reply of ${name}: expected bytes, a string or a value JSON can hold, got ${
        describe(value)
      }`,
    );
  }
  return { value: encoder.encode(json) };
}
