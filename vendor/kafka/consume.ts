/**
 * What `@chojs/vendor-kafka` does with the messages of Kafka: it reads them,
 * gives each one to the route of its topic, and commits its offset once the
 * message is settled.
 *
 * This file knows the client library through three small interfaces
 * ({@link KafkaConsumerLike}, {@link KafkaStreamLike} and
 * {@link KafkaProducerLike}), so that the tests run it without a broker.
 *
 * @module
 */

import { kafka_error } from "./errors.ts";
import { Buffer } from "node:buffer";
import type { Message, MessageToProduce } from "@platformatic/kafka";
import type { Debuglog } from "@chojs/core/utils";
import type { Delivery, Route } from "@chojs/message/linker";

/** A message of Kafka, as the client library gives it: bytes, not decoded. */
export type KafkaMessage = Message<Buffer, Buffer, Buffer, Buffer>;

/** A message to send to Kafka: the adapter sends the dead letters. */
export type KafkaMessageToProduce = MessageToProduce<
  Buffer,
  Buffer,
  Buffer,
  Buffer
>;

/** The messages of the subscribed topics, in the order they are read. */
export interface KafkaStreamLike extends AsyncIterable<KafkaMessage> {
  /** Stop reading. The iteration ends. */
  close(): Promise<void>;
}

/** What the adapter needs of the consumer of the client library. */
export interface KafkaConsumerLike {
  /** Join the group, and read the topics. */
  consume(options: KafkaConsumeOptionsLike): Promise<KafkaStreamLike>;
  /** Leave the group, and disconnect. */
  close(force?: boolean): Promise<void>;
}

/** What the adapter needs of the producer of the client library. */
export interface KafkaProducerLike {
  /** Send messages. */
  send(options: { messages: KafkaMessageToProduce[] }): Promise<unknown>;
  /** Disconnect. */
  close(): Promise<void>;
}

/** The options the adapter gives to `consume`. */
export type KafkaConsumeOptionsLike = {
  topics: string[];
  autocommit: false;
  mode: "committed";
  fallbackMode: "earliest" | "latest";
  [option: string]: unknown;
};

/** The settings of a {@link Pump}: the options of the linker, with defaults. */
export type PumpSettings = {
  /** The consumer group, for the headers of a dead letter. */
  readonly groupId: string;
  /** Where a group that has no committed offset starts. */
  readonly from: "earliest" | "latest";
  /** How many times a failed message is tried again. */
  readonly retries: number;
  /** The milliseconds to wait before the given retry (1 is the first). */
  readonly retryDelay: (retry: number) => number;
  /** The dead-letter topic of a topic; `undefined`: there is none. */
  readonly deadLetter: ((topic: string) => string) | undefined;
  /** How many messages are in hand at once. */
  readonly concurrency: number;
  /** More options for `consume`. */
  readonly consume: Readonly<Record<string, unknown>>;
  /** Called once, when the adapter stops by itself. */
  readonly onFatal: (error: Error) => void;
  /** The `cho:kafka` debug logger. */
  readonly log: Debuglog;
};

/** What a handler finds in `ctx.native` on this adapter. */
export type KafkaNative = {
  /** The message of the client library: partition, offset, timestamp, … */
  readonly message: KafkaMessage;
  /** `1` the first time the message is handled, `2` on its first retry, … */
  readonly attempt: number;
};

/** The headers the adapter adds to a dead letter. */
export const DEAD_LETTER_HEADERS = {
  topic: "cho-topic",
  partition: "cho-partition",
  offset: "cho-offset",
  group: "cho-group",
  attempts: "cho-attempts",
  error: "cho-error",
} as const;

const decoder = new TextDecoder();

/**
 * A Kafka message as the plain data `@chojs/message` handles.
 *
 * A key and headers that are not valid UTF-8 are decoded with replacement
 * characters: their bytes are in `ctx.native`. When a header is repeated, the
 * last one wins.
 */
export function to_delivery(message: KafkaMessage): Delivery {
  const headers: Record<string, string> = {};
  for (const [name, value] of message.headerEntries ?? message.headers) {
    if (name) {
      headers[decoder.decode(name)] = value ? decoder.decode(value) : "";
    }
  }
  return {
    value: message.value ?? null,
    ...(message.key ? { key: decoder.decode(message.key) } : {}),
    headers,
  };
}

