/**
 * Tests for `ws-protocol.ts`: the handshake, and the frames of the WebSocket
 * protocol (RFC 6455), as a server reads and writes them.
 *
 * The frames of a client are written here by hand, bit by bit, so that the
 * reader is not checked against a writer of the same author alone: the
 * examples of the RFC (section 5.7) are among them.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  accept_key,
  check_handshake,
  encode_close,
  encode_frame,
  encode_message,
  type FrameEvent,
  FrameReader,
  is_close_code,
} from "./ws-protocol.ts";

const text = new TextEncoder();

/** The mask of the examples of the RFC. */
const MASK = [0x37, 0xfa, 0x21, 0x3d];

/**
 * A frame as a client sends it: masked.
 *
 * @param opcode The opcode.
 * @param payload The payload, not masked.
 * @param options `fin: false` for a fragment that is not the last; `rsv` to
 *   set reserved bits; `masked: false` for a frame a client must not send;
 *   `long` to write the length in 2 or 8 bytes whatever it is.
 */
function client_frame(
  opcode: number,
  payload: Uint8Array | string = new Uint8Array(0),
  options: {
    fin?: boolean;
    rsv?: number;
    masked?: boolean;
    long?: 2 | 8;
  } = {},
): Uint8Array {
  const { fin = true, rsv = 0, masked = true, long } = options;
  const data = typeof payload === "string" ? text.encode(payload) : payload;
  const size = data.byteLength;
  const bytes: number[] = [(fin ? 0x80 : 0) | (rsv << 4) | opcode];
  const mask_bit = masked ? 0x80 : 0;
  if (long === 8 || size > 0xffff) {
    bytes.push(mask_bit | 127, 0, 0, 0, 0);
    bytes.push(
      (size >>> 24) & 0xff,
      (size >>> 16) & 0xff,
      (size >>> 8) & 0xff,
      size & 0xff,
    );
  } else if (long === 2 || size > 125) {
    bytes.push(mask_bit | 126, (size >>> 8) & 0xff, size & 0xff);
  } else {
    bytes.push(mask_bit | size);
  }
  if (masked) {
    bytes.push(...MASK);
  }
  const frame = new Uint8Array(bytes.length + size);
  frame.set(bytes);
  for (let i = 0; i < size; i++) {
    frame[bytes.length + i] = masked ? data[i]! ^ MASK[i & 3]! : data[i]!;
  }
  return frame;
}

/** The payload of a close frame. */
function close_payload(code: number, reason = ""): Uint8Array {
  return new Uint8Array([code >>> 8, code & 0xff, ...text.encode(reason)]);
}

/** Read frames, given whole. */
function read(max: number, ...frames: Uint8Array[]): FrameEvent[] {
  const reader = new FrameReader(max);
  return frames.flatMap((frame) => reader.push(frame));
}

const MAX = 1024 * 1024;

describe("accept_key", () => {
  it("gives the answer of the example of the RFC", async () => {
    assert.equal(
      await accept_key("dGhlIHNhbXBsZSBub25jZQ=="),
      "s3pPLMBiTxaQ9kYGzzhZRbK+xOo=",
    );
  });
});

describe("check_handshake", () => {
  const good = () =>
    new Headers({
      upgrade: "websocket",
      connection: "keep-alive, Upgrade",
      "sec-websocket-version": "13",
      "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
    });

  it("accepts the request of a client", () => {
    assert.equal(check_handshake("GET", good()), undefined);
  });

  it("refuses a method that is not GET", () => {
    const refusal = check_handshake("POST", good());
    assert.deepEqual([refusal?.status, refusal?.headers], [405, {
      allow: "GET",
    }]);
  });

  it("refuses a Connection header without Upgrade", () => {
    const headers = good();
    headers.set("connection", "keep-alive");
    assert.equal(check_handshake("GET", headers)?.status, 400);
    headers.delete("connection");
    assert.equal(check_handshake("GET", headers)?.status, 400);
  });

  it("refuses another version, and names the one it speaks", () => {
    for (const version of ["8", "12", "14", ""]) {
      const headers = good();
      headers.set("sec-websocket-version", version);
      const refusal = check_handshake("GET", headers);
      assert.equal(refusal?.status, 426);
      assert.equal(refusal?.headers["sec-websocket-version"], "13");
    }
  });

  it("refuses a key that is missing, or not 16 bytes in base64", () => {
    for (
      const key of [
        undefined,
        "",
        "short",
        "dGhlIHNhbXBsZSBub25jZQ",
        "!".repeat(24),
      ]
    ) {
      const headers = good();
      if (key === undefined) {
        headers.delete("sec-websocket-key");
      } else {
        headers.set("sec-websocket-key", key);
      }
      const refusal = check_handshake("GET", headers);
      assert.equal(refusal?.status, 400, String(key));
      assert.match(refusal?.message ?? "", /Sec-WebSocket-Key/);
    }
  });
});

