/**
 * Runs a chain of middlewares around a handler (the onion model): the core's
 * `compose`, for a `ChoWebContext` and a `Response`.
 *
 * @module
 */

import { compose as compose_chain } from "@chojs/core/utils";
import type { ChoWebContext } from "./context.ts";
import type { ChoWebMiddlewareFn } from "./types.ts";

/** The end of a chain: answers the request. */
export type Endpoint = (ctx: ChoWebContext) => Promise<Response>;

/**
 * Compose middlewares and an endpoint into one function.
 *
 * The middlewares run in order; each `next()` runs the rest of the chain and
 * resolves to its `Response`. See `ChoWebMiddlewareFn` for what a middleware
 * can return.
 *
 * @param middlewares The middlewares, in the order they run.
 * @param endpoint The end of the chain.
 * @returns A function that runs the chain for one request. It rejects when:
 *   - a middleware or the endpoint throws;
 *   - a middleware calls `next()` twice;
 *   - a middleware returns neither a `Response` nor, after calling `next()`,
 *     nothing.
 */
export function compose(
  middlewares: readonly ChoWebMiddlewareFn[],
  endpoint: Endpoint,
): Endpoint {
  return compose_chain(middlewares, endpoint, {
    is: (value) => value instanceof Response,
    name: "a Response",
    noun: "response",
  });
}
