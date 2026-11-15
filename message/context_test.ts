/**
 * Tests for `context.ts`: the context of a message.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loose } from "@chojs/core/utils/test_utils";
import { create_context } from "./context.ts";

describe("create_context", () => {
  it("holds the topic, the key, the headers and the adapter's own message", () => {
    const native = { partition: 3, offset: "42" };
    const ctx = create_context(
      "orders.created",
      { value: "x", key: "42", headers: { "message-id": "abc" } },
      native,
    );
    assert.equal(ctx.topic, "orders.created");
    assert.equal(ctx.key, "42");
    assert.deepEqual(ctx.headers, { "message-id": "abc" });
    assert.equal(ctx.native, native);
  });

  it("has no key, no headers and no native message by default", () => {
    const ctx = create_context("orders.created");
    assert.equal(ctx.key, undefined);
    assert.deepEqual(ctx.headers, {});
    assert.equal(ctx.native, undefined);
    assert.equal(ctx.value.length, 0);
  });

  it("gives each message a state of its own", () => {
    const one = create_context("t");
    const two = create_context("t");
    one.state.set("user", "ada");
    assert.equal(one.state.get("user"), "ada");
    assert.equal(two.state.size, 0);
  });

  it("keeps bytes as they are", () => {
    const bytes = new Uint8Array([104, 105]);
    const ctx = create_context("t", { value: bytes });
    assert.equal(ctx.value, bytes);
    assert.equal(ctx.text(), "hi");
  });

  it("encodes a string as UTF-8", () => {
    const ctx = create_context("t", { value: "héllo ✓" });
    assert.ok(ctx.value instanceof Uint8Array);
    assert.deepEqual(ctx.value, new TextEncoder().encode("héllo ✓"));
    assert.equal(ctx.text(), "héllo ✓");
  });

  it("has an empty value for a message without one", () => {
    for (const value of [undefined, null]) {
      const ctx = create_context("t", { value });
      assert.equal(ctx.value.length, 0);
      assert.equal(ctx.text(), "");
      assert.equal(ctx.json(), undefined);
    }
  });

  it("parses the value as JSON", () => {
    const ctx = create_context("t", { value: '{"id":"42","tags":["a"]}' });
    assert.deepEqual(ctx.json(), { id: "42", tags: ["a"] });
    assert.deepEqual(ctx.json<{ id: string }>().id, "42");
    assert.equal(create_context("t", { value: "null" }).json(), null);
    assert.equal(create_context("t", { value: "7" }).json(), 7);
  });

  it("reads the value as often as it is asked", () => {
    const ctx = create_context("t", { value: '{"n":1}' });
    assert.deepEqual(ctx.json(), { n: 1 });
    assert.deepEqual(ctx.json(), { n: 1 });
    assert.equal(ctx.text(), '{"n":1}');
    assert.equal(ctx.text(), '{"n":1}');
  });

  it("throws the SyntaxError of JSON.parse for a value that is not JSON", () => {
    const ctx = create_context("t", { value: "not json" });
    assert.throws(() => ctx.json(), SyntaxError);
  });

  it("rejects a value that is neither bytes nor a string", () => {
    for (const value of [42, { id: 1 }, ["a"], true]) {
      assert.throws(
        () => create_context("t", { value: loose(value) }),
        (error: unknown) =>
          error instanceof TypeError &&
          error.message.startsWith(
            "Invalid value of a message: expected bytes (a Uint8Array) or a string, got ",
          ),
      );
    }
  });
});
