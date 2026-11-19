/**
 * The sockets of an application: what happens between a route that accepts
 * an upgrade (`@Ws`) and the code that upgrades the connection.
 *
 * Nothing here knows a runtime. A route that accepts records the upgrade for
 * its request ({@link accept_upgrade}) and answers `426`; who holds the
 * connection takes the record ({@link take_upgrade}), upgrades, and gives
 * what the connection can do to `accept`. From there, one {@link Connection}
 * runs the methods of the controller: in order, one event at a time, sending
 * what they return.
 *
 * Internal to `@chojs/web`.
 *
 * @module
 */

import { type Debuglog, describe } from "@chojs/core/utils";
import type { ChoWebContext } from "./context.ts";
import { web_error } from "./errors.ts";
import type { SocketRef } from "./graph.ts";
import type {
  ChoWebSocket,
  ChoWebSocketEvents,
  ChoWebSocketIo,
  ChoWebUpgrade,
} from "./types.ts";

/** The status a route that accepted an upgrade answers with. */
const UPGRADE_REQUIRED = 426;

/** The close code of a socket whose method threw: Internal Error. */
const INTERNAL_ERROR = 1011;

/** The close code of a socket of an application that closes: Going Away. */
export const GOING_AWAY = 1001;

/**
 * Report an error of a socket. There is nobody to answer it, as an adapter
 * answers `500` for a route that rejects, so it is never silent: it goes to
 * the `cho:web` debug context when that is enabled, and to `console.error`
 * otherwise.
 *
 * @param log The `cho:web` debug logger.
 * @param message What failed.
 * @param error The error.
 */
function report(log: Debuglog, message: string, error: unknown): void {
  if (log.enabled) {
    log.error(message, error);
  } else {
    console.error(message, error);
  }
}

/** An upgrade a route accepted, until who holds the connection takes it. */
type Accepted = {
  /** The context of the request. */
  readonly ctx: ChoWebContext;
  /** The methods of the controller that handle the events. */
  readonly socket: SocketRef;
  /** The first message: what the `@Ws` method returned, ready to send. */
  readonly first: string | Uint8Array | undefined;
  /** Where the route is declared, for logs: `"ChatController.join"`. */
  readonly name: string;
  /** The `cho:web` debug logger. */
  readonly log: Debuglog;
};

/**
 * The accepted upgrades, by request. By request, and not by response: a
 * middleware can copy the response (to add a header), and the request is the
 * one object the route and who called it both hold.
 */
const ACCEPTED = new WeakMap<Request, Accepted>();

/**
 * Whether a request asks to be upgraded to a WebSocket: its `Upgrade` header
 * names `websocket`, in any case.
 *
 * @param req The request.
 * @returns `true` for a request that asks for a WebSocket.
 */
export function asks_upgrade(req: Request): boolean {
  return (req.headers.get("upgrade") ?? "")
    .split(",")
    .some((protocol) => protocol.trim().toLowerCase() === "websocket");
}

/**
 * The answer to a request that should have asked for an upgrade, and the
 * answer of a route that accepted one, for who cannot upgrade.
 *
 * @returns `426 Upgrade Required`, which names the protocol.
 */
export function upgrade_required(): Response {
  return new Response("Upgrade Required", {
    status: UPGRADE_REQUIRED,
    headers: { upgrade: "websocket", connection: "Upgrade" },
  });
}

/**
 * What is sent for a value: a string as it is, bytes as bytes, anything else
 * as JSON, and nothing for `undefined`.
 *
 * @param value What a method returned, or what was given to `send`.
 * @param where Who gave the value, for the error message.
 * @returns The text or the bytes to send, or `undefined` for nothing.
 * @throws {ChoError} `CHO_WEB_INVALID_SOCKET_RESULT` for a value that has no
 *   JSON: a function, a symbol, a `bigint`, an object that refers to itself.
 */
export function to_message(
  value: unknown,
  where: string,
): string | Uint8Array | undefined {
  if (value === undefined || typeof value === "string") {
    return value;
  }
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  let json: string | undefined;
  let cause: unknown;
  try {
    json = JSON.stringify(value);
  } catch (error) {
    cause = error;
  }
  if (json === undefined) {
    throw web_error(
      "CHO_WEB_INVALID_SOCKET_RESULT",
      `${where} gave a value that cannot be sent on a socket: expected a string, bytes or a value JSON can hold, got ${
        describe(value)
      }`,
      cause === undefined ? undefined : { cause },
    );
  }
  return json;
}

