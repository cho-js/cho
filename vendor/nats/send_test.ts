/**
 * Tests for `send.ts`: the sender of the NATS adapter publishes and requests
 * with a connection, and turns an error reply into a `ReplyError`.
 *
 * A fake connection stands for the client library: these tests need no
 * server, and run on every runtime. `nats_test.ts` has the tests with a
 * server.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isReplyError, type ReplyError } from "@chojs/message/linker";
import {
  ERROR_HEADERS,
  type NatsConnectionLike,
  type NatsMessageLike,
} from "./consume.ts";
import { NatsSender, REQUEST_TIMEOUT } from "./send.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** What a connection was asked to send. */
type Sent = {
  subject: string;
  value: string;
  headers: Record<string, string> | undefined;
  timeout?: number;
};

/** The headers of a message that was sent, as an object. */
const headers_of = (options?: { headers?: Iterable<[string, string[]]> }) =>
  options?.headers
    ? Object.fromEntries(
      [...options.headers].map(([name, values]) => [name, values.join(",")]),
    )
    : undefined;

/** A connection that records what it sends, and answers a request. */
function connection_of(answer: () => NatsMessageLike | Promise<never>) {
  const published: Sent[] = [];
  const requested: Sent[] = [];
  const connection = {
    publish(subject: string, data?: Uint8Array, options?: object) {
      published.push({
        subject,
        value: decoder.decode(data),
        headers: headers_of(options),
      });
    },
    request(
      subject: string,
      data?: Uint8Array,
      options?: { timeout: number; headers?: Iterable<[string, string[]]> },
    ) {
      requested.push({
        subject,
        value: decoder.decode(data),
        headers: headers_of(options),
        timeout: options!.timeout,
      });
      return Promise.resolve().then(answer);
    },
  } as unknown as NatsConnectionLike;
  return { connection, published, requested };
}

/** A reply of the other side. */
function reply(value: string, headers?: [string, string[]][]): NatsMessageLike {
  return {
    subject: "_INBOX.1",
    data: encoder.encode(value),
    headers,
    respond: () => false,
  };
}

/** A sender on a connection that answers with `answer`. */
function sender_of(
  answer: () => NatsMessageLike | Promise<never> = () => reply(""),
) {
  const made = connection_of(answer);
  return {
    ...made,
    sender: new NatsSender(() => Promise.resolve(made.connection)),
  };
}

/** An error of the client library, by its name. */
const named = (name: string, cause?: unknown) =>
  Object.assign(new Error(name, { cause }), { name });

describe("NatsSender.publish", () => {
  it("sends the value as bytes, to the subject", async () => {
    const { sender, published } = sender_of();
    await sender.publish("shop.orders.created", { value: '{"id":7}' });
    await sender.publish("bytes", { value: encoder.encode("raw") });
    assert.deepEqual(published, [
      { subject: "shop.orders.created", value: '{"id":7}', headers: undefined },
      { subject: "bytes", value: "raw", headers: undefined },
    ]);
  });

  it("sends an empty payload for a message with no value", async () => {
    const { sender, published } = sender_of();
    await sender.publish("ping", {});
    await sender.publish("ping", { value: null });
    assert.deepEqual(published.map((one) => one.value), ["", ""]);
  });

  it("sends the headers, and not the key", async () => {
    const { sender, published } = sender_of();
    await sender.publish("orders", {
      value: "x",
      key: "k7",
      headers: { Tenant: "acme", "x-trace": "t1" },
    });
    assert.deepEqual(published, [{
      subject: "orders",
      value: "x",
      headers: { Tenant: "acme", "x-trace": "t1" },
    }]);
    await sender.publish("orders", { headers: {} });
    assert.equal(published[1]!.headers, undefined);
  });

  it("rejects for a header NATS does not accept", async () => {
    const { sender, published } = sender_of();
    await assert.rejects(sender.publish("orders", { headers: { "a b": "1" } }));
    assert.deepEqual(published, []);
  });

  it("rejects with the error of a connection that is not there", async () => {
    const error = new Error("not started");
    const sender = new NatsSender(() => Promise.reject(error));
    await assert.rejects(sender.publish("orders", {}), error);
    await assert.rejects(sender.request("orders", {}), error);
  });
});

