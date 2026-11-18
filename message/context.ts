/**
 * The message context: what handlers, middlewares and error handlers of a
 * `@chojs/message` application receive. It holds the message as plain data,
 * so application code does not depend on the client library of the broker.
 *
 * @module
 */

import { message_error } from "./errors.ts";
import { describe } from "@chojs/core/utils";
import type { Delivery } from "./linker.ts";

/**
 * The context of one message.
 *
 * @example
 * ```ts
 * @Controller({ topic: "orders" })
 * class OrdersController {
 *   @Subscribe("created")
 *   created(ctx: ChoMessageContext) {
 *     const order = ctx.json<{ id: string }>();
 *     console.log(ctx.topic, ctx.key, order.id);
 *   }
 * }
 * ```
 */
export interface ChoMessageContext {
  /** The full topic of the message, global prefix included. */
  readonly topic: string;
  /** The value of the message, as bytes; empty when it has none. */
  readonly value: Uint8Array;
  /** The key of the message; `undefined` when it has none. */
  readonly key: string | undefined;
  /** The headers of the message; an empty object when it has none. */
  readonly headers: Readonly<Record<string, string>>;
  /**
   * The value, decoded as UTF-8.
   *
   * @returns The text; `""` for an empty value.
   */
  text(): string;
  /**
   * The value, parsed as JSON.
   *
   * @typeParam T What the value is, by your word: nothing checks it.
   * @returns The parsed value; `undefined` for an empty value.
   * @throws {SyntaxError} When the value is not JSON.
   */
  json<T = unknown>(): T;
  /**
   * Values shared while the message is handled: a middleware sets one for
   * the middlewares and the handler after it.
   */
  readonly state: Map<PropertyKey, unknown>;
  /**
   * The adapter's own message (its partition and offset, say), or
   * `undefined` when the adapter has none. Code that uses it only runs on
   * that adapter.
   */
  readonly native: unknown;
}

/** The headers of a message without headers. */
const NO_HEADERS: Readonly<Record<string, string>> = Object.freeze({});

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * The value of a delivery, as bytes.
 *
 * @param value The value as the adapter gave it.
 * @returns The bytes: those of a string, encoded as UTF-8; none for a message
 *   without a value.
 * @throws {ChoError} When the value is neither bytes nor a string.
 */
function to_bytes(value: unknown): Uint8Array {
  if (value === undefined || value === null) {
    return new Uint8Array(0);
  }
  if (typeof value === "string") {
    return encoder.encode(value);
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  throw message_error(
    "CHO_MESSAGE_INVALID_VALUE",
    `Invalid value of a message: expected bytes (a Uint8Array) or a string, got ${
      describe(value)
    }`,
  );
}

/** The context implementation: the text of the value is decoded once. */
class Context implements ChoMessageContext {
  readonly topic: string;
  readonly value: Uint8Array;
  readonly key: string | undefined;
  readonly headers: Readonly<Record<string, string>>;
  readonly state: Map<PropertyKey, unknown> = new Map();
  readonly native: unknown;
  #text: string | undefined;

  constructor(topic: string, delivery: Delivery, native: unknown) {
    this.topic = topic;
    this.value = to_bytes(delivery.value);
    this.key = delivery.key;
    this.headers = delivery.headers ?? NO_HEADERS;
    this.native = native;
  }

  text(): string {
    return this.#text ??= decoder.decode(this.value);
  }

  json<T = unknown>(): T {
    return (this.value.length === 0 ? undefined : JSON.parse(this.text())) as T;
  }
}

/**
 * Create the context of a message.
 *
 * @param topic The full topic of the message.
 * @param delivery The message, as the adapter gave it. Default: a message
 *   with no value, no key and no headers.
 * @param native The adapter's own message, if any.
 * @returns The context.
 * @throws {ChoError} When the value of the message is neither bytes nor a
 *   string.
 */
export function create_context(
  topic: string,
  delivery: Delivery = {},
  native?: unknown,
): ChoMessageContext {
  return new Context(topic, delivery ?? {}, native);
}
