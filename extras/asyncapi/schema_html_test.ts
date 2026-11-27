/**
 * Tests for `schema_html.ts`: a JSON Schema, as the HTML the page shows.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { html, schema_html } from "./schema_html.ts";
import { text } from "./testing.ts";

/** The HTML of a schema, without the JSON under it. */
function shown(schema: Record<string, unknown>, anchors?: Map<string, string>) {
  return schema_html(schema, anchors).split('<details class="json">')[0]!;
}

describe("html", () => {
  it("escapes what HTML reads as its own", () => {
    assert.equal(
      html(`<a href="x" title='y'>&</a>`),
      "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
    );
  });
});

describe("schema_html, the type of a schema", () => {
  const types: [Record<string, unknown>, string][] = [
    [{ type: "string" }, "string"],
    [{ type: "string", format: "date-time" }, "string (date-time)"],
    [{ type: ["string", "null"] }, "string | null"],
    [{ type: "array", items: { type: "number" } }, "array of number"],
    [{ type: "array" }, "array"],
    [{ enum: ["a", "b"] }, 'enum Values: "a" , "b"'],
    [{ const: 7 }, "7"],
    [{ oneOf: [] }, "one of"],
    [{ anyOf: [] }, "any of"],
    [{ allOf: [] }, "all of"],
    [{ properties: {} }, "object"],
    [{}, "any"],
  ];
  for (const [schema, expected] of types) {
    it(`says ${expected} for ${JSON.stringify(schema)}`, () => {
      assert.equal(text(shown(schema)), expected);
    });
  }
});

describe("schema_html, what a schema says of itself", () => {
  it("shows the description, the default and the limits", () => {
    const markup = shown({
      type: "integer",
      description: "How many.",
      default: 1,
      minimum: 1,
      maximum: 10,
      deprecated: true,
    });
    assert.equal(
      text(markup),
      "integer How many. Default: 1 minimum: 1 maximum: 10 Deprecated",
    );
  });

  it("shows a pattern as it is written", () => {
    assert.match(
      shown({ type: "string", pattern: "^\\d{4}$" }),
      /pattern: <code>\^\\d\{4\}\$<\/code>/,
    );
  });
});

describe("schema_html, what is inside a schema", () => {
  it("makes a table of the properties of an object, with what is required", () => {
    const markup = shown({
      type: "object",
      properties: {
        id: { type: "string", description: "The id." },
        note: { type: "string" },
      },
      required: ["id"],
    });
    assert.match(markup, /<table class="properties">/);
    assert.equal(
      text(markup),
      "object Name Type What it is id required string The id. note string",
    );
    assert.equal(markup.match(/<tr>/g)!.length, 3);
  });

  it("shows a nested object, and the items of a list, under their property", () => {
    const markup = shown({
      type: "object",
      properties: {
        customer: {
          type: "object",
          properties: { email: { type: "string" } },
        },
        items: {
          type: "array",
          items: { type: "object", properties: { sku: { type: "string" } } },
        },
        tags: { type: "array", items: { type: "string" } },
      },
    });
    assert.equal(markup.match(/<tr class="inside">/g)!.length, 2);
    assert.match(
      text(markup),
      /customer object Name Type What it is email string/,
    );
    assert.match(text(markup), /items array of object Each item: Name/);
    // a list of plain values has nothing inside
    assert.match(text(markup), /tags array of string$/);
  });

  it("shows each alternative of a oneOf, an anyOf and an allOf", () => {
    const markup = shown({
      oneOf: [
        { type: "object", properties: { card: { type: "string" } } },
        { type: "null", description: "Not paid." },
      ],
    });
    assert.equal(markup.match(/<div class="alternative">/g)!.length, 2);
    assert.match(
      text(markup),
      /^one of 1\. object .* card string 2\. null Not paid\.$/,
    );
    assert.equal(
      shown({ allOf: [{ type: "string" }] }).match(/class="alternative"/g)!
        .length,
      1,
    );
  });

  it("shows what an object takes besides its properties", () => {
    const markup = shown({
      type: "object",
      additionalProperties: { type: "integer" },
    });
    assert.match(text(markup), /any other integer$/);
  });

  it("stops at a depth, and leaves the rest to the JSON", () => {
    let schema: Record<string, unknown> = { type: "string" };
    for (let depth = 0; depth < 20; depth++) {
      schema = { type: "object", properties: { next: schema } };
    }
    assert.match(schema_html(schema), /Deeper: see the JSON\./);
  });

  it("takes a schema with keywords that are not what they should be", () => {
    const markup = schema_html({
      properties: ["a"],
      required: "id",
      items: 7,
      oneOf: [null, "x"],
      type: 12,
    });
    assert.match(markup, /class="schema"/);
  });
});

describe("schema_html, a reference", () => {
  it("is a link to a schema of the page, and what is inside is not repeated", () => {
    const anchors = new Map([["Item", "schema-Item"]]);
    const markup = shown({
      type: "object",
      properties: {
        item: { $ref: "#/components/schemas/Item" },
        all: { type: "array", items: { $ref: "#/components/schemas/Item" } },
      },
    }, anchors);
    assert.equal(
      markup.match(/<a href="#schema-Item">Item<\/a>/g)!.length,
      2,
    );
    assert.doesNotMatch(markup, /class="inside"/);
  });

  it("is written as it is when the page has no such schema", () => {
    assert.match(
      shown({ $ref: "#/components/schemas/Gone" }),
      /<code>#\/components\/schemas\/Gone<\/code>/,
    );
    assert.match(
      shown({ $ref: "https://example.com/schema.json" }),
      /<code>https:\/\/example\.com\/schema\.json<\/code>/,
    );
  });
});

describe("schema_html, what comes from the schema", () => {
  it("is escaped: names, descriptions, values, types and the JSON", () => {
    const attack = `<img src=x onerror="alert(1)">`;
    const markup = schema_html({
      type: attack,
      format: attack,
      description: attack,
      default: attack,
      enum: [attack],
      pattern: attack,
      $comment: attack,
      properties: { [attack]: { $ref: attack } },
    }, new Map([[attack, attack]]));
    assert.doesNotMatch(markup, /<img/);
    assert.match(markup, /&lt;img src=x onerror=/);
  });

  it("has the schema as JSON, under it", () => {
    const schema = { type: "object", properties: { id: { type: "string" } } };
    const markup = schema_html(schema);
    const json = /<pre><code>([^<]*)<\/code><\/pre>/.exec(markup)![1]!;
    assert.deepEqual(JSON.parse(json.replaceAll("&quot;", '"')), schema);
  });
});