describe("NatsSender.request", () => {
  it("sends the request, and gives the reply", async () => {
    const { sender, requested } = sender_of(() => reply('{"price":42}'));
    const answer = await sender.request("shop.orders.price", {
      value: '{"id":7}',
      headers: { Tenant: "acme" },
    });
    assert.deepEqual(answer, { value: encoder.encode('{"price":42}') });
    assert.deepEqual(requested, [{
      subject: "shop.orders.price",
      value: '{"id":7}',
      headers: { Tenant: "acme" },
      timeout: REQUEST_TIMEOUT,
    }]);
    assert.equal(REQUEST_TIMEOUT, 1000);
  });

  it("waits as long as it is told", async () => {
    const { sender, requested } = sender_of();
    await sender.request("ping", {}, { timeout: 250 });
    await sender.request("ping", {}, {});
    assert.deepEqual(requested.map((one) => one.timeout), [250, 1000]);
  });

  it("gives the first value of each header of the reply", async () => {
    const { sender } = sender_of(() =>
      reply("x", [["Content-Type", ["text/plain"]], ["Trace", ["t1", "t2"]]])
    );
    assert.deepEqual((await sender.request("ping", {})).headers, {
      "Content-Type": "text/plain",
      Trace: "t1",
    });
  });

  it("rejects with a ReplyError for an error reply", async () => {
    const { sender } = sender_of(() =>
      reply("", [
        [ERROR_HEADERS.description, ["Not Found"]],
        [ERROR_HEADERS.code, ["404"]],
      ])
    );
    await assert.rejects(sender.request("ping", {}), (error: ReplyError) => {
      assert.equal(isReplyError(error, 404), true);
      assert.equal(error.description, "Not Found");
      return true;
    });
  });

  it("rejects with 500, or Error, for what an error reply does not say", async () => {
    for (
      const [headers, code, description] of [
        [[[ERROR_HEADERS.description, ["Broken"]]], 500, "Broken"],
        [[[ERROR_HEADERS.code, ["409"]]], 409, "Error"],
        [
          [[ERROR_HEADERS.code, ["nope"]], [ERROR_HEADERS.description, [" "]]],
          500,
          "Error",
        ],
      ] as [[string, string[]][], number, string][]
    ) {
      const { sender } = sender_of(() => reply("", headers));
      await assert.rejects(sender.request("ping", {}), (error: ReplyError) => {
        assert.equal(isReplyError(error, code), true);
        assert.equal(error.description, description);
        return true;
      });
    }
  });

  it("rejects with CHO_MESSAGE_NO_RESPONDERS when nobody listens", async () => {
    for (
      const cause of [
        named("NoResponders"),
        named("RequestError", named("NoResponders")),
        named("NoRespondersError"),
      ]
    ) {
      const { sender } = sender_of(() => Promise.reject(cause));
      await assert.rejects(sender.request("shop.ping", {}), {
        code: "CHO_MESSAGE_NO_RESPONDERS",
        message:
          'No answer to the request of "shop.ping": nobody listens to it',
        cause,
      });
    }
  });

  it("rejects with CHO_MESSAGE_REQUEST_TIMEOUT when no reply came in time", async () => {
    for (
      const cause of [
        named("TimeoutError"),
        named("RequestError", named("TimeoutError")),
      ]
    ) {
      const { sender } = sender_of(() => Promise.reject(cause));
      await assert.rejects(sender.request("shop.ping", {}), {
        code: "CHO_MESSAGE_REQUEST_TIMEOUT",
        cause,
      });
    }
  });

  it("rejects with any other error of the client, as it is", async () => {
    const cause = named("RequestError", new Error("connection closed"));
    const { sender } = sender_of(() => Promise.reject(cause));
    await assert.rejects(sender.request("ping", {}), cause);
  });
});
