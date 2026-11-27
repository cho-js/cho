/**
 * Tests for `mount.ts`: `asyncApi` mounts the document of a message
 * application, and the page that shows it, on a web application.
 *
 * Decorators are applied as plain function calls.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ChoWeb,
  type ChoWebMiddlewareFn,
  Controller as WebController,
  Get,
  Module as WebModule,
} from "@chojs/web";
import { ChoMessage, Doc, Value } from "@chojs/message";
import { legacy, loose } from "@chojs/core/utils/test_utils";
import { openApi } from "../openapi/mod.ts";
import { asyncApi } from "./mount.ts";
import {
  args,
  type Class,
  controller,
  create,
  create_both,
  feature,
  send,
  standard,
  text,
} from "./testing.ts";
import type { AsyncApiDocument } from "./types.ts";

const INFO = { title: "Shop", version: "1.0.0" };

/** A module with one consumer: `OrdersController`, of `orders.created`. */
function orders_module(): Class {
  return feature([
    controller("OrdersController", "orders", {
      created: [
        "created",
        args(Value(standard({ type: "object" }))),
        loose(Doc({ summary: "An order was created" })),
      ],
    }),
  ]);
}

/** The document a web application serves at a path. */
async function document_at(
  web: ChoWeb<unknown>,
  path: string,
): Promise<AsyncApiDocument> {
  const response = await send(web, path);
  assert.equal(response.status, 200, path);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^application\/json/,
  );
  return await response.json();
}

