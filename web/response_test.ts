/**
 * Tests for `response.ts`: converting a returned value to a `Response`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { to_response } from "./response.ts";

describe("to_response", () => {
  it("returns a Response as is", () => {
    const response = new Response("ok", { status: 201 });
    assert.equal(to_response(response), response);
  });

  it("answers 204 with no body for undefined", async () => {
    const response = to_response(undefined);
    assert.equal(response.status, 204);
    assert.equal(await response.text(), "");
  });

  for (
    const [value, body] of [
      [{ id: 1 }, '{"id":1}'],
      [[1, 2], "[1,2]"],
      [0, "0"],
      [false, "false"],
      [null, "null"],
      [new Date(0), '"1970-01-01T00:00:00.000Z"'],
      [
        new (class Point {
          x = 1;
        })(),
        '{"x":1}',
      ],
    ] as const
  ) {
    it(`sends ${body} as JSON`, async () => {
      const response = to_response(value);
      assert.equal(response.status, 200);
      assert.match(
        response.headers.get("content-type") ?? "",
        /application\/json/,
      );
      assert.equal(await response.text(), body);
    });
  }

  it("rejects a value that cannot be serialized as JSON", () => {
    assert.throws(() => to_response({ n: 1n }), { name: "TypeError" });
  });
});

describe("to_response, bodies the platform sends as they are", () => {
  const type = (response: Response) => response.headers.get("content-type");

  it("sends a string as text", async () => {
    const response = to_response("text");
    assert.equal(response.status, 200);
    // set by to_response itself, so it is the same on every runtime
    assert.equal(type(response), "text/plain;charset=UTF-8");
    assert.equal(await response.text(), "text");
    // the empty string is a body too, not "nothing"
    const empty = to_response("");
    assert.equal(empty.status, 200);
    assert.equal(await empty.text(), "");
  });

  it("sends bytes as bytes, with no content type", async () => {
    for (
      const value of [
        new Uint8Array([1, 2, 3]),
        new Uint8Array([1, 2, 3]).buffer,
        new DataView(new Uint8Array([1, 2, 3]).buffer),
      ]
    ) {
      const response = to_response(value);
      assert.equal(type(response), null);
      assert.deepEqual(
        [...new Uint8Array(await response.arrayBuffer())],
        [1, 2, 3],
      );
    }
  });

  it("sends a Blob with its own type", async () => {
    const response = to_response(
      new Blob(["<p>hi</p>"], { type: "text/html" }),
    );
    // the platform's: Bun appends a charset to a text type
    assert.match(type(response) ?? "", /^text\/html/);
    assert.equal(await response.text(), "<p>hi</p>");
  });

  it("sends a ReadableStream as a stream", async () => {
    const stream = new Blob(["a", "b"]).stream();
    const response = to_response(stream);
    assert.equal(type(response), null);
    assert.equal(await response.text(), "ab");
  });

  it("sends FormData and URLSearchParams as forms", async () => {
    const form = new FormData();
    form.set("a", "1");
    assert.match(type(to_response(form)) ?? "", /^multipart\/form-data/);

    const params = to_response(new URLSearchParams({ a: "1" }));
    assert.match(type(params) ?? "", /^application\/x-www-form-urlencoded/);
    assert.equal(await params.text(), "a=1");
  });
});
