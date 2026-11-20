/**
 * {@link devRoutes}: mounts the graph of a web application on the application
 * itself: its page, and its model as JSON.
 *
 * @module
 */

import { read } from "./inspect.ts";
import {
  assert_page_options,
  graphPage,
  type GraphPageOptions,
  PAGE_OPTIONS,
} from "./page.ts";
import type { ChoDevApplication } from "./types.ts";

/**
 * A web application, as far as {@link devRoutes} uses it: it can be read, and
 * it takes a route. A `ChoWeb` of `@chojs/web` is one.
 *
 * @typeParam Middleware What a middleware of the application is.
 */
export type ChoDevWebApplication<Middleware = unknown> = ChoDevApplication & {
  /** Add a route to the application: `ChoWeb.mount`. */
  mount(
    method: "GET",
    route: string,
    handler: () => unknown,
    options?: { middlewares?: readonly Middleware[]; name?: string },
  ): void;
};

/**
 * The options of {@link devRoutes}: those of the page, and its own.
 *
 * @typeParam Middleware What a middleware of the application is.
 */
export type DevRoutesOptions<Middleware = unknown> = GraphPageOptions & {
  /**
   * The base route of the two routes, written like the route of a decorator
   * (`"internal/graph"`). It is not under the global prefix of the
   * application. Default: `"__cho"`.
   */
  route?: string;
  /**
   * Middleware functions of `@chojs/web`, for the two routes: an
   * authentication, say. The middlewares of the application do not run for a
   * mounted route. Default: none.
   */
  middlewares?: readonly Middleware[];
};

/** The names of the options, for the error of an unknown one. */
const OPTIONS = [...PAGE_OPTIONS, "middlewares", "route"].sort();

/**
 * Give a web application the page of its own graph.
 *
 * | Route                    | Answers                 |
 * | ------------------------ | ----------------------- |
 * | `GET <route>`            | the page of `graphPage` |
 * | `GET <route>/graph.json` | the model of `inspect`  |
 *
 * Call it between `ChoWeb.create` and the start of the server: the routes are
 * mounted with `app.mount`.
 *
 * - The model is read once, here, before the two routes are added: they are
 *   not in it. The routes that were mounted before are.
 * - The two routes are not under the global prefix of the application, and no
 *   middleware of the application runs for them: they have the `middlewares`
 *   of the options.
 * - It is for development. The page shows the structure of the application to
 *   whoever can reach the route: do not mount it in production, or give it an
 *   authentication.
 *
 * @param app The application, created.
 * @param options `route`, `middlewares`, and the options of the page.
 * @throws {ChoError} When the application or an option is invalid, when the
 *   route is invalid or taken, or when the application can no longer take a
 *   route.
 *
 * @example
 * ```ts
 * const app = await ChoWeb.create(AppModule);
 * if (Deno.env.get("ENV") !== "production") {
 *   devRoutes(app); // GET /__cho, GET /__cho/graph.json
 * }
 * Deno.serve(app.handler);
 * ```
 */
export function devRoutes<Middleware>(
  app: ChoDevWebApplication<Middleware>,
  options: DevRoutesOptions<Middleware> = {},
): void {
  const graph = read("devRoutes()", app);
  assert_page_options("devRoutes()", options, OPTIONS);
  const { route = "__cho", middlewares, ...of_page } = options;
  const html = graphPage(graph, of_page);
  const json = JSON.stringify(graph);
  const mount_options = { ...(middlewares ? { middlewares } : {}) };
  // `app.mount` checks the route. A route that is not a string is given as it
  // is, for its error.
  const base = typeof route === "string" ? route.trim() : route;
  const json_route = typeof base === "string"
    ? (base === "" ? "graph.json" : `${base}/graph.json`)
    : base;
  app.mount(
    "GET",
    base,
    () =>
      new Response(html, {
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    { ...mount_options, name: "dev graph page" },
  );
  app.mount(
    "GET",
    json_route,
    () =>
      new Response(json, { headers: { "content-type": "application/json" } }),
    { ...mount_options, name: "dev graph model" },
  );
}
