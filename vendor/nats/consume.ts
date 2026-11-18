/**
 * What `@chojs/vendor-nats` does with the messages of NATS: it subscribes to
 * the subject of each route, gives each message to its route, and answers the
 * ones that ask for a reply.
 *
 * This file knows the client library through three small interfaces
 * ({@link NatsConnectionLike}, {@link NatsSubscriptionLike} and
 * {@link NatsMessageLike}), so that the tests run it without a server.
 *
 * @module
 */

import { headers as make_headers } from "@nats-io/nats-core";
import type { Msg, MsgHdrs } from "@nats-io/nats-core";
import type { Debuglog } from "@chojs/core/utils";
import type { Delivery, Reply, Route } from "@chojs/message/linker";
import { nats_error } from "./errors.ts";

/** A message of NATS, as the client library gives it. */
export type NatsMessage = Msg;

/** What the adapter needs of a message of the client library. */
export interface NatsMessageLike {
  /** The subject the message was sent to. */
  readonly subject: string;
  /** The payload. */
  readonly data: Uint8Array;
  /** Where a reply goes, when the message asks for one. */
  readonly reply?: string | undefined;
  /** The headers: each name, with its values. */
  readonly headers?: Iterable<[string, string[]]> | undefined;
  /** Send a reply to who asked. */
  respond(data?: Uint8Array, options?: { headers?: MsgHdrs }): boolean;
}

/** What the adapter needs of a subscription of the client library. */
export interface NatsSubscriptionLike extends AsyncIterable<NatsMessageLike> {
  /**
   * Receive nothing more from the server. The messages that were already
   * received are still given, then the iteration ends.
   */
  drain(): Promise<void>;
}

/** What the adapter needs of the connection of the client library. */
export interface NatsConnectionLike {
  /** Subscribe to a subject, as a member of a queue group. */
  subscribe(subject: string, options: { queue: string }): NatsSubscriptionLike;
  /** Resolves when the server has what was sent. */
  flush(): Promise<void>;
  /** End every subscription, send what is left, and close. */
  drain(): Promise<void>;
  /** Resolves when the connection closes, with the error that closed it. */
  closed(): Promise<void | Error>;
  /** Whether the connection is closed. */
  isClosed(): boolean;
}

/** What a requester is told when its message failed. */
export type NatsErrorReply = {
  /** The code, as the `Nats-Service-Error-Code` header: `500`, `404`, … */
  readonly code: number;
  /** What went wrong, as the `Nats-Service-Error` header. One line. */
  readonly description: string;
  /** The payload of the reply. Default: empty. */
  readonly value?: Uint8Array | string | undefined;
};

/** Decides what a requester is told when its message failed. */
export type NatsErrorReplyFn = (
  error: unknown,
  message: NatsMessage,
) => NatsErrorReply | undefined | void;

/** The settings of a {@link Pump}: the options of the linker, with defaults. */
export type PumpSettings = {
  /** The queue group of the application. */
  readonly queue: string;
  /** How many messages of one subject are in hand at once. */
  readonly concurrency: number;
  /** What a requester is told when its message failed; `undefined`: 500. */
  readonly errorReply: NatsErrorReplyFn | undefined;
  /** Called once, when the adapter stops by itself. */
  readonly onFatal: (error: Error) => void;
  /** The `cho:nats` debug logger. */
  readonly log: Debuglog;
};

/** What a handler finds in `ctx.native` on this adapter. */
export type NatsNative = {
  /** The message of the client library: `subject`, `reply`, `headers`, … */
  readonly message: NatsMessage;
};

/**
 * The headers of an error reply: the ones a NATS service answers with, so a
 * requester reads an error of a CHO application as it reads any other.
 */
export const ERROR_HEADERS = {
  /** What went wrong. */
  description: "Nats-Service-Error",
  /** The code of the error. */
  code: "Nats-Service-Error-Code",
} as const;

/** What a requester is told when nothing else is said. */
export const INTERNAL_ERROR: NatsErrorReply = {
  code: 500,
  description: "Internal Error",
};

const EMPTY = new Uint8Array(0);
const encoder = new TextEncoder();

/**
 * A NATS message as the plain data `@chojs/message` handles.
 *
 * NATS has no key. When a header is repeated, its first value is kept: every
 * value is in `ctx.native`.
 */
export function to_delivery(message: NatsMessageLike): Delivery {
  const headers: Record<string, string> = {};
  for (const [name, values] of message.headers ?? []) {
    headers[name] = values[0] ?? "";
  }
  return { value: message.data, headers };
}

/** Whether a value is what {@link NatsErrorReplyFn} may return. */
function is_error_reply(value: unknown): value is NatsErrorReply {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { code, description, value: payload } = value as NatsErrorReply;
  return Number.isInteger(code) && typeof description === "string" &&
    (payload === undefined || typeof payload === "string" ||
      payload instanceof Uint8Array);
}

