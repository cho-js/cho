/**
 * The server side of the WebSocket protocol
 * ([RFC 6455](https://datatracker.ietf.org/doc/html/rfc6455)): the handshake,
 * and reading and writing frames.
 *
 * Deno, Bun and Cloudflare Workers have the protocol built in. Node.js has a
 * client only, so `serve` speaks it there with this module. Nothing here is
 * of Node.js: it works on bytes, and its tests run on every runtime.
 *
 * Not in it: extensions (no compression, `permessage-deflate`) and
 * subprotocols. Both are optional in the protocol.
 *
 * Internal to `@chojs/web`.
 *
 * @module
 */

/** The value every server adds to the key of a client (RFC 6455, 1.3). */
const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

/** The opcodes of the frames. */
export const OPCODE = {
  continuation: 0,
  text: 1,
  binary: 2,
  close: 8,
  ping: 9,
  pong: 10,
} as const;

/** The close codes this module gives. */
export const CLOSE = {
  /** A frame the protocol does not allow. */
  protocol_error: 1002,
  /** A close frame with no code. */
  no_status: 1005,
  /** A connection that ended with no close frame. */
  abnormal: 1006,
  /** Text that is not UTF-8. */
  invalid_data: 1007,
  /** A message above the limit. */
  too_big: 1009,
} as const;

const encoder = new TextEncoder();

/**
 * The `Sec-WebSocket-Accept` of a handshake: the SHA-1 of the key of the
 * client and the GUID of the protocol, in base64.
 *
 * @param key The `Sec-WebSocket-Key` header of the request.
 * @returns The value of the header of the answer.
 */
export async function accept_key(key: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-1",
    encoder.encode(key + GUID),
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)));
}

/** A handshake the server refuses: the answer to the request. */
export type HandshakeRefusal = {
  /** The status of the answer. */
  readonly status: number;
  /** Why, as the body of the answer. */
  readonly message: string;
  /** The headers of the answer. */
  readonly headers: Readonly<Record<string, string>>;
};

/**
 * Check the request of a handshake (RFC 6455, 4.2.1).
 *
 * @param method The method of the request.
 * @param headers The headers of the request.
 * @returns `undefined` for a request the server can upgrade; otherwise the
 *   answer that refuses it.
 */
export function check_handshake(
  method: string,
  headers: Headers,
): HandshakeRefusal | undefined {
  const refuse = (
    status: number,
    message: string,
    more: Record<string, string> = {},
  ): HandshakeRefusal => ({ status, message, headers: more });
  if (method !== "GET") {
    return refuse(405, "A WebSocket handshake is a GET request", {
      allow: "GET",
    });
  }
  const connection = (headers.get("connection") ?? "")
    .split(",")
    .map((token) => token.trim().toLowerCase());
  if (!connection.includes("upgrade")) {
    return refuse(400, 'The "Connection" header must include "Upgrade"');
  }
  if (headers.get("sec-websocket-version") !== "13") {
    return refuse(426, "The version of the WebSocket protocol must be 13", {
      "sec-websocket-version": "13",
      upgrade: "websocket",
      connection: "Upgrade",
    });
  }
  // The key is 16 bytes in base64: 22 characters, and two of padding.
  if (!/^[A-Za-z0-9+/]{22}==$/.test(headers.get("sec-websocket-key") ?? "")) {
    return refuse(400, 'The "Sec-WebSocket-Key" header is missing or invalid');
  }
  return undefined;
}

/**
 * Write a frame of a server: whole (`FIN`), and not masked.
 *
 * @param opcode The opcode of the frame.
 * @param payload The payload.
 * @returns The bytes of the frame.
 */
export function encode_frame(
  opcode: number,
  payload: Uint8Array = new Uint8Array(0),
): Uint8Array {
  const size = payload.byteLength;
  const head = size < 126 ? 2 : size < 65536 ? 4 : 10;
  const frame = new Uint8Array(head + size);
  frame[0] = 0x80 | opcode;
  if (head === 2) {
    frame[1] = size;
  } else if (head === 4) {
    frame[1] = 126;
    frame[2] = size >>> 8;
    frame[3] = size & 0xff;
  } else {
    frame[1] = 127;
    // 64 bits, of which a length in JavaScript uses 53 at most.
    new DataView(frame.buffer).setBigUint64(2, BigInt(size));
  }
  frame.set(payload, head);
  return frame;
}

/**
 * Write a message as a frame: a string as text, bytes as binary.
 *
 * @param data The message.
 * @returns The bytes of the frame.
 */
export function encode_message(data: string | Uint8Array): Uint8Array {
  return typeof data === "string"
    ? encode_frame(OPCODE.text, encoder.encode(data))
    : encode_frame(OPCODE.binary, data);
}

