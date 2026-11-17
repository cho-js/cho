/**
 * @chojs/vendor-kafka — runs CHO message applications on Apache Kafka, on
 * Node.js.
 *
 * {@link KafkaLinker} subscribes the topics of a `@chojs/message` application
 * to Kafka, as one consumer group. Pass it to `ChoMessage.create` as `linker`,
 * and start the application.
 *
 * The client library is
 * [`@platformatic/kafka`](https://github.com/platformatic/kafka), which runs
 * on Node.js only: so does this adapter.
 *
 * @example
 * ```ts
 * import { ChoMessage } from "@chojs/message";
 * import { KafkaLinker } from "@chojs/vendor-kafka";
 *
 * const app = await ChoMessage.create(AppModule, {
 *   linker: new KafkaLinker({
 *     brokers: ["localhost:9092"],
 *     groupId: "mailer",
 *     deadLetter: (topic) => `${topic}.dead`,
 *   }),
 * });
 * await app.start();
 * ```
 *
 * @module
 */

import type { Buffer } from "node:buffer";
import {
  type BaseOptions,
  type ConsumeOptions,
  Consumer,
  Producer,
} from "@platformatic/kafka";
import { debuglog } from "@chojs/core/utils";
import type { Linked, Linker, Route } from "@chojs/message/linker";
import {
  DEAD_LETTER_HEADERS,
  type KafkaMessage,
  type KafkaNative,
  Pump,
} from "./consume.ts";

// The `@chojs/message` types this module refers to.
export type { Linked, Linker, Route };
export { DEAD_LETTER_HEADERS };
export type { KafkaMessage, KafkaNative };

/** The consumer of the client library, reading bytes. */
export type KafkaConsumer = Consumer<Buffer, Buffer, Buffer, Buffer>;

/** The producer of the client library, writing bytes. */
export type KafkaProducer = Producer<Buffer, Buffer, Buffer, Buffer>;

/**
 * The options of the connection to Kafka, as the client library takes them:
 * `tls`, `sasl`, `connectTimeout`, `retries`, … The brokers and the client id
 * are options of the linker.
 */
export type KafkaClientOptions = Omit<
  BaseOptions,
  "bootstrapBrokers" | "clientId"
>;

/**
 * More options for the consumer, as the client library takes them:
 * `sessionTimeout`, `heartbeatInterval`, `maxBytes`, `maxWaitTime`, … What the
 * adapter decides by itself is left out.
 */
export type KafkaConsumeOptions = Omit<
  ConsumeOptions<Buffer, Buffer, Buffer, Buffer>,
  | "topics"
  | "autocommit"
  | "mode"
  | "fallbackMode"
  | "offsets"
  | "deserializers"
  | "registry"
  | "beforeDeserialization"
>;

/** The options of {@link KafkaLinker}. */
export type KafkaLinkerOptions = {
  /** The brokers to connect first, as `host:port`. At least one. */
  readonly brokers: readonly string[];
  /**
   * The consumer group: the name of the application for Kafka. Every instance
   * of the application has the same one, and shares the partitions with the
   * others.
   */
  readonly groupId: string;
  /** The name of this client, for the logs of the brokers. Default: the group. */
  readonly clientId?: string | undefined;
  /**
   * Where the group starts in a topic it never read: at the `"earliest"`
   * message that Kafka still has, or after the `"latest"`. Default:
   * `"latest"`, as Kafka does.
   */
  readonly from?: "earliest" | "latest" | undefined;
  /**
   * How many times a message that failed is tried again, in place, before it
   * is dead. Default: `3`. `0`: never.
   */
  readonly retries?: number | undefined;
  /**
   * The milliseconds to wait before a retry: a number, or a function of the
   * retry (`1` for the first). Default: `1000`.
   */
  readonly retryDelay?: number | ((retry: number) => number) | undefined;
  /**
   * The topic a dead message is sent to: a name, or a function of the topic
   * of the message. Without it, a dead message stops the consumer.
   */
  readonly deadLetter?: string | ((topic: string) => string) | undefined;
  /**
   * How many messages are in hand at once. The messages of one partition are
   * always handled one at a time, in order. Default: `1`.
   */
  readonly concurrency?: number | undefined;
  /**
   * Called when the consumer stopped by itself: a dead message with no
   * dead-letter topic, or a connection that cannot be restored. Default: the
   * error is thrown, and ends the process when nothing catches it.
   */
  readonly onFatal?: ((error: Error) => void) | undefined;
  /** The options of the connection: `tls`, `sasl`, … */
  readonly client?: KafkaClientOptions | undefined;
  /** More options for the consumer: `sessionTimeout`, `maxBytes`, … */
  readonly consume?: KafkaConsumeOptions | undefined;
};