/** Whether a value is a connection the adapter can use. */
function is_connection(value: unknown): value is NatsConnectionLike {
  return typeof value === "object" && value !== null &&
    (["subscribe", "flush", "drain", "closed", "isClosed"] as const).every(
      (name) => typeof (value as NatsConnectionLike)[name] === "function",
    );
}

/**
 * Subscribes to the subjects of the routes, and gives them their messages.
 *
 * - Each route has one subscription, in the queue group of the application.
 * - `concurrency` messages of one subject are in hand at once: with 1, they
 *   are handled in the order they came.
 * - A message that asks for a reply is answered: with the reply of its
 *   handler and its headers, with an empty reply when there is none, and with
 *   an error reply when it failed.
 * - A message that asks for none is not answered: what its handler returns is
 *   dropped, and a failure is logged.
 *
 * @typeParam C The connection of the client library.
 */
export class Pump<C extends NatsConnectionLike = NatsConnectionLike> {
  readonly #routes: readonly Route[];
  readonly #connect: () => C | Promise<C>;
  readonly #settings: PumpSettings;

  /** The subscriptions, and what reads each of them. */
  readonly #subscriptions: NatsSubscriptionLike[] = [];
  readonly #readings: Promise<void>[] = [];
  /** The routes whose reply was dropped, and said so. */
  readonly #dropped = new WeakSet<Route>();
  #connecting: Promise<C> | undefined;
  #connection: C | undefined;
  #stopped: Promise<void> | undefined;
  #stopping = false;
  #fatal = false;

  constructor(
    routes: readonly Route[],
    connect: () => C | Promise<C>,
    settings: PumpSettings,
  ) {
    this.#routes = routes;
    this.#connect = connect;
    this.#settings = settings;
  }

  /**
   * The connection, once {@link start} resolved.
   *
   * @throws {ChoError} Before that: there is no connection yet.
   */
  get connection(): C {
    if (!this.#connection) {
      throw nats_error(
        "CHO_NATS_NOT_STARTED",
        "NatsLinker: there is no connection before start() resolves: read the instance after app.start()",
      );
    }
    return this.#connection;
  }

  /**
   * Connect, and subscribe to the subject of each route. It resolves when the
   * server has the subscriptions: the messages are handled after.
   */
  async start(): Promise<void> {
    const { log, queue } = this.#settings;
    if (this.#stopping) {
      return;
    }
    this.#connecting = this.#open();
    const connection = await this.#connecting;
    if (this.#stopping) {
      return; // stop() was called meanwhile: it closes the connection
    }
    this.#connection = connection;
    connection.closed().then(
      (error) => this.#closed(error),
      (error) => this.#closed(error),
    );
    if (this.#routes.length === 0) {
      log("no subject to subscribe to: nothing is received");
      return;
    }
    for (const route of this.#routes) {
      log("subscribing to", route.topic, "in the queue group", queue);
      const subscription = connection.subscribe(route.topic, { queue });
      this.#subscriptions.push(subscription);
      this.#readings.push(this.#read(route, subscription));
    }
    await connection.flush();
  }

  /**
   * Receive nothing more, handle and answer what was received, then close the
   * connection. It never rejects for a message.
   */
  stop(): Promise<void> {
    return this.#stopped ??= this.#stop();
  }

