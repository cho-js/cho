/**
 * Sending with Kafka: the `Sender` of `@chojs/vendor-kafka`, which a
 * `ChoMessageClient` is built on. It publishes with the producer of the
 * adapter. Kafka has no replies: this sender has no `request`.
 *
 * @module
 */

import { Buffer } from "node:buffer";
import type { Delivery, Sender } from "@chojs/message/linker";
import type { KafkaMessageToProduce, KafkaProducerLike } from "./consume.ts";

/** A message to send to Kafka: the delivery, as the bytes Kafka takes. */
export function to_message(
  topic: string,
  delivery: Delivery,
): KafkaMessageToProduce {
  const { value, key, headers } = delivery;
  const entries = Object.entries(headers ?? {});
  return {
    topic,
    ...(key === undefined ? {} : { key: Buffer.from(key) }),
    ...(value === undefined || value === null
      ? {}
      : { value: Buffer.from(value as Uint8Array) }),
    ...(entries.length === 0 ? {} : {
      headers: new Map(
        entries.map(([name, text]) => [Buffer.from(name), Buffer.from(text)]),
      ),
    }),
  };
}

/**
 * The sender of the Kafka adapter.
 *
 * `publish` sends a message with the producer of the adapter: its value, its
 * key and its headers. A message with no value is sent with none.
 *
 * There is no `request`: Kafka has no replies, and
 * `ChoMessageClient.request` throws `CHO_MESSAGE_NO_REPLIES` on this sender.
 */
export class KafkaSender implements Sender {
  readonly #producer: () => KafkaProducerLike;

  /**
   * @param producer Gives the producer of the adapter, once it is made.
   */
  constructor(producer: () => KafkaProducerLike) {
    this.#producer = producer;
  }

  /**
   * Send a message.
   *
   * @param topic The topic.
   * @param delivery The message.
   * @returns A promise that resolves when Kafka has the message.
   */
  async publish(topic: string, delivery: Delivery): Promise<void> {
    await this.#producer().send({ messages: [to_message(topic, delivery)] });
  }
}
