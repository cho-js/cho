/**
 * @chojs/openapi — the documentation of a `@chojs/web` application, from what
 * the application already declares.
 *
 * {@link openApi} gives an application two routes: the OpenAPI document of
 * its routes, and a page that shows it, with Swagger UI, Scalar, Redoc or any
 * other client of OpenAPI.
 *
 * The methods, the paths, the arguments and their schemas are those of the
 * handlers: nothing is declared twice. What the code cannot tell is given
 * with `@Doc`, of `@chojs/web`.
 *
 * The parts are usable by themselves: {@link openApiDocument} makes the
 * document, as a plain object, and {@link docsPage} the HTML of a page.
 *
 * @example
 * ```ts
 * import { ChoWeb } from "@chojs/web";
 * import { serve } from "@chojs/web/serve";
 * import { openApi } from "@chojs/openapi";
 *
 * const app = await ChoWeb.create(AppModule);
 *
 * openApi(app, { info: { title: "Shop", version: "1.0.0" } });
 * // GET /docs              the page: Swagger UI
 * // GET /docs/openapi.json the document
 *
 * await serve(app.handler);
 * ```
 *
 * @module
 */

export { openApi, type OpenApiOptions } from "./mount.ts";
export { openApiDocument, type OpenApiDocumentOptions } from "./document.ts";
export {
  type DocsPage,
  docsPage,
  type DocsPageOptions,
  type DocsUi,
  UI_VERSIONS,
} from "./page.ts";
export type { SchemaIo, ToJsonSchema } from "./schema.ts";
export type * from "./types.ts";
