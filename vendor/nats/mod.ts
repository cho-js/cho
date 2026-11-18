/**
 * @chojs/vendor-nats — runs CHO message applications on NATS, on Deno,
 * Node.js and Bun.
 *
 * {@link NatsLinker} subscribes the topics of a `@chojs/message` application
 * to NATS, as one queue group, and answers the messages that ask for a reply
 * with what their handler returns. Pass it to `ChoMessage.create` as
 * `linker`, and start the application.
 *
 * The client library is [nats.js](https://github.com/nats-io/nats.js). The
 * application gives the connection, made by the transport of its runtime: so
 * this adapter runs wherever nats.js does.
 *
 * @example
 * ```ts
 * import { connect } from "@nats-io/transport-node"; // Node.js and Bun
 * import { ChoMessage } from "@chojs/message";
 * import { NatsLinker } from "@chojs/vendor-nats";
 *
 * const app = await ChoMessage.create(AppModule, {
 *   linker: new NatsLinker({
 *     connect: () => connect({ servers: "localhost:4222" }),
 *     queue: "mailer",
 *   }),
 * });
 * await app.start();
 * ```
 *
 * @module
 */

import { assert_known_options } from "@chojs/core/di";
import type { ChoError } from "@chojs/core";
import { debuglog } from "@chojs/core/utils";
import type {
  Delivery,
  Linked,
  Linker,
  Reply,
  Route,
} from "@chojs/message/linker";
import type { NatsConnection } from "@nats-io/nats-core";
import { type ChoNatsErrorCode, nats_error } from "./errors.ts";
import {
  BAD_REQUEST,
  ERROR_HEADERS,
  INTERNAL_ERROR,
  type NatsConnectionLike,
  type NatsErrorReply,
  type NatsErrorReplyFn,
  type NatsMessage,
  type NatsMessageLike,
  type NatsNative,
  type NatsSubscriptionLike,
  Pump,
} from "./consume.ts";

// The `@chojs/message` types this module refers to.
export type { Delivery, Linked, Linker, Reply, Route };
export { BAD_REQUEST, ERROR_HEADERS, INTERNAL_ERROR };
export type {
  NatsConnectionLike,
  NatsErrorReply,
  NatsErrorReplyFn,
  NatsMessage,
  NatsMessageLike,
  NatsNative,
  NatsSubscriptionLike,
};

/**
 * The options of {@link NatsLinker}.
 *
 * @typeParam C The connection `connect` gives: the `NatsConnection` of the
 *   client library.
 */
export type NatsLinkerOptions<
  C extends NatsConnectionLike = NatsConnection,
> = {
  /**
   * Connects to NATS: `connect` of the transport of the runtime, with the
   * options of the application (the servers, the credentials, TLS, how many
   * times the client connects again, …). The adapter calls it once, on
   * `start()`, and closes the connection on `stop()`.
   */
  readonly connect: () => C | Promise<C>;
  /**
   * The queue group: the name of the application for NATS. Every instance of
   * the application has the same one, and a message goes to one of them.
   */
  readonly queue: string;
  /**
   * How many messages of one subject are in hand at once. With `1`, the
   * messages of a subject are handled in the order they came. Default: `1`.
   */
  readonly concurrency?: number | undefined;
  /**
   * What a requester is told when its message failed: the code and the
   * description of the error reply. It receives the error, and the message of
   * the client library. Default, and when it returns nothing: `500`,
   * `Internal Error`, so that the message of an error is not sent by mistake;
   * and `400`, `Bad Request`, for a message that is not valid.
   */
  readonly errorReply?: NatsErrorReplyFn | undefined;
  /**
   * Called when the adapter stopped by itself: the connection closed and the
   * client does not connect again, or a subscription failed. Default: the
   * error is thrown, and ends the process when nothing catches it.
   */
  readonly onFatal?: ((error: Error) => void) | undefined;
};

/** The names of the options, for the error of an unknown one. */
const OPTIONS = [
  "concurrency",
  "connect",
  "errorReply",
  "onFatal",
  "queue",
] as const satisfies readonly (keyof NatsLinkerOptions)[];

/** An error of the options, with the name of the class. */
function invalid(message: string): ChoError<ChoNatsErrorCode> {
  return nats_error("CHO_NATS_INVALID_OPTION", `NatsLinker: ${message}`);
}

/** Check the options, and throw for the first that is wrong. */
function assert_options(options: NatsLinkerOptions<NatsConnectionLike>): void {
  if (typeof options !== "object" || options === null) {
    throw invalid(
      'expected options, such as { connect: () => connect({ servers: "localhost:4222" }), queue: "my-app" }',
    );
  }
  assert_known_options("NatsLinker", options, OPTIONS);
  const { connect, queue, concurrency } = options;
  if (typeof connect !== "function") {
    throw invalid(
      'the "connect" option is required: a function that connects to NATS, such as () => connect({ servers: "localhost:4222" })',
    );
  }
  if (typeof queue !== "string" || queue === "") {
    throw invalid(
      'the "queue" option is required: the queue group of the application, such as "mailer"',
    );
  }
  if (/\s/.test(queue)) {
    throw invalid(
      `the "queue" option is a name without a space, got "${queue}"`,
    );
  }
  if (
    concurrency !== undefined &&
    !(Number.isInteger(concurrency) && concurrency >= 1)
  ) {
    throw invalid(`the "concurrency" option is 1 or more, got ${concurrency}`);
  }
  for (const name of ["errorReply", "onFatal"] as const) {
    const value = options[name];
    if (value !== undefined && typeof value !== "function") {
      throw invalid(`the "${name}" option is a function`);
    }
  }
}

