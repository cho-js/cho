/**
 * Runs a chain of middlewares around a handler (the onion model): the core's
 * `compose`, for a `ChoWebContext` and a `Response`.
 *
 * @module
 */

import { compose as compose_chain } from "@chojs/core/utils";
import { type ChoWebContext, create_context } from "./context.ts";
import { isHttpError } from "./http-error.ts";
import type { Around } from "./linker.ts";
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

/**
 * Make what a linker runs the middlewares of the application with: a
 * function that creates the context of a request, and runs them around what
 * answers it.
 *
 * An `HttpError` one of them throws is the answer it makes of itself, as it
 * is in a route: the middlewares before it get that response, so a CORS
 * middleware still adds its headers to the `401` of an authentication. Any
 * other error rejects: the linker answers it, as it answers a route that
 * rejects.
 *
 * @param middlewares The middlewares of the application, in the order they
 *   run.
 * @returns The `around` of `LinkOptions`.
 */
export function around(middlewares: readonly ChoWebMiddlewareFn[]): Around {
  const answering = middlewares.map(
    (middleware): ChoWebMiddlewareFn => async (ctx, next) => {
      try {
        return await middleware(ctx, next);
      } catch (error) {
        if (!isHttpError(error)) {
          throw error;
        }
        const response = error.toResponse();
        // A HEAD response has no body, whatever produced it.
        return ctx.req.method === "HEAD"
          ? new Response(null, response)
          : response;
      }
    },
  );
  return (req, answer, native, params) =>
    compose(answering, answer)(create_context(req, params, native));
}
