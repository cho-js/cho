/**
 * The web application: {@link ChoWeb} builds the HTTP graph of a root module
 * and links it to an HTTP runtime with the given {@link Linker} (such as
 * `HonoLinker` from `@chojs/vendor-hono`), which gives a `fetch`-style request
 * handler.
 *
 * `ChoWeb.create` logs to the `cho:web` debug context (`CHO_DEBUGLOG=cho:web`
 * or `CHO_DEBUG=1`): every route with its handler, and any error that stops
 * the application from being created.
 *
 * @module
 */

import type { Ctr } from "@chojs/core/di";
import { Injector } from "@chojs/core/di";
import { debuglog, describe } from "@chojs/core/utils";
import { build_http_graph } from "./build-graph.ts";
import type { Linked, Linker } from "./linker.ts";
import type { AppRef } from "./graph.ts";

/**
 * The routes of an HTTP graph, for the debug log: `GET /v1/users/:id ->
 * Users.get`, in registration order.
 *
 * @param graph The HTTP graph.
 * @returns One line per route handler.
 */
function routes_of(graph: AppRef): string[] {
  const lines: string[] = [];
  for (const feature of graph.features) {
    for (const controller of feature.controllers) {
      for (const method of controller.methods) {
        const path = [
          graph.route,
          feature.route,
          controller.route,
          method.route,
        ]
          .filter((segment) => segment !== "")
          .join("/");
        lines.push(
          `${method.method} /${path} -> ${
            describe(controller.instance.constructor)
          }.${method.name}`,
        );
      }
    }
  }
  return lines;
}

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
 * import type { Context } from "hono";
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
    // Created here, not when the module is loaded, so it follows `set_env`.
    const log = debuglog("cho:web");
    const done = log.start();
    try {
      const inj = new Injector(app);
      await inj.init();
      const graph = await build_http_graph(inj, options.prefix ?? "");
      if (log.enabled) {
        for (const route of routes_of(graph)) log(route);
      }
      const web = new ChoWeb(options.linker.link(graph));
      done(`application ${describe(app)} created`);
      return web;
    } catch (error) {
      log.error(`cannot create application ${describe(app)}:`, error);
      throw error;
    }
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
