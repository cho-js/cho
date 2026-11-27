/**
 * Mounts the documentation of a message application on a web application:
 * the AsyncAPI document of its topics, and the page that shows it.
 *
 * @module
 */

import { describe } from "@chojs/core/utils";
import type { ChoMessage } from "@chojs/message";
import type { ChoWeb, ChoWebMiddlewareFn } from "@chojs/web";
import {
  assert_application,
  assert_document_options,
  asyncApiDocument,
  type AsyncApiDocumentOptions,
  DOCUMENT_OPTIONS,
} from "./document.ts";
import { asyncapi_error } from "./errors.ts";
import { docsPage, type DocsUi } from "./page.ts";

/** The options of {@link asyncApi}: those of the document, and its own. */
export type AsyncApiOptions = AsyncApiDocumentOptions & {
  /**
   * The base route of the two routes, written like the route of a decorator
   * (`"internal/asyncapi"`). It is not under the global prefix of the web
   * application. Default: `"asyncapi"`.
   */
  route?: string;
  /**
   * A page of the application's own, in place of the one of the package: a
   * function that returns its HTML. `false`: no page, the document only.
   * Default: the page of the package.
   */
  ui?: DocsUi | false;
  /**
   * Middleware functions of `@chojs/web`, for the two routes: an
   * authentication, say. The middlewares of the application do not run for a
   * mounted route. Default: none.
   */
  middlewares?: readonly ChoWebMiddlewareFn[];
};

/** The names of the options, for the error of an unknown one. */
const OPTIONS = [...DOCUMENT_OPTIONS, "middlewares", "route", "ui"].sort();

/** How many pages are kept: one for each path the page is asked at. */
const KEPT_PAGES = 8;

/**
 * Give a web application the documentation of its consumers: mount the
 * AsyncAPI document of a message application, and a page that shows it.
 *
 * | Route                       | Answers                  |
 * | --------------------------- | ------------------------ |
 * | `GET <route>`               | the page                 |
 * | `GET <route>/asyncapi.json` | the document             |
 *
 * Call it between the creation of the two applications and the start of the
 * server: the routes are mounted with `web.mount`. The consumers are made on
 * the injector of the web application, with `ChoMessage.from(web.injector)`.
 *
 * - The two routes are in `web.routes`, and not in `web.graph`: so they are
 *   not in the OpenAPI document of the web application.
 * - They are not under the global prefix of the web application: `route`
 *   says their whole path.
 * - The document and the page are made at once, and kept: the graph of an
 *   application does not change. So a mistake throws here, before the server
 *   starts, and nothing is mounted.
 * - The page links to the document: its URL is the path of the request for
 *   the page, with `/asyncapi.json`.
 * - No middleware of the application runs for them: they have the
 *   `middlewares` of the options.
 * - The message application is only read: it is not started, and need not
 *   be.
 *
 * @param web The web application, created: it gets the two routes.
 * @param app The message application, created: its graph is documented.
 * @param options The options of the document (`info` is required), and
 *   `route`, `ui` and `middlewares`.
 * @throws {ChoError} When `app` is not a message application, when `info` has
 *   no title or no version, when an option is unknown or not valid, when the
 *   document cannot be made (two operations with one id), when the route is
 *   invalid or taken, or when the web application can no longer take a
 *   route.
 *
 * @example
 * ```ts
 * const web = await ChoWeb.create(AppModule);
 * const app = await ChoMessage.from(web.injector, { linker });
 * asyncApi(web, app, { info: { title: "Shop", version: "1.0.0" } });
 * Deno.serve(web.handler); // GET /asyncapi, GET /asyncapi/asyncapi.json
 * await app.start();
 * ```
 */
export function asyncApi(
  web: ChoWeb<unknown>,
  app: ChoMessage<unknown>,
  options: AsyncApiOptions,
): void {
  if (typeof (web as { mount?: unknown } | null)?.mount !== "function") {
    throw asyncapi_error(
      "CHO_ASYNCAPI_INVALID_OPTION",
      `asyncApi(): expected a web application, made by ChoWeb.create, then the message application, got ${
        describe(web)
      }`,
    );
  }
  assert_application("asyncApi()", app);
  assert_document_options("asyncApi()", options, OPTIONS);
  const { route = "asyncapi", ui, middlewares, ...of_document } = options;
  if (ui !== undefined && ui !== false && typeof ui !== "function") {
    throw asyncapi_error(
      "CHO_ASYNCAPI_INVALID_OPTION",
      `asyncApi(): the "ui" option is a function that returns the HTML of a page, or false for no page, got ${
        describe(ui)
      }`,
    );
  }
  // Made now, and not for the first request: what is wrong with the
  // application is known before it serves, and nothing is mounted.
  const document = asyncApiDocument(app, of_document);
  const json = JSON.stringify(document);
  const title = options.info.title;
  const make_page = (url: string): string =>
    typeof ui === "function"
      ? ui({ document, url, title })
      : docsPage(document, { url, title });
  // `web.mount` checks the route. A route that is not a string is given as
  // it is, for its error.
  const base = typeof route === "string" ? route.trim() : route;
  const document_route = typeof base === "string"
    ? (base === "" ? "asyncapi.json" : `${base}/asyncapi.json`)
    : base;
  const mount_options = { ...(middlewares ? { middlewares } : {}) };

  // The page first: its route is the one an application is likely to have.
  if (ui !== false) {
    // The page of the package is made now too: it throws for a document it
    // cannot show.
    if (typeof ui !== "function" && typeof base === "string") {
      make_page(`/${base}/asyncapi.json`);
    }
    // The page is the same for every request, apart from the link to the
    // document, which follows the path the page was asked at.
    const pages = new Map<string, string>();
    web.mount(
      "GET",
      base,
      (ctx) => {
        // Where the page is, with no trailing slash, and the document.
        const url = `${ctx.url.pathname.replace(/\/+$/, "")}/asyncapi.json`;
        let page = pages.get(url);
        if (page === undefined) {
          page = make_page(url);
          if (pages.size < KEPT_PAGES) {
            pages.set(url, page);
          }
        }
        return new Response(page, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
      { ...mount_options, name: "asyncApi page" },
    );
  }
  web.mount(
    "GET",
    document_route,
    () =>
      new Response(json, { headers: { "content-type": "application/json" } }),
    { ...mount_options, name: "asyncApi document" },
  );
}
