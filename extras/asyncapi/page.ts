/**
 * The page that shows an AsyncAPI document: one HTML file, made from the
 * document, with its styles in it.
 *
 * It loads nothing: no script, no stylesheet, no font and no image. What
 * opens and closes on it is a `<details>` element.
 *
 * @module
 */

import { assert_known_options } from "@chojs/core/di";
import { describe } from "@chojs/core/utils";
import { asyncapi_error } from "./errors.ts";
import { html, schema_html } from "./schema_html.ts";
import type {
  AsyncApiChannel,
  AsyncApiDocument,
  AsyncApiMessage,
  AsyncApiOperation,
  JsonSchema,
} from "./types.ts";

/** The options of {@link docsPage}. */
export type DocsPageOptions = {
  /** The title of the page. Default: the `title` of the `info`. */
  title?: string;
  /**
   * Where the document is, as JSON: the page links to it. Default: no link.
   */
  url?: string;
};

/** What a `ui` function receives: what it makes its own page from. */
export type DocsPage = {
  /** The document. */
  document: AsyncApiDocument;
  /** Where the document is served, as JSON. */
  url: string;
  /** The title of the page: the `title` of the `info`. */
  title: string;
};

/**
 * A page of the application's own, in place of the one of the package: a
 * function that returns its HTML.
 */
export type DocsUi = (page: DocsPage) => string;

/** The styles of the page: light, and dark where the browser asks for it. */
const STYLES = `
:root {
  color-scheme: light dark;
  --bg: #ffffff; --fg: #1b1f24; --muted: #5b6470; --line: #d9dee5;
  --soft: #f5f7fa; --code: #eef1f5; --accent: #0052cc;
  --receive: #0a6b43; --receive-bg: #e1f5ea;
  --send: #8a4b00; --send-bg: #fdf0db;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #12151a; --fg: #e6e9ee; --muted: #9aa4b2; --line: #2b323c;
    --soft: #191d24; --code: #222933; --accent: #6ea8ff;
    --receive: #5fd39a; --receive-bg: #12301f;
    --send: #f0b866; --send-bg: #33240c;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  overflow-wrap: anywhere;
}
a { color: var(--accent); }
code, pre { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.9em; }
code { background: var(--code); border-radius: 4px; padding: 0.1em 0.35em; }
pre { background: var(--code); border-radius: 6px; padding: 12px; overflow: auto; margin: 8px 0 0; }
pre code { background: none; padding: 0; }
h1, h2, h3, h4 { line-height: 1.25; margin: 0; }
h1 { font-size: 1.9rem; }
h2 { font-size: 1.3rem; margin: 40px 0 12px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
h3 { font-size: 1.1rem; }
h4 { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 18px 0 6px; }
p { margin: 8px 0; }
.wrap { max-width: 1180px; margin: 0 auto; padding: 0 20px; }
.head { border-bottom: 1px solid var(--line); background: var(--soft); padding: 28px 0 22px; }
.head .text { max-width: 70ch; }
.badges { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
.badge, .tag { display: inline-block; border-radius: 999px; padding: 1px 10px; font-size: 0.8rem; border: 1px solid var(--line); color: var(--muted); }
.action { display: inline-block; border-radius: 4px; padding: 1px 8px; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
.receive { color: var(--receive); background: var(--receive-bg); }
.send { color: var(--send); background: var(--send-bg); }
.text { white-space: pre-wrap; }
.muted, .none { color: var(--muted); }
.layout { display: grid; grid-template-columns: 250px minmax(0, 1fr); gap: 36px; align-items: start; }
nav { position: sticky; top: 0; max-height: 100vh; overflow: auto; padding: 24px 0; font-size: 0.92rem; }
nav ul { list-style: none; margin: 0 0 14px; padding: 0; }
nav li { margin: 3px 0; }
nav a { text-decoration: none; }
nav a:hover { text-decoration: underline; }
nav .group { font-weight: 600; margin: 14px 0 4px; }
nav .about { color: var(--muted); font-size: 0.85rem; margin: 0 0 6px; }
main { padding-bottom: 60px; min-width: 0; }
article { border: 1px solid var(--line); border-radius: 8px; padding: 16px 18px; margin: 14px 0; }
article > header { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
article .tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.part { border-top: 1px solid var(--line); margin-top: 16px; padding-top: 4px; }
table { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: 0.93rem; }
th, td { text-align: left; vertical-align: top; padding: 6px 10px 6px 0; border-bottom: 1px solid var(--line); }
thead th { color: var(--muted); font-weight: 600; font-size: 0.8rem; }
tbody th { font-weight: 500; }
td.type { color: var(--muted); }
table.properties { table-layout: fixed; }
table.properties th:first-child { width: 34%; }
table.properties td.type, table.properties th:nth-child(2) { width: 24%; }
tr.inside > td { padding: 0 0 8px 18px; border-left: 2px solid var(--line); }
tr.inside thead, .alternative thead { display: none; }
.required { color: var(--send); font-size: 0.75rem; margin-left: 4px; }
.label { font-weight: 600; margin: 6px 0 2px; }
.alternative { border-left: 2px solid var(--line); padding-left: 12px; margin: 8px 0; }
details.json { margin-top: 8px; }
details.json summary { cursor: pointer; color: var(--muted); font-size: 0.85rem; }
footer { border-top: 1px solid var(--line); color: var(--muted); font-size: 0.85rem; padding: 16px 0 28px; }
@media (max-width: 800px) {
  .layout { grid-template-columns: minmax(0, 1fr); gap: 0; }
  nav { position: static; max-height: none; padding: 16px 0 0; }
  table.properties th:first-child { width: 38%; }
}
`;

