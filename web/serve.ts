/**
 * {@link serve} runs a `fetch`-style request handler, such as the `handler`
 * of a `ChoWeb` application, on the server of the runtime the code is running
 * on: `Deno.serve` on Deno, `Bun.serve` on Bun, and the `node:http` server on
 * Node.js.
 *
 * It has no dependency. Node.js has no server for a `fetch` handler of its
 * own, so the small bridge between `node:http` and the standard `Request` and
 * `Response` is here; the Node.js modules are imported when they are needed,
 * and only on Node.js, which is why `serve` is asynchronous.
 *
 * It is an entry point of its own, `@chojs/web/serve`, and not part of
 * `@chojs/web`: an application for a runtime that serves an exported handler,
 * such as Cloudflare Workers, does not load it, or anything of Node.js.
 *
 * @module
 */

import { web_error } from "./errors.ts";
import { engine, type EngineType } from "@chojs/core/utils";
import type {
  IncomingMessage,
  Server as NodeServer,
  ServerResponse,
} from "node:http";
import type { Duplex } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import {
  asks_upgrade,
  GOING_AWAY,
  upgrade_here,
  upgrade_required,
} from "./socket.ts";
import type {
  ChoWebSocketEvents,
  ChoWebSocketIo,
  ChoWebUpgrade,
} from "./types.ts";
import {
  accept_key,
  check_handshake,
  CLOSE,
  encode_close,
  encode_frame,
  encode_message,
  FrameReader,
  OPCODE,
} from "./ws-protocol.ts";

// The runtime a `ChoWebServer` reports.
export type { EngineType };

/** A `fetch`-style request handler: what {@link serve} serves. */
export type ServeHandler = (req: Request) => Response | Promise<Response>;

/**
 * An application, as {@link serve} serves it: its request handler, and what
 * runs the route of a request that asks for a WebSocket. A `ChoWeb`
 * application is one.
 */
export type ServeApp = {
  /** The request handler: `app.handler`. */
  readonly handler: ServeHandler;
  /**
   * Runs the route of a request that asks to be upgraded: `app.upgrade`.
   * Without it, the server upgrades nothing.
   */
  readonly upgrade?:
    | ((req: Request) => Promise<ChoWebUpgrade | Response>)
    | undefined;
};

/** The options of the functions that upgrade a connection. */
export type SocketOptions = {
  /**
   * The bytes a message of a WebSocket can hold. A larger one closes its
   * socket with the code `1009`. Default: 1 MiB. It applies on Node.js and
   * on Bun; Deno has no such limit to set.
   */
  maxPayload?: number;
};

/** The options of {@link serve}. */
export type ServeOptions = SocketOptions & {
  /** The port to listen on. `0` picks a free port. Default: `3000`. */
  port?: number;
  /**
   * The host name or address to listen on. Default: the default of the
   * runtime's server, which listens on every network interface.
   */
  hostname?: string;
  /** Closes the server when it is aborted. Default: none. */
  signal?: AbortSignal;
  /**
   * How long closing the server waits for the requests in flight, in
   * milliseconds, before it cuts their connections; `0` cuts them at once.
   * Default: none: it waits for every request to end, however long that
   * takes, and for ever for a response that has no end, such as a stream of
   * server-sent events that is still open.
   */
  closeTimeout?: number;
};

/** A server started by {@link serve}. */
export type ChoWebServer = {
  /** The runtime the server runs on. */
  readonly runtime: EngineType;
  /** The port the server listens on: the real one, when `0` was asked. */
  readonly port: number;
  /** The host name or address the server listens on. */
  readonly hostname: string;
  /**
   * Stop accepting requests, wait for the ones in flight, and close the
   * server. With the `closeTimeout` option, the requests that are still in
   * flight after that long are cut. Calling it again does nothing more.
   */
  close(): Promise<void>;
};

/** What `serve_on` needs to know of `Deno`. */
type DenoLike = {
  serve(
    options: {
      port: number;
      hostname?: string;
      signal?: AbortSignal;
      onListen: () => void;
    },
    handler: (
      req: Request,
      info: { completed: Promise<void> },
    ) => Response | Promise<Response>,
  ): {
    addr: { port: number; hostname: string };
    /** Resolves when the server is closed, and its connections with it. */
    finished: Promise<void>;
    shutdown(): Promise<void>;
  };
};

