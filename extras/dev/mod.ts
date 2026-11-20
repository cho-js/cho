/**
 * @chojs/dev — tools for developing and debugging a CHO application.
 *
 * They read the metadata the decorators wrote. No instance is created and no
 * application is started: a root module class is enough.
 *
 * - {@link printEndpoints} prints every endpoint of an application: its HTTP
 *   routes, its WebSockets, its message topics and its commands, with the
 *   method that handles each. {@link endpoints} lists them, and
 *   {@link formatEndpoints} writes the table.
 * - {@link graphPage} draws the application on a page: its modules, their
 *   providers and controllers, its endpoints, and what imports, exports and
 *   injects what. The page filters by kind and by search. {@link devRoutes}
 *   mounts it on a `@chojs/web` application.
 * - {@link toMermaid} and {@link toDot} write the same graph as text, for
 *   Mermaid and for Graphviz.
 *
 * All of them are made of one model, {@link inspect}: plain data, that
 * {@link filterGraph} cuts by kind, by search or around a node.
 *
 * @example
 * ```ts
 * import { graphPage, printEndpoints } from "@chojs/dev";
 *
 * printEndpoints(AppModule);
 * // HTTP
 * // GET   /users  UsersController.list    UsersModule
 * // POST  /users  UsersController.create  UsersModule
 *
 * await Deno.writeTextFile("graph.html", graphPage(AppModule));
 * ```
 *
 * @module
 */

export { inspect } from "./inspect.ts";
export {
  endpoints,
  formatEndpoints,
  type FormatEndpointsOptions,
  printEndpoints,
} from "./endpoints.ts";
export { filterGraph } from "./filter.ts";
export { toDot, toMermaid } from "./text.ts";
export { graphPage, type GraphPageOptions, PAGE_VERSIONS } from "./page.ts";
export {
  type ChoDevWebApplication,
  devRoutes,
  type DevRoutesOptions,
} from "./mount.ts";
export type * from "./types.ts";

/** The codes of the errors of this package. */
export type { ChoDevErrorCode } from "./errors.ts";
