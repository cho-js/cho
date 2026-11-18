/**
 * Runs a chain of middlewares around a handler (the onion model): the core's
 * `compose`, for a `ChoMessageContext` and a chain whose middlewares have no
 * result. A message is handled, or it fails; what the end of the chain
 * returns is passed on, for the reply.
 *
 * @module
 */

import { compose as compose_chain } from "@chojs/core/utils";
import type { ChoMessageContext } from "./context.ts";
import type { ChoMessageMiddlewareFn } from "./types.ts";

/**
 * The end of a chain: handles the message. It resolves with what the handler
 * returned.
 */
export type Endpoint = (ctx: ChoMessageContext) => Promise<unknown>;

/**
 * Compose middlewares and an endpoint into one function.
 *
 * The middlewares run in order; each `next()` runs the rest of the chain. A
 * middleware that returns without calling `next()` ends the chain there: the
 * endpoint does not run, the message is handled, and the chain resolves with
 * `undefined`. See `ChoMessageMiddlewareFn` for what a middleware can do.
 *
 * @param middlewares The middlewares, in the order they run.
 * @param endpoint The end of the chain.
 * @returns A function that runs the chain for one message. It resolves with
 *   what the endpoint resolved with: what a middleware returns is ignored. It
 *   rejects when:
 *   - a middleware or the endpoint throws. A middleware that catches the
 *     error of `next()` does not hide it: the chain still rejects with it;
 *   - a middleware calls `next()` twice
 *     (`middleware <name>: next() called more than once`).
 */
export function compose(
  middlewares: readonly ChoMessageMiddlewareFn[],
  endpoint: Endpoint,
): Endpoint {
  if (middlewares.length === 0) {
    return endpoint;
  }
  // The chain of the core has no result. What the endpoint returned is kept
  // by the context of its message, and given once the chain is done: no
  // middleware sees it, and none can replace it.
  const results = new WeakMap<ChoMessageContext, unknown>();
  const chain = compose_chain(middlewares, async (ctx) => {
    results.set(ctx, await endpoint(ctx));
  });
  return async (ctx) => {
    await chain(ctx);
    const result = results.get(ctx);
    results.delete(ctx);
    return result;
  };
}
