/**
 * Runs a chain of middlewares around an endpoint (the onion model). Shared by
 * the CHO modules that have middlewares: `@chojs/web`, whose result is a
 * `Response`, and `@chojs/command`, whose result is an exit code.
 *
 * @module
 */

import { describe } from "./describe.ts";

/**
 * A middleware function, as {@link compose} runs it. It wraps the rest of the
 * chain (the next middlewares, then the endpoint):
 *
 * - `next()` runs the rest of the chain and resolves to its result;
 * - returning a result ends the chain with it, whether `next()` was called
 *   (to replace the result) or not (to end early);
 * - returning nothing after calling `next()` passes the result on.
 *
 * @typeParam Ctx The context every middleware and the endpoint receive.
 * @typeParam Result What the chain produces.
 */
export type MiddlewareFn<Ctx, Result> = (
  ctx: Ctx,
  next: () => Promise<Result>,
) => Result | void | Promise<Result | void>;

/**
 * What the chain produces: how to recognize it, and how to name it in error
 * messages.
 *
 * @typeParam Result What the chain produces.
 */
export type ResultKind<Result> = {
  /** Whether a value a middleware returned is a result. */
  is(value: unknown): value is Result;
  /** The result, with its article: `"a Response"`, `"an exit code"`. */
  name: string;
  /** The result, as a bare noun: `"response"`, `"exit code"`. */
  noun: string;
};

/**
 * Compose middlewares and an endpoint into one function.
 *
 * The middlewares run in order; each `next()` runs the rest of the chain and
 * resolves to its result. See {@link MiddlewareFn} for what a middleware can
 * return.
 *
 * @typeParam Ctx The context every middleware and the endpoint receive.
 * @typeParam Result What the chain produces.
 * @param middlewares The middlewares, in the order they run.
 * @param endpoint The end of the chain.
 * @param kind What a result is, and how to name it in error messages.
 * @returns A function that runs the chain once. It rejects when:
 *   - a middleware or the endpoint throws;
 *   - a middleware calls `next()` twice
 *     (`middleware <name>: next() called more than once`);
 *   - a middleware returns nothing without calling `next()`
 *     (`middleware <name> returned no <noun>: return <name> or call next()`);
 *   - a middleware returns something that is not a result
 *     (`TypeError: middleware <name> must return <name> or nothing, got <typeof>`).
 *
 * @example
 * ```ts
 * const run = compose<{ user?: string }, number>(
 *   [async (ctx, next) => {
 *     ctx.user = "ada";
 *     return await next();
 *   }],
 *   (ctx) => Promise.resolve(ctx.user ? 0 : 1),
 *   {
 *     is: (value) => typeof value === "number",
 *     name: "an exit code",
 *     noun: "exit code",
 *   },
 * );
 * await run({}); // 0
 * ```
 */
export function compose<Ctx, Result>(
  middlewares: readonly MiddlewareFn<Ctx, Result>[],
  endpoint: (ctx: Ctx) => Promise<Result>,
  kind: ResultKind<Result>,
): (ctx: Ctx) => Promise<Result> {
  if (middlewares.length === 0) {
    return endpoint;
  }

  return (ctx) => {
    const dispatch = async (index: number): Promise<Result> => {
      const middleware = middlewares[index];
      if (!middleware) {
        return endpoint(ctx);
      }

      let downstream: Promise<Result> | undefined;
      const next = (): Promise<Result> => {
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
        // A middleware may end the chain without awaiting next(): a failure
        // down the chain must not become an unhandled rejection.
        downstream.catch(() => {});
        return downstream;
      };

      const result = await middleware(ctx, next);
      if (kind.is(result)) {
        return result;
      }
      if (result !== undefined) {
        throw new TypeError(
          `middleware ${
            describe(middleware)
          } must return ${kind.name} or nothing, got ${typeof result}`,
        );
      }
      if (!downstream) {
        throw new Error(
          `middleware ${
            describe(middleware)
          } returned no ${kind.noun}: return ${kind.name} or call next()`,
        );
      }
      return downstream;
    };
    return dispatch(0);
  };
}
