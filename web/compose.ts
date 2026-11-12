/**
 * Runs a chain of middlewares around a handler (the onion model).
 *
 * @module
 */

import { describe } from "@chojs/core/utils";
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
  if (middlewares.length === 0) {
    return endpoint;
  }

  return (ctx) => {
    const dispatch = async (index: number): Promise<Response> => {
      const middleware = middlewares[index];
      if (!middleware) {
        return endpoint(ctx);
      }

      let downstream: Promise<Response> | undefined;
      const next = (): Promise<Response> => {
        if (downstream) {
          return Promise.reject(
            new Error(
              `middleware ${
                describe(middleware)
              }: next() called more than once`,
            ),
          );
        }
        downstream = dispatch(index + 1);
        // A middleware may answer without awaiting next(): a failure down
        // the chain must not become an unhandled rejection.
        downstream.catch(() => {});
        return downstream;
      };

      const result = await middleware(ctx, next);
      if (result instanceof Response) {
        return result;
      }
      if (result !== undefined) {
        throw new TypeError(
          `middleware ${
            describe(middleware)
          } must return a Response or nothing, got ${typeof result}`,
        );
      }
      if (!downstream) {
        throw new Error(
          `middleware ${
            describe(middleware)
          } returned no response: return a Response or call next()`,
        );
      }
      return downstream;
    };
    return dispatch(0);
  };
}