describe("encode_frame", () => {
  it("writes the unmasked text frame of the RFC", () => {
    assert.deepEqual(
      [...encode_message("Hello")],
      [0x81, 0x05, 0x48, 0x65, 0x6c, 0x6c, 0x6f],
    );
  });

  it("writes a binary frame, a ping and a pong", () => {
    assert.deepEqual([...encode_message(new Uint8Array([1, 2]))], [
      0x82,
      2,
      1,
      2,
    ]);
    assert.deepEqual([...encode_frame(9, text.encode("Hello"))].slice(0, 2), [
      0x89,
      0x05,
    ]);
    assert.deepEqual([...encode_frame(10)], [0x8a, 0]);
  });

  it("writes the length in 1, 2 or 8 bytes", () => {
    assert.deepEqual([...encode_message(new Uint8Array(125))].slice(0, 2), [
      0x82,
      125,
    ]);
    // 256 bytes: the example of the RFC
    assert.deepEqual([...encode_message(new Uint8Array(256))].slice(0, 4), [
      0x82,
      0x7e,
      0x01,
      0x00,
    ]);
    assert.equal(encode_message(new Uint8Array(65535)).byteLength, 65535 + 4);
    // 64 KiB: the example of the RFC
    const big = encode_message(new Uint8Array(65536));
    assert.deepEqual([...big.subarray(0, 10)], [
      0x82,
      0x7f,
      0,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
    ]);
    assert.equal(big.byteLength, 65536 + 10);
  });

  it("writes text as UTF-8", () => {
    assert.deepEqual([...encode_message("é")], [0x81, 2, 0xc3, 0xa9]);
  });
});

describe("encode_close", () => {
  it("writes the code, then the reason", () => {
    assert.deepEqual([...encode_close(1000)], [0x88, 2, 0x03, 0xe8]);
    assert.deepEqual([...encode_close(1001, "bye")], [
      0x88,
      5,
      0x03,
      0xe9,
      0x62,
      0x79,
      0x65,
    ]);
  });

  it("writes no code for one a frame cannot hold", () => {
    for (const code of [1005, 1006, 0, 999, 1004, 1015, 2999, 5000]) {
      assert.deepEqual([...encode_close(code, "x")], [0x88, 0], String(code));
    }
  });

  it("cuts a long reason at a character", () => {
    const frame = encode_close(1000, "é".repeat(100));
    // 2 bytes of code, and 61 characters of 2 bytes: 124, not 125
    assert.equal(frame[1], 124);
    assert.equal(
      new TextDecoder("utf-8", { fatal: true }).decode(frame.subarray(4)),
      "é".repeat(61),
    );
  });
});

describe("is_close_code", () => {
  it("takes the codes a close frame can hold", () => {
    for (const code of [1000, 1001, 1002, 1003, 1007, 1011, 1014, 3000, 4999]) {
      assert.equal(is_close_code(code), true, String(code));
    }
    for (const code of [0, 999, 1004, 1005, 1006, 1015, 1016, 2999, 5000]) {
      assert.equal(is_close_code(code), false, String(code));
    }
  });
});