describe("asyncApi", () => {
  it("mounts the page and the document, under asyncapi", async () => {
    const { web, app } = await create_both(orders_module());
    asyncApi(web, app, { info: INFO });

    const document = await document_at(web, "/asyncapi/asyncapi.json");
    assert.equal(document.asyncapi, "3.0.0");
    assert.deepEqual(Object.keys(document.channels), ["orders.created"]);
    assert.deepEqual(Object.keys(document.operations), [
      "OrdersController.created",
    ]);

    const page = await send(web, "/asyncapi");
    assert.equal(page.status, 200);
    assert.equal(page.headers.get("content-type"), "text/html; charset=utf-8");
    const body = await page.text();
    assert.match(body, /<title>Shop<\/title>/);
    assert.match(
      text(body),
      /Receives orders\.created .* An order was created/,
    );
    assert.match(
      body,
      /<a href="\/asyncapi\/asyncapi\.json">The document, as JSON<\/a>/,
    );
  });

  it("names the two routes, and keeps them out of the graph of the web application", async () => {
    const { web, app } = await create_both(orders_module());
    asyncApi(web, app, { info: INFO });
    assert.deepEqual(
      web.routes.map((route) => [route.method, route.path, route.name]),
      [
        ["GET", "/asyncapi", "asyncApi page"],
        ["GET", "/asyncapi/asyncapi.json", "asyncApi document"],
      ],
    );
    assert.deepEqual(web.graph.features, []);
  });

  it("links to the document from where the page was asked, a trailing slash or not", async () => {
    class Pages {
      home() {
        return "home";
      }
    }
    legacy(Get(""), Pages, "home");
    WebController({})(Pages);
    class App {}
    WebModule({ controllers: [Pages], imports: [orders_module()] })(App);
    const { web, app } = await create_both(App);
    asyncApi(web, app, { info: INFO, route: "internal/messages" });
    for (const path of ["/internal/messages", "/internal/messages/"]) {
      const response = await send(web, path);
      // a router may not answer the path with a slash
      if (response.status === 200) {
        assert.match(
          await response.text(),
          /<a href="\/internal\/messages\/asyncapi\.json">/,
        );
      } else {
        await response.body?.cancel();
      }
    }
    await document_at(web, "/internal/messages/asyncapi.json");
  });

  it("is not under the prefix of the web application, and has the prefix of the message application", async () => {
    const web = await ChoWeb.create(orders_module(), {
      linker: new (await import("../../web/testing.ts")).TestLinker(),
      prefix: "api",
    });
    const app = await ChoMessage.from(web.injector, { prefix: "staging" });
    asyncApi(web, app, { info: INFO });
    const document = await document_at(web, "/asyncapi/asyncapi.json");
    assert.deepEqual(Object.keys(document.channels), [
      "staging.orders.created",
    ]);
    assert.equal((await send(web, "/api/asyncapi")).status, 404);
  });

  it("mounts at the root, with an empty route", async () => {
    const { web, app } = await create_both(orders_module());
    asyncApi(web, app, { info: INFO, route: "" });
    await document_at(web, "/asyncapi.json");
    const page = await (await send(web, "/")).text();
    assert.match(page, /<a href="\/asyncapi\.json">/);
  });

  it("gives the options of the document to the document", async () => {
    const { web, app } = await create_both(orders_module());
    asyncApi(web, app, {
      info: INFO,
      id: "urn:shop",
      servers: { main: { host: "kafka:9092", protocol: "kafka" } },
      tags: { Orders: "The orders" },
    });
    const document = await document_at(web, "/asyncapi/asyncapi.json");
    assert.equal(document.id, "urn:shop");
    assert.deepEqual(Object.keys(document.servers!), ["main"]);
    assert.deepEqual(document.info.tags, [
      { name: "Orders", description: "The orders" },
    ]);
  });

  it("mounts the document alone, with ui: false", async () => {
    const { web, app } = await create_both(orders_module());
    asyncApi(web, app, { info: INFO, ui: false });
    assert.deepEqual(web.routes.map((route) => route.name), [
      "asyncApi document",
    ]);
    assert.equal((await send(web, "/asyncapi")).status, 404);
    await document_at(web, "/asyncapi/asyncapi.json");
  });

  it("serves a page of the application's own, with a ui function", async () => {
    const { web, app } = await create_both(orders_module());
    const seen: unknown[] = [];
    asyncApi(web, app, {
      info: INFO,
      ui: ({ document, url, title }) => {
        seen.push([Object.keys(document.operations), url, title]);
        return `<h1>${title}</h1>`;
      },
    });
    const page = await send(web, "/asyncapi");
    assert.equal(page.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(await page.text(), "<h1>Shop</h1>");
    // made once for a path, and kept
    await (await send(web, "/asyncapi")).text();
    assert.deepEqual(seen, [
      [["OrdersController.created"], "/asyncapi/asyncapi.json", "Shop"],
    ]);
  });

  it("runs the middlewares of the options, for the two routes", async () => {
    const { web, app } = await create_both(orders_module());
    const seen: string[] = [];
    const only_admins: ChoWebMiddlewareFn = (ctx, next) => {
      seen.push(ctx.url.pathname);
      return ctx.req.headers.get("x-admin")
        ? next()
        : new Response("no", { status: 401 });
    };
    asyncApi(web, app, { info: INFO, middlewares: [only_admins] });
    assert.equal((await send(web, "/asyncapi")).status, 401);
    assert.equal((await send(web, "/asyncapi/asyncapi.json")).status, 401);
    const allowed = await send(web, "/asyncapi", {
      headers: { "x-admin": "1" },
    });
    assert.equal(allowed.status, 200);
    await allowed.text();
    assert.deepEqual(seen, [
      "/asyncapi",
      "/asyncapi/asyncapi.json",
      "/asyncapi",
    ]);
  });

  it("keeps the document it made, whatever is asked", async () => {
    const { web, app } = await create_both(orders_module());
    asyncApi(web, app, { info: INFO });
    const first = await (await send(web, "/asyncapi/asyncapi.json")).text();
    const second = await (await send(web, "/asyncapi/asyncapi.json")).text();
    assert.equal(first, second);
  });

  it("stands next to the documentation of the web application", async () => {
    const { web, app } = await create_both(orders_module());
    openApi(web, { info: INFO });
    asyncApi(web, app, { info: INFO });
    assert.deepEqual(web.routes.map((route) => route.path), [
      "/docs",
      "/docs/openapi.json",
      "/asyncapi",
      "/asyncapi/asyncapi.json",
    ]);
    // the routes of one are not in the document of the other
    const openapi = await (await send(web, "/docs/openapi.json")).json();
    assert.deepEqual(openapi.paths, {});
  });

  it("reads a message application that has an injector of its own", async () => {
    const { web } = await create_both(feature([]));
    const app = await create(orders_module());
    asyncApi(web, app, { info: INFO });
    const document = await document_at(web, "/asyncapi/asyncapi.json");
    assert.deepEqual(Object.keys(document.channels), ["orders.created"]);
    await app.close();
  });
});

describe("asyncApi, mistakes", () => {
  it("needs the web application, then the message application", async () => {
    const { web, app } = await create_both(orders_module());
    assert.throws(() => asyncApi(loose(app), loose(web), { info: INFO }), {
      code: "CHO_ASYNCAPI_INVALID_OPTION",
      message:
        /^asyncApi\(\): expected a web application, made by ChoWeb\.create, then the message application, got /,
    });
    assert.throws(() => asyncApi(web, loose(web), { info: INFO }), {
      code: "CHO_ASYNCAPI_INVALID_OPTION",
      message:
        /^asyncApi\(\): expected a message application, made by ChoMessage\.create or ChoMessage\.from, got /,
    });
    assert.throws(() => asyncApi(web, loose(undefined), { info: INFO }), {
      code: "CHO_ASYNCAPI_INVALID_OPTION",
    });
  });

  it("checks the options under its own name, and mounts nothing", async () => {
    const { web, app } = await create_both(orders_module());
    assert.throws(() => asyncApi(web, app, loose({})), {
      code: "CHO_ASYNCAPI_INVALID_OPTION",
      message:
        'asyncApi(): the "info" option is required: { title: "My application", version: "1.0.0" }',
    });
    assert.throws(
      () => asyncApi(web, app, loose({ info: INFO, assets: "/x" })),
      {
        code: "CHO_CORE_UNKNOWN_OPTION",
        message:
          'asyncApi(): unknown option "assets". Known options: externalDocs, id, info, middlewares, route, sends, servers, tags, toJsonSchema, ui',
      },
    );
    for (const ui of ["swagger", true, {}]) {
      assert.throws(() => asyncApi(web, app, loose({ info: INFO, ui })), {
        code: "CHO_ASYNCAPI_INVALID_OPTION",
        message:
          /^asyncApi\(\): the "ui" option is a function that returns the HTML of a page, or false for no page, got /,
      });
    }
    assert.deepEqual(web.routes, []);
  });

  it("mounts nothing when the document cannot be made", async () => {
    const { web, app } = await create_both(feature([
      controller("Orders", "one", { created: ["created"] }),
      controller("Orders", "two", { created: ["created"] }),
    ]));
    assert.throws(() => asyncApi(web, app, { info: INFO }), {
      code: "CHO_ASYNCAPI_DUPLICATE_OPERATION_ID",
    });
    assert.deepEqual(web.routes, []);
  });

  it("gives a route that is not valid, or a middleware that is not one, to web.mount", async () => {
    const { web, app } = await create_both(orders_module());
    assert.throws(() => asyncApi(web, app, { info: INFO, route: "/docs/" }), {
      code: "CHO_WEB_INVALID_ROUTE",
    });
    assert.throws(() => asyncApi(web, app, loose({ info: INFO, route: 7 })), {
      code: "CHO_WEB_INVALID_ROUTE",
    });
    assert.throws(
      () => asyncApi(web, app, loose({ info: INFO, middlewares: ["auth"] })),
      { code: "CHO_WEB_INVALID_MIDDLEWARE" },
    );
  });

  it("refuses a second documentation on one route, and takes one on another", async () => {
    const { web, app } = await create_both(orders_module());
    asyncApi(web, app, { info: INFO });
    assert.throws(() => asyncApi(web, app, { info: INFO }), {
      code: "CHO_WEB_DUPLICATE_ROUTE",
    });
    asyncApi(web, app, { info: INFO, route: "internal" });
    await document_at(web, "/internal/asyncapi.json");
  });
});
