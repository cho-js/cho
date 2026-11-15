/**
 * Runs a chain of middlewares around a handler (the onion model), for a
 * message: a chain that produces nothing. It is handled, or it fails.
 *
 * It is not the core's `compose`, which is for a chain with a result (a
 * `Response`, an exit code), where a middleware that returns nothing without
 * calling `next()` is a mistake. Here it is how a message is dropped.
 *
 * @module
 */

import { describe } from "@chojs/core/utils";
import type { ChoMessageContext } from "./context.ts";
import type { ChoMessageMiddlewareFn } from "./types.ts";

/** The end of a chain: handles the message. */
export type Endpoint = (ctx: ChoMessageContext) => Promise<void>;

/**
 * Compose middlewares and an endpoint into one function.
 *
 * The middlewares run in order; each `next()` runs the rest of the chain. A
 * middleware that returns without calling `next()` ends the chain there: the
 * endpoint does not run, and the message is handled.
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
  if (middlewares.length === 0) {
    return endpoint;
  }

  return (ctx) => {
    const dispatch = async (index: number): Promise<void> => {
      const middleware = middlewares[index];
      if (!middleware) {
        return endpoint(ctx);
      }

      let downstream: Promise<void> | undefined;
      const next = (): Promise<void> => {
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
        // A middleware may return without awaiting next(): a failure down
        // the chain must not become an unhandled rejection.
        downstream.catch(() => {});
        return downstream;
      };

      await middleware(ctx, next);
      // The rest of the chain decides: the message is not handled before it
      // is done, and its failure is the failure of the message.
      await downstream;
    };
    return dispatch(0);
  };
}
