/**
 * The page that shows an OpenAPI document: one small HTML file, that loads a
 * client of OpenAPI from a CDN and gives it the URL of the document.
 *
 * @module
 */

import { openapi_error } from "./errors.ts";

/**
 * The version of each client {@link docsPage} loads. They are exact: a page
 * does not change until the package does.
 */
export const UI_VERSIONS = {
  /** Swagger UI: the package `swagger-ui-dist`. */
  swagger: "5.34.1",
  /** Scalar: the package `@scalar/api-reference`. */
  scalar: "1.76.4",
  /** Redoc: the package `redoc`. */
  redoc: "2.5.4",
} as const;

/** What a page shows: given to a `ui` function. */
export type DocsPage = {
  /** Where the OpenAPI document is. */
  readonly url: string;
  /** The title of the page. */
  readonly title: string;
};

/**
 * The client of a page: one that is ready, or a function that returns the
 * HTML of the page, for any other client.
 *
 * @example
 * ```ts
 * const ui: DocsUi = ({ url, title }) =>
 *   `<!doctype html><title>${title}</title><my-client spec="${url}"></my-client>`;
 * ```
 */
export type DocsUi =
  | keyof typeof UI_VERSIONS
  | ((page: DocsPage) => string);

/** The options of {@link docsPage}. */
export type DocsPageOptions = {
  /** Where the OpenAPI document is: a URL, or a path of the application. */
  url: string;
  /** The client. Default: `"swagger"`. */
  ui?: DocsUi;
  /** The title of the page. Default: `"API"`. */
  title?: string;
  /**
   * Where the files of the client are, for an application that hosts them
   * itself: it replaces the address of the package on the CDN, and the names
   * of the files stay the same. Default: the CDN.
   */
  assets?: string;
};

/** The package of each client on the CDN. */
const PACKAGES: Readonly<Record<keyof typeof UI_VERSIONS, string>> = {
  swagger: "swagger-ui-dist",
  scalar: "@scalar/api-reference",
  redoc: "redoc",
};

/** The names of the ready clients, for the error of an unknown one. */
const UI_NAMES = Object.keys(UI_VERSIONS).sort();

/** Escape a text for HTML, in an element or in a quoted attribute. */
function html(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Write a text as a JavaScript string, safe inside a `<script>` element. */
function script_string(text: string): string {
  return JSON.stringify(text)
    .replaceAll("<", "\\u003c")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

/** A whole page, around what is in its head and in its body. */
function page(title: string, head: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${html(title)}</title>${head}
  </head>
  <body>${body}
  </body>
</html>
`;
}

/** The page of each ready client. `base` is where its files are. */
const PAGES: Readonly<
  Record<keyof typeof UI_VERSIONS, (page: DocsPage, base: string) => string>
> = {
  swagger: ({ url, title }, base) =>
    page(
      title,
      `
    <link rel="stylesheet" href="${html(base)}/swagger-ui.css">`,
      `
    <div id="swagger-ui"></div>
    <script src="${html(base)}/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({ url: ${
        script_string(url)
      }, dom_id: "#swagger-ui" });
    </script>`,
    ),
  scalar: ({ url, title }, base) =>
    page(
      title,
      "",
      `
    <div id="app"></div>
    <script src="${html(base)}/dist/browser/standalone.js"></script>
    <script>
      Scalar.createApiReference("#app", { url: ${script_string(url)} });
    </script>`,
    ),
  redoc: ({ url, title }, base) =>
    page(
      title,
      `
    <style>body { margin: 0; }</style>`,
      `
    <redoc spec-url="${html(url)}"></redoc>
    <script src="${html(base)}/bundles/redoc.standalone.js"></script>`,
    ),
};

/**
 * Check a `ui`.
 *
 * @param caller The function that was given it, for the message.
 * @param ui The value of the option.
 * @param or_false Whether `false` is a value the caller takes.
 * @throws {ChoError} When it is neither a ready client nor a function.
 */
export function assert_ui(caller: string, ui: unknown, or_false = false): void {
  if (
    typeof ui === "function" || (or_false && ui === false) ||
    (typeof ui === "string" && Object.hasOwn(UI_VERSIONS, ui))
  ) {
    return;
  }
  throw openapi_error(
    "CHO_OPENAPI_UNKNOWN_UI",
    `${caller}: unknown ui ${
      typeof ui === "string" ? JSON.stringify(ui) : String(ui)
    }. Known: ${UI_NAMES.join(", ")},${
      or_false ? " false," : ""
    } or a function that returns the HTML`,
  );
}

/**
 * The HTML of a page that shows an OpenAPI document.
 *
 * The page loads a client of OpenAPI and gives it the URL of the document:
 * Swagger UI (`"swagger"`, the default), Scalar (`"scalar"`) or Redoc
 * (`"redoc"`), from the jsDelivr CDN, at the version of {@link UI_VERSIONS}.
 * For any other client, `ui` is a function that returns the HTML.
 *
 * The title and the URL are escaped in the page of the three clients. A
 * function of your own escapes what it writes.
 *
 * @param options The options: `url`, and `ui`, `title` and `assets`.
 * @returns The HTML of the page.
 * @throws {ChoError} When there is no `url`, or when the `ui` is not known.
 *
 * @example
 * ```ts
 * const html = docsPage({ url: "/docs/openapi.json", ui: "scalar" });
 * return new Response(html, {
 *   headers: { "content-type": "text/html; charset=utf-8" },
 * });
 * ```
 */
export function docsPage(options: DocsPageOptions): string {
  const { url, ui = "swagger", title = "API", assets } = options ?? {};
  if (typeof url !== "string" || url === "") {
    throw openapi_error(
      "CHO_OPENAPI_INVALID_OPTION",
      'docsPage(): the "url" option is required: where the OpenAPI document is',
    );
  }
  assert_ui("docsPage()", ui);
  if (typeof ui === "function") {
    return ui({ url, title });
  }
  const base = assets === undefined
    ? `https://cdn.jsdelivr.net/npm/${PACKAGES[ui]}@${UI_VERSIONS[ui]}`
    : assets.replace(/\/+$/, "");
  return PAGES[ui]({ url, title }, base);
}
