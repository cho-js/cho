/**
 * Tests for `mount.ts`: `devRoutes` mounts the page of an application, and
 * its model, on the application itself.
 *
 * Decorators are applied as plain function calls.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isChoError } from "@chojs/core";
import type { ChoWebMiddlewareFn } from "@chojs/web";
import { loose } from "@chojs/core/utils/test_utils";
import { inspect } from "./inspect.ts";
import { devRoutes } from "./mount.ts";
import { send, shop, web_app } from "./testing.ts";

describe("devRoutes", () => {
  it("mounts the page and the model, under __cho", async () => {
    const app = await web_app(shop().App);
    const before = inspect(app);
    devRoutes(app);

    const page = await send(app, "/__cho");
    assert.equal(page.status, 200);
    assert.equal(
      page.headers.get("content-type"),
      "text/html; charset=utf-8",
    );
    const html = await page.text();
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<title>App<\/title>/);

    const model = await send(app, "/__cho/graph.json");
    assert.equal(model.status, 200);
    assert.equal(model.headers.get("content-type"), "application/json");
    // The model was read before the two routes were added.
    assert.deepEqual(await model.json(), before);
    assert.deepEqual(
      app.routes.slice(-2).map((route) => [route.path, route.name]),
      [["/__cho", "dev graph page"], ["/__cho/graph.json", "dev graph model"]],
    );
    await app.close();
  });

  it("is not under the global prefix, and shows the prefix in the model", async () => {
    const app = await web_app(shop().App, "api");
    devRoutes(app);
    assert.equal((await send(app, "/__cho")).status, 200);
    assert.equal((await send(app, "/api/__cho")).status, 404);
    const model = await (await send(app, "/__cho/graph.json")).json();
    const paths = model.nodes.flatMap((node: { path?: string }) =>
      node.path ?? []
    );
    assert.ok(paths.includes("/api/v1/users"));
    await app.close();
  });

  it("shows the routes that were mounted before it", async () => {
    const app = await web_app(shop().App);
    app.mount("GET", "health", () => "ok");
    devRoutes(app);
    const model = await (await send(app, "/__cho/graph.json")).json();
    const mounted = model.nodes.filter((node: { mounted?: boolean }) =>
      node.mounted
    );
    assert.deepEqual(
      mounted.map((node: { name: string }) => node.name),
      ["GET /health"],
    );
    await app.close();
  });

  it("takes a route, a title and where the libraries are", async () => {
    const app = await web_app(shop().App);
    devRoutes(app, {
      route: " internal/graph ",
      title: "Shop",
      assets: "/static",
    });
    const html = await (await send(app, "/internal/graph")).text();
    assert.match(html, /<title>Shop<\/title>/);
    assert.ok(html.includes('<script src="/static/cytoscape.min.js">'));
    assert.equal((await send(app, "/internal/graph/graph.json")).status, 200);
    assert.equal((await send(app, "/__cho")).status, 404);
    await app.close();
  });

  it("runs the middlewares that are given, for the two routes", async () => {
    const app = await web_app(shop().App);
    const guard: ChoWebMiddlewareFn = (ctx, next) =>
      ctx.req.headers.get("x-key") === "open"
        ? next()
        : new Response("no", { status: 401 });
    devRoutes(app, { middlewares: [guard] });
    assert.equal((await send(app, "/__cho")).status, 401);
    assert.equal((await send(app, "/__cho/graph.json")).status, 401);
    const allowed = await app.handler(
      new Request("http://localhost/__cho", { headers: { "x-key": "open" } }),
    );
    assert.equal(allowed.status, 200);
    await app.close();
  });

  it("refuses an option it does not know, before anything is mounted", async () => {
    const app = await web_app(shop().App);
    const routes = app.routes.length;
    assert.throws(
      () => devRoutes(app, loose({ path: "graph" })),
      (error) =>
        isChoError(error, "CHO_CORE_UNKNOWN_OPTION") &&
        /^devRoutes\(\): unknown option "path". Known options: assets, middlewares, route, title$/
          .test(error.message),
    );
    assert.throws(
      () => devRoutes(app, loose({ title: 1 })),
      (error) => isChoError(error, "CHO_DEV_INVALID_OPTION"),
    );
    assert.equal(app.routes.length, routes);
    await app.close();
  });

  it("leaves the error of a route to the application", async () => {
    const app = await web_app(shop().App);
    assert.throws(
      () => devRoutes(app, { route: "/graph" }),
      (error) => isChoError(error, "CHO_WEB_INVALID_ROUTE"),
    );
    assert.throws(
      () => devRoutes(app, { route: "v1/users" }),
      (error) => isChoError(error) && /v1\/users/.test(error.message),
    );
    await app.close();
  });

  it("refuses what is not an application", () => {
    assert.throws(
      () => devRoutes(loose({ mount() {} })),
      (error) =>
        isChoError(error, "CHO_DEV_INVALID_TARGET") &&
        error.message.startsWith("devRoutes():"),
    );
  });
});