/** What the upgrade of a connection needs to know of a server of Bun. */
type BunServer = {
  upgrade(
    req: Request,
    options: { data: BunData; headers: Headers },
  ): boolean;
};

/** What the upgrade of a connection needs to know of a socket of Bun. */
type BunSocket = {
  data: BunData;
  send(data: string | Uint8Array): unknown;
  close(code?: number, reason?: string): void;
};

/** What a socket of Bun carries: its upgrade, then where its events go. */
type BunData = { upgrade: ChoWebUpgrade; events?: ChoWebSocketEvents };

/**
 * What {@link bunOptions} gives: the `fetch` and the `websocket` of
 * `Bun.serve`.
 */
export type BunOptions = {
  /** Answers a request, or upgrades its connection and answers nothing. */
  fetch(req: Request, server: unknown): Promise<Response | undefined>;
  /** The callbacks of every socket of the server. */
  websocket: {
    maxPayloadLength: number;
    open(ws: unknown): void;
    message(ws: unknown, message: string | Uint8Array): void;
    close(ws: unknown, code: number, reason: string): void;
  };
};

/** What `serve_on` needs to know of `Bun`. */
type BunLike = {
  serve(
    options:
      & { port: number; hostname?: string }
      & ({ fetch: ServeHandler } | BunOptions),
  ): {
    port: number;
    hostname: string;
    /** `true` also closes the connections of the requests in flight. */
    stop(closeActiveConnections?: boolean): void | Promise<void>;
  };
};

/** The default port of {@link serve}. */
const DEFAULT_PORT = 3000;

/** The default of the `maxPayload` option: 1 MiB. */
const DEFAULT_MAX_PAYLOAD = 1024 * 1024;

/** How often a socket of Node.js is pinged, in milliseconds. */
const PING_INTERVAL = 30_000;

/**
 * How long a connection of Node.js has to end once its close frame is
 * sent, in milliseconds, before it is cut.
 */
const CLOSE_GRACE = 5_000;

/**
 * The open sockets of a server, so that closing the server closes them.
 */
class Sockets {
  readonly #open = new Set<{
    io: ChoWebSocketIo;
    events: ChoWebSocketEvents;
    cut?: (() => void) | undefined;
  }>();

  /**
   * An upgrade whose connection is remembered from the moment it is
   * accepted until it is closed.
   *
   * @param upgrade The upgrade the route accepted.
   * @param cut Cuts the connection at once, when the runtime needs it done
   *   for each one.
   * @returns The upgrade to give to what upgrades the connection.
   */
  track(upgrade: ChoWebUpgrade, cut?: () => void): ChoWebUpgrade {
    return {
      headers: upgrade.headers,
      accept: (io) => {
        const events = upgrade.accept(io);
        const entry = { io, events, cut };
        this.#open.add(entry);
        return {
          message: events.message,
          closed: (code, reason) => {
            this.#open.delete(entry);
            events.closed(code, reason);
          },
        };
      },
    };
  }

  /** Close every open socket with `1001`: the server is closing. */
  close(): void {
    for (const entry of [...this.#open]) {
      try {
        entry.io.close(GOING_AWAY, "Going Away");
      } catch {
        // A connection that is already gone.
      }
      // Now, whatever the runtime reports later: `@WsClose` runs with 1001.
      entry.events.closed(GOING_AWAY, "Going Away");
    }
  }

  /** Cut what is still connected. */
  cut(): void {
    for (const entry of this.#open) {
      entry.cut?.();
    }
    this.#open.clear();
  }
}

/** An upgrade as it is, for a server that tracks nothing. */
const untracked = (upgrade: ChoWebUpgrade): ChoWebUpgrade => upgrade;

/** Check the `maxPayload` option, and give its value. */
function max_payload_of(options: SocketOptions, where: string): number {
  const { maxPayload = DEFAULT_MAX_PAYLOAD } = options;
  if (!(Number.isInteger(maxPayload) && maxPayload > 0)) {
    throw web_error(
      "CHO_WEB_INVALID_OPTION",
      `${where}: maxPayload must be a positive whole number of bytes, got ${
        String(maxPayload)
      }`,
    );
  }
  return maxPayload;
}

