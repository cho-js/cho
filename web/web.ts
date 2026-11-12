/**
 * The web application: {@link ChoWeb} builds the HTTP graph of a root module
 * and links it to an HTTP runtime (Hono by default), which gives a
 * `fetch`-style request handler.
 *
 * @module
 */

import { type Any, type Ctr, Injector } from "@chojs/core/di";
import { build_http_graph } from "./graph.ts";
import { default_linker, type Linked, type Linker } from "./linker.ts";

/**
 * Options of {@link ChoWeb.create}. Every option is optional.
 *
 * @example
 * ```ts
 * import { HonoLinker } from "@chojs/vendor-hono";
 *
 * const app = await ChoWeb.create(AppModule, {
 *   prefix: "api/v1", // every route starts with /api/v1
 *   platform: () => Promise.resolve(new HonoLinker()),
 * });
 * ```
 */
export type ChoWebOptions = {
  /** The application version. Not used yet. */
  version: string;
  /** The application name. Not used yet. */
  name: string;
  /**
   * The global route prefix, added before every feature route, without
   * leading or trailing `/` (for example `"api"`). Default: `""`, no prefix.
   */
  prefix: string;
  /**
   * Create the linker that turns the HTTP graph into the routes of an HTTP
   * runtime. Default: the Hono linker of `@chojs/vendor-hono`, loaded on
   * demand.
   */
  platform: () => Promise<Linker<unknown>>;
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
 * const app = await ChoWeb.create(App);
 * Deno.serve(app.handler);
 * ```
 */
export class ChoWeb<T = Any> {
  /** The linked HTTP application, which holds the runtime's own object. */
  linked: Linked<T>;

  /**
   * Create the web application of a root module.
   *
   * Creates the injector and every instance of the application, builds the
   * HTTP graph, and links it with the linker of `options.platform`.
   *
   * @param app The root module.
   * @param options The application options; every option is optional.
   * @returns The application.
   * @throws {Error} When the module graph is invalid (see `Injector`), when a
   *   route is invalid or declared twice, or when a middleware or an error
   *   handler is invalid.
   *
   * @example
   * ```ts
   * const app = await ChoWeb.create(AppModule, { prefix: "api" });
   * Deno.serve({ port: 8080 }, app.handler);
   * ```
   */
  static async create<T = Any>(
    app: Ctr,
    options: Partial<ChoWebOptions> = {},
  ): Promise<ChoWeb<T>> {
    const prefix = options.prefix ?? "";
    const inj = new Injector(app);
    await inj.init();
    const graph = await build_http_graph(inj, prefix);
    const linker = await (options.platform ?? default_linker)();
    const ref = linker.link(graph);
    return new ChoWeb(ref as Linked<T>);
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
