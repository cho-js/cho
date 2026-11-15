/**
 * Runs a chain of middlewares around an endpoint (the onion model). Shared by
 * the CHO modules that have middlewares: `@chojs/web`, whose result is a
 * `Response`, `@chojs/command`, whose result is an exit code, and
 * `@chojs/message`, whose chain has no result.
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
 * A middleware function of a chain that has no result, as {@link compose}
 * runs it without a `kind`. It wraps the rest of the chain (the next
 * middlewares, then the endpoint):
 *
 * - `next()` runs the rest of the chain. It resolves when the rest is done,
 *   and rejects with its error;
 * - returning without calling `next()` ends the chain there: the endpoint
 *   does not run, and the chain is done;
 * - what it returns is ignored.
 *
 * @typeParam Ctx The context every middleware and the endpoint receive.
 */
export type VoidMiddlewareFn<Ctx> = (
  ctx: Ctx,
  next: () => Promise<void>,
) => unknown;

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
): (ctx: Ctx) => Promise<Result>;
/**
 * Compose middlewares and an endpoint into one function, for a chain that
 * has no result: it is done, or it fails.
 *
 * The middlewares run in order; each `next()` runs the rest of the chain. See
 * {@link VoidMiddlewareFn} for what a middleware can do.
 *
 * @typeParam Ctx The context every middleware and the endpoint receive.
 * @param middlewares The middlewares, in the order they run.
 * @param endpoint The end of the chain.
 * @returns A function that runs the chain once. It resolves when the chain is
 *   done: when the endpoint has run, or when a middleware returned without
 *   calling `next()`. It rejects when:
 *   - a middleware or the endpoint throws. A middleware that catches the
 *     error of `next()` does not hide it: the chain still rejects with it,
 *     unless the middleware throws another one;
 *   - a middleware calls `next()` twice
 *     (`middleware <name>: next() called more than once`).
 *
 * @example
 * ```ts
 * const seen: string[] = [];
 * const run = compose<{ topic: string }>(
 *   [async (ctx, next) => {
 *     seen.push(`in ${ctx.topic}`);
 *     await next();
 *     seen.push(`out ${ctx.topic}`);
 *   }],
 *   (ctx) => {
 *     seen.push(`handled ${ctx.topic}`);
 *     return Promise.resolve();
 *   },
 * );
 * await run({ topic: "orders" }); // in orders, handled orders, out orders
 * ```
 */
export function compose<Ctx>(
  middlewares: readonly VoidMiddlewareFn<Ctx>[],
  endpoint: (ctx: Ctx) => Promise<void>,
): (ctx: Ctx) => Promise<void>;
export function compose<Ctx, Result>(
  middlewares: readonly ((
    ctx: Ctx,
    next: () => Promise<Result>,
  ) => unknown)[],
  endpoint: (ctx: Ctx) => Promise<Result>,
  kind?: ResultKind<Result>,
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
      if (!kind) {
        // No result: what the middleware returned is ignored. The rest of
        // the chain decides, when it ran: the chain is not done before it
        // is, and its failure is the failure of the chain.
        return await downstream as Result;
      }
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
