/**
 * Tests for `page.ts`: the HTML of the page that shows an AsyncAPI document.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { contract, Doc, Header, Key, Value } from "@chojs/message";
import { loose } from "@chojs/core/utils/test_utils";
import { asyncApiDocument } from "./document.ts";
import { docsPage } from "./page.ts";
import {
  args,
  controller,
  create,
  feature,
  standard,
  text,
} from "./testing.ts";
import type { AsyncApiDocument } from "./types.ts";

const INFO = { title: "Shop", version: "1.0.0" };

const ORDER = {
  type: "object",
  properties: { id: { type: "string", description: "The id of the order." } },
  required: ["id"],
};

/** A document with nothing in it. */
function empty(info: Record<string, unknown> = INFO): AsyncApiDocument {
  return loose({ asyncapi: "3.0.0", info, channels: {}, operations: {} });
}

/** The document of an application with every kind of operation. */
async function shop(): Promise<AsyncApiDocument> {
  const GetPrice = contract({
    topic: "orders.price",
    request: standard(ORDER),
    reply: standard({ type: "object", properties: { cents: {} } }),
  });
  const Shipped = contract({
    topic: "orders.shipped",
    request: standard({
      type: "object",
      properties: { item: { $ref: "#/definitions/Item" } },
      definitions: { Item: { type: "object", properties: { sku: {} } } },
    }),
  });
  const Orders = controller("OrdersController", "orders", {
    created: [
      "created",
      args(Value(standard(ORDER)), Header("tenant"), Key()),
      loose(Doc({ summary: "An order", description: "It was created." })),
    ],
    price: [GetPrice, loose(Doc({ reply: { description: "In cents" } }))],
    raw: ["raw", loose(Doc({ tags: ["tools"] }))],
  });
  return asyncApiDocument(await create(feature([Orders])), {
    info: { ...INFO, description: "The consumers of the shop." },
    servers: {
      production: {
        host: "kafka:9092",
        protocol: "kafka",
        protocolVersion: "3.7",
        description: "The production broker",
      },
    },
    tags: { tools: "For the team" },
    sends: { orderShipped: Shipped },
  });
}

