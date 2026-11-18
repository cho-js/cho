/**
 * Sending with NATS: the `Sender` of `@chojs/vendor-nats`, which a
 * `ChoMessageClient` is built on. It publishes and requests with the
 * connection of the application.
 *
 * @module
 */

import { headers as make_headers } from "@nats-io/nats-core";
import type { MsgHdrs } from "@nats-io/nats-core";
import {
  type Delivery,
  type Reply,
  ReplyError,
  request_error,
  type RequestOptions,
  type Sender,
} from "@chojs/message/linker";
import {
  ERROR_HEADERS,
  type NatsConnectionLike,
  type NatsMessageLike,
} from "./consume.ts";

/** How long a request waits when nothing says: the default of nats.js. */
export const REQUEST_TIMEOUT = 1000;

const EMPTY = new Uint8Array(0);
const encoder = new TextEncoder();

/** The bytes of the value of a message to send. */
function to_bytes(value: Delivery["value"]): Uint8Array {
  return typeof value === "string" ? encoder.encode(value) : value ?? EMPTY;
}

/** The headers of a message to send, or `undefined` when it has none. */
function to_headers(delivery: Delivery): MsgHdrs | undefined {
  const entries = Object.entries(delivery.headers ?? {});
  if (entries.length === 0) {
    return undefined;
  }
  const headers = make_headers();
  for (const [name, text] of entries) {
    headers.set(name, text);
  }
  return headers;
}

/** The first value of each header of a message. */
function first_values(message: NatsMessageLike): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, values] of message.headers ?? []) {
    headers[name] = values[0] ?? "";
  }
  return headers;
}

/** The names of an error of the client library, and of its cause. */
function names_of(error: unknown): string[] {
  const names: string[] = [];
  for (let at = error, depth = 0; at && depth < 3; depth++) {
    names.push(String((at as { name?: unknown }).name));
    at = (at as { cause?: unknown }).cause;
  }
  return names;
}

/**
 * The sender of the NATS adapter.
 *
 * - `publish` sends a message: its value, and its headers. NATS has no key:
 *   the key of a delivery is not sent.
 * - `request` sends it, and waits for the reply. A reply with the headers of
 *   an error (`ERROR_HEADERS`), as a NATS service and this adapter answer,
 *   rejects with a `ReplyError` of its code and its description.
 */
export class NatsSender implements Sender {
  readonly #connection: () => Promise<NatsConnectionLike>;

  /**
   * @param connection Gives the connection of the application, once it is
   *   made.
   */
  constructor(connection: () => Promise<NatsConnectionLike>) {
    this.#connection = connection;
  }

  /**
   * Send a message that asks for no reply.
   *
   * @param topic The subject.
   * @param delivery The message.
   * @returns A promise that resolves when the client has the message: it is
   *   sent with the next flush.
   */
  async publish(topic: string, delivery: Delivery): Promise<void> {
    const connection = await this.#connection();
    const headers = to_headers(delivery);
    connection.publish(
      topic,
      to_bytes(delivery.value),
      headers ? { headers } : undefined,
    );
  }

  /**
   * Send a message that asks for a reply, and wait for it.
   *
   * @param topic The subject.
   * @param delivery The message.
   * @param options How long to wait. Default: 1000 ms.
   * @returns The reply: its bytes, and its headers when it has some.
   * @throws {ReplyError} (as a rejection) When the reply is an error reply.
   * @throws {ChoError} (as a rejection) `CHO_MESSAGE_NO_RESPONDERS` when no
   *   subscription listens to the subject; `CHO_MESSAGE_REQUEST_TIMEOUT` when
   *   no reply came in time.
   */
  async request(
    topic: string,
    delivery: Delivery,
    options?: RequestOptions,
  ): Promise<Reply> {
    const connection = await this.#connection();
    const headers = to_headers(delivery);
    let message: NatsMessageLike;
    try {
      message = await connection.request(topic, to_bytes(delivery.value), {
        timeout: options?.timeout ?? REQUEST_TIMEOUT,
        ...(headers ? { headers } : {}),
      });
    } catch (cause) {
      // By name: the error can be of another copy of the client library.
      const names = names_of(cause);
      if (names.some((name) => name.startsWith("NoResponders"))) {
        throw request_error("CHO_MESSAGE_NO_RESPONDERS", topic, { cause });
      }
      if (names.includes("TimeoutError")) {
        throw request_error("CHO_MESSAGE_REQUEST_TIMEOUT", topic, { cause });
      }
      throw cause;
    }
    const told = first_values(message);
    const code = told[ERROR_HEADERS.code];
    const description = told[ERROR_HEADERS.description];
    if (code !== undefined || description !== undefined) {
      const number = Number(code);
      throw new ReplyError(
        Number.isInteger(number) && number >= 1 ? number : 500,
        description?.trim() || "Error",
      );
    }
    return {
      value: message.data,
      ...(Object.keys(told).length > 0 ? { headers: told } : {}),
    };
  }
}
