/**
 * The timeout middleware: {@link timeout}.
 *
 * @module
 */

import type { ChoWebContext, ChoWebMiddlewareFn } from "@chojs/web";

/** The options of {@link timeout}. */
export type TimeoutOptions = {
  /** How long a request may take, in milliseconds. */
  readonly ms: number;
  /**
   * Answer a request that took too long. Default: `504`, with the text
   * `Gateway Timeout`.
   */
  readonly onTimeout?: (ctx: ChoWebContext) => Response | Promise<Response>;
};

/**
 * Make a middleware that answers `504 Gateway Timeout` when the rest of the
 * chain takes longer than a limit.
 *
 * The request is answered at the limit, but what was running is not
 * stopped: JavaScript has no way to stop it. Its result, or its error, is
 * dropped when it comes. A handler that can be stopped should watch
 * `ctx.req.signal` or its own timer.
 *
 * @param options The limit, and the answer to a request over it.
 * @returns A CHO middleware function.
 * @throws {TypeError} When `ms` is not a positive number.
 *
 * @example
 * ```ts
 * @Middlewares(timeout({ ms: 5000 }))
 * @Controller({ route: "reports" })
 * class ReportsController {}
 * ```
 */
export function timeout(options: TimeoutOptions): ChoWebMiddlewareFn {
  const { ms, onTimeout } = options ?? {};
  if (!(typeof ms === "number" && Number.isFinite(ms) && ms > 0)) {
    throw new TypeError(
      "timeout(): ms must be a positive number of milliseconds",
    );
  }
  return (ctx, next) =>
    new Promise<Response>((resolve, reject) => {
      let done = false;
      const timer = setTimeout(async () => {
        done = true;
        try {
          resolve(
            onTimeout
              ? await onTimeout(ctx)
              : new Response("Gateway Timeout", { status: 504 }),
          );
        } catch (error) {
          reject(error);
        }
      }, ms);
      next().then(
        (response) => {
          if (!done) {
            clearTimeout(timer);
            resolve(response);
          }
        },
        (error) => {
          // After the limit the request is already answered: the error of
          // what was still running is dropped.
          if (!done) {
            clearTimeout(timer);
            reject(error);
          }
        },
      );
    });
}