describe("docsPage", () => {
  it("is one HTML file, that loads nothing and runs no script", async () => {
    const page = docsPage(await shop(), { url: "/asyncapi/asyncapi.json" });
    assert.match(page, /^<!doctype html>\n<html lang="en">/);
    assert.match(page, /<meta charset="utf-8">/);
    assert.match(page, /<meta name="viewport"/);
    assert.equal(page.match(/<style>/g)!.length, 1);
    for (
      const loads of ["<script", "<link", "<img", "<iframe", "@import", "url("]
    ) {
      assert.equal(page.includes(loads), false, loads);
    }
    // no address of another site, and no handler of an event
    assert.doesNotMatch(page, /https?:\/\//);
    assert.doesNotMatch(page, / on[a-z]+=/);
  });

  it("follows the color scheme of the browser", () => {
    const page = docsPage(empty());
    assert.match(page, /color-scheme: light dark/);
    assert.match(page, /@media \(prefers-color-scheme: dark\)/);
  });

  it("shows what the application is, and links to the document", async () => {
    const page = docsPage(await shop(), { url: "/asyncapi/asyncapi.json" });
    assert.match(page, /<title>Shop<\/title>/);
    assert.match(page, /<h1>Shop<\/h1>/);
    const shown = text(page);
    assert.match(shown, /Version 1\.0\.0 AsyncAPI 3\.0\.0/);
    assert.match(shown, /The consumers of the shop\./);
    assert.match(
      page,
      /<a href="\/asyncapi\/asyncapi\.json">The document, as JSON<\/a>/,
    );
  });

  it("takes a title of its own, and has no link with no url", async () => {
    const page = docsPage(await shop(), { title: "The shop" });
    assert.match(page, /<title>The shop<\/title>/);
    assert.match(page, /<h1>The shop<\/h1>/);
    assert.doesNotMatch(page, /The document, as JSON/);
  });

  it("shows the license, the contact, the terms and the other documentation", () => {
    const page = docsPage(empty({
      ...INFO,
      termsOfService: "https://example.com/terms",
      license: { name: "MIT", url: "https://example.com/mit" },
      contact: { name: "The team", email: "team@example.com" },
      externalDocs: {
        url: "https://example.com/docs",
        description: "Handbook",
      },
    }));
    assert.match(page, /<a href="https:\/\/example\.com\/docs">Handbook<\/a>/);
    assert.match(
      page,
      /<a href="https:\/\/example\.com\/terms">Terms of service<\/a>/,
    );
    assert.match(
      page,
      /License: <a href="https:\/\/example\.com\/mit">MIT<\/a>/,
    );
    assert.match(
      page,
      /Contact: <a href="mailto:team@example\.com">The team<\/a>/,
    );
  });

  it("shows the servers, in a table", async () => {
    const shown = text(docsPage(await shop()));
    assert.match(
      shown,
      /Servers Name Host Protocol What it is production kafka:9092 kafka 3\.7 The production broker/,
    );
    assert.doesNotMatch(docsPage(empty()), /id="servers"/);
  });

  it("shows each operation: what it does, its topic, its message and its reply", async () => {
    const page = docsPage(await shop());
    const [, created, price, raw, shipped] = page.split("<article ");
    assert.match(created!, /^id="operation-OrdersController\.created"/);
    assert.equal(
      text(`<${created!.split('<div class="part">')[0]}`),
      "Receives orders.created Operation OrdersController.created An order It was created. Orders",
    );
    const message = text(`<${created!.split('<div class="part">')[1]}`);
    assert.match(
      message,
      /^Message Content type: application\/json Payload object/,
    );
    assert.match(message, /id required string The id of the order\./);
    assert.match(message, /Headers object .* tenant string/);
    assert.match(message, /Key string/);

    assert.match(
      text(`<${price!.split('<div class="part">')[2]}`),
      /^Reply Sent back to who asked\. In cents Content type: application\/json Payload object .* cents any/,
    );
    assert.match(
      text(`<${raw!}`),
      /Receives orders\.raw .* Message Nothing is declared about its value\./,
    );
    assert.match(
      text(`<${shipped!}`),
      /^Sends orders\.shipped Operation orderShipped Message/,
    );
    assert.match(shipped!, /<span class="action send">Sends<\/span>/);
    assert.match(created!, /<span class="action receive">Receives<\/span>/);
  });

  it("lists the operations by tag, with what the document says of the tag", async () => {
    const page = docsPage(await shop());
    const nav = text(/<nav[^]*<\/nav>/.exec(page)![0]);
    assert.equal(
      nav,
      "Servers Operations Schemas Orders OrdersController.created OrdersController.price tools For the team OrdersController.raw No tag orderShipped sends",
    );
    assert.match(
      page,
      /<a href="#operation-OrdersController\.created">OrdersController\.created<\/a>/,
    );
  });

  it("shows the schemas the others refer to, and links to them", async () => {
    const page = docsPage(await shop());
    assert.match(page, /<a href="#schema-Item">Item<\/a>/);
    assert.match(page, /<article id="schema-Item">/);
    assert.match(
      text(page.split('<section id="schemas">')[1]!),
      /^Schemas Item object .* sku any/,
    );
    assert.doesNotMatch(docsPage(empty()), /id="schemas"/);
  });

  it("says that an application with no handler has no operation", () => {
    assert.match(
      text(docsPage(empty())),
      /Operations The application has no operation\./,
    );
  });

  it("gives every element an id of its own", () => {
    const operation = {
      action: "receive",
      channel: { $ref: "#/channels/a" },
      messages: [],
    };
    const page = docsPage(loose({
      ...empty(),
      channels: { a: { address: "a", messages: {} } },
      operations: { "a b": operation, "a/b": operation, "a-b": operation },
    }));
    assert.deepEqual(
      [...page.matchAll(/<article id="([^"]*)"/g)].map((found) => found[1]),
      ["operation-a-b", "operation-a-b-2", "operation-a-b-3"],
    );
  });

  it("escapes everything that comes from the document", () => {
    const attack = `<img src=x onerror="alert(1)">`;
    const page = docsPage(
      loose({
        asyncapi: attack,
        info: {
          title: attack,
          version: attack,
          description: attack,
          license: { name: attack },
          contact: { name: attack },
          tags: [{ name: attack, description: attack }],
        },
        servers: {
          [attack]: { host: attack, protocol: attack, description: attack },
        },
        channels: {
          [attack]: {
            address: attack,
            messages: {
              message: {
                summary: attack,
                description: attack,
                contentType: attack,
                payload: { description: attack, properties: { [attack]: {} } },
              },
            },
          },
        },
        operations: {
          [attack]: {
            action: "receive",
            channel: { $ref: `#/channels/${attack.replaceAll("/", "~1")}` },
            messages: [{ $ref: attack }],
            summary: attack,
            description: attack,
            tags: [{ name: attack }],
          },
        },
        components: { schemas: { [attack]: { description: attack } } },
      }),
      { title: attack, url: attack },
    );
    assert.doesNotMatch(page, /<img/);
    assert.match(page, /&lt;img src=x onerror=/);
  });

  it("does not make a link of a URL that is not one of the web", () => {
    for (
      const url of [
        "javascript:alert(1)",
        " JavaScript:alert(1)",
        "data:text/html,x",
      ]
    ) {
      const page = docsPage(
        empty({ ...INFO, license: { name: "MIT", url }, termsOfService: url }),
        { url },
      );
      assert.doesNotMatch(page, /href="[^#]/, url);
      assert.match(
        text(page),
        /The document, as JSON · Terms of service · License: MIT/,
      );
    }
    // a path of the same site is one
    assert.match(
      docsPage(empty(), { url: "asyncapi.json" }),
      /<a href="asyncapi\.json">/,
    );
  });

  it("shows a document that an application changed, with references to nothing", () => {
    const page = docsPage(loose({
      ...empty(),
      operations: {
        lost: {
          action: "send",
          channel: { $ref: "#/channels/gone" },
          messages: [{ $ref: "#/channels/gone/messages/message" }],
          reply: { channel: { $ref: "#/channels/gone~1reply" } },
        },
        odd: { action: "receive", channel: "orders", messages: "orders" },
      },
    }));
    const shown = text(page);
    assert.match(shown, /Sends #\/channels\/gone Operation lost/);
    assert.match(shown, /The message is not in the document\./);
    assert.match(shown, /Reply Sent to #\/channels\/gone~1reply/);
  });
});

describe("docsPage, mistakes", () => {
  it("needs an AsyncAPI document", () => {
    for (
      const not_one of [
        undefined,
        null,
        "document",
        {},
        { info: INFO },
        { info: INFO, channels: {} },
        { info: INFO, channels: [], operations: {} },
      ]
    ) {
      assert.throws(() => docsPage(loose(not_one)), {
        code: "CHO_ASYNCAPI_INVALID_OPTION",
        message:
          /^docsPage\(\): expected an AsyncAPI document, such as the one asyncApiDocument\(\) makes, got /,
      });
    }
  });

  it("refuses options that are not ones", () => {
    assert.throws(() => docsPage(empty(), loose("/asyncapi.json")), {
      code: "CHO_ASYNCAPI_INVALID_OPTION",
      message:
        /^docsPage\(\): expected options, such as \{ url: "\/asyncapi\/asyncapi\.json" \}, got /,
    });
    assert.throws(() => docsPage(empty(), loose({ ui: "x" })), {
      code: "CHO_CORE_UNKNOWN_OPTION",
      message: 'docsPage(): unknown option "ui". Known options: title, url',
    });
    for (const name of ["title", "url"]) {
      assert.throws(() => docsPage(empty(), loose({ [name]: 7 })), {
        code: "CHO_ASYNCAPI_INVALID_OPTION",
        message: `docsPage(): the "${name}" option is a string, got 7`,
      });
    }
  });
});