/** The bytes a control frame can hold, and so a close frame. */
const MAX_CONTROL = 125;

/**
 * Whether a close code can be sent in a close frame (RFC 6455, 7.4): the
 * codes of the protocol that are not reserved, and those of libraries and
 * of applications (3000 to 4999).
 *
 * @param code The close code.
 * @returns `true` for a code a close frame can hold.
 */
export function is_close_code(code: number): boolean {
  return (code >= 1000 && code <= 1014 && code !== 1004 && code !== 1005 &&
    code !== 1006) || (code >= 3000 && code <= 4999);
}

/**
 * Write a close frame.
 *
 * @param code The close code. A code a frame cannot hold (`1005`, `1006`,
 *   or one that is not valid) gives a close frame with no code.
 * @param reason The reason: it is cut to what a control frame holds.
 * @returns The bytes of the frame.
 */
export function encode_close(code: number, reason = ""): Uint8Array {
  if (!is_close_code(code)) {
    return encode_frame(OPCODE.close);
  }
  let text = encoder.encode(reason);
  if (text.byteLength > MAX_CONTROL - 2) {
    // Cut at a character: the reason must stay UTF-8.
    let end = MAX_CONTROL - 2;
    while (end > 0 && (text[end]! & 0xc0) === 0x80) {
      end--;
    }
    text = text.subarray(0, end);
  }
  const payload = new Uint8Array(2 + text.byteLength);
  payload[0] = code >>> 8;
  payload[1] = code & 0xff;
  payload.set(text, 2);
  return encode_frame(OPCODE.close, payload);
}

/** What a {@link FrameReader} found in the bytes of a client. */
export type FrameEvent =
  /** A whole message: text as a string, binary as bytes. */
  | { readonly type: "message"; readonly data: string | Uint8Array }
  /** A ping: it is answered with a pong of the same payload. */
  | { readonly type: "ping"; readonly data: Uint8Array }
  /** A pong: the answer to a ping. */
  | { readonly type: "pong" }
  /** A close frame: `1005` when it has no code. */
  | { readonly type: "close"; readonly code: number; readonly reason: string }
  /** What the protocol does not allow: the connection fails with the code. */
  | { readonly type: "error"; readonly code: number; readonly reason: string };

/**
 * Reads the frames of a client from the bytes of its connection, as they
 * arrive.
 *
 * It joins the fragments of a message, checks what the protocol asks of a
 * client (RFC 6455, 5), and stops at a close frame or at the first error:
 * what comes after is ignored.
 */
export class FrameReader {
  readonly #max: number;
  /** The bytes that are not read yet. */
  #buffer: Uint8Array = new Uint8Array(0);
  /** The fragments of the message in progress. */
  #parts: Uint8Array[] = [];
  /** The size of the message in progress. */
  #size = 0;
  /** The opcode of the message in progress: text or binary, `0` for none. */
  #kind = 0;
  /** Whether a close frame or an error was read. */
  #done = false;

  /**
   * @param max_payload The bytes a message can hold, all its fragments
   *   together. A larger one fails with `1009`.
   */
  constructor(max_payload: number) {
    this.#max = max_payload;
  }