/** The dead letter of a message: the message, and where it comes from. */
export function to_dead_letter(
  message: KafkaMessage,
  topic: string,
  groupId: string,
  attempts: number,
  error: unknown,
): KafkaMessageToProduce {
  const headers = new Map<Buffer, Buffer>(
    message.headerEntries ?? message.headers,
  );
  const reason = error instanceof Error ? error.message : String(error);
  for (
    const [name, value] of [
      [DEAD_LETTER_HEADERS.topic, message.topic],
      [DEAD_LETTER_HEADERS.partition, String(message.partition)],
      [DEAD_LETTER_HEADERS.offset, String(message.offset)],
      [DEAD_LETTER_HEADERS.group, groupId],
      [DEAD_LETTER_HEADERS.attempts, String(attempts)],
      [DEAD_LETTER_HEADERS.error, reason],
    ] as const
  ) {
    headers.set(Buffer.from(name), Buffer.from(value));
  }
  return {
    topic,
    ...(message.key ? { key: message.key } : {}),
    ...(message.value ? { value: message.value } : {}),
    headers,
  };
}

/** Where a message is, for logs and errors. */
function where(message: KafkaMessage): string {
  return `${message.topic}[${message.partition}]@${message.offset}`;
}

/**
 * Reads the messages of Kafka and gives them to the routes.
 *
 * - The messages of one partition are handled one at a time, in order. Those
 *   of different partitions run together, `concurrency` at once.
 * - A message that was handled is committed.
 * - A message that failed is tried again, in place, `retries` times. Then it
 *   is sent to its dead-letter topic and committed. Without a dead-letter
 *   topic, the pump stops: the offset is not committed, and `onFatal` is
 *   called.
 * - A message that is in hand when the pump stops is not committed if it did
 *   not finish: Kafka delivers it again.
 */
export class Pump {
  readonly #routes: ReadonlyMap<string, Route>;
  readonly #consumer: KafkaConsumerLike;
  readonly #producer: KafkaProducerLike;
  readonly #settings: PumpSettings;

  /** Aborted when the pump stops: it ends the waits between retries. */
  readonly #abort = new AbortController();
  /** The messages in hand. */
  readonly #active = new Set<Promise<void>>();
  /** The last message in hand of each partition: the next one waits for it. */
  readonly #lanes = new Map<string, Promise<void>>();
  /** The routes whose reply was dropped, and said so. */
  readonly #replied = new WeakSet<Route>();
  #stream: KafkaStreamLike | undefined;
  #reading: Promise<void> | undefined;
  #stopped: Promise<void> | undefined;
  #fatal = false;

  constructor(
    routes: readonly Route[],
    consumer: KafkaConsumerLike,
    producer: KafkaProducerLike,
    settings: PumpSettings,
  ) {
    this.#routes = new Map(routes.map((route) => [route.topic, route]));
    this.#consumer = consumer;
    this.#producer = producer;
    this.#settings = settings;
  }

