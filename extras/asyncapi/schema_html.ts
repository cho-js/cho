/**
 * A JSON Schema, as HTML: what the page shows of the payload, the headers
 * and the key of a message.
 *
 * An object is a table of its properties: the name, the type, and what else
 * the schema says of the property. What is inside a property (an object, the
 * items of a list, the alternatives of a `oneOf`) is shown under it. What the
 * table has no place for is in the schema as JSON, under it.
 *
 * Everything that comes from the schema is escaped.
 *
 * @module
 */

import type { JsonSchema } from "./types.ts";

/** Where the schemas a document refers to are. */
const COMPONENTS = "#/components/schemas/";

/** The keywords that are shown as they are: `minimum: 1`. */
const LIMITS = [
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
] as const;

/** The keywords that hold a list of schemas, and how each is named. */
const ALTERNATIVES = [
  ["oneOf", "one of"],
  ["anyOf", "any of"],
  ["allOf", "all of"],
] as const;

/** How deep a schema is shown. Deeper, it is only in the JSON. */
const MAX_DEPTH = 12;

/** Whether a value is a plain object: what a JSON Schema is. */
function is_object(value: unknown): value is JsonSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Escape a text for HTML, in an element or in a quoted attribute.
 *
 * @param text The text.
 * @returns The text, with no character HTML reads as its own.
 */
