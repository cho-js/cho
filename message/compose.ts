/**
 * Runs a chain of middlewares around a handler (the onion model): the core's
 * `compose`, for a `ChoMessageContext` and a chain that has no result. A
 * message is handled, or it fails.
 *
 * @module
 */

import { compose as compose_chain } from "@chojs/core/utils";
import type { ChoMessageContext } from "./context.ts";
import type { ChoMessageMiddlewareFn } from "./types.ts";

/** The end of a chain: handles the message. */
export type Endpoint = (ctx: ChoMessageContext) => Promise<void>;

/**
 * Compose middlewares and an endpoint into one function.
 *
 * The middlewares run in order; each `next()` runs the rest of the chain. A
 * middleware that returns without calling `next()` ends the chain there: the
 * endpoint does not run, and the message is handled. See
 * `ChoMessageMiddlewareFn` for what a middleware can do.
 *
 * @param middlewares The middlewares, in the order they run.
 * @param endpoint The end of the chain.
 * @returns A function that runs the chain for one message. It rejects when:
 *   - a middleware or the endpoint throws. A middleware that catches the
 *     error of `next()` does not hide it: the chain still rejects with it;
 *   - a middleware calls `next()` twice
 *     (`middleware <name>: next() called more than once`).
 */
export function compose(
  middlewares: readonly ChoMessageMiddlewareFn[],
  endpoint: Endpoint,
): Endpoint {
  return compose_chain(middlewares, endpoint);
}
