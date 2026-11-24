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
  ChoWeb,
  type ChoWebContext,
  type ChoWebSocket,
  Controller,
  Get,
  Middlewares,
  Module,
  Post,
  Sse,
  Ws,
  WsMessage,
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
      middlewares: [
        vendor.logger({ log: (line) => lines.push(line) }),
        vendor.requestId(),
        vendor.cors({ origin: "https://example.com" }),
        vendor.secureHeaders(),
        vendor.bodyLimit({ maxSize: 20 }),
        vendor.timeout({ ms: 1000 }),
      ],
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

  it("lets a route upgrade to a WebSocket through every one of them", async () => {
    const seen: unknown[] = [];
    class Chat {
      join(ctx: ChoWebContext) {
        return { id: ctx.state.get(vendor.REQUEST_ID) };
      }
      message(data: string, socket: ChoWebSocket) {
        seen.push([data, socket.ctx.state.get(vendor.REQUEST_ID)]);
        return `echo ${data}`;
      }
    }
    legacy(Ws("live"), Chat, "join");
    legacy(loose(WsMessage()), Chat, "message");
    legacy(
      Middlewares(
        vendor.basicAuth({ username: "ada", password: "s3cret" }),
        vendor.etag(),
      ),
      Chat,
      "join",
    );
    Controller({ route: "chat" })(Chat);
    class App {}
    Module({ controllers: [Chat] })(App);
    const app = await ChoWeb.create(App, {
      middlewares: [
        vendor.logger({ log: (line) => lines.push(line) }),
        vendor.requestId(),
        vendor.cors({ origin: "https://example.com" }),
        vendor.secureHeaders(),
        vendor.compress({ threshold: 0 }),
        vendor.etag(),
        vendor.bodyLimit({ maxSize: 20 }),
        vendor.timeout({ ms: 1000 }),
      ],
    });
    const asking = (headers: Record<string, string> = {}) =>
      new Request("http://localhost/chat/live", {
        headers: {
          upgrade: "websocket",
          origin: "https://example.com",
          "accept-encoding": "gzip",
          "x-request-id": "abc-7",
          ...headers,
        },
      });

    // refused before the upgrade, as any request
    const refused = await app.upgrade(asking());
    assert.ok(refused instanceof Response);
    assert.equal(refused.status, 401);

    const upgrade = await app.upgrade(
      asking({ authorization: `Basic ${btoa("ada:s3cret")}` }),
    );
    assert.ok(!(upgrade instanceof Response));
    // the headers of the middlewares go with the 101, without those that
    // describe a body: it has none
    assert.deepEqual(
      [
        "x-request-id",
        "access-control-allow-origin",
        "x-content-type-options",
        "content-encoding",
        "content-type",
        "content-length",
        "etag",
      ].map((name) => upgrade.headers.get(name)),
      ["abc-7", "https://example.com", "nosniff", null, null, null, null],
    );
    const sent: unknown[] = [];
    const events = upgrade.accept({
      send: (data) => void sent.push(data),
      close() {},
      native: undefined,
    });
    events.message("hi");
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(sent, ['{"id":"abc-7"}', "echo hi"]);
    assert.deepEqual(seen, [["hi", "abc-7"]]);
    await app.close();
  });

  it("passes a stream of server-sent events through every one of them", async () => {
    const ended = Promise.withResolvers<void>();
    class Feed {
      async *events() {
        try {
          while (true) { // never ends: nothing may wait for its end
            yield { event: "tick", data: "now" };
          }
        } finally {
          ended.resolve();
        }
      }
    }
    legacy(loose(Sse("events")), Feed, "events");
    legacy(
      Middlewares(
        vendor.basicAuth({ username: "ada", password: "s3cret" }),
        vendor.etag(),
      ),
      Feed,
      "events",
    );
    Controller({ route: "feed" })(Feed);
    class App {}
    Module({ controllers: [Feed] })(App);
    const app = await ChoWeb.create(App, {
      middlewares: [
        vendor.logger({ log: (line) => lines.push(line) }),
        vendor.requestId(),
        vendor.cors({ origin: "https://example.com" }),
        vendor.secureHeaders(),
        vendor.compress({ threshold: 0 }),
        vendor.etag(),
        vendor.bodyLimit({ maxSize: 20 }),
        vendor.timeout({ ms: 1000 }),
      ],
    });

    const response = await send(app, "/feed/events", {
      headers: {
        origin: "https://example.com",
        authorization: `Basic ${btoa("ada:s3cret")}`,
        "accept-encoding": "gzip",
        "if-none-match": "*",
      },
    });
    assert.deepEqual(
      [
        response.status,
        response.headers.get("content-type"),
        response.headers.get("content-encoding"),
        response.headers.get("etag"),
        response.headers.get("access-control-allow-origin"),
        response.headers.get("x-content-type-options"),
      ],
      [200, "text/event-stream", null, null, "https://example.com", "nosniff"],
    );
    const reader = response.body!.getReader();
    assert.equal(
      new TextDecoder().decode((await reader.read()).value),
      "event: tick\ndata: now\n\n",
    );
    // the stream is logged when it opens, not when it ends
    assert.match(lines.at(-1)!, /^GET \/feed\/events 200 \d+ms$/);
    await reader.cancel();
    await ended.promise;
  });
});
