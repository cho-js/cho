/**
 * What `@chojs/vendor-nats` does with the messages of a JetStream stream: it
 * makes a durable consumer for each route whose subject is of a stream,
 * gives each message to its route, and acknowledges it.
 *
 * This file knows the JetStream client through small interfaces
 * ({@link JetStreamClientLike} and the ones it refers to), so that the tests
 * run it without a server.
 *
 * @module
 */

import { isChoError } from "@chojs/core";
import { headers as make_headers } from "@nats-io/nats-core";
import type { MsgHdrs } from "@nats-io/nats-core";
import type { JsMsg } from "@nats-io/jetstream";
import type { Debuglog } from "@chojs/core/utils";
import type { Delivery, Route } from "@chojs/message/linker";
import { nats_error } from "./errors.ts";

/** A message of a stream, as the JetStream client gives it. */
export type NatsStreamMessage = JsMsg;

/** What the adapter needs of a message of a stream. */
export interface JetStreamMessageLike {
  /** The subject the message was published to. */
  readonly subject: string;
  /** The payload. */
  readonly data: Uint8Array;
  /** The headers: each name, with its values. */
  readonly headers?: Iterable<[string, string[]]> | undefined;
  /** The sequence of the message in its stream. */
  readonly seq: number;
  /** Where the message comes from, and how many times it was delivered. */
  readonly info: { readonly deliveryCount: number };
  /** The message is handled: it is not delivered again. */
  ack(): void;
  /** The message failed: deliver it again, after `millis`. */
  nak(millis?: number): void;
  /** The message is given up: it is not delivered again. */
  term(reason?: string): void;
}

/** The messages of a consumer, in the order they are delivered. */
export interface JetStreamMessagesLike
  extends AsyncIterable<JetStreamMessageLike> {
  /** Ask for no more messages. The iteration ends. */
  close(): Promise<void | Error>;
}

/** What the adapter needs of a consumer of the JetStream client. */
export interface JetStreamConsumerLike {
  /** Ask for the messages of the consumer, as they come. */
  consume(options?: { max_messages?: number }): Promise<JetStreamMessagesLike>;
}

/** What the adapter needs of the manager of the JetStream client. */
export interface JetStreamManagerLike {
  /** The streams of the server. */
  readonly streams: {
    /** What a stream is: its subjects. It rejects when there is none. */
    info(stream: string): Promise<{ config: { subjects?: string[] } }>;
  };
  /** The consumers of the server. */
  readonly consumers: {
    /** Make a consumer, or change the one of that name. */
    add(stream: string, config: ConsumerSettings): Promise<unknown>;
  };
}

/** What the adapter needs of the JetStream client. */
export interface JetStreamClientLike {
  /** The consumers of the client. */
  readonly consumers: {
    /** A consumer, by its stream and its name. */
    get(stream: string, name: string): Promise<JetStreamConsumerLike>;
  };
  /** Publish a message, and wait until a stream has it. */
  publish(
    subject: string,
    data?: Uint8Array,
    options?: { headers?: MsgHdrs },
  ): Promise<unknown>;
  /** The manager: what makes consumers, and tells of streams. */
  jetstreamManager(): Promise<JetStreamManagerLike>;
}

/** The consumer the adapter makes for a route. */
export type ConsumerSettings = {
  /** The name of the consumer: it is durable. */
  durable_name: string;
  /** Each message is acknowledged by itself. */
  ack_policy: "explicit";
  /** The subject of the route. */
  filter_subject: string;
  /** How long a handler has, in nanoseconds. */
  ack_wait: number;
  /** No limit: the adapter counts the deliveries itself. */
  max_deliver: -1;
  /** How many messages are not acknowledged yet at once. */
  max_ack_pending: number;
};

/** The settings of a {@link StreamReader}: the options, with defaults. */
export type StreamSettings = {
  /** Makes the JetStream client of a connection. */
  readonly client: (connection: never) => JetStreamClientLike;
  /** The streams of the application. */
  readonly streams: readonly string[];
  /** The queue group of the application: the start of each consumer name. */
  readonly queue: string;
  /** How many messages of one subject are in hand at once. */
  readonly concurrency: number;
  /** How many times a failed message is delivered again. */
  readonly retries: number;
  /** The milliseconds before the given retry (1 is the first). */
  readonly retryDelay: (retry: number) => number;
  /** The dead-letter subject of a topic; `undefined`: there is none. */
  readonly deadLetter: ((topic: string) => string) | undefined;
  /** The milliseconds a handler has before its message is delivered again. */
  readonly ackWait: number;
  /** The `cho:nats` debug logger. */
  readonly log: Debuglog;
};

