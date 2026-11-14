/** Tests for `etag.ts`. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { etag } from "./etag.ts";
import { run } from "./testing.ts";

/** The tag of a response of `etag()` with a given body. */
async function tag_of(body: string, weak = false) {
  const { response } = await run(etag({ weak }), {}, () => new Response(body));
  return response.headers.get("etag")!;
}

describe("etag", () => {
  it("tags a response with a hash of its body, and keeps the body", async () => {
    const { response } = await run(
      etag(),
      {},
      () => new Response("content", { headers: { "x-kept": "1" } }),
    );
    const tag = response.headers.get("etag");
    assert.match(tag!, /^"[0-9a-f]{40}"$/);
    assert.deepEqual(
      [response.status, response.headers.get("x-kept"), await response.text()],
      [200, "1", "content"],
    );
    // the same body gives the same tag, another body another one
    assert.equal(await tag_of("content"), tag);
    assert.notEqual(await tag_of("other"), tag);
  });

  it("makes a weak tag when asked", async () => {
    assert.match(await tag_of("content", true), /^W\/"[0-9a-f]{40}"$/);
  });

  it("answers 304, without the body, to a request that has the tag", async () => {
    const tag = await tag_of("content");
    for (
      const if_none_match of [tag, `W/${tag}`, `"other", ${tag}`, "*"]
    ) {
      const { response } = await run(
        etag(),
        { headers: { "if-none-match": if_none_match } },
        () =>
          new Response("content", {
            headers: {
              "cache-control": "max-age=60",
              "content-type": "text/plain",
              vary: "Accept",
            },
          }),
      );
      assert.deepEqual([response.status, await response.text()], [304, ""]);
      assert.deepEqual(
        ["etag", "cache-control", "vary", "content-type"].map((name) =>
          response.headers.get(name)
        ),
        [tag, "max-age=60", "Accept", null],
      );
    }
  });

  it("answers in full to a request that has another tag", async () => {
    const { response } = await run(
      etag(),
      { headers: { "if-none-match": '"something-else"' } },
      () => new Response("content"),
    );
    assert.deepEqual([response.status, await response.text()], [
      200,
      "content",
    ]);
  });

  it("uses the tag the response already has, without hashing", async () => {
    const answer = () => new Response("content", { headers: { etag: '"v7"' } });
    const first = await run(etag(), {}, answer);
    assert.equal(first.response.headers.get("etag"), '"v7"');
    const second = await run(
      etag(),
      { headers: { "if-none-match": '"v7"' } },
      answer,
    );
    assert.equal(second.response.status, 304);
  });

  it("leaves other methods, other statuses and empty responses alone", async () => {
    const posted = await run(etag(), { method: "POST", body: "x" });
    assert.equal(posted.response.headers.get("etag"), null);
    const missing = await run(
      etag(),
      {},
      () => new Response("no", { status: 404 }),
    );
    assert.equal(missing.response.headers.get("etag"), null);
    const empty = await run(
      etag(),
      {},
      () => new Response(null, { status: 200 }),
    );
    assert.equal(empty.response.headers.get("etag"), null);
  });

  it("tags the response to a HEAD request too", async () => {
    const { response } = await run(
      etag(),
      { method: "HEAD" },
      () => new Response("content"),
    );
    assert.equal(response.headers.get("etag"), await tag_of("content"));
  });
});
