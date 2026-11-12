/**
 * Linkers turn the HTTP graph of an application (see `graph.ts`) into the
 * routes of an HTTP runtime, such as Hono. Each runtime adapter, such as
 * `@chojs/vendor-hono`, implements {@link Linker} and {@link Linked}.
 *
 * @module
 */

import type { AppRef } from "./graph.ts";

/**
 * Create the default linker: the Hono linker of `@chojs/vendor-hono`, loaded
 * on demand so the package is imported only when it is used.
 *
 * @returns The linker.
 */
export function default_linker(): Promise<Linker<unknown>> {
  return import("@chojs/vendor-hono").then((mod) => mod.HonoLinker).then(
    (Linker) => new Linker(),
  );
}

/**
 * An HTTP application linked by a {@link Linker}: the runtime's own
 * application object, and its request handler.
 *
 * @typeParam T The application object of the HTTP runtime, such as `Hono`.
 *
 * @example
 * ```ts
 * class HonoLinked extends Linked<Hono> {
 *   get handler(): (req: Request) => Promise<Response> {
 *     return (req) => Promise.resolve(this.instance.fetch(req));
 *   }
 * }
 * ```
 */
export abstract class Linked<T> {
  /** The application object of the HTTP runtime. */
  readonly instance: T;

  /**
   * Wrap the application object of an HTTP runtime.
   *
   * @param instance The application object of the HTTP runtime.
   */
  constructor(instance: T) {
    this.instance = instance;
  }

  /**
   * The request handler: a `fetch`-style function that takes a `Request` and
   * resolves to a `Response`.
   */
  abstract get handler(): (req: Request) => Promise<Response>;
}

/**
 * Links the HTTP graph of an application to an HTTP runtime: registers every
 * route, middleware and error handler of the graph on a new application object
 * of the runtime.
 *
 * @typeParam T The application object of the HTTP runtime, such as `Hono`.
 *
 * @example
 * ```ts
 * class MyLinker implements Linker<MyServer> {
 *   link(graph: AppRef): Linked<MyServer> {
 *     const server = new MyServer();
 *     for (const feature of graph.features) {
 *       for (const controller of feature.controllers) {
 *         for (const method of controller.methods) {
 *           const path = [graph.route, feature.route, controller.route, method.route]
 *             .filter(Boolean).join("/");
 *           server.on(method.method, `/${path}`, method.handler);
 *         }
 *       }
 *     }
 *     return new MyLinked(server);
 *   }
 * }
 *
 * const app = await ChoWeb.create(AppModule, {
 *   platform: () => Promise.resolve(new MyLinker()),
 * });
 * ```
 */
export interface Linker<T> {
  /**
   * Link an HTTP graph to a new application object of the runtime.
   *
   * @param graph The HTTP graph of the application.
   * @returns The linked application.
   */
  link(graph: AppRef): Linked<T>;
}