export function html(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** A value of a schema (a default, a value of an `enum`), as code. */
function value_html(value: unknown): string {
  return `<code>${html(JSON.stringify(value) ?? String(value))}</code>`;
}

/**
 * A reference, as HTML: a link to the schema on the page, when it is one of
 * the schemas of the document.
 *
 * @param ref The reference: `"#/components/schemas/Item"`.
 * @param anchors The id of the element of each schema of the page, by the
 *   name of the schema.
 */
function ref_html(ref: string, anchors: ReadonlyMap<string, string>): string {
  const name = ref.startsWith(COMPONENTS)
    ? ref.slice(COMPONENTS.length)
    : undefined;
  const anchor = name === undefined ? undefined : anchors.get(name);
  return anchor === undefined
    ? `<code>${html(ref)}</code>`
    : `<a href="#${html(anchor)}">${html(name!)}</a>`;
}

/**
 * The type of a schema, in a few words: `string (date-time)`,
 * `array of number`, `one of`, a link for a reference.
 */
function type_html(
  schema: JsonSchema,
  anchors: ReadonlyMap<string, string>,
): string {
  if (typeof schema.$ref === "string") {
    return ref_html(schema.$ref, anchors);
  }
  if ("const" in schema) {
    return value_html(schema.const);
  }
  if (Array.isArray(schema.enum)) {
    return "enum";
  }
  for (const [keyword, name] of ALTERNATIVES) {
    if (Array.isArray(schema[keyword])) {
      return name;
    }
  }
  const types = Array.isArray(schema.type)
    ? schema.type
    : schema.type === undefined
    ? []
    : [schema.type];
  if (types.length === 0) {
    return is_object(schema.properties) ? "object" : "any";
  }
  const names = types.map((type) =>
    type === "array" && is_object(schema.items)
      ? `array of ${type_html(schema.items, anchors)}`
      : html(String(type))
  );
  const format = typeof schema.format === "string"
    ? ` (${html(schema.format)})`
    : "";
  return names.join(" | ") + format;
}

/**
 * What a schema says besides its type: its description, the values of its
 * `enum`, its default and its limits.
 */
function notes_html(schema: JsonSchema): string {
  const notes: string[] = [];
  if (typeof schema.description === "string" && schema.description !== "") {
    notes.push(`<span class="text">${html(schema.description)}</span>`);
  }
  if (Array.isArray(schema.enum)) {
    notes.push(`Values: ${schema.enum.map(value_html).join(", ")}`);
  }
  if ("default" in schema) {
    notes.push(`Default: ${value_html(schema.default)}`);
  }
  for (const keyword of LIMITS) {
    if (keyword in schema) {
      const limit = schema[keyword];
      // A pattern is read as it is written, not as a string of JSON.
      notes.push(
        `${keyword}: ${
          typeof limit === "string"
            ? `<code>${html(limit)}</code>`
            : value_html(limit)
        }`,
      );
    }
  }
  if (schema.deprecated === true) {
    notes.push("Deprecated");
  }
  return notes.map((note) => `<div>${note}</div>`).join("");
}

/**
 * What is inside a schema: the properties of an object, the items of a list,
 * the alternatives of a `oneOf`. Empty for a schema that has nothing inside.
 *
 * @param depth How deep the schema is, in the schema that is shown.
 */
function inside_html(
  schema: JsonSchema,
  anchors: ReadonlyMap<string, string>,
  depth: number,
): string {
  // A reference is a link: what is inside is where the link goes.
  if (typeof schema.$ref === "string") {
    return "";
  }
  if (depth > MAX_DEPTH) {
    return `<p class="none">Deeper: see the JSON.</p>`;
  }
  const parts: string[] = [];

  const properties = is_object(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const rows = Object.entries(properties).map(([name, property]) => {
    const of_property = is_object(property) ? property : {};
    const mark = required.includes(name)
      ? ` <span class="required">required</span>`
      : "";
    const inside = inside_html(of_property, anchors, depth + 1);
    return `<tr><th scope="row"><code>${html(name)}</code>${mark}</th>` +
      `<td class="type">${type_html(of_property, anchors)}</td>` +
      `<td>${notes_html(of_property)}</td></tr>` +
      (inside === ""
        ? ""
        : `<tr class="inside"><td colspan="3">${inside}</td></tr>`);
  });
  // What an object takes besides its properties.
  if (is_object(schema.additionalProperties)) {
    const other = schema.additionalProperties;
    const inside = inside_html(other, anchors, depth + 1);
    rows.push(
      `<tr><th scope="row"><em>any other</em></th>` +
        `<td class="type">${type_html(other, anchors)}</td>` +
        `<td>${notes_html(other)}</td></tr>` +
        (inside === ""
          ? ""
          : `<tr class="inside"><td colspan="3">${inside}</td></tr>`),
    );
  }
  if (rows.length > 0) {
    parts.push(
      `<table class="properties"><thead><tr><th scope="col">Name</th>` +
        `<th scope="col">Type</th><th scope="col">What it is</th></tr></thead>` +
        `<tbody>${rows.join("")}</tbody></table>`,
    );
  }

  if (is_object(schema.items)) {
    const inside = inside_html(schema.items, anchors, depth + 1);
    if (inside !== "") {
      parts.push(`<p class="label">Each item:</p>${inside}`);
    }
  }

  for (const [keyword] of ALTERNATIVES) {
    const alternatives = schema[keyword];
    if (!Array.isArray(alternatives)) {
      continue;
    }
    alternatives.forEach((alternative, index) => {
      const of_alternative = is_object(alternative) ? alternative : {};
      parts.push(
        `<div class="alternative"><p class="label">${index + 1}. ${
          type_html(of_alternative, anchors)
        }</p>${notes_html(of_alternative)}${
          inside_html(of_alternative, anchors, depth + 1)
        }</div>`,
      );
    });
  }
  return parts.join("");
}

/**
 * A JSON Schema, as HTML.
 *
 * @param schema The schema.
 * @param anchors The id of the element of each schema of the page, by the
 *   name of the schema: a reference to one of them is a link to it. Default:
 *   none, and a reference is written as it is.
 * @returns The HTML: the type and what the schema says of itself, what is
 *   inside it, and the schema as JSON.
 */
export function schema_html(
  schema: JsonSchema,
  anchors: ReadonlyMap<string, string> = new Map(),
): string {
  const json = JSON.stringify(schema, null, 2);
  return `<div class="schema">` +
    `<p class="label">${type_html(schema, anchors)}</p>` +
    notes_html(schema) +
    inside_html(schema, anchors, 0) +
    `<details class="json"><summary>JSON</summary><pre><code>${
      html(json)
    }</code></pre></details>` +
    `</div>`;
}