/** Whether a value is a plain object. */
function is_object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The tokens of a reference to a part of the document: `#/channels/a~1b`. */
function ref_tokens(ref: string): string[] {
  return ref.startsWith("#/")
    ? ref.slice(2).split("/").map((token) =>
      token.replaceAll("~1", "/").replaceAll("~0", "~")
    )
    : [];
}

/**
 * Follow a reference of the document.
 *
 * @returns What it points to, or `undefined` when nothing is there.
 */
function follow(document: AsyncApiDocument, reference: unknown): unknown {
  if (!is_object(reference) || typeof reference.$ref !== "string") {
    return undefined;
  }
  let found: unknown = document;
  for (const token of ref_tokens(reference.$ref)) {
    if (!is_object(found) || !Object.hasOwn(found, token)) {
      return undefined;
    }
    found = found[token];
  }
  return found;
}

/**
 * A URL a link can go to: `http`, `https` or `mailto`, or one with no scheme,
 * which stays on the site of the page. Any other (a `javascript:` URL) is
 * not a link.
 */
function link_href(url: unknown): string | undefined {
  if (typeof url !== "string" || url === "") {
    return undefined;
  }
  const scheme = /^\s*([A-Za-z][A-Za-z0-9+.-]*):/.exec(url)?.[1];
  return scheme === undefined ||
      ["http", "https", "mailto"].includes(scheme.toLowerCase())
    ? url
    : undefined;
}

/** A link, or its text alone when its URL is not one a link can go to. */
function link_html(url: unknown, text: string): string {
  const href = link_href(url);
  return href === undefined
    ? html(text)
    : `<a href="${html(href)}">${html(text)}</a>`;
}