/** Check what is served, and give it as an application. */
function app_of(app: ServeHandler | ServeApp, where: string): ServeApp {
  if (typeof app === "function") {
    return { handler: app };
  }
  if (
    typeof app !== "object" || app === null ||
    typeof app.handler !== "function" ||
    (app.upgrade !== undefined && typeof app.upgrade !== "function")
  ) {
    throw web_error(
      "CHO_WEB_INVALID_HANDLER",
      `${where} expects an application, or a request handler such as app.handler`,
    );
  }
  return app;
}

/**
 * The `fetch` and the `websocket` of a server of Bun that upgrades the
 * connections of an application.
 *
 * @param app The application.
 * @param max_payload The bytes a message can hold.
 * @param track Remembers an upgrade, for a server that closes its sockets.
 * @returns What to give to `Bun.serve`.
 */
function bun_options(
  app: ServeApp,
  max_payload: number,
  track: (upgrade: ChoWebUpgrade) => ChoWebUpgrade,
): BunOptions {
  type Handler = (req: Request, server: unknown) => Promise<Response>;
  return {
    async fetch(req, server) {
      if (!app.upgrade || !asks_upgrade(req)) {
        // The server goes on to the handler, as `Bun.serve` gives it.
        return await (app.handler as Handler)(req, server);
      }
      const upgrade = await app.upgrade(req);
      if (upgrade instanceof Response) {
        return upgrade;
      }
      const data: BunData = { upgrade: track(upgrade) };
      const upgraded = (server as BunServer).upgrade(req, {
        data,
        headers: upgrade.headers,
      });
      // Bun answered `101` itself: there is no response to give.
      return upgraded ? undefined : upgrade_required();
    },
    websocket: {
      maxPayloadLength: max_payload,
      open(ws) {
        const socket = ws as BunSocket;
        socket.data.events = socket.data.upgrade.accept({
          send: (data) => void socket.send(data),
          close: (code, reason) => socket.close(code, reason),
          native: socket,
        });
      },
      message(ws, message) {
        (ws as BunSocket).data.events?.message(
          // A copy: the events of a socket run later, one after another.
          typeof message === "string" ? message : new Uint8Array(message),
        );
      },
      close(ws, code, reason) {
        (ws as BunSocket).data.events?.closed(code, reason);
      },
    },
  };
}

/**
 * What to give to a `Bun.serve` of your own, so that it upgrades the
 * connections of an application: the routes marked with `@Ws`.
 *
 * {@link serve} does this itself. Bun declares the callbacks of its sockets
 * once, for the whole server, so they are given when the server is made.
 *
 * @param app The application: its `handler`, and its `upgrade`.
 * @param options The limit of a message.
 * @returns The `fetch` and the `websocket` options of `Bun.serve`.
 * @throws {ChoError} When `app` is not an application, or `maxPayload` not
 *   a positive whole number.
 *
 * @example
 * ```ts
 * const app = await ChoWeb.create(AppModule);
 * Bun.serve({ port: 3000, ...bunOptions(app) });
 * ```
 */
export function bunOptions(
  app: ServeApp,
  options: SocketOptions = {},
): BunOptions {
  return bun_options(
    app_of(app, "bunOptions()"),
    max_payload_of(options, "bunOptions()"),
    untracked,
  );
}

/**
 * The handler of a server of Deno that upgrades the connections of an
 * application, and remembers its sockets.
 *
 * @param app The application.
 * @param sockets The sockets of the server.
 * @returns The handler to give to `Deno.serve`.
 */
function deno_handler(app: ServeApp, sockets: Sockets): ServeHandler {
  const { upgrade } = app;
  if (!upgrade) {
    return app.handler;
  }
  return async (req) => {
    if (!asks_upgrade(req)) {
      return await app.handler(req);
    }
    const accepted = await upgrade(req);
    return accepted instanceof Response
      ? accepted
      : upgrade_here(req, sockets.track(accepted)) ?? upgrade_required();
  };
}

/** The `'upgrade'` listener of a `node:http` server. */
export type NodeUpgradeListener = (
  incoming: IncomingMessage,
  socket: Duplex,
  head: Uint8Array,
) => void;

/**
 * Write a `Response` to a connection of Node.js that has no response object:
 * the answer to a request that was not upgraded. The connection is closed.
 *
 * @param socket The connection.
 * @param response The response.
 */