/** What a handler finds in `ctx.native` for a message of a stream. */
export type NatsStreamNative = {
  /** The message of the JetStream client: `seq`, `info`, `headers`, … */
  readonly message: NatsStreamMessage;
  /** `1` the first time the message is handled, `2` on its first retry, … */
  readonly attempt: number;
};

/** The headers the adapter adds to a dead letter. */
export const DEAD_LETTER_HEADERS = {
  topic: "cho-topic",
  stream: "cho-stream",
  sequence: "cho-sequence",
  consumer: "cho-consumer",
  attempts: "cho-attempts",
  error: "cho-error",
} as const;

/**
 * Whether a subject is one a stream holds: whether it matches a subject of
 * the stream, which can have the wildcards of NATS (`*` is one token, `>` is
 * every token that is left, and at least one).
 *
 * @param pattern A subject of a stream: `orders.>`, `orders.*.created`.
 * @param subject A subject with no wildcard: the topic of a route.
 * @returns `true` when the pattern matches the subject.
 */
export function subject_matches(pattern: string, subject: string): boolean {
  const wanted = pattern.split(".");
  const given = subject.split(".");
  for (let i = 0; i < wanted.length; i++) {
    if (wanted[i] === ">") {
      return i === wanted.length - 1 && given.length > i;
    }
    if (i >= given.length || (wanted[i] !== "*" && wanted[i] !== given[i])) {
      return false;
    }
  }
  return wanted.length === given.length;
}

/**
 * The name of the consumer of a route: the queue group and the topic, with
 * what a consumer name cannot have (`.`, `*`, `>`, `/`, `\`) as `_`.
 *
 * @param queue The queue group of the application.
 * @param topic The topic of the route.
 * @returns The name: `shop_orders_created` for `shop` and `orders.created`.
 */
export function consumer_name(queue: string, topic: string): string {
  return `${queue}_${topic}`.replace(/[.*>/\\]/g, "_");
}

/** A message of a stream as the plain data `@chojs/message` handles. */
export function to_stream_delivery(message: JetStreamMessageLike): Delivery {
  const headers: Record<string, string> = {};
  for (const [name, values] of message.headers ?? []) {
    headers[name] = values[0] ?? "";
  }
  return { value: message.data, headers };
}

/** Whether a value is a JetStream client the adapter can use. */
function is_client(value: unknown): value is JetStreamClientLike {
  const client = value as JetStreamClientLike | null;
  return typeof client === "object" && client !== null &&
    typeof client.publish === "function" &&
    typeof client.jetstreamManager === "function" &&
    typeof client.consumers?.get === "function";
}

/** A route of a stream, with what reads it. */
type Reading = {
  readonly route: Route;
  readonly stream: string;
  readonly consumer: string;
  messages?: JetStreamMessagesLike;
  done?: Promise<void>;
};

/**
 * Reads the routes whose subject is of a stream.
 *
 * - Each such route has one durable consumer, made when it is missing, and
 *   named after the queue group and the topic.
 * - A message that was handled is acknowledged.
 * - A message that failed is delivered again after `retryDelay`, `retries`
 *   times. While it waits it still counts as one in hand: with a concurrency
 *   of 1 it holds its route, and the order of the route is kept. Then it is
 *   published to its dead-letter subject and ended. With no dead-letter
 *   subject it is ended, and logged: it stays in the stream.
 * - A message that is not valid (`CHO_MESSAGE_INVALID_MESSAGE`) is not
 *   delivered again: it is dead at once.
 * - What a handler returns is dropped: a message of a stream has nobody to
 *   answer.
 */
export class StreamReader {
  readonly #settings: StreamSettings;
  /** Stops the adapter for an error: the one of the pump. */
  readonly #fail: (error: Error) => void;
  /** Whether the adapter stops, or has stopped. */
  readonly #stopping: () => boolean;
  readonly #readings: Reading[] = [];
  /** The routes whose reply was dropped, and said so. */
  readonly #dropped = new WeakSet<Route>();
  #client: JetStreamClientLike | undefined;

  constructor(
    settings: StreamSettings,
    fail: (error: Error) => void,
    stopping: () => boolean,
  ) {
    this.#settings = settings;
    this.#fail = fail;
    this.#stopping = stopping;
  }