/** A text of the document, when it is one with something in it. */
function text_of(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The ids of the elements of a page: each is made from a name, and no two
 * are the same.
 */
class Ids {
  readonly #taken = new Set<string>();

  /**
   * @param kind What the element is: `"operation"`.
   * @param name Its name: the id of the operation.
   * @returns The id of the element.
   */
  make(kind: string, name: string): string {
    const base = `${kind}-${name.replace(/[^A-Za-z0-9._-]+/g, "-")}`;
    let id = base;
    for (let n = 2; this.#taken.has(id); n++) {
      id = `${base}-${n}`;
    }
    this.#taken.add(id);
    return id;
  }
}

/** One schema of a message, under its title: the payload, the headers, the key. */
function schema_part(
  title: string,
  schema: unknown,
  anchors: ReadonlyMap<string, string>,
): string {
  return is_object(schema)
    ? `<h4>${html(title)}</h4>${schema_html(schema as JsonSchema, anchors)}`
    : "";
}

/** A message, as HTML: what it is, and its schemas. */
function message_html(
  message: unknown,
  anchors: ReadonlyMap<string, string>,
): string {
  if (!is_object(message)) {
    return `<p class="none">The message is not in the document.</p>`;
  }
  const { summary, description, contentType, payload, headers } =
    message as AsyncApiMessage;
  const parts = [
    text_of(summary) ? `<p class="text">${html(summary!)}</p>` : "",
    text_of(description) ? `<p class="text">${html(description!)}</p>` : "",
    text_of(contentType)
      ? `<p class="muted">Content type: <code>${html(contentType!)}</code></p>`
      : "",
    schema_part("Payload", payload, anchors),
    schema_part("Headers", headers, anchors),
    schema_part("Key", message["x-key"], anchors),
  ].join("");
  return parts === ""
    ? `<p class="none">Nothing is declared about its value.</p>`
    : parts;
}

/** The messages a list of references points to, as HTML. */
function messages_html(
  document: AsyncApiDocument,
  references: unknown,
  anchors: ReadonlyMap<string, string>,
): string {
  const list = Array.isArray(references) ? references : [];
  return list.map((reference) =>
    message_html(follow(document, reference), anchors)
  ).join("");
}

/** The topic of a channel, as HTML: its address, or why it has none. */
function topic_html(channel: unknown, reference: unknown): string {
  if (!is_object(channel)) {
    const ref = is_object(reference) ? String(reference.$ref) : "";
    return `<code>${html(ref)}</code>`;
  }
  const { address } = channel as AsyncApiChannel;
  return typeof address === "string"
    ? `<code>${html(address)}</code>`
    : `<span class="muted">where who asked says</span>`;
}

/**
 * Where a reply goes, as HTML: the address of its channel, or back to who
 * asked when the channel has none.
 */
function reply_to_html(channel: unknown, reference: unknown): string {
  return is_object(channel) && channel.address === null
    ? "Sent back to who asked."
    : `Sent to ${topic_html(channel, reference)}`;
}

/** One operation, as HTML. */
function operation_html(
  document: AsyncApiDocument,
  id: string,
  element: string,
  operation: AsyncApiOperation,
  anchors: ReadonlyMap<string, string>,
): string {
  const sends = operation.action === "send";
  const channel = follow(document, operation.channel);
  const tags = (Array.isArray(operation.tags) ? operation.tags : [])
    .map((tag) => text_of(is_object(tag) ? tag.name : undefined))
    .filter((name) => name !== undefined);
  const reply = is_object(operation.reply) ? operation.reply : undefined;
  return `<article id="${html(element)}">` +
    `<header><span class="action ${sends ? "send" : "receive"}">${
      sends ? "Sends" : "Receives"
    }</span><h3>${topic_html(channel, operation.channel)}</h3></header>` +
    `<p class="muted">Operation <code>${html(id)}</code></p>` +
    (text_of(operation.summary)
      ? `<p class="text"><strong>${html(operation.summary!)}</strong></p>`
      : "") +
    (text_of(operation.description)
      ? `<p class="text">${html(operation.description!)}</p>`
      : "") +
    (tags.length > 0
      ? `<div class="tags">${
        tags.map((tag) => `<span class="tag">${html(tag!)}</span>`).join("")
      }</div>`
      : "") +
    `<div class="part"><h4>Message</h4>${
      messages_html(document, operation.messages, anchors)
    }</div>` +
    (reply
      ? `<div class="part"><h4>Reply</h4><p class="muted">${
        reply_to_html(follow(document, reply.channel), reply.channel)
      }</p>${messages_html(document, reply.messages, anchors)}</div>`
      : "") +
    `</article>`;
}

/** The servers of the document, as a table. */
function servers_html(document: AsyncApiDocument): string {
  const servers = is_object(document.servers) ? document.servers : {};
  const rows = Object.entries(servers).map(([name, server]) => {
    const of_server: Record<string, unknown> = is_object(server) ? server : {};
    const protocol = [of_server.protocol, of_server.protocolVersion]
      .map(text_of).filter((part) => part !== undefined).join(" ");
    return `<tr><th scope="row"><code>${html(name)}</code></th>` +
      `<td><code>${html(text_of(of_server.host) ?? "")}${
        html(text_of(of_server.pathname) ?? "")
      }</code></td>` +
      `<td>${html(protocol)}</td>` +
      `<td class="text">${
        html(text_of(of_server.description) ?? text_of(of_server.summary) ?? "")
      }</td></tr>`;
  });
  return rows.length === 0
    ? ""
    : `<section id="servers"><h2>Servers</h2><table><thead><tr>` +
      `<th scope="col">Name</th><th scope="col">Host</th>` +
      `<th scope="col">Protocol</th><th scope="col">What it is</th>` +
      `</tr></thead><tbody>${rows.join("")}</tbody></table></section>`;
}

/** The head of the page: what the application is. */
function head_html(
  document: AsyncApiDocument,
  title: string,
  url: string | undefined,
): string {
  const { info } = document;
  const license = is_object(info.license) ? info.license : undefined;
  const contact = is_object(info.contact) ? info.contact : undefined;
  const docs = is_object(info.externalDocs) ? info.externalDocs : undefined;
  const lines = [
    url !== undefined ? link_html(url, "The document, as JSON") : "",
    docs
      ? link_html(docs.url, text_of(docs.description) ?? "More documentation")
      : "",
    text_of(info.termsOfService)
      ? link_html(info.termsOfService, "Terms of service")
      : "",
    license && text_of(license.name)
      ? `License: ${link_html(license.url, license.name)}`
      : "",
    contact && (text_of(contact.name) ?? text_of(contact.email))
      ? `Contact: ${
        link_html(
          text_of(contact.url) ??
            (text_of(contact.email) ? `mailto:${contact.email}` : undefined),
          text_of(contact.name) ?? contact.email!,
        )
      }`
      : "",
  ].filter((line) => line !== "");
  return `<div class="head"><div class="wrap">` +
    `<h1>${html(title)}</h1>` +
    `<div class="badges"><span class="badge">Version ${
      html(String(info.version))
    }</span><span class="badge">AsyncAPI ${
      html(String(document.asyncapi))
    }</span></div>` +
    (text_of(info.description)
      ? `<p class="text">${html(info.description!)}</p>`
      : "") +
    (lines.length > 0 ? `<p class="muted">${lines.join(" · ")}</p>` : "") +
    `</div></div>`;
}

/**
 * The navigation of the page: the operations, by tag, then those with no
 * tag.
 *
 * @param elements The id of the element of each operation, by its id.
 */
function nav_html(
  document: AsyncApiDocument,
  elements: ReadonlyMap<string, string>,
  has_servers: boolean,
  has_schemas: boolean,
): string {
  /** The operations of each tag, in the order the tags are first seen. */
  const groups = new Map<string, string[]>();
  const no_tag: string[] = [];
  for (const [id, operation] of Object.entries(document.operations)) {
    const tags = (Array.isArray(operation.tags) ? operation.tags : [])
      .map((tag) => text_of(is_object(tag) ? tag.name : undefined))
      .filter((name) => name !== undefined);
    if (tags.length === 0) {
      no_tag.push(id);
    }
    for (const tag of tags) {
      groups.set(tag!, [...(groups.get(tag!) ?? []), id]);
    }
  }
  /** What the document says of each tag. */
  const about = new Map<string, string>();
  for (
    const tag of Array.isArray(document.info.tags) ? document.info.tags : []
  ) {
    if (is_object(tag) && text_of(tag.name) && text_of(tag.description)) {
      about.set(tag.name, tag.description!);
    }
  }
  const list = (ids: readonly string[]) =>
    `<ul>${
      ids.map((id) => {
        const sends = document.operations[id]!.action === "send";
        return `<li><a href="#${html(elements.get(id)!)}">${html(id)}</a>${
          sends ? ` <span class="muted">sends</span>` : ""
        }</li>`;
      }).join("")
    }</ul>`;
  const parts: string[] = [];
  for (const [tag, ids] of groups) {
    parts.push(
      `<p class="group">${html(tag)}</p>` +
        (about.has(tag)
          ? `<p class="about">${html(about.get(tag)!)}</p>`
          : "") +
        list(ids),
    );
  }
  if (no_tag.length > 0) {
    parts.push(
      (groups.size > 0 ? `<p class="group">No tag</p>` : "") + list(no_tag),
    );
  }
  const sections = [
    has_servers ? `<li><a href="#servers">Servers</a></li>` : "",
    `<li><a href="#operations">Operations</a></li>`,
    has_schemas ? `<li><a href="#schemas">Schemas</a></li>` : "",
  ].join("");
  return `<nav aria-label="Contents"><ul>${sections}</ul>${
    parts.join("")
  }</nav>`;
}

/**
 * The HTML of a page that shows an AsyncAPI document.
 *
 * The page is one file: its markup, and its styles in a `<style>` element.
 * It loads nothing, and runs no script. It shows what the document has: the
 * application, its servers, each operation with its message and its reply,
 * and the schemas the others refer to.
 *
 * - A schema is a table of its properties, with the schema as JSON under it.
 * - Everything that comes from the document is escaped.
 * - A description is shown as it is written: Markdown is not rendered.
 * - Light and dark follow the browser.
 *
 * @param document The document, such as the one `asyncApiDocument` makes.
 * @param options The `title` of the page, and the `url` of the document, for
 *   a link to it.
 * @returns The HTML of the page.
 * @throws {ChoError} When `document` is not an AsyncAPI document, or when an
 *   option is unknown or not a string.
 *
 * @example
 * ```ts
 * const document = asyncApiDocument(app, {
 *   info: { title: "Shop", version: "1.0.0" },
 * });
 * const page = docsPage(document, { url: "/asyncapi/asyncapi.json" });
 * ```
 */
export function docsPage(
  document: AsyncApiDocument,
  options: DocsPageOptions = {},
): string {
  if (
    !is_object(document) || !is_object(document.info) ||
    !is_object(document.channels) || !is_object(document.operations)
  ) {
    throw asyncapi_error(
      "CHO_ASYNCAPI_INVALID_OPTION",
      `docsPage(): expected an AsyncAPI document, such as the one asyncApiDocument() makes, got ${
        describe(document)
      }`,
    );
  }
  if (!is_object(options)) {
    throw asyncapi_error(
      "CHO_ASYNCAPI_INVALID_OPTION",
      `docsPage(): expected options, such as { url: "/asyncapi/asyncapi.json" }, got ${
        describe(options)
      }`,
    );
  }
  assert_known_options("docsPage()", options, ["title", "url"]);
  for (const name of ["title", "url"] as const) {
    if (options[name] !== undefined && typeof options[name] !== "string") {
      throw asyncapi_error(
        "CHO_ASYNCAPI_INVALID_OPTION",
        `docsPage(): the "${name}" option is a string, got ${
          describe(options[name])
        }`,
      );
    }
  }
  const title = options.title ?? String(document.info.title ?? "AsyncAPI");

  const ids = new Ids();
  const components = is_object(document.components?.schemas)
    ? document.components.schemas
    : {};
  /** The element of each schema of the document: where a reference links. */
  const anchors = new Map<string, string>();
  for (const name of Object.keys(components)) {
    anchors.set(name, ids.make("schema", name));
  }
  /** The element of each operation: where the navigation links. */
  const elements = new Map<string, string>();
  for (const id of Object.keys(document.operations)) {
    elements.set(id, ids.make("operation", id));
  }

  const servers = servers_html(document);
  const operations = Object.entries(document.operations).map(
    ([id, operation]) =>
      operation_html(document, id, elements.get(id)!, operation, anchors),
  );
  const schemas = Object.entries(components).map(([name, schema]) =>
    `<article id="${html(anchors.get(name)!)}"><header><h3><code>${
      html(name)
    }</code></h3></header>${
      is_object(schema) ? schema_html(schema, anchors) : ""
    }</article>`
  );

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${html(title)}</title>
<style>${STYLES}</style>
</head>
<body>
${head_html(document, title, options.url)}
<div class="wrap layout">
${nav_html(document, elements, servers !== "", schemas.length > 0)}
<main>
${servers}
<section id="operations"><h2>Operations</h2>${
    operations.length > 0
      ? operations.join("\n")
      : `<p class="none">The application has no operation.</p>`
  }</section>
${
    schemas.length > 0
      ? `<section id="schemas"><h2>Schemas</h2>${schemas.join("\n")}</section>`
      : ""
  }
</main>
</div>
<footer><div class="wrap">Made from the AsyncAPI document of the application, by @chojs/asyncapi.</div></footer>
</body>
</html>
`;
}
