/**
 * Tests for `send.ts`: the sender of the Kafka adapter publishes with a
 * producer, and has no request.
 *
 * A fake producer stands for the client library: these tests need no broker,
 * and run on every runtime.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { ChoMessageClient, contract } from "@chojs/message";
import type { KafkaMessageToProduce, KafkaProducerLike } from "./consume.ts";
import { KafkaSender, to_message } from "./send.ts";

/** A producer that keeps what it is asked to send. */
function producer_of(send_error?: Error) {
  const sent: KafkaMessageToProduce[] = [];
  const producer: KafkaProducerLike = {
    send(options) {
      if (send_error) {
        return Promise.reject(send_error);
      }
      sent.push(...options.messages);
      return Promise.resolve();
    },
    close: () => Promise.resolve(),
  };
  return { producer, sent };
}

/** The headers of a message to produce, as an object of strings. */
const headers_of = (message: KafkaMessageToProduce) =>
  Object.fromEntries(
    [...(message.headers as Map<Buffer, Buffer> | undefined ?? [])].map(
      ([name, value]) => [String(name), String(value)],
    ),
  );

describe("to_message", () => {
  it("gives the value, the key and the headers as bytes", () => {
    const message = to_message("orders", {
      value: '{"id":7}',
      key: "k7",
      headers: { tenant: "acme" },
    });
    assert.equal(message.topic, "orders");
    assert.deepEqual(message.value, Buffer.from('{"id":7}'));
    assert.deepEqual(message.key, Buffer.from("k7"));
    assert.deepEqual(headers_of(message), { tenant: "acme" });
  });

  it("keeps bytes as they are", () => {
    const message = to_message("orders", {
      value: new Uint8Array([0, 1, 254, 255]),
    });
    assert.deepEqual([...message.value as Buffer], [0, 1, 254, 255]);
  });

  it("has no value, no key and no headers when the message has none", () => {
    for (const delivery of [{}, { value: null }, { headers: {} }]) {
      assert.deepEqual(to_message("orders", delivery), { topic: "orders" });
    }
  });
});

describe("KafkaSender", () => {
  it("sends a message with the producer", async () => {
    const { producer, sent } = producer_of();
    const sender = new KafkaSender(() => producer);
    await sender.publish("shop.orders.created", { value: "x", key: "k" });
    assert.equal(sent.length, 1);
    assert.equal(sent[0]!.topic, "shop.orders.created");
    assert.deepEqual(sent[0]!.value, Buffer.from("x"));
    assert.deepEqual(sent[0]!.key, Buffer.from("k"));
  });

  it("rejects with the error of the producer, and of a producer that is not there", async () => {
    const boom = new Error("no broker");
    await assert.rejects(
      new KafkaSender(() => producer_of(boom).producer).publish("orders", {}),
      boom,
    );
    const missing = new Error("not linked");
    await assert.rejects(
      new KafkaSender(() => {
        throw missing;
      }).publish("orders", {}),
      missing,
    );
  });

  it("has no request: Kafka has no replies", () => {
    const sender = new KafkaSender(() => producer_of().producer);
    assert.equal("request" in sender, false);
  });

  it("is what a ChoMessageClient publishes with, and cannot ask with", async () => {
    const { producer, sent } = producer_of();
    const client = new ChoMessageClient(new KafkaSender(() => producer), {
      prefix: "staging",
    });
    const Created = contract<{ id: number }>({ topic: "shop.orders.created" });
    await client.publish(Created, { id: 7 }, {
      key: "7",
      headers: { tenant: "acme" },
    });
    assert.equal(sent[0]!.topic, "staging.shop.orders.created");
    assert.deepEqual(sent[0]!.value, Buffer.from('{"id":7}'));
    assert.deepEqual(sent[0]!.key, Buffer.from("7"));
    assert.deepEqual(headers_of(sent[0]!), { tenant: "acme" });
    await assert.rejects(client.request(Created, { id: 7 }), {
      code: "CHO_MESSAGE_NO_REPLIES",
    });
  });
});
