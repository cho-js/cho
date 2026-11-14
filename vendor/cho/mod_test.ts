/**
 * Tests for `mod.ts`: the package exports every middleware, and they work
 * together on the built-in router. Each middleware is tested in its own
 * file.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Args,
  Body,
  ChoLinker,
  ChoWeb,
  type ChoWebContext,
  Controller,
  Get,
  Middlewares,
  Module,
  Post,
} from "@chojs/web";
import { legacy, loose } from "@chojs/core/utils/test_utils";
import * as vendor from "./mod.ts";

/** Whether this runtime has the URL Pattern API, which the built-in router needs. */
const routed = typeof URLPattern === "function" ? describe : describe.skip;

describe("@chojs/vendor-cho", () => {
  it("exports the middlewares, and nothing else", () => {
    assert.deepEqual(Object.keys(vendor).sort(), [
      "REQUEST_ID",
      "basicAuth",
      "bearerAuth",
      "bodyLimit",
      "compress",
      "cors",
      "etag",
      "logger",
      "requestId",
      "secureHeaders",
      "timeout",
    ]);
  });
});

routed("the middlewares, together on the built-in router", () => {
  const lines: string[] = [];

  /** `GET users` and `POST users`, behind a token for the second. */
  async function create() {
    class Users {
      list(ctx: ChoWebContext) {
        return { id: ctx.state.get(vendor.REQUEST_ID), users: ["ada"] };
      }
      create(user: unknown) {
        return Response.json(user, { status: 201 });
      }
    }
    legacy(Get(""), Users, "list");
    legacy(Post(""), Users, "create");
    legacy(loose(Args(Body())), Users, "create");
    legacy(Middlewares(vendor.bearerAuth({ token: "t0ken" })), Users, "create");
    Controller({ route: "users" })(Users);
    class App {}
    Module({ controllers: [Users] })(App);
    return await ChoWeb.create(App, {
      linker: new ChoLinker({
        middlewares: [
          vendor.logger({ log: (line) => lines.push(line) }),
          vendor.requestId(),
          vendor.cors({ origin: "https://example.com" }),
          vendor.secureHeaders(),
          vendor.bodyLimit({ maxSize: 20 }),
          vendor.timeout({ ms: 1000 }),
        ],
      }),
    });
  }

  const send = (app: ChoWeb<unknown>, path: string, init: RequestInit = {}) =>
    app.handler(new Request(`http://localhost${path}`, init));

  it("answers a request through all of them", async () => {
    const app = await create();
    const response = await send(app, "/users", {
      headers: { origin: "https://example.com", "x-request-id": "abc-1" },
    });
    // the router's request id reached the handler, through the state
    assert.deepEqual(await response.json(), { id: "abc-1", users: ["ada"] });
    assert.deepEqual(
      [
        "x-request-id",
        "access-control-allow-origin",
        "x-content-type-options",
      ].map((name) => response.headers.get(name)),
      ["abc-1", "https://example.com", "nosniff"],
    );
    assert.match(lines.at(-1)!, /^GET \/users 200 \d+ms$/);
  });

  it("refuses what each of them refuses", async () => {
    const app = await create();
    const post = (init: RequestInit) =>
      send(app, "/users", { method: "POST", ...init });

    const no_token = await post({ body: "{}" });
    assert.equal(no_token.status, 401);
    const too_large = await post({
      body: JSON.stringify({ name: "a name that is too long" }),
      headers: { authorization: "Bearer t0ken" },
    });
    assert.equal(too_large.status, 413);
    const created = await post({
      body: '{"name":"Ada"}',
      headers: { authorization: "Bearer t0ken" },
    });
    assert.deepEqual([created.status, await created.json()], [201, {
      name: "Ada",
    }]);
    // a preflight request of a path with no OPTIONS route
    const preflight = await send(app, "/users", {
      method: "OPTIONS",
      headers: {
        origin: "https://example.com",
        "access-control-request-method": "POST",
      },
    });
    assert.equal(preflight.status, 204);
    assert.deepEqual(lines.slice(-4).map((line) => line.split(" ")[2]), [
      "401",
      "413",
      "201",
      "204",
    ]);
  });
});
