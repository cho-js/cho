/**
 * The keys of the records the decorators of `@chojs/web` write, and their
 * shapes. Private to `@chojs/web`: not exported by the package.
 *
 * Like core's keys, each is a symbol, so it never collides with user options
 * or with other CHO modules' keys, and a `Symbol.for` key, so two copies of
 * the package read each other's records.
 *
 * @module
 */

import type { ChoWebArg, ChoWebDoc } from "./types.ts";

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

/** The arguments of a handler method, written by `@Args`. */
export const ARGS: unique symbol = Symbol.for("chojs.web.args");

/**
 * What `@Args` declares. The list is inside an object on purpose: method
 * records are merged along the prototype chain, where arrays are concatenated
 * and other values replaced, and the arguments of an override replace the
 * inherited ones.
 */
export type HandlerArgs = {
  /** The arguments, in the order of the parameters. */
  readonly list: readonly ChoWebArg[];
};

/**
 * The arguments a method record declares, if any.
 *
 * @param record A method's metadata.
 * @returns What `@Args` wrote, or `undefined` when the method has none.
 */
export function handler_args(record: object): HandlerArgs | undefined {
  return (record as { readonly [ARGS]?: HandlerArgs })[ARGS];
}

/** The documentation of a class or of a method, written by `@Doc`. */
export const DOC: unique symbol = Symbol.for("chojs.web.doc");

/**
 * The documentation a record declares, if any.
 *
 * @param record The metadata of a method, or the options of a class.
 * @returns What `@Doc` wrote, or `undefined`.
 */
export function doc_of(record: object): ChoWebDoc | undefined {
  return (record as { readonly [DOC]?: ChoWebDoc })[DOC];
}
