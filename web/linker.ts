/**
 * Linkers turn the HTTP graph of an application (see `graph.ts`) into the
 * routes of an HTTP runtime, such as Hono. Each runtime adapter, such as
 * `@chojs/vendor-hono`, implements {@link Linker} and {@link Linked}.
 *
 * `@chojs/web` does not depend on any adapter: the application passes the
 * linker to `ChoWeb.create`, and the adapters depend on `@chojs/web`.
 *
 * @module
 */

import type { AppRef } from "./graph.ts";

/**
 * An HTTP application linked by a {@link Linker}: the runtime's own
 * application object, and its request handler.
 *
 * @typeParam T The application object of the HTTP runtime, such as `Hono`.
 *
 * Adapters can return a plain object, or an instance of their own class.
 *
 * @example
 * ```ts
 * const app = new Hono();
 * const linked: Linked<Hono> = {
 *   instance: app,
 *   handler: (req) => Promise.resolve(app.fetch(req)),
 * };
 * ```
 */
export interface Linked<T> {
  /** The application object of the HTTP runtime. */
  readonly instance: T;

  /**
   * The request handler: a `fetch`-style function that takes a `Request` and
   * resolves to a `Response`.
   */
  readonly handler: (req: Request) => Promise<Response>;
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
 *     return { instance: server, handler: (req) => server.fetch(req) };
 *   }
 * }
 *
 * const app = await ChoWeb.create(AppModule, { linker: new MyLinker() });
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
