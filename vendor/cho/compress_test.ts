/** Tests for `compress.ts`. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loose } from "@chojs/core/utils/test_utils";
import { compress } from "./compress.ts";
import { run } from "./testing.ts";

/** A body large enough to be compressed, and that compresses well. */
const BODY = JSON.stringify({ items: Array(200).fill("the same text") });

/** A JSON response with the test body. */
const json = (headers: Record<string, string> = {}) => () =>
  new Response(BODY, {
    headers: { "content-type": "application/json", ...headers },
  });

/** A request that accepts some encodings. */
const accepting = (encodings: string): RequestInit => ({
  headers: { "accept-encoding": encodings },
});

/** Read a compressed response back. */
async function decompress(response: Response) {
  const encoding = response.headers.get("content-encoding") as
    | "gzip"
    | "deflate";
  const stream = response.body!.pipeThrough(new DecompressionStream(encoding));
  return await new Response(stream).text();
}

/** The standard streams exist on Deno, Node.js and Bun. */
const suite = typeof CompressionStream === "function"
  ? describe
  : describe.skip;

suite("compress", () => {
  it("compresses a text response for a client that accepts gzip", async () => {
    const { response } = await run(
      compress(),
      accepting("gzip, deflate, br"),
      json({ "content-length": String(BODY.length), "x-kept": "1" }),
    );
    assert.deepEqual(
      [
        response.status,
        response.headers.get("content-encoding"),
        response.headers.get("content-length"),
        response.headers.get("vary"),
        response.headers.get("x-kept"),
      ],
      [200, "gzip", null, "Accept-Encoding", "1"],
    );
    const bytes = new Uint8Array(await response.clone().arrayBuffer());
    assert.ok(bytes.byteLength < BODY.length / 2);
    assert.equal(await decompress(response), BODY);
  });

  it("uses deflate when gzip is not accepted", async () => {
    for (
      const accept of ["deflate", "gzip;q=0, deflate", "br, deflate;q=0.5"]
    ) {
      const { response } = await run(compress(), accepting(accept), json());
      assert.equal(response.headers.get("content-encoding"), "deflate", accept);
      assert.equal(await decompress(response), BODY);
    }
  });

  it("accepts * as any encoding", async () => {
    const { response } = await run(compress(), accepting("*"), json());
    assert.equal(response.headers.get("content-encoding"), "gzip");
  });

  it("leaves the response alone when it should not be compressed", async () => {
    const untouched: [string, RequestInit, () => Response][] = [
      ["no Accept-Encoding", {}, json()],
      ["an encoding it does not have", accepting("br, zstd"), json()],
      ["everything refused", accepting("identity, *;q=0"), json()],
      [
        "not a text type",
        accepting("gzip"),
        () => new Response(BODY, { headers: { "content-type": "image/png" } }),
      ],
      [
        "no content type",
        accepting("gzip"),
        () => new Response(new TextEncoder().encode(BODY)),
      ],
      [
        "already encoded",
        accepting("gzip"),
        json({ "content-encoding": "br" }),
      ],
      [
        "no-transform",
        accepting("gzip"),
        json({
          "cache-control": "public, no-transform",
        }),
      ],
      ["under the threshold", accepting("gzip"), () =>
        new Response("small", {
          headers: { "content-type": "text/plain", "content-length": "5" },
        })],
      ["no body", accepting("gzip"), () => new Response(null, { status: 204 })],
      ["a HEAD request", { method: "HEAD", ...accepting("gzip") }, json()],
    ];
    for (const [name, init, answer] of untouched) {
      const { response } = await run(compress(), init, answer);
      assert.equal(
        response.headers.get("content-encoding") ?? "none",
        {
          "already encoded": "br",
        }[name] ?? "none",
        name,
      );
      assert.equal(response.headers.get("vary"), null, name);
    }
  });

  it("compresses a small body when the threshold allows it, or its size is unknown", async () => {
    const small = () =>
      new Response("small", {
        headers: { "content-type": "text/plain", "content-length": "5" },
      });
    const low = await run(compress({ threshold: 0 }), accepting("gzip"), small);
    assert.equal(await decompress(low.response), "small");
    // a streamed body does not say its size
    const streamed = await run(
      compress(),
      accepting("gzip"),
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("small"));
              controller.close();
            },
          }),
          { headers: { "content-type": "text/plain" } },
        ),
    );
    assert.equal(await decompress(streamed.response), "small");
  });

  it("recognizes the text types", async () => {
    for (
      const [type, compressed] of [
        ["text/html; charset=utf-8", true],
        ["application/json", true],
        ["application/problem+json", true],
        ["application/javascript", true],
        ["application/xml", true],
        ["image/svg+xml", true],
        ["image/jpeg", false],
        ["application/octet-stream", false],
        ["video/mp4", false],
      ] as [string, boolean][]
    ) {
      const { response } = await run(
        compress({ threshold: 0 }),
        accepting("gzip"),
        () => new Response(BODY, { headers: { "content-type": type } }),
      );
      assert.equal(response.headers.has("content-encoding"), compressed, type);
    }
  });

  it("keeps Vary, and weakens a strong ETag", async () => {
    const { response } = await run(
      compress(),
      accepting("gzip"),
      json({ vary: "Origin", etag: '"abc"' }),
    );
    assert.equal(response.headers.get("vary"), "Origin, Accept-Encoding");
    assert.equal(response.headers.get("etag"), 'W/"abc"');
    const weak = await run(
      compress(),
      accepting("gzip"),
      json({ etag: 'W/"abc"' }),
    );
    assert.equal(weak.response.headers.get("etag"), 'W/"abc"');
  });

  it("needs a whole number of bytes as threshold", () => {
    for (const threshold of [-1, 1.5, "1"]) {
      assert.throws(() => compress(loose({ threshold })), {
        name: "TypeError",
        message: "compress(): threshold must be a whole number of bytes",
      });
    }
  });
});