async function write_response(
  socket: Duplex,
  response: Response,
): Promise<void> {
  const { STATUS_CODES } = await import("node:http");
  const body = new Uint8Array(await response.arrayBuffer());
  const headers = new Headers(response.headers);
  headers.set("connection", "close");
  headers.set("content-length", String(body.byteLength));
  headers.delete("transfer-encoding");
  const text = response.statusText || STATUS_CODES[response.status] ||
    "Unknown";
  const lines = [`HTTP/1.1 ${response.status} ${text}`];
  for (const [name, value] of headers) {
    if (name !== "set-cookie") {
      lines.push(`${name}: ${value}`);
    }
  }
  for (const cookie of headers.getSetCookie()) {
    lines.push(`set-cookie: ${cookie}`);
  }
  if (socket.destroyed || !socket.writable) {
    return;
  }
  socket.write(lines.join("\r\n") + "\r\n\r\n");
  socket.end(body);
  // A client that never ends its side would hold the connection open.
  const cut = setTimeout(() => socket.destroy(), CLOSE_GRACE);
  (cut as { unref?: () => void }).unref?.();
  socket.once("close", () => clearTimeout(cut));
}

/**
 * Speak the WebSocket protocol on an upgraded connection of Node.js: read
 * the frames of the client, and write those of the application.
 *
 * - A ping is answered; a close frame is answered, then the connection
 *   ends; what the protocol does not allow closes it with the code of the
 *   RFC.
 * - The connection is pinged every 30 seconds. One that did not answer the
 *   ping before is cut: its socket closes with `1006`.
 *
 * @param socket The connection.
 * @param head The bytes that came with the request, after its headers.
 * @param upgrade The upgrade the route accepted.
 * @param max_payload The bytes a message can hold.
 */
function run_socket(
  socket: Duplex,
  head: Uint8Array,
  upgrade: ChoWebUpgrade,
  max_payload: number,
): void {
  const reader = new FrameReader(max_payload);
  /** Whether the close frame of the server was written. */
  let ended = false;
  /** Whether the client answered the last ping. */
  let alive = true;
  const write = (frame: Uint8Array) => {
    if (!socket.destroyed && socket.writable) {
      socket.write(frame);
    }
  };
  const pinger = setInterval(() => {
    if (!alive) {
      socket.destroy();
      return;
    }
    alive = false;
    write(encode_frame(OPCODE.ping));
  }, PING_INTERVAL);
  // A timer must not keep a process alive.
  (pinger as { unref?: () => void }).unref?.();

  /** Write the close frame, and end the connection. */
  const finish = (code: number, reason: string) => {
    if (ended) {
      return;
    }
    ended = true;
    clearInterval(pinger);
    write(encode_close(code, reason));
    socket.end();
    // A client that never ends its side would hold the connection open.
    const cut = setTimeout(() => socket.destroy(), CLOSE_GRACE);
    (cut as { unref?: () => void }).unref?.();
    socket.once("close", () => clearTimeout(cut));
  };

  const events = upgrade.accept({
    send(data) {
      if (!ended) {
        write(encode_message(data));
      }
    },
    close: finish,
    native: socket,
  });

  const read = (chunk: Uint8Array) => {
    // A plain view of the bytes: a `Buffer` has methods of its own.
    const bytes = new Uint8Array(
      chunk.buffer,
      chunk.byteOffset,
      chunk.byteLength,
    );
    for (const event of reader.push(bytes)) {
      if (event.type === "message") {
        if (!ended) {
          events.message(event.data);
        }
      } else if (event.type === "ping") {
        if (!ended) {
          write(encode_frame(OPCODE.pong, event.data));
        }
      } else if (event.type === "pong") {
        alive = true;
      } else {
        // A close frame is answered with what it said; an error of the
        // protocol with its own code and reason.
        finish(event.code, event.reason);
        events.closed(event.code, event.reason);
      }
    }
  };
  socket.on("data", read);
  // A connection of `node:http` stays half open when the client ends its
  // side: one that ended with no close frame is cut, and closes with 1006.
  socket.on("end", () => {
    if (!ended) {
      socket.destroy();
    }
  });
  socket.on("close", () => {
    clearInterval(pinger);
    // For a connection that was cut: after a close frame, it is ignored.
    events.closed(CLOSE.abnormal, "");
  });
  if (head.byteLength > 0) {
    read(head);
  }
}

/**
 * Make the `'upgrade'` listener of a server of Node.js.
 *
 * @param app The application.
 * @param max_payload The bytes a message can hold.
 * @param track Remembers an upgrade and how to cut its connection, for a
 *   server that closes its sockets.
 * @returns The listener.
 */
