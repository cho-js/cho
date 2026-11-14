/**
 * The request id middleware: {@link requestId}.
 *
 * @module
 */

import type { ChoWebContext, ChoWebMiddlewareFn } from "@chojs/web";
import { with_headers } from "./headers.ts";

/** The key of the request id in `ctx.state`. */
export const REQUEST_ID = "requestId";

/** The options of {@link requestId}. */
export type RequestIdOptions = {
  /**
   * The header that carries the id, on the request and on the response.
   * Default: `x-request-id`.
   */
  readonly header?: string;
  /** Makes the id of a request that has none. Default: a random UUID. */
  readonly generate?: (ctx: ChoWebContext) => string;
};

/** An id a client may send: short, and safe to put in a log or a header. */
const SAFE_ID = /^[\w\-.=+/:]{1,255}$/;

/**
 * Make a middleware that gives every request an id, to follow it through
 * the logs.
 *
 * - The id is the one the request came with (the `x-request-id` header),
 *   when it is a short string of letters, digits and `-_.=+/:`. Otherwise a
 *   new one is made.
 * - It is in `ctx.state`, under {@link REQUEST_ID} (`"requestId"`), for the
 *   middlewares and the handler after this one.
 * - It is sent back on the response, in the same header.
 *
 * @param options The header, and how to make an id.
 * @returns A CHO middleware function.
 *
 * @example
 * ```ts
 * import { ChoLinker, ChoWeb, type ChoWebContext } from "@chojs/web";
 * import { REQUEST_ID, requestId } from "@chojs/vendor-cho";
 *
 * const app = await ChoWeb.create(AppModule, {
 *   linker: new ChoLinker({ middlewares: [requestId()] }),
 * });
 *
 * // in a handler
 * @Get("")
 * list(ctx: ChoWebContext) {
 *   console.log(ctx.state.get(REQUEST_ID), "listing users");
 * }
 * ```
 */
export function requestId(options: RequestIdOptions = {}): ChoWebMiddlewareFn {
  const header = options.header ?? "x-request-id";
  const generate = options.generate ?? (() => crypto.randomUUID());
  return async (ctx, next) => {
    const sent = ctx.req.headers.get(header);
    const id = sent !== null && SAFE_ID.test(sent) ? sent : generate(ctx);
    ctx.state.set(REQUEST_ID, id);
    return with_headers(await next(), (headers) => headers.set(header, id));
  };
}