/**
 * Accept the upgrade of a request: what the chain of a `@Ws` route ends
 * with, when its method did not refuse.
 *
 * @param ctx The context of the request.
 * @param socket The methods of the controller that handle the events.
 * @param first What the `@Ws` method returned: the first message.
 * @param name Where the route is declared, for logs.
 * @param log The `cho:web` debug logger.
 * @returns The answer of the route: `426`, for who cannot upgrade.
 * @throws {ChoError} `CHO_WEB_INVALID_SOCKET_RESULT` when what the method
 *   returned cannot be sent. The connection is not upgraded.
 */
export function accept_upgrade(
  ctx: ChoWebContext,
  socket: SocketRef,
  first: unknown,
  name: string,
  log: Debuglog,
): Response {
  ACCEPTED.set(ctx.req, {
    ctx,
    socket,
    first: to_message(first, `@Ws() handler ${name}`),
    name,
    log,
  });
  return upgrade_required();
}

/**
 * The headers of the `426` of a route which are not for the `101`: those of
 * the connection, and those that describe a body, which a `101` has not
 * (the `content-*` headers are left out too).
 */
const NOT_FOR_THE_UPGRADE = [
  "accept-ranges",
  "connection",
  "etag",
  "keep-alive",
  "last-modified",
  "transfer-encoding",
  "upgrade",
];

/**
 * Take the upgrade a route accepted for a request, once the whole chain of
 * the route has answered.
 *
 * There is one when the route accepted, and its answer is still the `426`
 * of {@link accept_upgrade}: a middleware that answered with another status
 * after the handler refused the connection.
 *
 * @param req The request, as it was given to the route.
 * @param response What the route answered.
 * @param open The open connections of the application: each connection is
 *   in it from the moment it is accepted until it is closed.
 * @returns The upgrade, or `undefined` when the route did not accept one.
 */
export function take_upgrade(
  req: Request,
  response: Response,
  open: Set<Connection>,
): ChoWebUpgrade | undefined {
  const accepted = ACCEPTED.get(req);
  if (!accepted) {
    return undefined;
  }
  ACCEPTED.delete(req);
  if (response.status !== UPGRADE_REQUIRED) {
    return undefined;
  }
  const headers = new Headers(response.headers);
  for (const name of [...headers.keys()]) {
    if (name.startsWith("content-") || NOT_FOR_THE_UPGRADE.includes(name)) {
      headers.delete(name);
    }
  }
  let connection: Connection | undefined;
  return {
    headers,
    accept(io) {
      if (connection) {
        throw web_error(
          "CHO_WEB_INVALID_SOCKET",
          `The upgrade of ${accepted.name} was already accepted: accept() is called once for a connection`,
        );
      }
      connection = new Connection(accepted, io, open);
      return connection.events;
    },
  };
}

/**
 * One open socket: it runs the methods of its controller, one event at a
 * time, and sends what they return.
 *
 * - The events run in the order they arrived. `@WsOpen` ends before the
 *   first message is handled, and `@WsClose` runs last, once.
 * - An event runs at once when none waits before it, so a method that is
 *   not asynchronous answers before the next event is read.
 * - When the application closes the socket itself (`socket.close`, an error
 *   of a method, or the end of the application), `@WsClose` runs with the
 *   code and the reason it gave: what the runtime reports afterwards is
 *   ignored.
 */
export class Connection {
  /** What the methods of the controller receive. */
  readonly socket: ChoWebSocket;
  /** Where the code that upgraded gives what the connection receives. */
  readonly events: ChoWebSocketEvents;

  readonly #accepted: Accepted;
  readonly #io: ChoWebSocketIo;
  readonly #open: Set<Connection>;
  /** Resolves when the events given so far have ended. */
  #queue: Promise<void> = Promise.resolve();
  /** The events that were given and have not ended. */
  #waiting = 0;
  /** Whether messages can still be sent. */
  #sending = true;
  /** Whether the close was given to the queue: it is given once. */
  #closing = false;
  /** Whether a method threw: the events that wait are dropped. */
  #failed = false;