  /**
   * Give bytes of the connection to the reader.
   *
   * @param chunk The bytes, in the order they arrived.
   * @returns What they complete, in order. Empty when no frame is complete.
   */
  push(chunk: Uint8Array): FrameEvent[] {
    const events: FrameEvent[] = [];
    if (this.#done) {
      return events;
    }
    if (this.#buffer.byteLength === 0) {
      this.#buffer = chunk;
    } else {
      const joined = new Uint8Array(this.#buffer.byteLength + chunk.byteLength);
      joined.set(this.#buffer);
      joined.set(chunk, this.#buffer.byteLength);
      this.#buffer = joined;
    }
    while (!this.#done) {
      const event = this.#next();
      if (event === undefined) {
        break;
      }
      if (event !== null) {
        events.push(event);
      }
    }
    return events;
  }

  /** Stop reading, with an error. */
  #fail(code: number, reason: string): FrameEvent {
    this.#done = true;
    this.#buffer = new Uint8Array(0);
    this.#parts = [];
    return { type: "error", code, reason };
  }

  /**
   * Read one frame.
   *
   * @returns An event, `null` for a frame that completes nothing (a fragment
   *   of a message), or `undefined` when the frame is not whole yet.
   */
  #next(): FrameEvent | null | undefined {
    const buffer = this.#buffer;
    if (buffer.byteLength < 2) {
      return undefined;
    }
    const first = buffer[0]!;
    const second = buffer[1]!;
    const fin = (first & 0x80) !== 0;
    const opcode = first & 0x0f;
    if ((first & 0x70) !== 0) {
      return this.#fail(
        CLOSE.protocol_error,
        "Reserved bits are set, and no extension was agreed",
      );
    }
    if ((second & 0x80) === 0) {
      return this.#fail(
        CLOSE.protocol_error,
        "A frame of a client must be masked",
      );
    }
    const control = opcode >= OPCODE.close;
    if (
      opcode > OPCODE.pong || (opcode > OPCODE.binary && opcode < OPCODE.close)
    ) {
      return this.#fail(CLOSE.protocol_error, `Unknown opcode ${opcode}`);
    }
    let size = second & 0x7f;
    let at = 2;
    if (control && (!fin || size > MAX_CONTROL)) {
      return this.#fail(
        CLOSE.protocol_error,
        "A control frame is not fragmented, and holds 125 bytes at most",
      );
    }
    if (size === 126) {
      if (buffer.byteLength < 4) {
        return undefined;
      }
      size = (buffer[2]! << 8) | buffer[3]!;
      at = 4;
    } else if (size === 127) {
      if (buffer.byteLength < 10) {
        return undefined;
      }
      const long = new DataView(buffer.buffer, buffer.byteOffset + 2, 8)
        .getBigUint64(0);
      // Refused before any of it is kept, whatever the client says it is.
      if (long > BigInt(this.#max)) {
        return this.#fail(CLOSE.too_big, "The message is too big");
      }
      size = Number(long);
      at = 10;
    }
    if (!control) {
      if (opcode === OPCODE.continuation && this.#kind === 0) {
        return this.#fail(
          CLOSE.protocol_error,
          "A continuation frame with no message to continue",
        );
      }
      if (opcode !== OPCODE.continuation && this.#kind !== 0) {
        return this.#fail(
          CLOSE.protocol_error,
          "A new message before the end of a fragmented one",
        );
      }
      if (this.#size + size > this.#max) {
        return this.#fail(CLOSE.too_big, "The message is too big");
      }
    }
    if (buffer.byteLength < at + 4 + size) {
      return undefined;
    }
    const mask = buffer.subarray(at, at + 4);
    // A copy, in bytes of its own: the bytes of the connection are not
    // changed. (`slice` of a Node.js `Buffer` would give a view of them.)
    const payload = new Uint8Array(size);
    for (let i = 0; i < size; i++) {
      payload[i] = buffer[at + 4 + i]! ^ mask[i & 3]!;
    }
    this.#buffer = buffer.subarray(at + 4 + size);

    if (opcode === OPCODE.ping) {
      return { type: "ping", data: payload };
    }
    if (opcode === OPCODE.pong) {
      return { type: "pong" };
    }
    if (opcode === OPCODE.close) {
      return this.#close(payload);
    }
    if (opcode !== OPCODE.continuation) {
      this.#kind = opcode;
    }
    this.#parts.push(payload);
    this.#size += size;
    if (!fin) {
      return null;
    }
    const whole = this.#parts.length === 1
      ? payload
      : join(this.#parts, this.#size);
    const text = this.#kind === OPCODE.text;
    this.#parts = [];
    this.#size = 0;
    this.#kind = 0;
    if (!text) {
      return { type: "message", data: whole };
    }
    const data = decode(whole);
    return data === undefined
      ? this.#fail(CLOSE.invalid_data, "A text message is not UTF-8")
      : { type: "message", data };
  }

  /** Read the payload of a close frame. */
  #close(payload: Uint8Array): FrameEvent {
    if (payload.byteLength === 0) {
      this.#done = true;
      return { type: "close", code: CLOSE.no_status, reason: "" };
    }
    if (payload.byteLength === 1) {
      return this.#fail(
        CLOSE.protocol_error,
        "A close frame has no code, or two bytes of it",
      );
    }
    const code = (payload[0]! << 8) | payload[1]!;
    if (!is_close_code(code)) {
      return this.#fail(CLOSE.protocol_error, `Invalid close code ${code}`);
    }
    const reason = decode(payload.subarray(2));
    if (reason === undefined) {
      return this.#fail(
        CLOSE.invalid_data,
        "The reason of a close frame is not UTF-8",
      );
    }
    this.#done = true;
    return { type: "close", code, reason };
  }
}

/** One list of bytes of several. */
function join(parts: readonly Uint8Array[], size: number): Uint8Array {
  const whole = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    whole.set(part, at);
    at += part.byteLength;
  }
  return whole;
}

/** The text of UTF-8 bytes, or `undefined` when they are not UTF-8. */
function decode(bytes: Uint8Array): string | undefined {
  try {
    // Made for each text: a decoder that failed keeps no state to reuse.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true })
      .decode(bytes);
  } catch {
    return undefined;
  }
}
