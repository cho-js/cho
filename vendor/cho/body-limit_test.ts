/** Tests for `body-limit.ts`. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loose } from "@chojs/core/utils/test_utils";
import { bodyLimit } from "./body-limit.ts";
import { run } from "./testing.ts";

/** A body sent as a stream: its size is not declared. */
function streamed(...chunks: string[]): RequestInit {
  return {
    method: "POST",
    body: new ReadableStream({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(new TextEncoder().encode(chunk));
        }
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit;
}

/** A body whose size is declared, as a server receives it. */
function declared(body: string): RequestInit {
  return {
    method: "POST",
    body,
    headers: { "content-length": String(body.length) },
  };
}

/** The rest of the chain: it reads the body, and answers with its length. */
const read = async (ctx: { req: Request }) =>
  new Response(String((await ctx.req.text()).length));

describe("bodyLimit", () => {
  it("lets a request without a body through", async () => {
    const { response, called } = await run(bodyLimit({ maxSize: 0 }));
    assert.deepEqual([response.status, called], [200, 1]);
  });

  it("lets a declared body within the limit through", async () => {
    const { response, called } = await run(
      bodyLimit({ maxSize: 5 }),
      declared("12345"),
      read,
    );
    assert.deepEqual([await response.text(), called], ["5", 1]);
  });

  it("refuses a declared body over the limit, without reading it", async () => {
    const { response, called, ctx } = await run(
      bodyLimit({ maxSize: 5 }),
      declared("123456"),
      read,
    );
    assert.deepEqual(
      [response.status, await response.text(), called],
      [413, "Payload Too Large", 0],
    );
    assert.equal(ctx.req.bodyUsed, false);
  });

  it("counts a streamed body, and lets it through within the limit", async () => {
    const { response } = await run(
      bodyLimit({ maxSize: 6 }),
      streamed("abc", "def"),
      read,
    );
    assert.equal(await response.text(), "6");
  });

  it("answers 413 when a streamed body passes the limit while it is read", async () => {
    const { response, called } = await run(
      bodyLimit({ maxSize: 5 }),
      streamed("abc", "def", "ghi"),
      read,
    );
    assert.deepEqual([response.status, called], [413, 1]);
  });

  it("answers 413 even when the rest of the chain turned the failure into a response", async () => {
    const { response } = await run(
      bodyLimit({ maxSize: 2 }),
      streamed("abc"),
      async (ctx) => {
        // an error handler that answers 500 to everything
        try {
          return new Response(await ctx.req.text());
        } catch {
          return new Response("oops", { status: 500 });
        }
      },
    );
    assert.equal(response.status, 413);
  });

  it("does not count a streamed body nobody reads", async () => {
    const { response } = await run(
      bodyLimit({ maxSize: 1 }),
      streamed("abc"),
    );
    assert.equal(response.status, 200);
  });

  it("passes on an error that is not about the size", async () => {
    await assert.rejects(
      run(bodyLimit({ maxSize: 100 }), streamed("abc"), () => {
        throw new Error("down");
      }),
      { message: "down" },
    );
  });

  it("answers with onExceeded, which receives the context", async () => {
    const limit = bodyLimit({
      maxSize: 1,
      onExceeded: (ctx) =>
        Response.json({ too_large: ctx.url.pathname }, { status: 413 }),
    });
    const refused = await run(limit, { path: "/upload", ...declared("abc") });
    assert.deepEqual(await refused.response.json(), { too_large: "/upload" });
    const counted = await run(limit, {
      path: "/upload",
      ...streamed("abc"),
    }, read);
    assert.deepEqual(await counted.response.json(), { too_large: "/upload" });
  });

  it("needs a whole number of bytes", () => {
    for (const maxSize of [-1, 1.5, "1", undefined]) {
      assert.throws(() => bodyLimit(loose({ maxSize })), {
        name: "TypeError",
        message: "bodyLimit(): maxSize must be a whole number of bytes",
      });
    }
    assert.throws(() => bodyLimit(loose(undefined)), { name: "TypeError" });
  });
});
