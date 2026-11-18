/**
 * Tests for `reply.ts`: what a returned value becomes, and `ChoMessageReply`,
 * a reply with headers.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ChoMessageReply, is_reply, to_reply } from "./reply.ts";

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

describe("ChoMessageReply", () => {
  it("keeps a value, and headers that cannot change", () => {
    const given = { "content-type": "application/json", cache: "60" };
    const reply = new ChoMessageReply({ id: 1 }, { headers: given });
    assert.deepEqual(reply.value, { id: 1 });
    assert.deepEqual(reply.headers, given);
    assert.equal(Object.isFrozen(reply.headers), true);
    // A copy: what the handler does to its object later changes nothing.
    assert.notEqual(reply.headers, given);
  });

  it("has no headers, and no value, by default", () => {
    assert.deepEqual(new ChoMessageReply("x").headers, {});
    assert.deepEqual(new ChoMessageReply("x", {}).headers, {});
    assert.deepEqual(
      new ChoMessageReply("x", { headers: undefined }).headers,
      {},
    );
    assert.equal(new ChoMessageReply().value, undefined);
  });

  it("is recognized without its class", () => {
    assert.equal(is_reply(new ChoMessageReply("x")), true);
    // What another copy of the package makes: the mark, on another class.
    class Other {}
    Object.defineProperty(Other.prototype, Symbol.for("cho.message.reply"), {
      value: true,
    });
    assert.equal(is_reply(new Other()), true);
    for (const value of [undefined, null, "x", {}, { value: 1, headers: {} }]) {
      assert.equal(is_reply(value), false);
    }
  });

  it("refuses options that are not an object, or not known", () => {
    for (const options of [null, "headers", 5]) {
      assert.throws(
        () => new ChoMessageReply("x", options as never),
        {
          code: "CHO_MESSAGE_INVALID_REPLY",
          message: /^new ChoMessageReply\(\): expected options, such as/,
        },
      );
    }
    assert.throws(
      () => new ChoMessageReply("x", { header: {} } as never),
      {
        code: "CHO_CORE_UNKNOWN_OPTION",
        message:
          'new ChoMessageReply(): unknown option "header". Known options: headers',
      },
    );
  });

  it("refuses headers that are not an object of strings", () => {
    const refuses = (headers: unknown, message: RegExp) =>
      assert.throws(
        () => new ChoMessageReply("x", { headers } as never),
        { code: "CHO_MESSAGE_INVALID_REPLY", message },
      );
    refuses(null, /"headers" is an object of strings, got null/);
    refuses("a: 1", /"headers" is an object of strings, got "a: 1"/);
    refuses([["a", "1"]], /"headers" is an object of strings/);
    refuses({ a: 1 }, /the header "a" is a string, got 1/);
    refuses({ a: undefined }, /the header "a" is a string, got undefined/);
    refuses({ a: ["1"] }, /the header "a" is a string/);
    refuses({ "": "1" }, /a header has no name/);
  });

  it("refuses another reply as its value", () => {
    assert.throws(
      () => new ChoMessageReply(new ChoMessageReply("x")),
      {
        code: "CHO_MESSAGE_INVALID_REPLY",
        message:
          "new ChoMessageReply(): the value of a reply cannot be another reply",
      },
    );
  });
});

describe("to_reply, for a ChoMessageReply", () => {
  it("gives its value as a returned value, with its headers", () => {
    const headers = { "content-type": "application/json" };
    const reply = to_reply(new ChoMessageReply({ id: 1 }, { headers }), NAME);
    assert.equal(new TextDecoder().decode(reply!.value), '{"id":1}');
    assert.deepEqual(reply!.headers, headers);
    assert.equal(text_of(new ChoMessageReply("hi", { headers })), "hi");
    const bytes = new Uint8Array([1, 2]);
    assert.equal(
      to_reply(new ChoMessageReply(bytes, { headers }), NAME)!.value,
      bytes,
    );
  });

  it("has no headers property when the reply has no header", () => {
    for (
      const reply of [
        to_reply(new ChoMessageReply("x"), NAME),
        to_reply(new ChoMessageReply("x", { headers: {} }), NAME),
      ]
    ) {
      assert.deepEqual(Object.keys(reply!), ["value"]);
    }
  });

  it("gives an empty reply for one with no value", () => {
    const empty = to_reply(new ChoMessageReply(), NAME);
    assert.equal(empty!.value.byteLength, 0);
    assert.deepEqual(Object.keys(empty!), ["value"]);
    const reply = to_reply(
      new ChoMessageReply(undefined, { headers: { status: "204" } }),
      NAME,
    );
    assert.equal(reply!.value.byteLength, 0);
    assert.deepEqual(reply!.headers, { status: "204" });
  });

  it("refuses a value that cannot be a reply", () => {
    assert.throws(
      () => to_reply(new ChoMessageReply(10n, { headers: { a: "1" } }), NAME),
      {
        code: "CHO_MESSAGE_INVALID_REPLY",
        message: /^Invalid reply of Orders\.price: /,
      },
    );
  });
});
