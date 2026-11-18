/**
 * The functions an application gives to `@chojs/message`: message handlers,
 * middlewares and error handlers.
 *
 * @module
 */

import type { Ctr } from "@chojs/core/di";
import type { ChoMessageContext } from "./context.ts";

/**
 * A message handler: a controller method marked with `@Subscribe`.
 *
 * When it returns (or resolves), the message is handled. What it returns is
 * the reply of the message: bytes and strings as they are, anything else as
 * JSON, a `ChoMessageReply` for a reply with headers, and nothing for no
 * reply. It is sent when the message asks for one,
 * by an adapter whose broker has replies; otherwise it is dropped. When it
 * throws (or rejects), the error goes to the nearest error handler.
 */
export type ChoMessageHandler = (ctx: ChoMessageContext) => unknown;

/**
 * Runs the rest of the chain. It resolves when the rest is done, and rejects
 * with its error. It does not give the reply: the reply is the handler's, and
 * a middleware neither reads nor replaces it.
 */
export type ChoMessageNext = () => Promise<void>;

/**
 * A middleware function. It wraps the rest of the chain (the next
 * middlewares, then the handler):
 *
 * - `next()` runs the rest of the chain;
 * - returning without calling `next()` skips the handler: the message is
 *   handled, and has no reply;
 * - what it returns is ignored.
 *
 * A middleware cannot hide the failure of the rest of the chain: when
 * `next()` rejects, the message failed, even when the middleware catches the
 * error. Settling a failed message as handled is what an error handler does.
 *
 * @example
 * ```ts
 * const timing: ChoMessageMiddlewareFn = async (ctx, next) => {
 *   const start = Date.now();
 *   await next();
 *   console.log(ctx.topic, `${Date.now() - start}ms`);
 * };
 *
 * // drops the messages that are not for this application
 * const mine: ChoMessageMiddlewareFn = (ctx, next) =>
 *   ctx.headers["tenant"] === "acme" ? next() : undefined;
 * ```
 */
export type ChoMessageMiddlewareFn = (
  ctx: ChoMessageContext,
  next: ChoMessageNext,
) => unknown;

/**
 * A middleware, as given to `@Middlewares`: a function, or a class with a
 * `handle(ctx, next)` method, created by the injector in the scope of the
 * feature module.
 */
export type ChoMessageMiddleware =
  | ChoMessageMiddlewareFn
  | Ctr<{ handle: ChoMessageMiddlewareFn }>;

/**
 * An error handler function. What it returns settles the message:
 *
 * - nothing, or `false`: the message failed. An error handler that only logs
 *   does not turn a failed message into a handled one;
 * - `true`: the message is handled, and has no reply;
 * - any other value: the message is handled, and the value is its reply,
 *   converted as what a handler returns is.
 *
 * @example
 * ```ts
 * // a value that is not JSON never will be: drop the message
 * const on_error: ChoMessageErrorHandlerFn = (error, ctx) => {
 *   console.error(ctx.topic, error);
 *   return error instanceof SyntaxError;
 * };
 *
 * // tells who asked what went wrong
 * const answer: ChoMessageErrorHandlerFn = (error) => ({
 *   error: error instanceof NotFound ? "not found" : "failed",
 * });
 * ```
 */
export type ChoMessageErrorHandlerFn = (
  error: unknown,
  ctx: ChoMessageContext,
) => unknown;

/**
 * An error handler, as given to `@Catch`: a function, or a class with a
 * `handle(error, ctx)` method, created by the injector in the scope of the
 * feature module.
 */
export type ChoMessageErrorHandler =
  | ChoMessageErrorHandlerFn
  | Ctr<{ handle: ChoMessageErrorHandlerFn }>;
