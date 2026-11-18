/**
 * Tests for `mount.ts`: `openApi` mounts the document of an application and
 * the page that shows it, on the application itself, on every adapter.
 *
 * Decorators are applied as plain function calls.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ChoWeb,
  type ChoWebMiddlewareFn,
  Controller,
  Doc,
  Get,
  Middlewares,
  Module,
  Query,
} from "@chojs/web";
import { engine } from "@chojs/core/utils";
import { legacy, loose } from "@chojs/core/utils/test_utils";
import { HonoLinker } from "../../vendor/hono/mod.ts";
import { openApi } from "./mount.ts";
import { UI_VERSIONS } from "./page.ts";
import { args, type Class, create, send, standard } from "./testing.ts";
import type { OpenApiDocument } from "./types.ts";

const INFO = { title: "Shop", version: "1.0.0" };

/** An application with one controller, `Users`, and one handler, `GET users`. */
function users_app(): Class {
  class Users {
    list() {
      return [];
    }
  }
  legacy(Get(""), Users, "list");
  legacy(args(Query("page", standard({ type: "integer" }))), Users, "list");
  Controller({ route: "users" })(Users);
  class App {}
  Module({ controllers: [Users] })(App);
  return App;
}

/** The document an application serves at a path. */
async function document_at(
  app: ChoWeb<unknown>,
  path: string,
): Promise<OpenApiDocument> {
  const response = await send(app, path);
  assert.equal(response.status, 200, path);
  assert.match(
    response.headers.get("content-type") ?? "",
    /^application\/json/,
  );
  return await response.json();
}

