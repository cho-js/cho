/**
 * Helpers for the tests of the middlewares. Not part of the published
 * package.
 *
 * @module
 */

import type { ChoWebContext, ChoWebMiddlewareFn } from "@chojs/web";

/** What {@link run} gives back. */
export type Ran = {
  /** The response of the middleware. */
  response: Response;
  /** How many times the middleware called `next`. */
  called: number;
  /** The context the middleware ran with. */
  ctx: ChoWebContext;
};

/**
 * Make the context of a request, as a route would.
 *
 * @param path The path of the request, with its query string.
 * @param init The method, the headers and the body of the request.
 * @returns The context.
 */
export function context(path = "/", init: RequestInit = {}): ChoWebContext {
  let url: URL | undefined;
  const ctx = {
    req: new Request(`http://localhost${path}`, init),
    params: {},
    state: new Map<PropertyKey, unknown>(),
    native: undefined,
    get url() {
      return url ??= new URL(ctx.req.url);
    },
  };
  return ctx;
}

/**
 * Run a middleware on a request.
 *
 * @param middleware The middleware.
 * @param init The request: `path`, and what `Request` takes.
 * @param answer What the rest of the chain does; it receives the context.
 *   Default: it answers `200 ok`.
 * @returns The response, how many times `next` was called, and the context.
 */
export async function run(
  middleware: ChoWebMiddlewareFn,
  init: RequestInit & { path?: string } = {},
  answer: (ctx: ChoWebContext) => Response | Promise<Response> = () =>
    new Response("ok"),
): Promise<Ran> {
  const ctx = context(init.path, init);
  let called = 0;
  const response = await middleware(ctx, async () => {
    called++;
    return await answer(ctx);
  });
  if (!(response instanceof Response)) {
    throw new Error("the middleware returned no response");
  }
  return { response, called, ctx };
}
