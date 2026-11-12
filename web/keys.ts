/**
 * The key of the record the HTTP method decorators write, and its shape.
 * Private to `@chojs/web`: not exported by the package.
 *
 * Like core's keys, it is a symbol, so it never collides with user options
 * or with other CHO modules' keys, and a `Symbol.for` key, so two copies of
 * the package read each other's records.
 *
 * @module
 */

/** The route of a handler method, written by `@Get`, `@Post`, ... */
export const HTTP: unique symbol = Symbol.for("chojs.web.http");

/** What an HTTP method decorator declares about a handler method. */
export type HttpRoute = {
  /** The HTTP method, such as `"GET"`. */
  readonly method: string;
  /** The route of the handler, relative to its controller, as declared. */
  readonly route: string;
};

/**
 * The route a method record declares, if any.
 *
 * @param record A method's metadata, as the core's metadata graph passes it
 *   on.
 * @returns The handler's route, or `undefined` when the method is not an HTTP
 *   handler.
 */
export function http_route(record: object): HttpRoute | undefined {
  return (record as { readonly [HTTP]?: HttpRoute })[HTTP];
}
