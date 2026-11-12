/**
 * The web application: {@link ChoWeb} builds the HTTP graph of a root module
 * and links it to an HTTP runtime with the given {@link Linker} (such as
 * `HonoLinker` from `@chojs/vendor-hono`), which gives a `fetch`-style request
 * handler.
 *
 * @module
 */

import type { Ctr } from "@chojs/core/di";
import { Injector } from "@chojs/core/di";
import { build_http_graph } from "./build-graph.ts";
import type { Linked, Linker } from "./linker.ts";

/**
 * Options of {@link ChoWeb.create}. `linker` is required; the other options
 * are optional.
 *
 * @typeParam T The application object of the HTTP runtime, such as `Hono`.
 *
 * @example
 * ```ts
 * import { HonoLinker } from "@chojs/vendor-hono";
 *
 * const app = await ChoWeb.create(AppModule, {
 *   linker: new HonoLinker(),
 *   prefix: "api/v1", // every route starts with /api/v1
 * });
 * ```
 */
export type ChoWebOptions<T = unknown> = {
  /**
   * The linker that turns the HTTP graph into the routes of an HTTP runtime,
   * such as `HonoLinker` from `@chojs/vendor-hono`.
   */
  linker: Linker<T>;
  /** The application version. Not used yet. */
  version?: string;
  /** The application name. Not used yet. */
  name?: string;
  /**
   * The global route prefix, added before every feature route, without
   * leading or trailing `/` (for example `"api"`). Default: `""`, no prefix.
   */
  prefix?: string;
};

/**
 * A web application, built from a root module.
 *
 * Every module that declares controllers is a feature. The route of a handler
 * joins up to four levels, each optional: the global `prefix`, the feature
 * module's `route`, the controller's `route` and the route given to the HTTP
 * method decorator (`@Get("…")`). What a handler returns is sent as JSON,
 * unless it is a `Response`.
 *
 * @typeParam T The application object of the HTTP runtime, such as `Hono`.
 *
 * @example
 * ```ts
 * import { ChoWeb, Controller, Get, Module } from "@chojs/web";
 * import { HonoLinker } from "@chojs/vendor-hono";
 * import type { Context } from "@hono/hono";
 *
 * @Controller({ route: "users" })
 * class UsersController {
 *   @Get(":id")
 *   get(ctx: Context) {
 *     return { id: ctx.req.param("id") };
 *   }
 * }
 *
 * @Module({ route: "api", controllers: [UsersController] })
 * class App {}
 *
 * // GET /api/users/42 -> {"id":"42"}
 * const app = await ChoWeb.create(App, { linker: new HonoLinker() });
 * Deno.serve(app.handler);
 * ```
 */
export class ChoWeb<T = unknown> {
  /** The linked HTTP application, which holds the runtime's own object. */
  linked: Linked<T>;

  /**
   * Create the web application of a root module.
   *
   * Creates the injector and every instance of the application, builds the
   * HTTP graph, and links it with `options.linker`.
   *
   * @param app The root module.
   * @param options The application options: the linker, and optionally the
   *   global prefix.
   * @returns The application.
   * @throws {Error} When the module graph is invalid (see `Injector`), when a
   *   route is invalid or declared twice, or when a middleware or an error
   *   handler is invalid.
   *
   * @example
   * ```ts
   * const app = await ChoWeb.create(AppModule, {
   *   linker: new HonoLinker(),
   *   prefix: "api",
   * });
   * Deno.serve({ port: 8080 }, app.handler);
   * ```
   */
  static async create<T>(
    app: Ctr,
    options: ChoWebOptions<T>,
  ): Promise<ChoWeb<T>> {
    const inj = new Injector(app);
    await inj.init();
    const graph = await build_http_graph(inj, options.prefix ?? "");
    return new ChoWeb(options.linker.link(graph));
  }

  /**
   * Use {@link ChoWeb.create}, which builds and links the application from a
   * module.
   *
   * @param linked The linked HTTP application.
   */
  constructor(linked: Linked<T>) {
    this.linked = linked;
  }

  /**
   * The request handler of the application: a `fetch`-style function that
   * takes a `Request` and resolves to a `Response`.
   *
   * @example Deno
   * ```ts
   * Deno.serve(app.handler);
   * ```
   *
   * @example Bun
   * ```ts
   * Bun.serve({ fetch: app.handler });
   * ```
   */
  get handler(): (req: Request) => Promise<Response> {
    return this.linked.handler;
  }
}
