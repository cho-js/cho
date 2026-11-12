/**
 * The functions an application gives to `@chojs/web`: route handlers,
 * middlewares and error handlers.
 *
 * @module
 */

import type { Ctr } from "@chojs/core/di";
import type { ChoWebContext } from "./context.ts";

/**
 * A route handler: a controller method marked with `@Get`, `@Post`, ...
 *
 * What it returns (or resolves to) is the response: a `Response` is sent as
 * is, `undefined` answers `204 No Content`, anything else is sent as JSON.
 */
export type ChoWebHandler = (ctx: ChoWebContext) => unknown;

/** Runs the rest of the chain, and resolves to its response. */
export type ChoWebNext = () => Promise<Response>;

/**
 * A middleware function. It wraps the rest of the chain (the next
 * middlewares, then the handler):
 *
 * - `next()` runs the rest of the chain and resolves to its `Response`;
 * - returning a `Response` answers the request with it, whether `next()` was
 *   called (to replace the response) or not (to answer early);
 * - returning nothing after calling `next()` passes the response on.
 *
 * @example
 * ```ts
 * const timing: ChoWebMiddlewareFn = async (ctx, next) => {
 *   const start = Date.now();
 *   const res = await next();
 *   res.headers.set("x-time", `${Date.now() - start}ms`);
 *   return res;
 * };
 *
 * const auth: ChoWebMiddlewareFn = (ctx, next) =>
 *   ctx.req.headers.has("authorization")
 *     ? next()
 *     : new Response("unauthorized", { status: 401 });
 * ```
 */
export type ChoWebMiddlewareFn = (
  ctx: ChoWebContext,
  next: ChoWebNext,
) => Response | void | Promise<Response | void>;

/**
 * A middleware, as given to `@Middlewares`: a function, or a class with a
 * `handle(ctx, next)` method, created by the injector in the scope of the
 * feature module.
 */
export type ChoWebMiddleware =
  | ChoWebMiddlewareFn
  | Ctr<{ handle: ChoWebMiddlewareFn }>;

/**
 * An error handler function. What it returns is the response, converted like
 * a handler's result.
 *
 * @example
 * ```ts
 * const on_error: ChoWebErrorHandlerFn = (error, ctx) =>
 *   Response.json({ error: String(error), path: ctx.url.pathname }, { status: 500 });
 * ```
 */
export type ChoWebErrorHandlerFn = (
  error: unknown,
  ctx: ChoWebContext,
) => unknown;

/**
 * An error handler, as given to `@Catch`: a function, or a class with a
 * `handle(error, ctx)` method, created by the injector in the scope of the
 * feature module.
 */
export type ChoWebErrorHandler =
  | ChoWebErrorHandlerFn
  | Ctr<{ handle: ChoWebErrorHandlerFn }>;
