/**
 * Converts what a handler or an error handler returned into the reply of a
 * message: what `to_response` is for `@chojs/web`. Internal to
 * `@chojs/message`.
 *
 * @module
 */

import { describe } from "@chojs/core/utils";
import { message_error } from "./errors.ts";
import type { Reply } from "./linker.ts";

const encoder = new TextEncoder();

/**
 * The reply for a returned value (already awaited):
 *
 * - `undefined` is no reply;
 * - bytes are sent as they are: a `Uint8Array`, another typed array or a
 *   `DataView` (the bytes they show), an `ArrayBuffer`;
 * - a string is sent as its UTF-8 bytes;
 * - anything else is sent as JSON, in UTF-8: objects, arrays, numbers,
 *   booleans, `null`, dates, class instances.
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
 * ```
 */
export function to_reply(value: unknown, name: string): Reply | undefined {
  if (value === undefined) {
    return undefined;
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
