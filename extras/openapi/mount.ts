/**
 * Mounts the documentation of an application on the application itself: the
 * OpenAPI document of its routes, and the page that shows it.
 *
 * @module
 */

import type { ChoWeb, ChoWebMiddlewareFn } from "@chojs/web";
import {
  assert_document_options,
  DOCUMENT_OPTIONS,
  openApiDocument,
  type OpenApiDocumentOptions,
} from "./document.ts";
import { assert_ui, docsPage, type DocsUi } from "./page.ts";

/** The options of {@link openApi}: those of the document, and its own. */
export type OpenApiOptions = OpenApiDocumentOptions & {
  /**
   * The base route of the two routes, written like the route of a decorator
   * (`"internal/docs"`). It is not under the global prefix of the
   * application. Default: `"docs"`.
   */
  route?: string;
  /**
   * The client the page shows: `"swagger"` (Swagger UI), `"scalar"`,
   * `"redoc"`, or a function that returns the HTML of the page, for any other
   * client. `false`: no page, the document only. Default: `"swagger"`.
   */
  ui?: DocsUi | false;
  /**
   * Where the files of the client are, for an application that hosts them
   * itself. Default: the CDN.
   */
  assets?: string;
  /**
   * Middleware functions of `@chojs/web`, for the two routes: an
   * authentication, say. The middlewares of the application do not run for a
   * mounted route. Default: none.
   */
  middlewares?: readonly ChoWebMiddlewareFn[];
};

/** The names of the options, for the error of an unknown one. */
const OPTIONS = [
  ...DOCUMENT_OPTIONS,
  "assets",
  "middlewares",
  "route",
  "ui",
].sort();

/**
 * Give an application its documentation: mount the OpenAPI document of its
 * routes, and a page that shows it.
 *
 * | Route                      | Answers                          |
 * | -------------------------- | -------------------------------- |
 * | `GET <route>`              | the page, Swagger UI by default  |
 * | `GET <route>/openapi.json` | the document                     |
 *
 * Call it between `ChoWeb.create` and the start of the server: the routes are
 * mounted with `app.mount`.
 *
 * - The two routes are in `app.routes`, and not in `app.graph`: so they are
 *   not in the document.
 * - They are not under the global prefix of the application: `route` says
 *   their whole path.
 * - The document is made at once, and kept: the graph of an application does
 *   not change. So a mistake throws here, before the server starts, and
 *   nothing is mounted.
 * - The page finds the document by itself: its URL is the path of the request
 *   for the page, with `/openapi.json`.
 * - No middleware of the application runs for them: they have the
 *   `middlewares` of the options.
 *
 * @param app The application, created.
 * @param options The options of the document (`info` is required), and
 *   `route`, `ui`, `assets` and `middlewares`.
 * @throws {ChoError} When `info` has no title or no version, when an option or
 *   the `ui` is unknown, when the document cannot be made (two operations
 *   with one `operationId`, a security scheme the document has not), when the
 *   route is invalid or taken, or when the application can no longer take a
 *   route.
 *
 * @example
 * ```ts
 * const app = await ChoWeb.create(AppModule);
 * openApi(app, { info: { title: "Shop", version: "1.0.0" } });
 * Deno.serve(app.handler); // GET /docs, GET /docs/openapi.json
 * ```
 */
export function openApi(app: ChoWeb<unknown>, options: OpenApiOptions): void {
  assert_document_options("openApi()", options, OPTIONS);
  const {
    route = "docs",
    ui = "swagger",
    assets,
    middlewares,
    ...of_document
  } = options;
  assert_ui("openApi()", ui, true);
  // Made now, and not for the first request: what is wrong with the
  // application is known before it serves, and nothing is mounted.
  const json = JSON.stringify(openApiDocument(app, of_document));
  const mount_options = { ...(middlewares ? { middlewares } : {}) };
  // `app.mount` checks the route. A route that is not a string is given as it
  // is, for its error.
  const base = typeof route === "string" ? route.trim() : route;
  const document_route = typeof base === "string"
    ? (base === "" ? "openapi.json" : `${base}/openapi.json`)
    : base;

  // The page first: its route is the one an application is likely to have.
  if (ui !== false) {
    app.mount(
      "GET",
      base,
      (ctx) =>
        new Response(
          docsPage({
            ui,
            // Where the page is, with no trailing slash, and the document.
            url: `${ctx.url.pathname.replace(/\/+$/, "")}/openapi.json`,
            title: options.info.title,
            ...(assets === undefined ? {} : { assets }),
          }),
          { headers: { "content-type": "text/html; charset=utf-8" } },
        ),
      { ...mount_options, name: "openApi page" },
    );
  }
  app.mount(
    "GET",
    document_route,
    () =>
      new Response(json, { headers: { "content-type": "application/json" } }),
    { ...mount_options, name: "openApi document" },
  );
}
