/**
 * The keys of the records the decorators of `@chojs/message` write, and their
 * shapes. Private to `@chojs/message`: not exported by the package.
 *
 * Like core's keys, they are symbols, so they never collide with user options
 * or with other CHO modules' keys, and `Symbol.for` keys, so two copies of the
 * package read each other's records.
 *
 * @module
 */

import type { ChoMessageArg } from "./types.ts";

/** The topic of a handler method, written by `@Subscribe`. */
export const SUBSCRIBE: unique symbol = Symbol.for("chojs.message.subscribe");

/** What `@Subscribe` declares about a handler method. */
export type Subscription = {
  /** The topic of the handler, relative to its controller, as declared. */
  readonly topic: string;
};

/**
 * The topic a method record declares, if any.
 *
 * @param record A method's metadata, as the core's metadata graph passes it
 *   on.
 * @returns What `@Subscribe` wrote, or `undefined` when the method is not a
 *   message handler.
 */
export function subscription(record: object): Subscription | undefined {
  return (record as { readonly [SUBSCRIBE]?: Subscription })[SUBSCRIBE];
}

/** The arguments of a handler method, written by `@Args`. */
export const ARGS: unique symbol = Symbol.for("chojs.message.args");

/**
 * What `@Args` declares about a handler method. The list is wrapped in an
 * object: a bare array would be concatenated with the one a base class
 * declared, and an override replaces the arguments it inherits.
 */
export type HandlerArgs = {
  /** The arguments, in the order of the parameters of the method. */
  readonly list: readonly ChoMessageArg[];
};

/**
 * The arguments a method record declares, if any.
 *
 * @param record A method's metadata, as the core's metadata graph passes it
 *   on.
 * @returns What `@Args` wrote, or `undefined` when the method has none.
 */
export function handler_args(record: object): HandlerArgs | undefined {
  return (record as { readonly [ARGS]?: HandlerArgs })[ARGS];
}
