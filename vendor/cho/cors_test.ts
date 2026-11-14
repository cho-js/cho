/**
 * Tests for `cors.ts`.
 *
 * `cors` is tested as a plain function `(ctx, next)`, then on the routes of
 * an application and on the built-in router. Decorators are applied as plain
 * function calls, so the tests run on every runtime.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ChoLinker,
  ChoWeb,
  type ChoWebContext,
  Controller,
  Get,
  Middlewares,
  Module,
  Options,
  Post,
} from "@chojs/web";
import { legacy, loose } from "@chojs/core/utils/test_utils";
import { cors, type CorsOptions } from "./cors.ts";

/** Whether this runtime has the URL Pattern API, which the built-in router needs. */
const routed = typeof URLPattern === "function" ? describe : describe.skip;

const ORIGIN = "https://example.com";

/** Run a CORS middleware on a request; `next` answers `200 ok`. */
async function run(
  options: CorsOptions | undefined,
  init: RequestInit & { path?: string } = {},
  answer: () => Response = () => new Response("ok"),
) {
  let called = 0;
  const req = new Request(`http://localhost${init.path ?? "/"}`, init);
  const ctx = loose({ req, params: {}, state: new Map(), native: undefined });
  const response = await cors(options)(ctx, () => {
    called++;
    return Promise.resolve(answer());
  });
  assert.ok(response instanceof Response);
  return { response, headers: response.headers, called };
}

/** A preflight request from an origin, for a method and some headers. */
function preflight(origin = ORIGIN, method = "PUT", headers?: string) {
  return {
    method: "OPTIONS",
    headers: {
      origin,
      "access-control-request-method": method,
      ...(headers ? { "access-control-request-headers": headers } : {}),
    },
  };
}

describe("cors, a request", () => {
  it("allows any origin by default, with *", async () => {
    const { headers, called, response } = await run(undefined, {
      headers: { origin: ORIGIN },
    });
    assert.equal(headers.get("access-control-allow-origin"), "*");
    // the same answer for every origin: nothing varies
    assert.equal(headers.get("vary"), null);
    assert.equal(headers.get("access-control-allow-credentials"), null);
    assert.deepEqual([called, await response.text()], [1, "ok"]);
  });

  it("leaves a request without an Origin as it is", async () => {
    const { headers, called } = await run(undefined);
    assert.equal(headers.get("access-control-allow-origin"), null);
    assert.equal(called, 1);
  });

  for (
    const [name, origin] of [
      ["a string", ORIGIN],
      ["a list", ["https://other.com", ORIGIN]],
      ["a function", (o: string) => o.endsWith("example.com")],
      [
        "an asynchronous function",
        (o: string) => Promise.resolve(o === ORIGIN),
      ],
    ] as [string, NonNullable<CorsOptions["origin"]>][]
  ) {
    it(`allows the origins of ${name}, and no other`, async () => {
      const allowed = await run({ origin }, { headers: { origin: ORIGIN } });
      assert.equal(
        allowed.headers.get("access-control-allow-origin"),
        ORIGIN,
      );
      assert.equal(allowed.headers.get("vary"), "Origin");

      const refused = await run({ origin }, {
        headers: { origin: "https://evil.test" },
      });
      assert.equal(refused.headers.get("access-control-allow-origin"), null);
      // the answer depends on the origin: caches must keep them apart
      assert.equal(refused.headers.get("vary"), "Origin");
      // the request still runs: the browser is what refuses the response
      assert.equal(refused.called, 1);

      // also without an Origin
      assert.equal((await run({ origin })).headers.get("vary"), "Origin");
    });
  }

  it("gives the function the origin and the context", async () => {
    const seen: unknown[] = [];
    await run({
      origin: (origin, ctx) => {
        seen.push([origin, new URL(ctx.req.url).pathname]);
        return true;
      },
    }, { path: "/users", headers: { origin: ORIGIN } });
    assert.deepEqual(seen, [[ORIGIN, "/users"]]);
  });

  it("names the origin instead of * with credentials", async () => {
    const { headers } = await run({ credentials: true }, {
      headers: { origin: ORIGIN },
    });
    assert.equal(headers.get("access-control-allow-origin"), ORIGIN);
    assert.equal(headers.get("access-control-allow-credentials"), "true");
    assert.equal(headers.get("vary"), "Origin");
  });

  it("exposes the listed response headers", async () => {
    const { headers } = await run({ exposedHeaders: ["x-total", "x-page"] }, {
      headers: { origin: ORIGIN },
    });
    assert.equal(
      headers.get("access-control-expose-headers"),
      "x-total, x-page",
    );
    // preflight headers are not sent with a real response
    assert.equal(headers.get("access-control-allow-methods"), null);
  });

  it("keeps the response, its headers and its Vary", async () => {
    const { response, headers } = await run(
      { origin: ORIGIN },
      { headers: { origin: ORIGIN } },
      () =>
        new Response("created", {
          status: 201,
          headers: [["vary", "Accept"], ["set-cookie", "a=1"], [
            "set-cookie",
            "b=2",
          ]],
        }),
    );
    assert.deepEqual([response.status, await response.text()], [
      201,
      "created",
    ]);
    assert.equal(headers.get("vary"), "Accept, Origin");
    assert.deepEqual(headers.getSetCookie(), ["a=1", "b=2"]);
  });

  it("copies a response whose headers cannot be changed", async () => {
    const { response, headers } = await run(
      undefined,
      { headers: { origin: ORIGIN } },
      () => Response.redirect("http://localhost/elsewhere", 302),
    );
    assert.equal(response.status, 302);
    assert.equal(headers.get("location"), "http://localhost/elsewhere");
    assert.equal(headers.get("access-control-allow-origin"), "*");
  });

  it("treats an OPTIONS request that is not a preflight like any request", async () => {
    const { response, called, headers } = await run(undefined, {
      method: "OPTIONS",
      headers: { origin: ORIGIN },
    });
    assert.deepEqual([response.status, called], [200, 1]);
    assert.equal(headers.get("access-control-allow-origin"), "*");
  });
});

