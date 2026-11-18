/** Tests for `reply.ts`: what a returned value becomes. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { to_reply } from "./reply.ts";

const NAME = "Orders.price";

/** The text of the reply of a value. */
const text_of = (value: unknown) =>
  new TextDecoder().decode(to_reply(value, NAME)?.value);

describe("to_reply", () => {
  it("gives no reply for undefined", () => {
    assert.equal(to_reply(undefined, NAME), undefined);
  });

  it("gives bytes as they are", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const reply = to_reply(bytes, NAME);
    assert.deepEqual(Object.keys(reply!), ["value"]);
    assert.equal(reply!.value, bytes);
  });

  it("gives the bytes of an ArrayBuffer, and of what shows a part of one", () => {
    const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
    assert.deepEqual([...to_reply(buffer, NAME)!.value], [1, 2, 3, 4]);
    assert.deepEqual(
      [...to_reply(new DataView(buffer, 1, 2), NAME)!.value],
      [2, 3],
    );
    assert.deepEqual(
      [...to_reply(new Uint16Array([258]), NAME)!.value].length,
      2,
    );
    assert.ok(to_reply(buffer, NAME)!.value instanceof Uint8Array);
  });

  it("gives a string as its UTF-8 bytes", () => {
    assert.deepEqual([...to_reply("hé", NAME)!.value], [104, 195, 169]);
    assert.equal(text_of("hello"), "hello");
  });

  it("gives an empty reply for an empty string, and for no bytes", () => {
    assert.equal(to_reply("", NAME)!.value.byteLength, 0);
    assert.equal(to_reply(new Uint8Array(0), NAME)!.value.byteLength, 0);
  });

  it("gives anything else as JSON", () => {
    class Order {
      constructor(readonly id: string) {}
    }
    for (
      const [value, json] of [
        [{ id: 1 }, '{"id":1}'],
        [[1, "a"], '[1,"a"]'],
        [42, "42"],
        [0, "0"],
        [true, "true"],
        [false, "false"],
        [null, "null"],
        [new Date(0), '"1970-01-01T00:00:00.000Z"'],
        [new Order("7"), '{"id":"7"}'],
        [{ toJSON: () => ({ as: "json" }) }, '{"as":"json"}'],
      ] as [unknown, string][]
    ) {
      assert.equal(text_of(value), json);
    }
  });

  it("refuses what JSON has no text for", () => {
    for (const value of [() => {}, Symbol("s"), class Order {}]) {
      assert.throws(() => to_reply(value, NAME), {
        code: "CHO_MESSAGE_INVALID_REPLY",
        message:
          /^Invalid reply of Orders\.price: expected bytes, a string or a value JSON can hold, got /,
      });
    }
  });

  it("refuses what JSON.stringify throws for, with its error as the cause", () => {
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    for (const value of [10n, { n: 10n }, cycle]) {
      assert.throws(
        () => to_reply(value, NAME),
        (error: { code?: string; message: string; cause?: unknown }) => {
          assert.equal(error.code, "CHO_MESSAGE_INVALID_REPLY");
          assert.match(
            error.message,
            /^Invalid reply of Orders\.price: .* cannot be serialized as JSON$/,
          );
          assert.ok(error.cause instanceof TypeError);
          return true;
        },
      );
    }
  });
});
