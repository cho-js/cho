/**
 * The key of the record the decorators of `@chojs/message` write, and its
 * shape. Private to `@chojs/message`: not exported by the package.
 *
 * Like core's keys, it is a symbol, so it never collides with user options or
 * with other CHO modules' keys, and a `Symbol.for` key, so two copies of the
 * package read each other's records.
 *
 * @module
 */

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