  /**
   * Look the streams up, make a consumer for each route of a stream, and
   * start reading them.
   *
   * @param connection The connection of the application.
   * @param routes The routes of the application.
   * @returns The routes that are of a stream: the others are for a core
   *   subscription.
   * @throws {ChoError} (as a rejection) When `client` gives no JetStream
   *   client, when a stream does not exist, or when a consumer cannot be
   *   made.
   */
  async start(
    connection: unknown,
    routes: readonly Route[],
  ): Promise<Set<Route>> {
    const { log, streams, queue, concurrency, ackWait } = this.#settings;
    const client = this.#settings.client(connection as never);
    if (!is_client(client)) {
      throw nats_error(
        "CHO_NATS_INVALID_JETSTREAM",
        'NatsLinker: the "client" option of "jetstream" did not give a JetStream client: return what jetstream(connection) of @nats-io/jetstream gives',
      );
    }
    this.#client = client;
    let manager: JetStreamManagerLike;
    try {
      manager = await client.jetstreamManager();
    } catch (cause) {
      throw nats_error(
        "CHO_NATS_STREAM_NOT_FOUND",
        "NatsLinker: JetStream cannot be reached: is it enabled on the server?",
        { cause },
      );
    }

    // The subjects of each stream, in the order of the option: the first
    // stream that holds a topic has its route.
    const held: [string, string[]][] = [];
    for (const stream of streams) {
      try {
        const info = await manager.streams.info(stream);
        held.push([stream, info.config.subjects ?? []]);
      } catch (cause) {
        throw nats_error(
          "CHO_NATS_STREAM_NOT_FOUND",
          `NatsLinker: the stream "${stream}" cannot be read: create it before the application starts, the adapter does not`,
          { cause },
        );
      }
    }

    const of_a_stream = new Set<Route>();
    const names = new Map<string, Route>();
    for (const route of routes) {
      const stream = held.find(([, subjects]) =>
        subjects.some((subject) => subject_matches(subject, route.topic))
      )?.[0];
      if (stream === undefined) {
        continue;
      }
      of_a_stream.add(route);
      const consumer = consumer_name(queue, route.topic);
      const same = names.get(consumer);
      if (same) {
        await this.stop();
        throw nats_error(
          "CHO_NATS_DUPLICATE_CONSUMER",
          `NatsLinker: the topics "${same.topic}" and "${route.topic}" have the same consumer name, "${consumer}": a "." of a topic is a "_" of the name. Rename one of them`,
        );
      }
      names.set(consumer, route);
      const settings: ConsumerSettings = {
        durable_name: consumer,
        ack_policy: "explicit",
        filter_subject: route.topic,
        ack_wait: ackWait * 1_000_000,
        max_deliver: -1,
        max_ack_pending: concurrency,
      };
      const reading: Reading = { route, stream, consumer };
      this.#readings.push(reading);
      try {
        log(
          "consuming",
          route.topic,
          "of the stream",
          stream,
          "as",
          consumer,
        );
        await manager.consumers.add(stream, settings);
        reading.messages = await (await client.consumers.get(stream, consumer))
          .consume({ max_messages: concurrency });
      } catch (cause) {
        // What was asked for is given back: nothing was read yet.
        await this.stop();
        throw nats_error(
          "CHO_NATS_CONSUMER_FAILED",
          `NatsLinker: cannot make the consumer "${consumer}" of ${route.name}, on "${route.topic}" of the stream "${stream}"`,
          { cause },
        );
      }
    }
    for (const [stream, subjects] of held) {
      if (!this.#readings.some((reading) => reading.stream === stream)) {
        log(
          `the stream "${stream}" holds no topic of the application:`,
          subjects,
        );
      }
    }
    // Reading starts once every consumer is made: a start that fails has
    // handled nothing.
    for (const reading of this.#readings) {
      reading.done = this.#read(reading, reading.messages!);
    }
    return of_a_stream;
  }