describe("cors, a preflight request", () => {
  it("answers 204 itself, with the methods and the headers asked for", async () => {
    const { response, headers, called } = await run(
      undefined,
      preflight(ORIGIN, "PUT", "content-type, x-token"),
    );
    assert.deepEqual([response.status, called, response.body], [204, 0, null]);
    assert.equal(headers.get("access-control-allow-origin"), "*");
    assert.equal(
      headers.get("access-control-allow-methods"),
      "GET, HEAD, PUT, POST, DELETE, PATCH",
    );
    assert.equal(
      headers.get("access-control-allow-headers"),
      "content-type, x-token",
    );
    // what is allowed is what was asked
    assert.equal(headers.get("vary"), "Access-Control-Request-Headers");
    assert.equal(headers.get("access-control-max-age"), null);
  });

  it("sends the configured methods, headers and max age", async () => {
    const { headers } = await run(
      {
        origin: ORIGIN,
        methods: ["GET", "POST"],
        allowedHeaders: ["content-type"],
        credentials: true,
        maxAge: 600,
      },
      preflight(ORIGIN, "POST", "x-anything"),
    );
    assert.deepEqual(
      [
        "access-control-allow-origin",
        "access-control-allow-credentials",
        "access-control-allow-methods",
        "access-control-allow-headers",
        "access-control-max-age",
        "vary",
      ].map((name) => headers.get(name)),
      [ORIGIN, "true", "GET, POST", "content-type", "600", "Origin"],
    );
  });

  it("sends no allow header to an origin that is not allowed", async () => {
    const { response, headers, called } = await run(
      { origin: ORIGIN },
      preflight("https://evil.test"),
    );
    assert.deepEqual([response.status, called], [204, 0]);
    assert.equal(headers.get("access-control-allow-origin"), null);
    assert.equal(headers.get("access-control-allow-methods"), null);
    assert.equal(headers.get("vary"), "Origin");
  });

  it("sends no allow-headers when none is asked for or configured", async () => {
    const { headers } = await run(undefined, preflight());
    assert.equal(headers.get("access-control-allow-headers"), null);
    assert.equal(headers.get("vary"), null);
  });
});

