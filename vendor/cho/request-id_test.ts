/** Tests for `request-id.ts`. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { REQUEST_ID, requestId } from "./request-id.ts";
import { run } from "./testing.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe("requestId", () => {
  it("makes an id, keeps it in the state and sends it back", async () => {
    let seen: unknown;
    const { response, ctx } = await run(requestId(), {}, (c) => {
      seen = c.state.get(REQUEST_ID);
      return new Response("ok");
    });
    const id = response.headers.get("x-request-id");
    assert.match(id!, UUID);
    // set before the rest of the chain ran
    assert.equal(seen, id);
    assert.equal(ctx.state.get("requestId"), id);
  });

  it("makes a new id for each request", async () => {
    const middleware = requestId();
    const ids = await Promise.all(
      [1, 2, 3].map(async () =>
        (await run(middleware)).response.headers.get("x-request-id")
      ),
    );
    assert.equal(new Set(ids).size, 3);
  });

  it("keeps the id the request came with", async () => {
    const { response, ctx } = await run(requestId(), {
      headers: { "x-request-id": "trace-42.a/b" },
    });
    assert.equal(response.headers.get("x-request-id"), "trace-42.a/b");
    assert.equal(ctx.state.get(REQUEST_ID), "trace-42.a/b");
  });

  it("replaces an id that is not safe to log", async () => {
    for (const bad of ["has spaces", "a".repeat(256), "<script>", ""]) {
      const { response } = await run(requestId(), {
        headers: { "x-request-id": bad },
      });
      assert.match(response.headers.get("x-request-id")!, UUID);
    }
  });

  it("uses another header, and another way to make an id", async () => {
    let n = 0;
    const middleware = requestId({
      header: "x-trace",
      generate: (ctx) => `${ctx.req.method}-${++n}`,
    });
    const made = await run(middleware, { method: "POST" });
    assert.equal(made.response.headers.get("x-trace"), "POST-1");
    assert.equal(made.response.headers.get("x-request-id"), null);
    const kept = await run(middleware, { headers: { "x-trace": "given" } });
    assert.equal(kept.ctx.state.get(REQUEST_ID), "given");
  });

  it("works on a response whose headers cannot be changed", async () => {
    const { response } = await run(
      requestId(),
      { headers: { "x-request-id": "abc" } },
      () => Response.redirect("http://localhost/elsewhere"),
    );
    assert.deepEqual(
      [response.status, response.headers.get("x-request-id")],
      [302, "abc"],
    );
  });
});