/** The names of the options, for the error of an unknown one. */
const OPTIONS = [
  "brokers",
  "client",
  "clientId",
  "concurrency",
  "consume",
  "deadLetter",
  "from",
  "groupId",
  "onFatal",
  "retries",
  "retryDelay",
] as const satisfies readonly (keyof KafkaLinkerOptions)[];

/** The longest name Kafka accepts for a topic. */
const TOPIC_MAX_LENGTH = 249;

/** What {@link KafkaLinker} links: the clients of the application. */
export type KafkaClient = {
  /** The consumer of the application. It connects on `start()`. */
  readonly consumer: KafkaConsumer;
  /**
   * The producer the adapter sends the dead letters with. It connects on its
   * first message: the application can send its own messages with it.
   */
  readonly producer: KafkaProducer;
};

/** An error of the options, with the name of the class. */
function invalid(message: string): TypeError {
  return new TypeError(`KafkaLinker: ${message}`);
}

/** Check the options, and throw for the first that is wrong. */
function assert_options(options: KafkaLinkerOptions): void {
  if (typeof options !== "object" || options === null) {
    throw invalid(
      'expected options, such as { brokers: ["localhost:9092"], groupId: "my-app" }',
    );
  }
  for (const name of Object.keys(options)) {
    if (!(OPTIONS as readonly string[]).includes(name)) {
      throw invalid(
        `unknown option "${name}". Known options: ${OPTIONS.join(", ")}`,
      );
    }
  }
  const { brokers, groupId, from, retries, retryDelay, concurrency } = options;
  if (
    !Array.isArray(brokers) || brokers.length === 0 ||
    brokers.some((broker) => typeof broker !== "string" || broker === "")
  ) {
    throw invalid(
      'the "brokers" option is required: a list of "host:port", such as ["localhost:9092"]',
    );
  }
  if (typeof groupId !== "string" || groupId === "") {
    throw invalid(
      'the "groupId" option is required: the consumer group of the application, such as "mailer"',
    );
  }
  if (from !== undefined && from !== "earliest" && from !== "latest") {
    throw invalid(`the "from" option is "earliest" or "latest", got "${from}"`);
  }
  if (retries !== undefined && !(Number.isInteger(retries) && retries >= 0)) {
    throw invalid(`the "retries" option is 0 or more, got ${retries}`);
  }
  if (
    concurrency !== undefined &&
    !(Number.isInteger(concurrency) && concurrency >= 1)
  ) {
    throw invalid(`the "concurrency" option is 1 or more, got ${concurrency}`);
  }
  if (
    retryDelay !== undefined && typeof retryDelay !== "function" &&
    !(typeof retryDelay === "number" && retryDelay >= 0)
  ) {
    throw invalid(
      `the "retryDelay" option is a number of milliseconds or a function, got ${retryDelay}`,
    );
  }
  for (const name of ["deadLetter", "onFatal"] as const) {
    const value = options[name];
    const ok = value === undefined || typeof value === "function" ||
      (name === "deadLetter" && typeof value === "string" && value !== "");
    if (!ok) {
      throw invalid(
        name === "deadLetter"
          ? 'the "deadLetter" option is a topic or a function of the topic'
          : 'the "onFatal" option is a function',
      );
    }
  }
}

/**
 * A message application linked to Kafka by {@link KafkaLinker}.
 *
 * `ChoMessage` starts and stops it: `app.start()` and `app.close()`.
 */
export class KafkaLinked implements Linked<KafkaClient> {
  /** The consumer and the producer of the application. */
  readonly instance: KafkaClient;
  readonly #pump: Pump;
  #started: Promise<void> | undefined;

  /**
   * Wrap the clients of an application. {@link KafkaLinker.link} calls it.
   *
   * @param instance The consumer and the producer.
   * @param pump What reads the messages.
   */
  constructor(instance: KafkaClient, pump: Pump) {
    this.instance = instance;
    this.#pump = pump;
  }

  /**
   * Connect, join the consumer group and subscribe to the topic of each
   * route. It resolves when the group is joined.
   *
   * @returns A promise that rejects when Kafka cannot be reached.
   */
  start(): Promise<void> {
    return this.#started ??= this.#pump.start();
  }

  /**
   * Stop reading, wait for the messages in hand, leave the group and
   * disconnect. A message that did not finish is not committed: Kafka
   * delivers it again.
   *
   * @returns A promise that rejects when a client fails to close.
   */
  stop(): Promise<void> {
    return this.#pump.stop();
  }
}