  /** Call `connect`, and check what it gives. */
  async #open(): Promise<C> {
    const connection = await this.#connect();
    if (!is_connection(connection)) {
      throw nats_error(
        "CHO_NATS_INVALID_CONNECTION",
        'NatsLinker: the "connect" option did not give a connection of NATS: return what connect() of the client library resolves with',
      );
    }
    return connection;
  }

  async #stop(): Promise<void> {
    const { log } = this.#settings;
    this.#stopping = true;
    let connection: C;
    try {
      // `start()` reports a connection that failed: there is nothing to close.
      const made = await this.#connecting;
      if (!made) {
        return;
      }
      connection = made;
    } catch {
      return;
    }
    const errors: unknown[] = [];
    const attempt = async (step: () => Promise<unknown>) => {
      try {
        await step();
      } catch (error) {
        // A connection that is closed has nothing left to end.
        if (!connection.isClosed()) {
          errors.push(error);
        }
      }
    };
    if (!connection.isClosed()) {
      // No new message. The ones that were received are still read.
      await Promise.all(
        this.#subscriptions.map((subscription) =>
          attempt(() => subscription.drain())
        ),
      );
    }
    await Promise.all(this.#readings);
    if (!connection.isClosed()) {
      // Sends the replies that wait, then closes.
      await attempt(() => connection.drain());
    }
    log("stopped");
    if (errors.length > 0 && !this.#fatal) {
      throw errors.length === 1
        ? errors[0]
        : new AggregateError(errors, "NatsLinker: failed to stop");
    }
  }

  /** Read a subscription to its end. */
  async #read(
    route: Route,
    subscription: NatsSubscriptionLike,
  ): Promise<void> {
    const { concurrency } = this.#settings;
    const active = new Set<Promise<void>>();
    let failure: unknown;
    let failed = false;
    try {
      for await (const message of subscription) {
        const done = this.#handle(route, message).then(() => {
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
    // A subscription ends when the adapter stops, or with its connection:
    // `#closed` tells of that one.
    if (this.#stopping || this.#connection?.isClosed()) {
      return;
    }
    this.#fail(
      nats_error(
        "CHO_NATS_SUBSCRIPTION_FAILED",
        `NatsLinker: the subscription of ${route.name} to "${route.topic}" ${
          failed ? "failed" : "ended"
        }: the application stopped`,
        failed ? { cause: failure } : undefined,
      ),
    );
  }

  /** Handle one message, and answer it. It never rejects. */
  async #handle(route: Route, message: NatsMessageLike): Promise<void> {
    const { log } = this.#settings;
    const asked = Boolean(message.reply);
    let reply: Reply | undefined;
    try {
      reply = await route.handle(
        to_delivery(message),
        { message } as NatsNative,
      );
    } catch (error) {
      if (asked) {
        log.error(
          `${route.name} failed for a request of "${route.topic}":`,
          error,
        );
        this.#respond_error(route, message, error);
      } else {
        log.error(
          `${route.name} failed for a message of "${route.topic}"`,
          "that asks for no reply: the message is lost:",
          error,
        );
      }
      return;
    }
    if (!asked) {
      if (reply && !this.#dropped.has(route)) {
        // Said once for a route, not for each message.
        this.#dropped.add(route);
        log(
          route.name,
          "returned a reply for a message that asks for none: it is dropped",
        );
      }
      return;
    }
    const value = reply ? reply.value : EMPTY;
    try {
      if (reply?.headers) {
        // A name or a value NATS does not accept throws here.
        const headers = make_headers();
        for (const [name, text] of Object.entries(reply.headers)) {
          headers.set(name, text);
        }
        message.respond(value, { headers });
      } else {
        message.respond(value);
      }
    } catch (cause) {
      const error = nats_error(
        "CHO_NATS_REPLY_FAILED",
        `NatsLinker: cannot send the reply of ${route.name}, of ${value.length} byte(s), to who asked on "${route.topic}"`,
        { cause },
      );
      log.error(error);
      // The requester is told, so it does not wait for its timeout.
      this.#respond_error(route, message, error);
    }
  }

  /** Answer a request that failed with an error reply. It never throws. */
  #respond_error(route: Route, message: NatsMessageLike, error: unknown): void {
    const { log, errorReply } = this.#settings;
    let told = INTERNAL_ERROR;
    if (errorReply) {
      try {
        const chosen = errorReply(error, message as NatsMessage);
        if (is_error_reply(chosen)) {
          told = chosen;
        } else if (chosen !== undefined) {
          log.error(
            `the "errorReply" option gave no error reply for ${route.name}:`,
            "expected { code, description }, or nothing. The requester is told",
            `${INTERNAL_ERROR.code} ${INTERNAL_ERROR.description}:`,
            chosen,
          );
        }
      } catch (cause) {
        log.error(
          `the "errorReply" option failed for ${route.name}. The requester is told`,
          `${INTERNAL_ERROR.code} ${INTERNAL_ERROR.description}:`,
          cause,
        );
      }
    }
    try {
      const headers = make_headers();
      // A header is one line.
      headers.set(
        ERROR_HEADERS.description,
        told.description.replace(/[\r\n]+/g, " "),
      );
      headers.set(ERROR_HEADERS.code, String(told.code));
      const value = typeof told.value === "string"
        ? encoder.encode(told.value)
        : told.value ?? EMPTY;
      message.respond(value, { headers });
    } catch (cause) {
      log.error(
        `cannot tell who asked on "${route.topic}" that ${route.name} failed:`,
        cause,
      );
    }
  }

  /** The connection closed. By itself, unless the adapter stops. */
  #closed(error: void | Error): void {
    this.#fail(
      nats_error(
        "CHO_NATS_CONNECTION_CLOSED",
        "NatsLinker: the connection to NATS closed, and the client does not connect again: the application receives no more messages",
        error ? { cause: error } : undefined,
      ),
    );
  }

  /** Stop the pump for an error, and tell the application. Once. */
  #fail(error: Error): void {
    if (this.#stopping) {
      return;
    }
    this.#fatal = true;
    this.#stopping = true;
    this.#settings.log.error(error);
    // After the messages in hand: `stop()` waits for the reading.
    queueMicrotask(() => {
      this.stop().finally(() => this.#settings.onFatal(error));
    });
  }
}