  /**
   * Ask for no more messages, and wait for the ones in hand. A message that
   * was received and not handled yet is not acknowledged: JetStream delivers
   * it again.
   */
  async stop(): Promise<void> {
    await Promise.all(this.#readings.map(async (reading) => {
      try {
        await reading.messages?.close();
      } catch (error) {
        this.#settings.log.error(
          `cannot close the consumer "${reading.consumer}":`,
          error,
        );
      }
    }));
    await Promise.all(this.#readings.map((reading) => reading.done));
  }

  /** Read the messages of a consumer to their end. */
  async #read(
    reading: Reading,
    messages: JetStreamMessagesLike,
  ): Promise<void> {
    const { concurrency } = this.#settings;
    const { route } = reading;
    const active = new Set<Promise<void>>();
    let failure: unknown;
    let failed = false;
    try {
      for await (const message of messages) {
        if (this.#stopping()) {
          break; // not acknowledged: delivered again
        }
        const done = this.#handle(reading, message).then(() => {
          active.delete(done);
        });
        active.add(done);
        if (active.size >= concurrency) {
          await Promise.race(active);
        }
      }
    } catch (error) {
      failure = error;
      failed = true;
    }
    await Promise.all(active);
    if (this.#stopping()) {
      return;
    }
    this.#fail(
      nats_error(
        "CHO_NATS_SUBSCRIPTION_FAILED",
        `NatsLinker: the consumer "${reading.consumer}" of ${route.name}, on "${route.topic}" of the stream "${reading.stream}", ${
          failed ? "failed" : "ended"
        }: the application stopped`,
        failed ? { cause: failure } : undefined,
      ),
    );
  }

  /** Handle one message, and settle it. It never rejects. */
  async #handle(
    reading: Reading,
    message: JetStreamMessageLike,
  ): Promise<void> {
    const { log, retries, retryDelay, deadLetter } = this.#settings;
    const { route } = reading;
    const attempt = message.info.deliveryCount;
    const where = `${route.topic}@${message.seq}`;
    try {
      const reply = await route.handle(
        to_stream_delivery(message),
        { message, attempt } as NatsStreamNative,
      );
      if (reply && !this.#dropped.has(route)) {
        // Said once for a route, not for each message.
        this.#dropped.add(route);
        log(
          route.name,
          "returned a reply for a message of a stream: it has nobody to answer, and is dropped",
        );
      }
      message.ack();
    } catch (error) {
      // A message that is not valid will not be the next time either.
      const invalid = isChoError(error, "CHO_MESSAGE_INVALID_MESSAGE");
      if (!invalid && attempt <= retries) {
        log.error(
          `${route.name} failed for ${where}`,
          `(attempt ${attempt} of ${retries + 1}):`,
          error,
        );
        message.nak(retryDelay(attempt));
        return;
      }
      if (!deadLetter) {
        log.error(
          `${route.name} failed for ${where} after ${attempt} attempt(s),`,
          'and there is no dead-letter subject: the message is ended, and stays in the stream. Set the "deadLetter" option to keep such messages apart:',
          error,
        );
        message.term(`failed after ${attempt} attempt(s)`);
        return;
      }
      const subject = deadLetter(route.topic);
      try {
        await this.#client!.publish(subject, message.data, {
          headers: to_dead_letter_headers(message, reading, attempt, error),
        });
      } catch (cause) {
        // Not ended: the message is kept, and the dead letter tried again.
        log.error(
          nats_error(
            "CHO_NATS_DEAD_LETTER_FAILED",
            `NatsLinker: cannot send ${where} to the dead-letter subject "${subject}": is it a subject of a stream? The message is delivered again`,
            { cause },
          ),
        );
        message.nak(retryDelay(Math.max(attempt, 1)));
        return;
      }
      log.error(
        `${route.name} failed for ${where}:`,
        `sent to "${subject}" after ${attempt} attempt(s):`,
        error,
      );
      message.term(`sent to ${subject} after ${attempt} attempt(s)`);
    }
  }
}

/** The headers of a dead letter: those of the message, and where it comes from. */
function to_dead_letter_headers(
  message: JetStreamMessageLike,
  reading: Reading,
  attempts: number,
  error: unknown,
): MsgHdrs {
  const headers = make_headers();
  for (const [name, values] of message.headers ?? []) {
    for (const text of values) {
      headers.append(name, text);
    }
  }
  const reason = error instanceof Error ? error.message : String(error);
  for (
    const [name, text] of [
      [DEAD_LETTER_HEADERS.topic, reading.route.topic],
      [DEAD_LETTER_HEADERS.stream, reading.stream],
      [DEAD_LETTER_HEADERS.sequence, String(message.seq)],
      [DEAD_LETTER_HEADERS.consumer, reading.consumer],
      [DEAD_LETTER_HEADERS.attempts, String(attempts)],
      // A header is one line.
      [DEAD_LETTER_HEADERS.error, reason.replace(/[\r\n]+/g, " ")],
    ] as const
  ) {
    headers.set(name, text);
  }
  return headers;
}