function node_listener(
  app: ServeApp,
  max_payload: number,
  track: (upgrade: ChoWebUpgrade, cut: () => void) => ChoWebUpgrade,
): NodeUpgradeListener {
  const upgrade = async (
    incoming: IncomingMessage,
    socket: Duplex,
    head: Uint8Array,
  ): Promise<void> => {
    const request = new Request(request_url(incoming), {
      method: incoming.method ?? "GET",
      headers: request_headers(incoming),
    });
    if (asks_upgrade(request)) {
      const refusal = check_handshake(request.method, request.headers);
      if (refusal) {
        return await write_response(
          socket,
          new Response(refusal.message, {
            status: refusal.status,
            headers: refusal.headers,
          }),
        );
      }
    }
    // An upgrade to another protocol is a request like any other.
    const accepted = app.upgrade
      ? await app.upgrade(request)
      : await app.handler(request);
    if (accepted instanceof Response) {
      return await write_response(socket, accepted);
    }
    const lines = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${await accept_key(
        request.headers.get("sec-websocket-key") ?? "",
      )}`,
    ];
    for (const [name, value] of accepted.headers) {
      if (name !== "set-cookie") {
        lines.push(`${name}: ${value}`);
      }
    }
    for (const cookie of accepted.headers.getSetCookie()) {
      lines.push(`set-cookie: ${cookie}`);
    }
    if (socket.destroyed || !socket.writable) {
      return; // the client went away while the route ran
    }
    socket.write(lines.join("\r\n") + "\r\n\r\n");
    run_socket(
      socket,
      head,
      track(accepted, () => socket.destroy()),
      max_payload,
    );
  };
  return (incoming, socket, head) => {
    // Nothing else listens to this connection: its errors (a client that
    // went away) must not stop the process. `close` follows each of them.
    socket.on("error", () => {});
    upgrade(incoming, socket, head).catch((error) => {
      console.error(error);
      write_response(
        socket,
        new Response("Internal Server Error", { status: 500 }),
      ).catch(() => socket.destroy());
    });
  };
}

/**
 * The `'upgrade'` listener to give to a `node:http` server of your own, so
 * that it upgrades the connections of an application: the routes marked
 * with `@Ws`.
 *
 * {@link serve} does this itself. Node.js has no WebSocket server: the
 * listener speaks the protocol (RFC 6455) on the connection, with no
 * extension: messages are not compressed.
 *
 * @param app The application: its `handler`, and its `upgrade`.
 * @param options The limit of a message.
 * @returns The listener of the `'upgrade'` event.
 * @throws {ChoError} When `app` is not an application, or `maxPayload` not
 *   a positive whole number.
 *
 * @example
 * ```ts
 * import { createServer } from "node:http";
 *
 * const app = await ChoWeb.create(AppModule);
 * const server = createServer(my_request_listener);
 * server.on("upgrade", nodeUpgrade(app));
 * ```
 */
export function nodeUpgrade(
  app: ServeApp,
  options: SocketOptions = {},
): NodeUpgradeListener {
  return node_listener(
    app_of(app, "nodeUpgrade()"),
    max_payload_of(options, "nodeUpgrade()"),
    untracked,
  );
}

/**
 * Serve a `fetch`-style request handler on the server of the current runtime.
 *
 * | Runtime | Server                                         |
 * | ------- | ---------------------------------------------- |
 * | Deno    | `Deno.serve` (needs `--allow-net`)             |
 * | Bun     | `Bun.serve`                                    |
 * | Node.js | `node:http`, bridged to `Request` / `Response` |
 *
 * On Node.js a handler that rejects is logged with `console.error` and
 * answered with `500`; on Deno and Bun the runtime's server does the same.
 *
 * Closing the server waits for the requests in flight. A response with no
 * end, such as an open stream of server-sent events, would hold it for ever:
 * the `closeTimeout` option cuts what is still in flight after a grace
 * period.
 *
 * @param handler The request handler, such as `app.handler`.
 * @param options The port and the host name, a signal that closes the
 *   server, and how long closing waits for the requests in flight.
 * @returns The server, once it is listening.
 * @throws {ChoError} (as a rejection) On a runtime that is not Deno, Bun or
 *   Node.js, such as Cloudflare Workers: give the handler to that runtime's
 *   own entry point instead.
 * @throws {ChoError} (as a rejection) When the handler is not a function,
 *   or `closeTimeout` not a whole number of milliseconds.
 *
 * @example
 * ```ts
 * import { ChoWeb } from "@chojs/web";
 * import { serve } from "@chojs/web/serve";
 *
 * const app = await ChoWeb.create(AppModule);
 * const server = await serve(app.handler, { port: 3000 });
 * console.log(`listening on http://localhost:${server.port}`);
 * ```
 *
 * @example Closing
 * ```ts
 * const server = await serve(app.handler);
 * // ...
 * await server.close(); // stop the server, then release the application
 * await app.close();
 * ```
 *
 * @example Closing with open streams
 * ```ts
 * // Requests get 10 seconds to end; what is still open then is cut.
 * const server = await serve(app.handler, { closeTimeout: 10_000 });
 * ```
 */
export function serve(
  app: ServeHandler | ServeApp,
  options: ServeOptions = {},
): Promise<ChoWebServer> {
  return serve_on(engine(), app, options);
}

/**
 * Serve a handler on the server of a given runtime (see {@link serve}).
 *
 * @param runtime The runtime whose server is used.
 * @param app The application, or a request handler.
 * @param options The options of {@link serve}.
 * @returns The server, once it is listening.
 * @throws {ChoError} (as a rejection) When the runtime has no server here.
 */
export async function serve_on(
  runtime: EngineType,
  app: ServeHandler | ServeApp,
  options: ServeOptions = {},
): Promise<ChoWebServer> {
  const served = app_of(app, "serve()");
  const { handler } = served;
  const max_payload = max_payload_of(options, "serve()");
  /** The sockets the server upgraded: closing the server closes them. */
  const sockets = new Sockets();
  const { closeTimeout } = options;
  if (
    closeTimeout !== undefined &&
    !(Number.isInteger(closeTimeout) && closeTimeout >= 0)
  ) {
    throw web_error(
      "CHO_WEB_INVALID_OPTION",
      `serve(): closeTimeout must be a whole number of milliseconds, got ${
        String(closeTimeout)
      }`,
    );
  }
  const port = options.port ?? DEFAULT_PORT;
  const hostname = options.hostname === undefined
    ? {}
    : { hostname: options.hostname };

  let server: ChoWebServer;
  if (runtime === "deno") {
    server = serve_deno(
      deno_handler(served, sockets),
      port,
      options.hostname,
      closeTimeout,
    );
  } else if (runtime === "bun") {
    const bun = (globalThis as unknown as { Bun: BunLike }).Bun;
    const native = bun.serve({
      port,
      ...hostname,
      ...(served.upgrade
        ? bun_options(served, max_payload, (upgrade) => sockets.track(upgrade))
        : { fetch: handler }),
    });
    server = {
      runtime,
      port: native.port,
      hostname: native.hostname,
      close: once(() =>
        close_within(
          async () => await native.stop(),
          () => native.stop(true),
          closeTimeout,
        )
      ),
    };
  } else if (runtime === "node") {
    server = await serve_node(
      handler,
      port,
      options.hostname,
      closeTimeout,
      served.upgrade &&
        node_listener(
          served,
          max_payload,
          (upgrade, cut) => sockets.track(upgrade, cut),
        ),
      () => sockets.cut(),
    );
  } else {
    throw web_error(
      "CHO_WEB_NO_SERVER",
      `serve() has no server for this runtime (${runtime}): ` +
        "give app.handler to the runtime's own entry point",
    );
  }

  if (served.upgrade) {
    // An open socket would hold a closing server: its sockets go first.
    const close = server.close;
    server = {
      ...server,
      close: once(() => {
        sockets.close();
        return close();
      }),
    };
  }

  const { signal } = options;
  if (signal?.aborted) {
    await server.close();
  } else {
    signal?.addEventListener("abort", () => void server.close(), {
      once: true,
    });
  }
  return server;
}

/** Make a `close` that runs once: later calls get the same promise. */
function once(close: () => Promise<void>): () => Promise<void> {
  let closing: Promise<void> | undefined;
  return () => closing ??= close();
}

/**
 * Close a server that can be closed in two ways: wait for its requests in
 * flight, and cut them when they take too long.
 *
 * @param graceful Stops accepting requests, and resolves once the ones in
 *   flight have ended. It must also resolve once `force` was called.
 * @param force Cuts the connections of the requests in flight.
 * @param timeout How long to wait before `force`, in milliseconds. Default:
 *   for ever.
 */
async function close_within(
  graceful: () => Promise<void>,
  force: () => unknown,
  timeout: number | undefined,
): Promise<void> {
  if (timeout === undefined) {
    return await graceful();
  }
  const timer = setTimeout(force, timeout);
  try {
    await graceful();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Serve a handler on `Deno.serve`. It is the Deno part of {@link serve}.
 *
 * `Deno.serve` closes in one of two ways, and not one after the other: it
 * waits for every request (`shutdown()`), or cuts them all (its `signal`).
 * So with a `close_timeout` the requests in flight are counted here: closing
 * waits until there is none left, or for the timeout, and then cuts. A
 * request that arrives while it waits is answered `503`.
 *
 * @param handler The request handler.
 * @param port The port to listen on; `0` picks a free one.
 * @param hostname The host name or address to listen on. Default: every
 *   network interface.
 * @param close_timeout How long closing waits for the requests in flight, in
 *   milliseconds. Default: for ever.
 * @returns The server: it is listening.
 */
function serve_deno(
  handler: ServeHandler,
  port: number,
  hostname?: string,
  close_timeout?: number,
): ChoWebServer {
  const deno = (globalThis as unknown as { Deno: DenoLike }).Deno;
  const address = hostname === undefined ? {} : { hostname };
  if (close_timeout === undefined) {
    // `onListen` replaces the line Deno prints: the address is returned.
    const native = deno.serve(
      { port, ...address, onListen() {} },
      // Deno reads the number of parameters: one is the request alone.
      (req) => handler(req),
    );
    return {
      runtime: "deno",
      port: native.addr.port,
      hostname: native.addr.hostname,
      close: once(() => native.shutdown()),
    };
  }

  const cut = new AbortController();
  let in_flight = 0;
  let closing = false;
  /** Called when the last request in flight has ended. */
  let idle = () => {};
  const native = deno.serve(
    { port, ...address, signal: cut.signal, onListen() {} },
    (req, info) => {
      if (closing) {
        return new Response("Service Unavailable", {
          status: 503,
          headers: { connection: "close" },
        });
      }
      in_flight++;
      const ended = () => {
        if (--in_flight === 0) {
          idle();
        }
      };
      // Settles when the response is sent, or the connection lost.
      info.completed.then(ended, ended);
      return handler(req);
    },
  );
  return {
    runtime: "deno",
    port: native.addr.port,
    hostname: native.addr.hostname,
    close: once(async () => {
      closing = true;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const in_time = await new Promise<boolean>((resolve) => {
        idle = () => resolve(true);
        if (in_flight === 0) {
          resolve(true);
        } else {
          timer = setTimeout(() => resolve(false), close_timeout);
        }
      });
      clearTimeout(timer);
      if (in_time) {
        // Not `abort()`: it would drop a response Deno has just been given,
        // before it is written. Nothing is in flight, so this does not wait.
        await native.shutdown();
      } else {
        // Closes the server, and what is still in flight with it.
        cut.abort();
      }
      await native.finished;
    }),
  };
}

/**
 * Serve a handler on the `node:http` server. It is the Node.js part of
 * {@link serve}; it also runs on the runtimes that have `node:http`.
 *
 * @param handler The request handler.
 * @param port The port to listen on; `0` picks a free one.
 * @param hostname The host name or address to listen on. Default: every
 *   network interface.
 * @param close_timeout How long closing waits for the requests in flight, in
 *   milliseconds, before it cuts their connections. Default: for ever.
 * @param on_upgrade The listener of the `'upgrade'` event: it upgrades the
 *   connections of the application. Default: none, and a request that asks
 *   for an upgrade is a request like any other.
 * @param cut Cuts the connections that were upgraded, which the server no
 *   longer counts as its own. Default: nothing.
 * @returns The server, once it is listening.
 */
export async function serve_node(
  handler: ServeHandler,
  port: number,
  hostname?: string,
  close_timeout?: number,
  on_upgrade?: NodeUpgradeListener,
  cut?: () => void,
): Promise<ChoWebServer> {
  // Imported here, so that nothing of Node.js is loaded on another runtime.
  const { createServer } = await import("node:http");
  const { Readable } = await import("node:stream");
  const { pipeline } = await import("node:stream/promises");

  /** Whether the server is closing: it waits for its requests in flight. */
  let closing = false;

  const native: NodeServer = createServer((incoming, outgoing) => {
    // A connection that is kept alive would hold a closing server open once
    // its request has ended.
    outgoing.once("close", () => {
      if (closing) {
        native.closeIdleConnections();
      }
    });
    answer(incoming, outgoing).catch((error) => {
      console.error(error);
      if (outgoing.headersSent) {
        outgoing.destroy(); // too late for a 500: cut the response
      } else {
        outgoing.writeHead(500, { "content-type": "text/plain" });
        outgoing.end("Internal Server Error");
      }
    });
  });

  /** Answer one Node.js request with the handler. */
  async function answer(
    incoming: IncomingMessage,
    outgoing: ServerResponse,
  ): Promise<void> {
    // Aborted when the connection closes before the response is sent.
    const abort = new AbortController();
    outgoing.once("close", () => {
      if (!outgoing.writableFinished) {
        abort.abort();
      }
    });
    const has_body = incoming.method !== "GET" && incoming.method !== "HEAD";
    const request = new Request(request_url(incoming), {
      method: incoming.method ?? "GET",
      headers: request_headers(incoming),
      signal: abort.signal,
      ...(has_body
        ? {
          body: Readable.toWeb(incoming) as unknown as ReadableStream,
          duplex: "half",
        }
        : {}),
    } as RequestInit);
    // `pipeline` handles a full buffer, and ends or destroys both streams.
    await send_response(
      await handler(request),
      outgoing,
      (body) =>
        pipeline(Readable.fromWeb(body as NodeReadableStream), outgoing),
    );
  }

  if (on_upgrade) {
    native.on("upgrade", on_upgrade);
  }

  await new Promise<void>((resolve, reject) => {
    native.once("error", reject);
    native.listen(port, hostname, () => {
      native.off("error", reject);
      resolve();
    });
  });
  const address = native.address();
  const listening = typeof address === "object" && address !== null
    ? address
    : { port, address: hostname ?? "" };
  return {
    runtime: "node",
    port: listening.port,
    hostname: listening.address,
    close: once(() =>
      close_within(
        () =>
          new Promise<void>((resolve, reject) => {
            closing = true;
            native.close((error) => error ? reject(error) : resolve());
            // Connections kept alive with no request would hold the server
            // open.
            native.closeIdleConnections();
          }),
        () => {
          native.closeAllConnections();
          cut?.();
        },
        close_timeout,
      )
    ),
  };
}

/** The full URL of a Node.js request. */
function request_url(incoming: IncomingMessage): string {
  const encrypted = (incoming.socket as { encrypted?: boolean }).encrypted;
  const host = incoming.headers.host ?? "localhost";
  return `${encrypted ? "https" : "http"}://${host}${incoming.url ?? "/"}`;
}

/** The headers of a Node.js request, repeated ones included. */
function request_headers(incoming: IncomingMessage): Headers {
  const headers = new Headers();
  const raw = incoming.rawHeaders;
  for (let i = 0; i + 1 < raw.length; i += 2) {
    const name = raw[i]!;
    if (!name.startsWith(":")) { // an HTTP/2 pseudo-header
      headers.append(name, raw[i + 1]!);
    }
  }
  return headers;
}

/**
 * Write a `Response` to a Node.js response, streaming its body.
 *
 * @param response The response of the handler.
 * @param outgoing The Node.js response to write it to.
 * @param pipe Pipes a body to `outgoing`, and ends it.
 */
async function send_response(
  response: Response,
  outgoing: ServerResponse,
  pipe: (body: ReadableStream<Uint8Array>) => Promise<void>,
): Promise<void> {
  outgoing.statusCode = response.status;
  outgoing.statusMessage = response.statusText;
  const cookies = response.headers.getSetCookie();
  for (const [name, value] of response.headers) {
    if (name !== "set-cookie") {
      outgoing.setHeader(name, value);
    }
  }
  if (cookies.length > 0) {
    outgoing.setHeader("set-cookie", cookies);
  }
  if (response.body === null) {
    outgoing.end();
    return;
  }
  try {
    await pipe(response.body);
  } catch (error) {
    // The client went away before the end of the body: no one to answer.
    if ((error as { code?: string }).code !== "ERR_STREAM_PREMATURE_CLOSE") {
      throw error;
    }
  }
}