/**
 * A message application linked to NATS by {@link NatsLinker}.
 *
 * `ChoMessage` starts and stops it: `app.start()` and `app.close()`.
 *
 * @typeParam C The connection of the client library.
 */
export class NatsLinked<C extends NatsConnectionLike = NatsConnection>
  implements Linked<C> {
  readonly #pump: Pump<C>;
  #started: Promise<void> | undefined;

  /**
   * Wrap what subscribes an application. {@link NatsLinker.link} calls it.
   *
   * @param pump What connects, and receives the messages.
   */
  constructor(pump: Pump<C>) {
    this.#pump = pump;
  }

  /**
   * The connection of the application, once `start()` resolved: publish and
   * request with it. The adapter closes it on `stop()`.
   *
   * @throws {ChoError} Before `start()` resolved: there is no connection yet.
   */
  get instance(): C {
    return this.#pump.connection;
  }

  /**
   * Connect, and subscribe to the subject of each route. It resolves when the
   * server has the subscriptions.
   *
   * @returns A promise that rejects when NATS cannot be reached, with the
   *   error of `connect`.
   */
  start(): Promise<void> {
    return this.#started ??= this.#pump.start();
  }

  /**
   * Receive nothing more, handle and answer the messages that were received,
   * send what is left and close the connection.
   *
   * @returns A promise that rejects when the connection fails to close.
   */
  stop(): Promise<void> {
    return this.#pump.stop();
  }
}

/**
 * Subscribes the topics of a CHO message application to NATS, and answers the
 * messages that ask for a reply.
 *
 * NATS only delivers: each message goes to `Route.handle`, which
 * `@chojs/message` built. Middlewares and error handlers are
 * `@chojs/message`'s, so they behave the same on every adapter.
 *
 * - **The application is one queue group** (`queue`). A topic is a subject of
 *   NATS, named as it is in the application (`shop.orders.created`), and a
 *   message of it goes to one instance of the application.
 * - **What a handler returns is the reply** of a message that asks for one (a
 *   request). A handler that returns nothing answers with an empty reply. For
 *   a message that asks for none, what the handler returns is dropped.
 * - **A request that failed is answered with an error reply**: the headers
 *   {@link ERROR_HEADERS}, as a NATS service does. `errorReply` decides its
 *   code and description; by default they are `500` and `Internal Error`.
 * - **A message that failed and asks for no reply is lost**, and logged: this
 *   is core NATS, delivery is at most once, and nothing is tried again.
 * - **One message at a time for each subject**, in the order they came.
 *   `concurrency` (1) is how many messages of one subject are in hand at once.
 * - **`ctx.native`** is a {@link NatsNative}: the message of the client
 *   library (`subject`, `reply`, every value of the headers).
 *
 * @typeParam C The connection `connect` gives: `linked.instance` has its
 *   type.
 *
 * @example
 * ```ts
 * import { connect } from "@nats-io/transport-node";
 * import { ChoMessage } from "@chojs/message";
 * import { NatsLinker } from "@chojs/vendor-nats";
 *
 * const app = await ChoMessage.create(AppModule, {
 *   linker: new NatsLinker({
 *     connect: () => connect({ servers: "nats:4222" }),
 *     queue: "mailer",
 *   }),
 * });
 * await app.start();
 *
 * // the connection of the application: publish and request with it
 * app.linked.instance.publish("shop.orders.created", JSON.stringify(order));
 * ```
 *
 * @example What a requester is told when a handler failed
 * ```ts
 * new NatsLinker({
 *   connect: () => connect({ servers: "nats:4222" }),
 *   queue: "mailer",
 *   concurrency: 8,
 *   errorReply: (error) =>
 *     error instanceof NotFound
 *       ? { code: 404, description: "Not Found" }
 *       : undefined, // 500, Internal Error
 * });
 * ```
 */
export class NatsLinker<C extends NatsConnectionLike = NatsConnection>
  implements Linker<C> {
  readonly #options: NatsLinkerOptions<C>;
  /** Whether {@link link} was called: a linker serves one application. */
  #linked = false;

  /**
   * Create a linker. Nothing is connected yet.
   *
   * @param options How to connect, the queue group, and what a requester is
   *   told when its message failed.
   * @throws {ChoError} When an option is missing, unknown or wrong.
   */
  constructor(options: NatsLinkerOptions<C>) {
    assert_options(options);
    this.#options = options;
  }

  /**
   * Prepare the subscriptions of the routes. It connects nothing: `start()`
   * of the linked application does.
   *
   * @param routes The routes of the application.
   * @returns The linked application.
   * @throws {ChoError} When the linker was already used.
   */
  link(routes: readonly Route[]): NatsLinked<C> {
    if (this.#linked) {
      throw nats_error(
        "CHO_NATS_ALREADY_LINKED",
        "NatsLinker.link() was already called: use one linker for one application",
      );
    }
    this.#linked = true;
    const options = this.#options;
    const pump = new Pump<C>(routes, options.connect, {
      queue: options.queue,
      concurrency: options.concurrency ?? 1,
      errorReply: options.errorReply,
      onFatal: options.onFatal ?? ((error) => {
        throw error;
      }),
      log: debuglog("cho:nats"),
    });
    return new NatsLinked(pump);
  }
}

/** The codes of the errors of this package. */
export type { ChoNatsErrorCode } from "./errors.ts";
