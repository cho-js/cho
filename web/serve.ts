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

import { engine, type EngineType } from "@chojs/core/utils";
import type {
  IncomingMessage,
  Server as NodeServer,
  ServerResponse,
} from "node:http";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

// The runtime a `ChoWebServer` reports.
export type { EngineType };

/** A `fetch`-style request handler: what {@link serve} serves. */
export type ServeHandler = (req: Request) => Response | Promise<Response>;

/** The options of {@link serve}. */
export type ServeOptions = {
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

/** What `serve_on` needs to know of `Bun`. */
type BunLike = {
  serve(
    options: { port: number; hostname?: string; fetch: ServeHandler },
  ): {
    port: number;
    hostname: string;
    /** `true` also closes the connections of the requests in flight. */
    stop(closeActiveConnections?: boolean): void | Promise<void>;
  };
};

/** The default port of {@link serve}. */
const DEFAULT_PORT = 3000;

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
 * @throws {Error} (as a rejection) On a runtime that is not Deno, Bun or
 *   Node.js, such as Cloudflare Workers: give the handler to that runtime's
 *   own entry point instead.
 * @throws {TypeError} (as a rejection) When the handler is not a function,
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
  handler: ServeHandler,
  options: ServeOptions = {},
): Promise<ChoWebServer> {
  return serve_on(engine(), handler, options);
}

/**
 * Serve a handler on the server of a given runtime (see {@link serve}).
 *
 * @param runtime The runtime whose server is used.
 * @param handler The request handler.
 * @param options The options of {@link serve}.
 * @returns The server, once it is listening.
 * @throws {Error} (as a rejection) When the runtime has no server here.
 */
export async function serve_on(
  runtime: EngineType,
  handler: ServeHandler,
  options: ServeOptions = {},
): Promise<ChoWebServer> {
  if (typeof handler !== "function") {
    throw new TypeError(
      "serve() expects a request handler, such as app.handler",
    );
  }
  const { closeTimeout } = options;
  if (
    closeTimeout !== undefined &&
    !(Number.isInteger(closeTimeout) && closeTimeout >= 0)
  ) {
    throw new TypeError(
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
    server = serve_deno(handler, port, options.hostname, closeTimeout);
  } else if (runtime === "bun") {
    const bun = (globalThis as unknown as { Bun: BunLike }).Bun;
    const native = bun.serve({ port, ...hostname, fetch: handler });
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
    server = await serve_node(handler, port, options.hostname, closeTimeout);
  } else {
    throw new Error(
      `serve() has no server for this runtime (${runtime}): ` +
        "give app.handler to the runtime's own entry point",
    );
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
      await new Promise<void>((resolve) => {
        idle = resolve;
        if (in_flight === 0) {
          resolve();
        } else {
          timer = setTimeout(resolve, close_timeout);
        }
      });
      clearTimeout(timer);
      // Closes the server, and what is still in flight with it.
      cut.abort();
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
 * @returns The server, once it is listening.
 */
export async function serve_node(
  handler: ServeHandler,
  port: number,
  hostname?: string,
  close_timeout?: number,
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
        () => native.closeAllConnections(),
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