describe("openApi", () => {
  it("mounts the page and the document, under docs", async () => {
    const app = await create(users_app());
    openApi(app, { info: INFO });

    assert.deepEqual(
      app.routes.map((r) => [r.method, r.path, r.name]),
      [
        ["GET", "/users", "Users.list"],
        ["GET", "/docs", "openApi page"],
        ["GET", "/docs/openapi.json", "openApi document"],
      ],
    );
    const page = await send(app, "/docs");
    assert.equal(page.status, 200);
    assert.equal(
      page.headers.get("content-type"),
      "text/html; charset=utf-8",
    );
    const html = await page.text();
    assert.match(html, /<title>Shop<\/title>/);
    assert.ok(
      html.includes(`swagger-ui-dist@${UI_VERSIONS.swagger}/swagger-ui.css`),
    );
    // the page asks for the document of the application
    assert.ok(html.includes('url: "/docs/openapi.json"'));

    const document = await document_at(app, "/docs/openapi.json");
    assert.equal(document.openapi, "3.1.1");
    assert.deepEqual(document.info, INFO);
    // the application's routes, and not the two of the documentation
    assert.deepEqual(Object.keys(document.paths), ["/users"]);
    assert.deepEqual(document.paths["/users"]!.get!.parameters, [
      { name: "page", in: "query", schema: { type: "integer" } },
    ]);
  });

  it("gives the options of the document to the document", async () => {
    const app = await create(users_app());
    openApi(app, {
      info: INFO,
      servers: [{ url: "https://api.example.com" }],
      securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
      security: [{ bearer: [] }],
      tags: { Users: "The users" },
    });
    const document = await document_at(app, "/docs/openapi.json");
    assert.deepEqual(document.servers, [{ url: "https://api.example.com" }]);
    assert.deepEqual(document.security, [{ bearer: [] }]);
    assert.deepEqual(document.tags, [
      { name: "Users", description: "The users" },
    ]);
  });

  it("does not put the two routes under the global prefix", async () => {
    const app = await create(users_app(), "api");
    openApi(app, { info: INFO });
    assert.deepEqual(app.routes.map((r) => r.path), [
      "/api/users",
      "/docs",
      "/docs/openapi.json",
    ]);
    const document = await document_at(app, "/docs/openapi.json");
    assert.deepEqual(Object.keys(document.paths), ["/api/users"]);
    assert.equal((await send(app, "/api/docs")).status, 404);
  });

  it("mounts them where the route says", async () => {
    const app = await create(users_app());
    openApi(app, { info: INFO, route: " internal/api-docs " });
    const html = await (await send(app, "/internal/api-docs")).text();
    assert.ok(html.includes('url: "/internal/api-docs/openapi.json"'));
    await document_at(app, "/internal/api-docs/openapi.json");

    // at the root of the application
    const root = await create(users_app());
    openApi(root, { info: INFO, route: "" });
    assert.deepEqual(root.routes.slice(1).map((r) => r.path), [
      "/",
      "/openapi.json",
    ]);
    assert.ok(
      (await (await send(root, "/")).text()).includes('url: "/openapi.json"'),
    );
    await document_at(root, "/openapi.json");
  });

  it("shows the client the ui option names", async () => {
    for (
      const [ui, mark] of [
        ["scalar", `@scalar/api-reference@${UI_VERSIONS.scalar}`],
        ["redoc", `redoc@${UI_VERSIONS.redoc}`],
        ["swagger", `swagger-ui-dist@${UI_VERSIONS.swagger}`],
      ] as const
    ) {
      const app = await create(users_app());
      openApi(app, { info: INFO, ui });
      const html = await (await send(app, "/docs")).text();
      assert.ok(html.includes(mark), ui);
      assert.ok(html.includes("/docs/openapi.json"), ui);
    }
  });

  it("shows a client of the application's own", async () => {
    const app = await create(users_app());
    openApi(app, {
      info: INFO,
      ui: ({ url, title }) => `<my-client spec="${url}">${title}</my-client>`,
    });
    assert.equal(
      await (await send(app, "/docs")).text(),
      '<my-client spec="/docs/openapi.json">Shop</my-client>',
    );
  });

  it("mounts the document only, with no ui", async () => {
    const app = await create(users_app());
    openApi(app, { info: INFO, ui: false });
    assert.deepEqual(app.routes.slice(1).map((r) => r.path), [
      "/docs/openapi.json",
    ]);
    assert.equal((await send(app, "/docs")).status, 404);
    await document_at(app, "/docs/openapi.json");
  });

  it("loads the files of the client from the assets option", async () => {
    const app = await create(users_app());
    openApi(app, { info: INFO, assets: "/static/swagger" });
    const html = await (await send(app, "/docs")).text();
    assert.ok(html.includes('src="/static/swagger/swagger-ui-bundle.js"'));
  });

  it("makes the document once, when it is called", async () => {
    const calls: string[] = [];
    class Users {
      list() {}
    }
    legacy(Get("users"), Users, "list");
    legacy(
      args(Query("page", standard({ type: "integer" }, {}, calls))),
      Users,
      "list",
    );
    Controller({})(Users);
    class App {}
    Module({ controllers: [Users] })(App);
    const app = await create(App);

    openApi(app, { info: INFO });
    assert.equal(calls.length, 1); // made, before any request

    const first = await (await send(app, "/docs/openapi.json")).text();
    const second = await (await send(app, "/docs/openapi.json")).text();
    await send(app, "/docs");
    assert.equal(first, second);
    assert.equal(JSON.parse(first).openapi, "3.1.1");
    assert.equal(calls.length, 1);
  });

  it("runs its middlewares for the two routes, and none of the application's", async () => {
    const seen: string[] = [];
    const record = (name: string): ChoWebMiddlewareFn => (ctx, next) => {
      seen.push(`${name} ${ctx.url.pathname}`);
      return next();
    };
    class Users {
      list() {}
    }
    legacy(Get("users"), Users, "list");
    Middlewares(record("controller"))(Users);
    Controller({})(Users);
    class App {}
    Module({ controllers: [Users] })(App);
    const app = await create(App);
    openApi(app, {
      info: INFO,
      middlewares: [
        record("docs"),
        (ctx, next) =>
          ctx.req.headers.get("authorization") === "Bearer admin"
            ? next()
            : new Response("no", { status: 401 }),
      ],
    });

    assert.equal((await send(app, "/docs")).status, 401);
    assert.equal((await send(app, "/docs/openapi.json")).status, 401);
    const headers = { authorization: "Bearer admin" };
    assert.equal((await send(app, "/docs", { headers })).status, 200);
    assert.equal(
      (await send(app, "/docs/openapi.json", { headers })).status,
      200,
    );
    assert.deepEqual(seen, [
      "docs /docs",
      "docs /docs/openapi.json",
      "docs /docs",
      "docs /docs/openapi.json",
    ]);
  });

  it("throws a second time on one route, and mounts a second documentation on another", async () => {
    const app = await create(users_app());
    openApi(app, { info: INFO });
    assert.throws(() => openApi(app, { info: INFO }), {
      message:
        'Duplicate route "GET /docs": mounted as openApi page and mounted as openApi page',
    });
    assert.equal(app.routes.length, 3);

    openApi(app, { info: { ...INFO, title: "Internal" }, route: "internal" });
    const internal = await document_at(app, "/internal/openapi.json");
    assert.equal(internal.info.title, "Internal");
    assert.equal(
      (await document_at(app, "/docs/openapi.json")).info.title,
      "Shop",
    );
  });

  it("checks its options when it is called, before it mounts anything", async () => {
    const app = await create(users_app());
    const call = (options: unknown) => () => openApi(app, loose(options));

    assert.throws(call({}), {
      message:
        'openApi(): the "info" option is required: { title: "My API", version: "1.0.0" }',
    });
    assert.throws(call({ info: INFO, path: "docs" }), {
      message:
        'openApi(): unknown option "path". Known options: assets, externalDocs, info, middlewares, route, security, securitySchemes, servers, tags, toJsonSchema, ui',
    });
    assert.throws(call({ info: INFO, ui: "rapidoc" }), {
      message:
        'openApi(): unknown ui "rapidoc". Known: redoc, scalar, swagger, false, or a function that returns the HTML',
    });
    assert.throws(call({ info: INFO, route: "/docs" }), {
      message:
        'Invalid route "/docs" of ChoWeb.mount(): it must not start or end with "/"',
    });
    assert.throws(call({ info: INFO, route: 7 }), {
      name: "TypeError",
      message: "Invalid route of ChoWeb.mount(): expected a string, got 7",
    });
    assert.throws(call({ info: INFO, middlewares: ["auth"] }), {
      name: "TypeError",
      message:
        /^ChoWeb\.mount\(\): middleware 1 of GET \/docs must be a function/,
    });
    assert.throws(call({ info: INFO, route: "users" }), {
      message:
        'Duplicate route "GET /users": declared by Users.list and mounted as openApi page',
    });
    assert.equal(app.routes.length, 1);
  });

  it("throws for a document that cannot be made, and mounts nothing", async () => {
    class Users {
      a() {}
      b() {}
    }
    legacy(Get("a"), Users, "a");
    legacy(Doc({ operationId: "users" }), Users, "a");
    legacy(Get("b"), Users, "b");
    legacy(Doc({ operationId: "users" }), Users, "b");
    Controller({})(Users);
    class App {}
    Module({ controllers: [Users] })(App);
    const app = await create(App);

    assert.throws(() => openApi(app, { info: INFO }), {
      message:
        'openApiDocument(): the operationId "users" is used by Users.a and Users.b',
    });
    // a scheme the document has not
    const fine = await create(users_app());
    assert.throws(
      () => openApi(fine, { info: INFO, security: [{ bearer: [] }] }),
      {
        message:
          'openApiDocument(): the "security" option requires the security scheme "bearer", which is not in the "securitySchemes" option',
      },
    );
    assert.equal(app.routes.length, 2);
    assert.equal(fine.routes.length, 1);
    assert.equal((await send(fine, "/docs")).status, 404);
  });
});