describe("cors, options", () => {
  it("rejects an option of the wrong type, when the middleware is made", () => {
    const bad = (options: unknown) => () => cors(loose(options));
    assert.throws(bad({ origin: 1 }), {
      name: "TypeError",
      message:
        "cors(): origin must be a string, a list of strings or a function",
    });
    assert.throws(bad({ origin: ["a", 1] }), { name: "TypeError" });
    for (const name of ["methods", "allowedHeaders", "exposedHeaders"]) {
      assert.throws(bad({ [name]: "GET" }), {
        name: "TypeError",
        message: `cors(): ${name} must be a list of strings`,
      });
    }
    assert.throws(bad({ credentials: "yes" }), {
      message: "cors(): credentials must be a boolean",
    });
    for (const maxAge of [-1, 1.5, "600"]) {
      assert.throws(bad({ maxAge }), {
        message: "cors(): maxAge must be a whole number of seconds",
      });
    }
  });
});

routed("cors, in an application", () => {
  /** `GET users`, `POST users` and `OPTIONS users`; `GET other` without OPTIONS. */
  function app_module(...on_controller: ReturnType<typeof cors>[]) {
    class Users {
      list(_ctx: ChoWebContext) {
        return [1, 2];
      }
      create() {
        return new Response("created", { status: 201 });
      }
      options() {
        return new Response(null, { status: 204, headers: { allow: "GET" } });
      }
    }
    legacy(Get(""), Users, "list");
    legacy(Post(""), Users, "create");
    legacy(Options(""), Users, "options");
    Controller({ route: "users" })(Users);
    if (on_controller.length > 0) {
      Middlewares(...on_controller)(Users);
    }
    class Other {
      get() {
        return "other";
      }
    }
    legacy(Get(""), Other, "get");
    Controller({ route: "other" })(Other);
    class App {}
    Module({ controllers: [Users, Other] })(App);
    return App;
  }

  const send = (app: ChoWeb<unknown>, path: string, init: RequestInit = {}) =>
    app.handler(new Request(`http://localhost${path}`, init));

  it("covers the routes it is declared on, with @Middlewares", async () => {
    const app = await ChoWeb.create(app_module(cors({ origin: ORIGIN })));
    const list = await send(app, "/users", { headers: { origin: ORIGIN } });
    assert.deepEqual(await list.json(), [1, 2]);
    assert.equal(list.headers.get("access-control-allow-origin"), ORIGIN);
    // the preflight request reaches it through the @Options route
    const pre = await send(app, "/users", preflight(ORIGIN, "POST"));
    assert.deepEqual(
      [pre.status, pre.headers.get("access-control-allow-origin")],
      [204, ORIGIN],
    );
    assert.equal(pre.headers.get("allow"), null); // not the handler's answer
    // another controller is not covered
    const other = await send(app, "/other", { headers: { origin: ORIGIN } });
    assert.equal(other.headers.get("access-control-allow-origin"), null);
    // and a preflight request of a path without an @Options route is lost
    assert.equal((await send(app, "/other", preflight())).status, 404);
  });

  it("covers every request on the router, preflight requests of any path included", async () => {
    const app = await ChoWeb.create(app_module(), {
      linker: new ChoLinker({
        middlewares: [cors({ origin: ORIGIN, credentials: true })],
      }),
    });
    for (const path of ["/users", "/other"]) {
      const real = await send(app, path, { headers: { origin: ORIGIN } });
      assert.equal(real.status, 200);
      assert.equal(real.headers.get("access-control-allow-origin"), ORIGIN);
      assert.equal(
        real.headers.get("access-control-allow-credentials"),
        "true",
      );
      const pre = await send(app, path, preflight(ORIGIN, "GET"));
      assert.deepEqual(
        [pre.status, pre.headers.get("access-control-allow-origin")],
        [204, ORIGIN],
      );
    }
    // a path with no route at all: still a CORS answer, on the 404
    const missing = await send(app, "/nope", { headers: { origin: ORIGIN } });
    assert.deepEqual(
      [missing.status, missing.headers.get("access-control-allow-origin")],
      [404, ORIGIN],
    );
    // a POST still reaches its handler
    const created = await send(app, "/users", {
      method: "POST",
      headers: { origin: ORIGIN },
    });
    assert.deepEqual([created.status, await created.text()], [201, "created"]);
  });
});
