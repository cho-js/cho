/**
 * @chojs/asyncapi — the documentation of a `@chojs/message` application, from
 * what the application already declares.
 *
 * {@link asyncApi} gives a web application two routes: the
 * [AsyncAPI](https://www.asyncapi.com) document of the topics of a message
 * application, and a page that shows it. The page is made by the package: it
 * loads nothing, and runs no script.
 *
 * The topics, the arguments of the handlers with their schemas, and the
 * contracts are those of the handlers: nothing is declared twice. What the
 * code cannot tell is given with `@Doc`, of `@chojs/message`.
 *
 * The parts are usable by themselves: {@link asyncApiDocument} makes the
 * document, as a plain object, and {@link docsPage} the HTML of a page.
 *
 * @example
 * ```ts
 * import { ChoWeb } from "@chojs/web";
 * import { serve } from "@chojs/web/serve";
 * import { ChoMessage } from "@chojs/message";
 * import { asyncApi } from "@chojs/asyncapi";
 *
 * const web = await ChoWeb.create(AppModule);
 * // the consumers, on the injector of the web application
 * const app = await ChoMessage.from(web.injector, { linker });
 *
 * asyncApi(web, app, { info: { title: "Shop", version: "1.0.0" } });
 * // GET /asyncapi               the page
 * // GET /asyncapi/asyncapi.json the document
 *
 * await serve(web.handler);
 * await app.start();
 * ```
 *
 * @module
 */

export { asyncApi, type AsyncApiOptions } from "./mount.ts";
export { asyncApiDocument, type AsyncApiDocumentOptions } from "./document.ts";
export {
  type DocsPage,
  docsPage,
  type DocsPageOptions,
  type DocsUi,
} from "./page.ts";
export type { SchemaIo, ToJsonSchema } from "@chojs/core/utils";
export type * from "./types.ts";

/** The codes of the errors of this package. */
export type { ChoAsyncApiErrorCode } from "./errors.ts";