describe("FrameReader", () => {
  it("reads the masked text frame of the RFC", () => {
    const frame = new Uint8Array([
      0x81,
      0x85,
      0x37,
      0xfa,
      0x21,
      0x3d,
      0x7f,
      0x9f,
      0x4d,
      0x51,
      0x58,
    ]);
    assert.deepEqual(read(MAX, frame), [{ type: "message", data: "Hello" }]);
  });

  it("reads a binary message as bytes of its own", () => {
    const frame = client_frame(2, new Uint8Array([1, 2, 3]));
    const before = [...frame];
    const [event] = read(MAX, frame);
    assert.deepEqual(event, {
      type: "message",
      data: new Uint8Array([1, 2, 3]),
    });
    // the bytes of the connection are not changed
    assert.deepEqual([...frame], before);
  });

  it("reads an empty message", () => {
    assert.deepEqual(read(MAX, client_frame(1), client_frame(2)), [
      { type: "message", data: "" },
      { type: "message", data: new Uint8Array(0) },
    ]);
  });

  it("reads the three sizes of a length", () => {
    for (const size of [125, 126, 65535, 65536]) {
      const [event] = read(MAX, client_frame(2, new Uint8Array(size).fill(7)));
      assert.equal(event?.type, "message");
      const data = (event as { data: Uint8Array }).data;
      assert.equal(data.byteLength, size);
      assert.equal(data.every((byte) => byte === 7), true);
    }
  });

  it("joins the fragments of a message: the example of the RFC", () => {
    assert.deepEqual(
      read(
        MAX,
        client_frame(1, "Hel", { fin: false }),
        client_frame(0, "lo"),
      ),
      [{ type: "message", data: "Hello" }],
    );
  });

  it("reads a control frame between the fragments of a message", () => {
    assert.deepEqual(
      read(
        MAX,
        client_frame(2, new Uint8Array([1]), { fin: false }),
        client_frame(9, "are you there?"),
        client_frame(0, new Uint8Array([2]), { fin: false }),
        client_frame(10),
        client_frame(0, new Uint8Array([3])),
      ),
      [
        { type: "ping", data: text.encode("are you there?") },
        { type: "pong" },
        { type: "message", data: new Uint8Array([1, 2, 3]) },
      ],
    );
  });

  it("joins a character that is cut between two fragments", () => {
    const [first, second] = [...text.encode("é")];
    assert.deepEqual(
      read(
        MAX,
        client_frame(1, new Uint8Array([first!]), { fin: false }),
        client_frame(0, new Uint8Array([second!])),
      ),
      [{ type: "message", data: "é" }],
    );
  });

  it("reads frames that arrive in any pieces", () => {
    const bytes = [
      ...client_frame(1, "one"),
      ...client_frame(2, new Uint8Array(300).fill(9)),
      ...client_frame(9, "p"),
      ...client_frame(1, "two"),
    ];
    for (const step of [1, 2, 3, 7, 64, bytes.length]) {
      const reader = new FrameReader(MAX);
      const events: FrameEvent[] = [];
      for (let at = 0; at < bytes.length; at += step) {
        events.push(
          ...reader.push(new Uint8Array(bytes.slice(at, at + step))),
        );
      }
      assert.deepEqual(events, [
        { type: "message", data: "one" },
        { type: "message", data: new Uint8Array(300).fill(9) },
        { type: "ping", data: text.encode("p") },
        { type: "message", data: "two" },
      ], `in pieces of ${step}`);
    }
  });

  it("reads a close frame, and nothing after it", () => {
    assert.deepEqual(
      read(
        MAX,
        client_frame(8, close_payload(1000, "bye")),
        client_frame(1, "late"),
      ),
      [{ type: "close", code: 1000, reason: "bye" }],
    );
    assert.deepEqual(read(MAX, client_frame(8)), [
      { type: "close", code: 1005, reason: "" },
    ]);
    assert.deepEqual(read(MAX, client_frame(8, close_payload(4999))), [
      { type: "close", code: 4999, reason: "" },
    ]);
  });

  it("fails with 1002 for a frame the protocol does not allow", () => {
    const cases: [string, Uint8Array[]][] = [
      ["not masked", [client_frame(1, "x", { masked: false })]],
      ["reserved bit 1", [client_frame(1, "x", { rsv: 4 })]],
      ["reserved bit 2", [client_frame(1, "x", { rsv: 2 })]],
      ["reserved bit 3", [client_frame(1, "x", { rsv: 1 })]],
      ["opcode 3", [client_frame(3, "x")]],
      ["opcode 7", [client_frame(7, "x")]],
      ["opcode 11", [client_frame(11)]],
      ["opcode 15", [client_frame(15)]],
      ["a fragmented ping", [client_frame(9, "x", { fin: false })]],
      ["a fragmented close", [client_frame(8, "", { fin: false })]],
      ["a ping of 126 bytes", [client_frame(9, new Uint8Array(126))]],
      ["a continuation with no message", [client_frame(0, "x")]],
      ["a message inside a message", [
        client_frame(1, "a", { fin: false }),
        client_frame(1, "b"),
      ]],
      ["a close with one byte", [client_frame(8, new Uint8Array([3]))]],
      ["the close code 1005", [client_frame(8, close_payload(1005))]],
      ["the close code 999", [client_frame(8, close_payload(999))]],
      ["the close code 5000", [client_frame(8, close_payload(5000))]],
    ];
    for (const [name, frames] of cases) {
      const events = read(MAX, ...frames, client_frame(1, "after"));
      assert.equal(events.length, 1, name);
      assert.deepEqual(
        [events[0]?.type, (events[0] as { code: number }).code],
        ["error", 1002],
        name,
      );
    }
  });

  it("takes a ping of 125 bytes: the most a control frame holds", () => {
    assert.equal(
      read(MAX, client_frame(9, new Uint8Array(125)))[0]?.type,
      "ping",
    );
  });

  it("fails with 1007 for text that is not UTF-8", () => {
    const invalid: Uint8Array[] = [
      new Uint8Array([0xff]),
      new Uint8Array([0xc3]), // the first byte of a character, alone
      new Uint8Array([0xed, 0xa0, 0x80]), // a surrogate
      new Uint8Array([0xc0, 0xaf]), // an overlong encoding
    ];
    for (const bytes of invalid) {
      assert.deepEqual(read(MAX, client_frame(1, bytes)), [{
        type: "error",
        code: 1007,
        reason: "A text message is not UTF-8",
      }]);
    }
    // the same bytes are a valid binary message
    assert.equal(read(MAX, client_frame(2, invalid[0]!))[0]?.type, "message");
    // and the reason of a close frame is text too
    assert.deepEqual(
      read(MAX, client_frame(8, new Uint8Array([0x03, 0xe8, 0xff])))[0],
      {
        type: "error",
        code: 1007,
        reason: "The reason of a close frame is not UTF-8",
      },
    );
  });

  it("fails with 1009 for a message above the limit", () => {
    assert.equal(
      read(10, client_frame(2, new Uint8Array(10)))[0]?.type,
      "message",
    );
    for (
      const frames of [
        [client_frame(2, new Uint8Array(11))],
        // the fragments together
        [
          client_frame(2, new Uint8Array(6), { fin: false }),
          client_frame(0, new Uint8Array(5)),
        ],
        [client_frame(2, new Uint8Array(200))],
        [client_frame(2, new Uint8Array(70000))],
      ]
    ) {
      const events = read(10, ...frames);
      assert.deepEqual(events.at(-1), {
        type: "error",
        code: 1009,
        reason: "The message is too big",
      });
    }
  });

  it("refuses a message by its declared length, before its bytes arrive", () => {
    const reader = new FrameReader(1000);
    // A frame that says it holds 4 GiB, and nothing of it.
    const head = new Uint8Array([0x82, 0xff, 0, 0, 0, 1, 0, 0, 0, 0]);
    assert.deepEqual(reader.push(head), [{
      type: "error",
      code: 1009,
      reason: "The message is too big",
    }]);
    // 2 bytes of length are refused the same way
    const medium = new FrameReader(100);
    assert.equal(
      medium.push(new Uint8Array([0x82, 0xfe, 0x01, 0x00]))[0]?.type,
      "error",
    );
    // and a length above what a number holds
    const huge = new FrameReader(MAX);
    const all = new Uint8Array([
      0x82,
      0xff,
      255,
      255,
      255,
      255,
      255,
      255,
      255,
      255,
    ]);
    assert.equal((huge.push(all)[0] as { code: number }).code, 1009);
  });

  it("reads nothing after an error", () => {
    const reader = new FrameReader(MAX);
    assert.equal(reader.push(client_frame(3))[0]?.type, "error");
    assert.deepEqual(reader.push(client_frame(1, "x")), []);
    assert.deepEqual(reader.push(client_frame(8, close_payload(1000))), []);
  });

  it("reads a length written in more bytes than it needs", () => {
    assert.deepEqual(read(MAX, client_frame(1, "hi", { long: 2 })), [{
      type: "message",
      data: "hi",
    }]);
    assert.deepEqual(read(MAX, client_frame(1, "hi", { long: 8 })), [{
      type: "message",
      data: "hi",
    }]);
  });
});