describe("openApi, on the adapters", () => {
  it("serves the documentation on the built-in router", async () => {
    const app = await ChoWeb.create(users_app(), { prefix: "api" });
    openApi(app, { info: INFO });
    assert.equal((await send(app, "/docs")).status, 200);
    const document = await document_at(app, "/docs/openapi.json");
    assert.deepEqual(Object.keys(document.paths), ["/api/users"]);
    // a HEAD request, as a client may send to find the document
    const head = await send(app, "/docs/openapi.json", { method: "HEAD" });
    assert.deepEqual([head.status, head.body], [200, null]);
  });

  it("serves the documentation on Hono", async () => {
    const app = await ChoWeb.create(users_app(), {
      linker: new HonoLinker(),
      prefix: "api",
    });
    openApi(app, { info: INFO, ui: "scalar" });
    const html = await (await send(app, "/docs")).text();
    assert.ok(html.includes('{ url: "/docs/openapi.json" }'));
    const document = await document_at(app, "/docs/openapi.json");
    assert.deepEqual(Object.keys(document.paths), ["/api/users"]);
  });

  it("serves the documentation on Fastify, over HTTP", {
    skip: engine() !== "node" && "Fastify runs on Node.js only",
  }, async () => {
    const { FastifyLinker } = await import("../../vendor/fastify/mod.ts");
    const app = await ChoWeb.create(users_app(), {
      linker: new FastifyLinker(),
      prefix: "api",
    });
    openApi(app, { info: INFO, ui: "redoc" });
    const address = await app.linked.instance.listen({
      port: 0,
      host: "127.0.0.1",
    });
    try {
      const page = await fetch(`${address}/docs`);
      assert.equal(page.status, 200);
      assert.equal(
        page.headers.get("content-type"),
        "text/html; charset=utf-8",
      );
      assert.ok(
        (await page.text()).includes(
          '<redoc spec-url="/docs/openapi.json"></redoc>',
        ),
      );
      const document = await (await fetch(`${address}/docs/openapi.json`))
        .json();
      assert.deepEqual(Object.keys(document.paths), ["/api/users"]);
    } finally {
      await app.linked.instance.close();
    }
  });
});