  /**
   * @param accepted The upgrade the route accepted.
   * @param io What the connection can do.
   * @param open The open connections of the application.
   */
  constructor(accepted: Accepted, io: ChoWebSocketIo, open: Set<Connection>) {
    this.#accepted = accepted;
    this.#io = io;
    this.#open = open;
    const is_open = () => this.#sending;
    this.socket = Object.freeze({
      ctx: accepted.ctx,
      get open() {
        return is_open();
      },
      send: (data: unknown) => this.#send(data, "send()"),
      close: (code = 1000, reason = "") => this.close(code, reason),
      native: io.native,
    });
    this.events = Object.freeze({
      message: (data: string | Uint8Array) => this.#message(data),
      closed: (code: number, reason: string) => this.#closed(code, reason),
    });
    open.add(this);
    // At once: the connection is open now, and may not be a moment later.
    if (accepted.first !== undefined) {
      this.#write(accepted.first);
    }
    this.#enqueue(() => this.#run("open", []));
  }

  /**
   * Close the socket, from the side of the application: the method marked
   * with `@WsClose` runs with this code and this reason, after the events
   * that wait.
   *
   * @param code The close code.
   * @param reason The reason.
   */
  close(code: number, reason: string): void {
    if (this.#closing) {
      return;
    }
    this.#sending = false;
    try {
      this.#io.close(code, reason);
    } catch (error) {
      this.#accepted.log.error(
        `the socket of ${this.#accepted.name} could not be closed:`,
        error,
      );
    }
    this.#closed(code, reason);
  }

  /**
   * Wait for the events given so far: after {@link close}, for the method
   * marked with `@WsClose`.
   *
   * @returns A promise that resolves when they have ended. It never rejects.
   */
  ended(): Promise<void> {
    return this.#queue;
  }

  /**
   * Give an event to the queue. It never throws, and never rejects.
   *
   * An event runs at once when nothing waits before it. So a method that is
   * not asynchronous has answered before the next event is read: a client
   * that sends a message and closes right after still gets its reply. An
   * event that waits runs when the one before it has ended.
   *
   * @param event Runs the event. It gives a promise when it has not ended
   *   when it returns.
   */
  #enqueue(event: () => void | Promise<void>): void {
    const done = () => void this.#waiting--;
    if (this.#waiting++ > 0) {
      this.#queue = this.#queue.then(event).then(done);
      return;
    }
    // Set before the event runs: what the event itself gives to the queue
    // (a close, from its method) waits for its end.
    let release!: () => void;
    this.#queue = new Promise<void>((resolve) => release = resolve);
    const end = () => {
      done();
      release();
    };
    const running = event();
    if (running) {
      running.then(end);
    } else {
      end();
    }
  }

  /** A message arrived. */
  #message(data: string | Uint8Array): void {
    if (this.#closing) {
      return;
    }
    this.#enqueue(() =>
      this.#failed ? undefined : this.#run("message", [data])
    );
  }

  /** The connection is closed, by either side. */
  #closed(code: number, reason: string): void {
    if (this.#closing) {
      return;
    }
    this.#closing = true;
    this.#sending = false;
    this.#enqueue(() => {
      this.#open.delete(this);
      return this.#run("close", [code, reason]);
    });
  }

  /** Send what a method returned, or what was given to `send`. */
  #send(value: unknown, where: string): void {
    const message = to_message(value, where);
    if (message !== undefined) {
      this.#write(message);
    }
  }

  /** Give a message to the connection, when it is open. */
  #write(message: string | Uint8Array): void {
    if (!this.#sending) {
      return;
    }
    try {
      this.#io.send(message);
    } catch (error) {
      // The connection went away between the check and the write.
      this.#accepted.log.error(
        `a message of ${this.#accepted.name} could not be sent:`,
        error,
      );
    }
  }

  /**
   * Run the method of an event, and send what it returns. An error closes
   * the socket; an error of the close itself is only reported.
   *
   * @returns Nothing for a method that returned a value: it is sent. A
   *   promise, which never rejects, for a method that returned one.
   */
  #run(
    event: "open" | "message" | "close",
    args: unknown[],
  ): void | Promise<void> {
    const method = this.#accepted.socket[event];
    if (!method) {
      return;
    }
    const { name, log } = this.#accepted;
    const where = `${name.slice(0, name.lastIndexOf(".") + 1)}${method.name}`;
    const failed = (error: unknown) => {
      report(log, `the socket of ${name} failed in ${where}:`, error);
      if (event !== "close") {
        this.#failed = true;
        this.close(INTERNAL_ERROR, "Internal Error");
      }
    };
    const settle = (value: unknown) => {
      if (event !== "close") {
        this.#send(value, where);
      }
    };
    try {
      const value = method.handler(...args, this.socket);
      if (
        typeof (value as { then?: unknown } | null | undefined)?.then ===
          "function"
      ) {
        return Promise.resolve(value).then(settle).catch(failed);
      }
      settle(value);
    } catch (error) {
      failed(error);
    }
  }
}