/**
 * Subscribes the topics of a CHO message application to Apache Kafka. The
 * client library runs on Node.js: so does this adapter.
 *
 * Kafka only delivers: each message goes to `Route.handle`, which
 * `@chojs/message` built. Middlewares and error handlers are
 * `@chojs/message`'s, so they behave the same on every adapter.
 *
 * - **The application is one consumer group** (`groupId`). Every topic of the
 *   application is read by this group. A topic is named in Kafka as it is in
 *   the application (`shop.orders.created`).
 * - **A message that was handled is committed.** Delivery is at least once: a
 *   message can be handled twice, after a crash or a rebalance.
 * - **A message that failed is tried again, in place**: `retries` times (3),
 *   `retryDelay` milliseconds apart (1000). Kafka cannot refuse one message,
 *   so the partition waits meanwhile. Then the message is dead: it is sent to
 *   the `deadLetter` topic with the headers {@link DEAD_LETTER_HEADERS}, and
 *   committed. Without `deadLetter`, the consumer stops, the offset is not
 *   committed, and `onFatal` is called.
 * - **One message at a time for each partition**, in the order of the
 *   partition. `concurrency` (1) is how many messages, of different
 *   partitions, are in hand at once.
 * - **`ctx.native`** is a {@link KafkaNative}: the message of the client
 *   library (`partition`, `offset`, `timestamp`, the bytes of the key and of
 *   the headers), and the number of the attempt.
 * - The topics are not created by the adapter: create them, or let the broker
 *   do it (`auto.create.topics.enable`).
 *
 * @example
 * ```ts
 * import { ChoMessage } from "@chojs/message";
 * import { KafkaLinker } from "@chojs/vendor-kafka";
 *
 * const app = await ChoMessage.create(AppModule, {
 *   linker: new KafkaLinker({ brokers: ["kafka:9092"], groupId: "mailer" }),
 * });
 * await app.start();
 * ```
 *
 * @example Retries, dead letters and TLS
 * ```ts
 * new KafkaLinker({
 *   brokers: ["kafka:9093"],
 *   groupId: "mailer",
 *   retries: 5,
 *   retryDelay: (retry) => 500 * 2 ** retry,
 *   deadLetter: (topic) => `${topic}.dead`,
 *   concurrency: 8,
 *   client: {
 *     tls: {},
 *     sasl: { mechanism: "SCRAM-SHA-512", username, password },
 *   },
 * });
 * ```
 */
export class KafkaLinker implements Linker<KafkaClient> {
  readonly #options: KafkaLinkerOptions;
  /** Whether {@link link} was called: a linker serves one application. */
  #linked = false;

  /**
   * Create a linker. Nothing is connected yet.
   *
   * @param options The brokers, the consumer group, and what a failed
   *   message leads to.
   * @throws {TypeError} When an option is missing, unknown or wrong.
   */
  constructor(options: KafkaLinkerOptions) {
    assert_options(options);
    this.#options = options;
  }

  /**
   * Prepare the consumer of the routes. It connects nothing: `start()` of
   * the linked application does.
   *
   * @param routes The routes of the application.
   * @returns The linked application.
   * @throws {Error} When the linker was already used, or when a topic is not
   *   one Kafka accepts.
   */
  link(routes: readonly Route[]): KafkaLinked {
    if (this.#linked) {
      throw new Error(
        "KafkaLinker.link() was already called: use one linker for one application",
      );
    }
    const options = this.#options;
    const dead_letter = options.deadLetter;
    const deadLetter = typeof dead_letter === "string"
      ? () => dead_letter
      : dead_letter;
    for (const route of routes) {
      // The syntax of a CHO topic is a syntax of Kafka: only its length is not.
      if (route.topic.length > TOPIC_MAX_LENGTH) {
        throw new Error(
          `KafkaLinker: the topic of ${route.name} has ${route.topic.length} characters: Kafka accepts ${TOPIC_MAX_LENGTH} ("${route.topic}")`,
        );
      }
      if (deadLetter?.(route.topic) === route.topic) {
        throw new Error(
          `KafkaLinker: the dead-letter topic of "${route.topic}" is "${route.topic}" itself: a dead message would be handled again, for ever`,
        );
      }
    }
    this.#linked = true;

    const base = {
      ...options.client,
      clientId: options.clientId ?? options.groupId,
      bootstrapBrokers: [...options.brokers],
    };
    const instance: KafkaClient = {
      consumer: new Consumer({ ...base, groupId: options.groupId }),
      producer: new Producer(base),
    };
    const retry_delay = options.retryDelay ?? 1000;
    const pump = new Pump(routes, instance.consumer, instance.producer, {
      groupId: options.groupId,
      from: options.from ?? "latest",
      retries: options.retries ?? 3,
      retryDelay: typeof retry_delay === "function"
        ? retry_delay
        : () => retry_delay,
      deadLetter,
      concurrency: options.concurrency ?? 1,
      consume: { ...options.consume },
      onFatal: options.onFatal ?? ((error) => {
        throw error;
      }),
      log: debuglog("cho:kafka"),
    });
    return new KafkaLinked(instance, pump);
  }
}
