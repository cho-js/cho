/**
 * The request log middleware: {@link logger}.
 *
 * @module
 */

import type { ChoWebContext, ChoWebMiddlewareFn } from "@chojs/web";

/** What {@link logger} knows about a request when it is done. */
export type LoggerEntry = {
  /** The method of the request. */
  readonly method: string;
  /** The path of the request, without its query string. */
  readonly path: string;
  /** The status of the response; `undefined` when the request failed. */
  readonly status: number | undefined;
  /** How long the request took, in milliseconds. */
  readonly ms: number;
  /** The error the rest of the chain threw, when the request failed. */
  readonly error?: unknown;
  /** The context of the request. */
  readonly ctx: ChoWebContext;
};

/** The options of {@link logger}. */
export type LoggerOptions = {
  /**
   * Writes a line. Default: `console.log`.
   */
  readonly log?: (line: string) => void;
  /**
   * Makes the line of a request. Default: `GET /users/42 200 12ms`, and
   * `GET /users/42 failed 12ms` for a request that failed.
   */
  readonly format?: (entry: LoggerEntry) => string;
};

/** The default line of a request. */
function default_format({ method, path, status, ms }: LoggerEntry): string {
  return `${method} ${path} ${status ?? "failed"} ${ms}ms`;
}

/**
 * Make a middleware that writes one line for each request, when it is done:
 * its method, its path, the status of the response and how long it took.
 *
 * The query string is left out of the line: it can hold what should not be
 * in a log. A request that fails (the rest of the chain throws) is logged
 * too, and its error goes on.
 *
 * @param options Where to write the line, and how to make it.
 * @returns A CHO middleware function.
 *
 * @example
 * ```ts
 * import { ChoLinker, ChoWeb } from "@chojs/web";
 * import { logger } from "@chojs/vendor-cho";
 *
 * const app = await ChoWeb.create(AppModule, {
 *   linker: new ChoLinker({ middlewares: [logger()] }),
 * });
 * // GET /users/42 200 3ms
 * ```
 *
 * @example As JSON, to another logger
 * ```ts
 * logger({
 *   log: (line) => log.info(line),
 *   format: ({ method, path, status, ms }) =>
 *     JSON.stringify({ method, path, status, ms }),
 * });
 * ```
 */
export function logger(options: LoggerOptions = {}): ChoWebMiddlewareFn {
  const write = options.log ?? ((line: string) => console.log(line));
  const format = options.format ?? default_format;
  return async (ctx, next) => {
    const start = performance.now();
    const entry = (status: number | undefined, error?: unknown) => ({
      method: ctx.req.method,
      path: ctx.url.pathname,
      status,
      ms: Math.round(performance.now() - start),
      ...(error === undefined ? {} : { error }),
      ctx,
    });
    let response: Response;
    try {
      response = await next();
    } catch (error) {
      write(format(entry(undefined, error)));
      throw error;
    }
    write(format(entry(response.status)));
    return response;
  };
}