  /** Whether the pump stops, or has stopped. */
  get #stopping(): boolean {
    return this.#abort.signal.aborted;
  }

  /**
   * Join the group, and start reading. It resolves when the consumer has
   * joined: the messages are handled after.
   */
  async start(): Promise<void> {
    if (this.#routes.size === 0) {
      this.#settings.log("no topic to subscribe to: nothing is consumed");
      return;
    }
    this.#stream = await this.#subscribe();
    this.#reading = this.#read(this.#stream);
  }

  /**
   * Stop reading, wait for the messages in hand, and disconnect. It resolves
   * when everything is closed, and never rejects for a message.
   */
  stop(): Promise<void> {
    return this.#stopped ??= this.#stop();
  }

  #subscribe(): Promise<KafkaStreamLike> {
    const topics = [...this.#routes.keys()];
    this.#settings.log("subscribing to", topics);
    return this.#consumer.consume({
      ...this.#settings.consume,
      topics,
      autocommit: false,
      mode: "committed",
      fallbackMode: this.#settings.from,
    });
  }

  async #stop(): Promise<void> {
    const { log } = this.#settings;
    this.#abort.abort();
    const errors: unknown[] = [];
    const attempt = async (step: () => Promise<unknown> | undefined) => {
      try {
        await step();
      } catch (error) {
        errors.push(error);
      }
    };
    await attempt(() => this.#stream?.close());
    await this.#reading;
    await attempt(() => this.#consumer.close(true));
    await attempt(() => this.#producer.close());
    log("stopped");
    if (errors.length > 0 && !this.#fatal) {
      throw errors.length === 1
        ? errors[0]
        : new AggregateError(errors, "KafkaLinker: failed to stop");
    }
  }

  /** Read a stream to its end, then the next one, until the pump stops. */
  async #read(first: KafkaStreamLike): Promise<void> {
    const { log } = this.#settings;
    let stream = first;
    while (true) {
      try {
        for await (const message of stream) {
          if (this.#stopping) {
            break;
          }
          this.#take(message);
          if (this.#active.size >= this.#settings.concurrency) {
            await Promise.race(this.#active);
          }
        }
      } catch (error) {
        // The client ends a stream with an error when the group has to be
        // joined again (a rebalance while committing).
        if (!this.#stopping) {
          log.error("the stream of messages failed:", error);
        }
      }
      // What is in hand finishes before the group is joined again: the
      // partitions may not be ours any more.
      await Promise.all(this.#active);
      if (this.#stopping) {
        return;
      }
      try {
        await this.#sleep(this.#settings.retryDelay(1));
        if (this.#stopping) {
          return;
        }
        this.#stream = stream = await this.#subscribe();
      } catch (error) {
        this.#fail(
          kafka_error(
            "CHO_KAFKA_CONSUME_FAILED",
            "KafkaLinker: cannot read the topics again",
            {
              cause: error,
            },
          ),
        );
        return;
      }
    }
  }

  /** Put a message in hand, after the one of its partition. */
  #take(message: KafkaMessage): void {
    const lane = `${message.topic}/${message.partition}`;
    const done = (this.#lanes.get(lane) ?? Promise.resolve())
      .then(() => this.#handle(message))
      .catch((error) => this.#fail(error))
      .then(() => {
        this.#active.delete(done);
        if (this.#lanes.get(lane) === done) {
          this.#lanes.delete(lane);
        }
      });
    this.#lanes.set(lane, done);
    this.#active.add(done);
  }

  /**
   * Handle one message, to the end: handled, or dead. It rejects when the
   * pump has to stop.
   */
  async #handle(message: KafkaMessage): Promise<void> {
    const { log, retries, retryDelay, deadLetter, groupId } = this.#settings;
    const route = this.#routes.get(message.topic);
    if (!route) {
      // Not a topic of the application: the group read it before.
      log("no route for", where(message), ": skipped");
      return this.#commit(message);
    }
    const delivery = to_delivery(message);
    for (let attempt = 1;; attempt++) {
      if (this.#stopping) {
        return; // not committed: delivered again
      }
      try {
        const reply = await route.handle(
          delivery,
          { message, attempt } as KafkaNative,
        );
        if (reply && !this.#replied.has(route)) {
          // Said once for a route, not for each message.
          this.#replied.add(route);
          log(
            route.name,
            "returned a reply: Kafka has no replies, what a handler returns is dropped",
          );
        }
        return this.#commit(message);
      } catch (error) {
        if (this.#stopping) {
          return;
        }
        if (attempt <= retries) {
          log.error(
            `${route.name} failed for ${where(message)}`,
            `(attempt ${attempt} of ${retries + 1}):`,
            error,
          );
          await this.#sleep(retryDelay(attempt));
          continue;
        }
        if (!deadLetter) {
          throw kafka_error(
            "CHO_KAFKA_NO_DEAD_LETTER",
            `KafkaLinker: ${route.name} failed ${attempt} time(s) for ${
              where(message)
            }, and there is no dead-letter topic: the consumer stopped, and the offset is not committed. Set the "deadLetter" option to go on after such a message`,
            { cause: error },
          );
        }
        const topic = deadLetter(message.topic);
        try {
          await this.#producer.send({
            messages: [
              to_dead_letter(message, topic, groupId, attempt, error),
            ],
          });
        } catch (cause) {
          throw kafka_error(
            "CHO_KAFKA_DEAD_LETTER_FAILED",
            `KafkaLinker: cannot send ${
              where(message)
            } to the dead-letter topic "${topic}": the consumer stopped, and the offset is not committed`,
            { cause },
          );
        }
        log.error(
          `${route.name} failed for ${where(message)}:`,
          `sent to "${topic}" after ${attempt} attempt(s):`,
          error,
        );
        return this.#commit(message);
      }
    }
  }

  /**
   * Commit the offset of a message. A commit that fails is logged, and the
   * consumer goes on: the message may be delivered again (at least once).
   */
  async #commit(message: KafkaMessage): Promise<void> {
    try {
      await message.commit();
    } catch (error) {
      this.#settings.log.error(
        `cannot commit ${where(message)}: it may be delivered again:`,
        error,
      );
    }
  }

  /** Stop the pump for an error, and tell the application. Once. */
  #fail(error: unknown): void {
    if (this.#stopping) {
      return;
    }
    this.#fatal = true;
    this.#abort.abort(); // the other messages in hand are left uncommitted
    const fatal = error instanceof Error ? error : new Error(String(error));
    this.#settings.log.error(fatal);
    // After the messages in hand: `stop()` waits for the reading.
    queueMicrotask(() => {
      this.stop().finally(() => this.#settings.onFatal(fatal));
    });
  }

  /** Wait, unless the pump stops first. */
  #sleep(ms: number): Promise<void> {
    const signal = this.#abort.signal;
    if (signal.aborted || !(ms > 0)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      signal.addEventListener("abort", done);
    });
  }
}
