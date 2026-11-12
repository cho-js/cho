/**
 * The functions an application gives to `@chojs/command`: command methods,
 * middlewares and error handlers.
 *
 * @module
 */

import type { Ctr } from "@chojs/core/di";
import type { ChoCommandContext } from "./context.ts";

/**
 * A command: a controller method marked with `@Main` or `@Action`.
 *
 * What it returns (or resolves to) gives the exit code: a non-negative
 * integer is the exit code, anything else is `0`.
 */
export type ChoCommandHandler = (ctx: ChoCommandContext) => unknown;

/** Runs the rest of the chain, and resolves to its exit code. */
export type ChoCommandNext = () => Promise<number>;

/**
 * A middleware function. It wraps the rest of the chain (the next
 * middlewares, then the command):
 *
 * - `next()` runs the rest of the chain and resolves to its exit code;
 * - returning an exit code (a non-negative integer) ends the run with it,
 *   whether `next()` was called (to replace the exit code) or not (to stop
 *   before the command);
 * - returning nothing after calling `next()` passes the exit code on.
 *
 * @example
 * ```ts
 * const timing: ChoCommandMiddlewareFn = async (ctx, next) => {
 *   const start = performance.now();
 *   await next();
 *   console.error(`${ctx.command}: ${Math.round(performance.now() - start)}ms`);
 * };
 *
 * const confirm: ChoCommandMiddlewareFn = (ctx, next) =>
 *   ctx.args.yes ? next() : 1; // stops, with exit code 1
 * ```
 */
export type ChoCommandMiddlewareFn = (
  ctx: ChoCommandContext,
  next: ChoCommandNext,
) => number | void | Promise<number | void>;

/**
 * A middleware, as given to `@Middlewares`: a function, or a class with a
 * `handle(ctx, next)` method, created by the injector in the scope of the
 * module that declares the controller.
 */
export type ChoCommandMiddleware =
  | ChoCommandMiddlewareFn
  | Ctr<{ handle: ChoCommandMiddlewareFn }>;

/**
 * An error handler function. What it returns gives the exit code: a
 * non-negative integer is the exit code, anything else is `1`.
 *
 * @example
 * ```ts
 * const on_error: ChoCommandErrorHandlerFn = (error, ctx) => {
 *   console.error(`${ctx.command} failed: ${error}`);
 *   return 2;
 * };
 * ```
 */
export type ChoCommandErrorHandlerFn = (
  error: unknown,
  ctx: ChoCommandContext,
) => unknown;

/**
 * An error handler, as given to `@Catch` or to the `onError` option: a
 * function, or a class with a `handle(error, ctx)` method, created by the
 * injector.
 */
export type ChoCommandErrorHandler =
  | ChoCommandErrorHandlerFn
  | Ctr<{ handle: ChoCommandErrorHandlerFn }>;