/** What the upgrade of a request needs to know of a standard `WebSocket`. */
type StandardSocket = {
  binaryType: string;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: "open" | "message" | "close",
    listener: (
      event: { data?: unknown; code?: number; reason?: string },
    ) => void,
  ): void;
};

/** What {@link upgrade_here} needs to know of the runtime. */
type UpgradingRuntime = {
  /** Deno: the request is enough. */
  Deno?: {
    upgradeWebSocket?(req: Request): {
      socket: StandardSocket;
      response: Response;
    };
  };
  /** Cloudflare Workers: two ends, one for the client. */
  WebSocketPair?: new () => {
    0: unknown;
    1: StandardSocket & { accept(): void };
  };
};

/** The bytes of a binary message of a standard `WebSocket`. */
async function to_bytes(data: unknown): Promise<Uint8Array> {
  return new Uint8Array(
    data instanceof ArrayBuffer ? data : await (data as Blob).arrayBuffer(),
  );
}

/**
 * Give the events of a standard `WebSocket` to an accepted upgrade.
 *
 * @param socket The server side of the socket.
 * @param upgrade The upgrade the route accepted.
 * @param opened Whether the socket is already open: it then has no `open`
 *   event to wait for.
 */
function wire(
  socket: StandardSocket,
  upgrade: ChoWebUpgrade,
  opened: boolean,
): void {
  let events: ChoWebSocketEvents | undefined;
  /** Set once a message had to be read asynchronously: order is kept. */
  let reading: Promise<void> | undefined;
  const start = () => {
    events = upgrade.accept({
      send: (data) => socket.send(data),
      close(code, reason) {
        try {
          socket.close(code, reason);
        } catch {
          // A code or a reason a standard socket does not take.
          socket.close();
        }
      },
      native: socket,
    });
  };
  try {
    socket.binaryType = "arraybuffer";
  } catch {
    // A runtime that only gives blobs: `to_bytes` reads them.
  }
  socket.addEventListener("message", ({ data }) => {
    if (typeof data === "string" && !reading) {
      events?.message(data);
    } else if (data instanceof ArrayBuffer && !reading) {
      events?.message(new Uint8Array(data));
    } else {
      reading = (reading ?? Promise.resolve()).then(async () =>
        events?.message(typeof data === "string" ? data : await to_bytes(data))
      ).catch(() => {});
    }
  });
  socket.addEventListener("close", ({ code, reason }) => {
    const closed = () => events?.closed(code ?? 1005, reason ?? "");
    if (reading) {
      reading.then(closed);
    } else {
      closed();
    }
  });
  if (opened) {
    start();
  } else {
    socket.addEventListener("open", start);
  }
}

/**
 * Upgrade a request on a runtime where a `Response` carries the upgrade:
 * Deno (`Deno.upgradeWebSocket`) and Cloudflare Workers (`WebSocketPair`).
 *
 * @param req The request, as the server of the runtime gave it.
 * @param upgrade The upgrade the route accepted.
 * @returns The response that upgrades the connection, or `undefined` on a
 *   runtime that needs more than the request (Bun, Node.js), and for a
 *   request the runtime cannot upgrade, such as one a test made.
 */
export function upgrade_here(
  req: Request,
  upgrade: ChoWebUpgrade,
): Response | undefined {
  const runtime = globalThis as UpgradingRuntime;
  if (typeof runtime.Deno?.upgradeWebSocket === "function") {
    let upgraded;
    try {
      upgraded = runtime.Deno.upgradeWebSocket(req);
    } catch {
      return undefined;
    }
    upgrade.headers.forEach((value, name) =>
      upgraded.response.headers.append(name, value)
    );
    wire(upgraded.socket, upgrade, false);
    return upgraded.response;
  }
  if (typeof runtime.WebSocketPair === "function") {
    const pair = new runtime.WebSocketPair();
    const server = pair[1];
    server.accept();
    wire(server, upgrade, true);
    return new Response(
      null,
      {
        status: 101,
        webSocket: pair[0],
        headers: upgrade.headers,
      } as ResponseInit,
    );
  }
  return undefined;
}

/**
 * Close every open connection of an application, and wait for their
 * `@WsClose` methods.
 *
 * @param open The open connections of the application.
 * @returns A promise that resolves when every one of them has ended.
 */
export async function close_connections(open: Set<Connection>): Promise<void> {
  const closing = [...open].map((connection) => {
    connection.close(GOING_AWAY, "Going Away");
    return connection.ended();
  });
  await Promise.all(closing);
}
