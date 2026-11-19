/**
 * Tests for the sockets of an application over real connections: `serve` on
 * Deno, Bun and Node.js, with the `WebSocket` client of each runtime.
 *
 * The tests are the same on the three runtimes: what differs is who upgrades
 * the connection (`socket.ts` on Deno, the callbacks of `Bun.serve`, and the
 * protocol of `ws-protocol.ts` on Node.js). A runtime with no server skips
 * them. Decorators are applied as plain function calls.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { engine } from "@chojs/core/utils";
import {
  type AnyMethodDecorator,
  capture,
  legacy,
  loose,
} from "@chojs/core/utils/test_utils";
import { Param } from "./args.ts";
import type { ChoWebContext } from "./context.ts";
import {
  Args,
  Controller,
  Get,
  Middlewares,
  Module,
  Ws,
  WsClose,
  WsMessage,
  WsOpen,
} from "./decorators.ts";
import { HttpError } from "./http-error.ts";
import {
  bunOptions,
  type ChoWebServer,
  nodeUpgrade,
  serve,
  type ServeOptions,
} from "./serve.ts";
import type { ChoWebMiddlewareFn, ChoWebSocket } from "./types.ts";
import { ChoWeb } from "./web.ts";

type Class = new () => object;
// deno-lint-ignore no-explicit-any
type Fn = (...args: any[]) => unknown;
type Methods = { join?: Fn; open?: Fn; message?: Fn; close?: Fn };

const RUNTIME = engine();
const SERVES = ["deno", "node", "bun"].includes(RUNTIME);
/** `describe`, skipped on a runtime with no server. */
const served = SERVES ? describe : describe.skip;

/** A controller, `Chat`, at `chat`, with a socket at `:room`. */
function chat(methods: Methods = {}, ...decorations: AnyMethodDecorator[]) {
  class Chat {
    join(...args: unknown[]) {
      return methods.join?.apply(this, args);
    }
    open(...args: unknown[]) {
      return methods.open?.apply(this, args);
    }
    message(...args: unknown[]) {
      return methods.message?.apply(this, args);
    }
    close(...args: unknown[]) {
      return methods.close?.apply(this, args);
    }
    info() {
      return { ok: true };
    }
  }
  legacy(Ws(":room"), Chat, "join");
  for (const decoration of decorations) {
    legacy(decoration, Chat, "join");
  }
  if (methods.open) legacy(loose(WsOpen()), Chat, "open");
  if (methods.message) legacy(loose(WsMessage()), Chat, "message");
  if (methods.close) legacy(loose(WsClose()), Chat, "close");
  legacy(Get(""), Chat, "info");
  Controller({ route: "chat" })(Chat);
  return Chat;
}

/** The application of a controller, served on a free port. */
async function start(controller: Class, options: ServeOptions = {}) {
  class Feature {}
  Module({ controllers: [controller] })(Feature);
  const app = await ChoWeb.create(Feature);
  const server = await serve(app, {
    port: 0,
    hostname: "127.0.0.1",
    ...options,
  });
  return { app, server };
}

/** Close a server and its application. */
async function stop(server: ChoWebServer, app: ChoWeb<unknown>) {
  await server.close();
  await app.close();
}

/** A client: what it received, and how its connection ended. */
type Client = {
  ws: WebSocket;
  /** What arrived, in order: text as a string, binary as bytes. */
  received: (string | Uint8Array)[];
  /** Resolves with `true` once it is open, `false` when it never opened. */
  opened: Promise<boolean>;
  /** Resolves when the connection is closed, with its code and reason. */
  closed: Promise<{ code: number; reason: string }>;
  /** Wait until `count` messages have arrived. */
  got(count: number): Promise<(string | Uint8Array)[]>;
};

/** Connect a `WebSocket` client to a server. */
function connect(server: ChoWebServer, path = "/chat/lobby"): Client {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}${path}`);
  ws.binaryType = "arraybuffer";
  const received: (string | Uint8Array)[] = [];
  let arrived = () => {};
  ws.addEventListener("message", (event) => {
    received.push(
      typeof event.data === "string" ? event.data : new Uint8Array(event.data),
    );
    arrived();
  });
  // A client that is refused has an error event: it is expected.
  ws.addEventListener("error", () => {});
  const closed = new Promise<{ code: number; reason: string }>((resolve) => {
    ws.addEventListener(
      "close",
      (event) => resolve({ code: event.code, reason: event.reason }),
    );
  });
  const opened = new Promise<boolean>((resolve) => {
    ws.addEventListener("open", () => resolve(true));
    closed.then(() => resolve(false));
  });
  const got = (count: number) =>
    new Promise<(string | Uint8Array)[]>((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            new Error(`got ${received.length} of ${count} messages in 5 s`),
          ),
        5000,
      );
      arrived = () => {
        if (received.length >= count) {
          clearTimeout(timer);
          resolve(received);
        }
      };
      arrived();
    });
  return { ws, received, opened, closed, got };
}

/** Wait until something is true, for 5 seconds at most. */
async function until(what: () => boolean, name: string): Promise<void> {
  const end = Date.now() + 5000;
  while (!what()) {
    if (Date.now() > end) {
      throw new Error(`timeout: ${name}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

served(`a socket, served on ${RUNTIME}`, () => {
  it("sends the first message, what @WsOpen returns, and the replies", async () => {
    const { app, server } = await start(chat({
      join: () => ({ joined: "lobby" }),
      open: () => "welcome",
      message: (data: string | Uint8Array) =>
        typeof data === "string" ? `echo ${data}` : data,
    }));
    const client = connect(server);
    assert.equal(await client.opened, true);
    await client.got(2);
    client.ws.send("hello");
    client.ws.send(new Uint8Array([1, 2, 3]));
    assert.deepEqual(await client.got(4), [
      '{"joined":"lobby"}',
      "welcome",
      "echo hello",
      new Uint8Array([1, 2, 3]),
    ]);
    client.ws.close();
    await client.closed;
    await stop(server, app);
  });

  it("gives a message as a string or as a Uint8Array, and the context of the request", async () => {
    const seen: unknown[] = [];
    const tag: ChoWebMiddlewareFn = (ctx, next) => {
      ctx.state.set("version", ctx.url.searchParams.get("v"));
      return next();
    };
    const { app, server } = await start(chat(
      {
        join: (room: string) => `joined ${room}`,
        message(data: string | Uint8Array, socket: ChoWebSocket) {
          seen.push([
            typeof data === "string" ? "string" : data.constructor.name,
            typeof data === "string" ? data : [...data],
            socket.ctx.params.room,
            socket.ctx.state.get("version"),
          ]);
          return "seen";
        },
      },
      loose(Middlewares(tag)),
      loose(Args(Param("room"))),
    ));
    const client = connect(server, "/chat/kitchen?v=2");
    await client.got(1);
    client.ws.send("text");
    client.ws.send(new Uint8Array([9, 8]));
    assert.deepEqual(await client.got(3), ["joined kitchen", "seen", "seen"]);
    assert.deepEqual(seen, [
      ["string", "text", "kitchen", "2"],
      ["Uint8Array", [9, 8], "kitchen", "2"],
    ]);
    client.ws.close();
    await client.closed;
    await stop(server, app);
  });

  it("keeps the order of many messages, with an asynchronous handler", async () => {
    const { app, server } = await start(chat({
      async message(data: string) {
        // the earlier a message, the longer it takes
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, 5 - Number(data)))
        );
        return data;
      },
    }));
    const client = connect(server);
    await client.opened;
    const sent = Array.from({ length: 40 }, (_, index) => String(index));
    for (const text of sent) {
      client.ws.send(text);
    }
    assert.deepEqual(await client.got(40), sent);
    client.ws.close();
    await client.closed;
    await stop(server, app);
  });

  it("carries a large message, text and binary", async () => {
    const { app, server } = await start(chat({
      message: (data: string | Uint8Array) => data,
    }));
    const client = connect(server);
    await client.opened;
    const text = "é".repeat(100_000);
    const bytes = new Uint8Array(300_000).map((_, index) => index % 251);
    client.ws.send(text);
    client.ws.send(bytes);
    const [first, second] = await client.got(2);
    assert.equal(first, text);
    assert.deepEqual(second, bytes);
    client.ws.close();
    await client.closed;
    await stop(server, app);
  });

  it("answers a request that does not ask for an upgrade with 426, and serves other routes", async () => {
    const { app, server } = await start(chat());
    const base = `http://127.0.0.1:${server.port}`;
    const plain = await fetch(`${base}/chat/lobby`);
    assert.equal(plain.status, 426);
    assert.equal(await plain.text(), "Upgrade Required");
    const other = await fetch(`${base}/chat`);
    assert.deepEqual(await other.json(), { ok: true });
    await stop(server, app);
  });

  it("refuses a connection before it opens: no socket, no event", async () => {
    const events: string[] = [];
    const deny: ChoWebMiddlewareFn = (ctx, next) =>
      ctx.params.room === "private"
        ? new Response("who are you?", { status: 401 })
        : next();
    const { app, server } = await start(chat(
      {
        join(room: string) {
          if (room === "missing") {
            throw new HttpError(404);
          }
        },
        open: () => void events.push("open"),
        close: () => void events.push("close"),
      },
      loose(Middlewares(deny)),
      loose(Args(Param("room"))),
    ));
    for (const room of ["private", "missing"]) {
      const client = connect(server, `/chat/${room}`);
      assert.equal(await client.opened, false, room);
      await client.closed;
    }
    assert.deepEqual(events, []);
    // and a room that is there opens
    const client = connect(server);
    assert.equal(await client.opened, true);
    client.ws.close();
    await client.closed;
    await until(() => events.length === 2, "the close of the open socket");
    assert.deepEqual(events, ["open", "close"]);
    await stop(server, app);
  });

  it("runs @WsClose with the code and the reason of the client", async () => {
    const closes: unknown[] = [];
    const { app, server } = await start(chat({
      close: (code: number, reason: string) => void closes.push([code, reason]),
    }));
    const client = connect(server);
    await client.opened;
    client.ws.close(4001, "done");
    assert.deepEqual(await client.closed, { code: 4001, reason: "done" });
    await until(() => closes.length === 1, "@WsClose");
    assert.deepEqual(closes, [[4001, "done"]]);
    await stop(server, app);
  });

  it("closes from the application: the client gets the code and the reason", async () => {
    const closes: unknown[] = [];
    const { app, server } = await start(chat({
      message(_data: unknown, socket: ChoWebSocket) {
        socket.close(4000, "kicked");
        return "not sent: the socket is closed";
      },
      close: (code: number, reason: string) => void closes.push([code, reason]),
    }));
    const client = connect(server);
    await client.opened;
    client.ws.send("anything");
    assert.deepEqual(await client.closed, { code: 4000, reason: "kicked" });
    await until(() => closes.length === 1, "@WsClose");
    assert.deepEqual(closes, [[4000, "kicked"]]);
    assert.deepEqual(client.received, []);
    await stop(server, app);
  });

  it("closes a socket whose method throws with 1011", async () => {
    const closes: number[] = [];
    let client!: Client;
    let app!: ChoWeb<unknown>;
    let server!: ChoWebServer;
    const { output } = await capture(async () => {
      ({ app, server } = await start(chat({
        message() {
          throw new Error("boom");
        },
        close: (code: number) => void closes.push(code),
      })));
      client = connect(server);
      await client.opened;
      client.ws.send("anything");
      assert.equal((await client.closed).code, 1011);
      await until(() => closes.length === 1, "@WsClose");
    });
    assert.deepEqual(closes, [1011]);
    assert.match(output.error.map(String).join(" "), /failed in Chat\.message/);
    await stop(server, app);
  });

  it("sends to other sockets with send()", async () => {
    const room = new Set<ChoWebSocket>();
    const { app, server } = await start(chat({
      open: (socket: ChoWebSocket) => void room.add(socket),
      message(data: string, from: ChoWebSocket) {
        for (const socket of room) {
          if (socket !== from) {
            socket.send({ from: from.ctx.url.searchParams.get("name"), data });
          }
        }
      },
      close: (_code: number, _reason: string, socket: ChoWebSocket) =>
        void room.delete(socket),
    }));
    const ada = connect(server, "/chat/lobby?name=ada");
    const bob = connect(server, "/chat/lobby?name=bob");
    await ada.opened;
    await bob.opened;
    await until(() => room.size === 2, "both sockets are open");
    ada.ws.send("hi bob");
    assert.deepEqual(await bob.got(1), ['{"from":"ada","data":"hi bob"}']);
    assert.deepEqual(ada.received, []);
    ada.ws.close();
    bob.ws.close();
    await Promise.all([ada.closed, bob.closed]);
    await until(() => room.size === 0, "both sockets are closed");
    await stop(server, app);
  });

  it("closes its open sockets with 1001 when the server closes", async () => {
    const closes: unknown[] = [];
    const { app, server } = await start(
      chat({
        close: (code: number, reason: string) =>
          void closes.push([code, reason]),
      }),
      { closeTimeout: 2000 },
    );
    const first = connect(server);
    const second = connect(server, "/chat/kitchen");
    await first.opened;
    await second.opened;
    await server.close();
    // The reason the client reads is the runtime's own on Deno.
    assert.equal((await first.closed).code, 1001);
    assert.equal((await second.closed).code, 1001);
    assert.deepEqual(closes, [[1001, "Going Away"], [1001, "Going Away"]]);
    await app.close();
  });

  it("closes a socket whose message is above maxPayload with 1009", {
    skip: RUNTIME === "deno" && "Deno has no limit to set",
  }, async () => {
    const seen: number[] = [];
    const closes: number[] = [];
    const { app, server } = await start(
      chat({
        message: (data: string) => void seen.push(data.length),
        close: (code: number) => void closes.push(code),
      }),
      { maxPayload: 1000 },
    );
    const client = connect(server);
    await client.opened;
    client.ws.send("a".repeat(1000));
    client.ws.send("a".repeat(1001));
    const { code } = await client.closed;
    // Bun cuts the connection; Node.js says why first.
    assert.equal(code === 1009 || code === 1006, true, String(code));
    await until(() => closes.length === 1, "@WsClose");
    assert.deepEqual(seen, [1000]);
    await stop(server, app);
  });

  it("checks the maxPayload option", async () => {
    for (const maxPayload of [0, -1, 1.5, Number.NaN]) {
      await assert.rejects(serve(() => new Response(""), { maxPayload }), {
        code: "CHO_WEB_INVALID_OPTION",
        message:
          /^serve\(\): maxPayload must be a positive whole number of bytes, got /,
      });
    }
  });
});

(RUNTIME === "deno" ? describe : describe.skip)(
  "a socket, on Deno.serve with app.handler alone",
  () => {
    it("is upgraded by the handler of the application", async () => {
      class Feature {}
      Module({ controllers: [chat({ message: (data: string) => data })] })(
        Feature,
      );
      const app = await ChoWeb.create(Feature);
      const deno = (globalThis as unknown as {
        Deno: {
          serve(
            options: { port: number; hostname: string; onListen(): void },
            handler: (req: Request) => Promise<Response>,
          ): { addr: { port: number }; shutdown(): Promise<void> };
        };
      }).Deno;
      const native = deno.serve(
        { port: 0, hostname: "127.0.0.1", onListen() {} },
        app.handler,
      );
      const client = connect(
        { port: native.addr.port } as ChoWebServer,
      );
      assert.equal(await client.opened, true);
      client.ws.send("direct");
      assert.deepEqual(await client.got(1), ["direct"]);
      // the application closes its sockets itself
      await app.close();
      assert.equal((await client.closed).code, 1001);
      await native.shutdown();
    });
  },
);

(RUNTIME === "bun" ? describe : describe.skip)(
  "a socket, on a Bun.serve of your own",
  () => {
    it("is upgraded with bunOptions()", async () => {
      class Feature {}
      Module({ controllers: [chat({ message: (data: string) => data })] })(
        Feature,
      );
      const app = await ChoWeb.create(Feature);
      const bun = (globalThis as unknown as {
        Bun: {
          serve(options: object): { port: number; stop(force?: boolean): void };
        };
      }).Bun;
      const native = bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        ...bunOptions(app),
      });
      const client = connect({ port: native.port } as ChoWebServer);
      assert.equal(await client.opened, true);
      client.ws.send("own server");
      assert.deepEqual(await client.got(1), ["own server"]);
      const page = await fetch(`http://127.0.0.1:${native.port}/chat`);
      assert.deepEqual(await page.json(), { ok: true });
      await app.close();
      assert.equal((await client.closed).code, 1001);
      native.stop(true);
    });

    it("checks what it is given", () => {
      assert.throws(() => bunOptions(loose({})), {
        code: "CHO_WEB_INVALID_HANDLER",
        message:
          "bunOptions() expects an application, or a request handler such as app.handler",
      });
    });
  },
);

(RUNTIME === "node" ? describe : describe.skip)(
  "a socket, on Node.js: the protocol on the connection",
  () => {
    type Net = typeof import("node:net");
    type Socket = import("node:net").Socket;

    /** A masked frame, as a client sends it. */
    function frame(
      opcode: number,
      payload: Uint8Array | string = "",
      options: { fin?: boolean; masked?: boolean } = {},
    ): Uint8Array {
      const { fin = true, masked = true } = options;
      const data = typeof payload === "string"
        ? new TextEncoder().encode(payload)
        : payload;
      const mask = [1, 2, 3, 4];
      const bytes = [
        (fin ? 0x80 : 0) | opcode,
        (masked ? 0x80 : 0) | data.length,
      ];
      if (masked) bytes.push(...mask);
      for (let i = 0; i < data.length; i++) {
        bytes.push(masked ? data[i]! ^ mask[i & 3]! : data[i]!);
      }
      return new Uint8Array(bytes);
    }

    /** A raw connection: what the server wrote, and its end. */
    async function raw(server: ChoWebServer, request: string) {
      const net: Net = await import("node:net");
      const socket: Socket = net.connect(server.port, "127.0.0.1");
      const chunks: Uint8Array[] = [];
      socket.on("data", (chunk) => chunks.push(new Uint8Array(chunk)));
      const ended = new Promise<void>((resolve) => socket.on("close", resolve));
      await new Promise<void>((resolve) => socket.on("connect", resolve));
      socket.write(request);
      const all = () => {
        const whole = new Uint8Array(
          chunks.reduce((size, chunk) => size + chunk.length, 0),
        );
        let at = 0;
        for (const chunk of chunks) {
          whole.set(chunk, at);
          at += chunk.length;
        }
        return whole;
      };
      /** The bytes after the headers of the answer. */
      const body = () => {
        const whole = all();
        const text = new TextDecoder("latin1").decode(whole);
        const end = text.indexOf("\r\n\r\n");
        return end < 0 ? new Uint8Array(0) : whole.subarray(end + 4);
      };
      const head = () =>
        new TextDecoder("latin1").decode(all()).split("\r\n\r\n")[0]!;
      return { socket, ended, body, head };
    }

    const handshake = (path = "/chat/lobby", more = "") =>
      `GET ${path} HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\n` +
      `Connection: Upgrade\r\nSec-WebSocket-Version: 13\r\n` +
      `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n${more}\r\n`;

    it("answers the handshake, with the headers of the middlewares", async () => {
      const stamp: ChoWebMiddlewareFn = async (_ctx, next) => {
        const response = await next();
        response.headers.set("x-request-id", "r1");
        response.headers.append("set-cookie", "a=1");
        response.headers.append("set-cookie", "b=2");
        return response;
      };
      const { app, server } = await start(chat({}, loose(Middlewares(stamp))));
      const connection = await raw(server, handshake());
      await until(() => connection.head().includes("\r\n"), "the answer");
      const head = connection.head().toLowerCase();
      assert.match(head, /^http\/1\.1 101 switching protocols/);
      // the example of the RFC
      assert.match(head, /sec-websocket-accept: s3pplmbitxaq9kygzzhzrbk\+xoo=/);
      assert.match(head, /x-request-id: r1/);
      assert.match(head, /set-cookie: a=1\r\nset-cookie: b=2/);
      assert.doesNotMatch(head, /content-length|content-type/);
      connection.socket.destroy();
      await stop(server, app);
    });

    it("answers a ping, joins fragments, and answers a close", async () => {
      const { app, server } = await start(chat({
        message: (data: string) => `echo ${data}`,
      }));
      const connection = await raw(server, handshake());
      await until(() => connection.head().length > 0, "the handshake");
      connection.socket.write(frame(9, "are you there?"));
      connection.socket.write(frame(1, "Hel", { fin: false }));
      connection.socket.write(frame(0, "lo"));
      // the pong (16 bytes) and the reply (12): a reply is not sent once the
      // close of the client has arrived
      await until(() => connection.body().length >= 28, "the reply");
      connection.socket.write(frame(8, new Uint8Array([0x03, 0xe8])));
      await connection.ended;
      const text = new TextEncoder();
      assert.deepEqual([...connection.body()], [
        // a pong, with the payload of the ping
        0x8a,
        14,
        ...text.encode("are you there?"),
        // the reply to the joined message
        0x81,
        10,
        ...text.encode("echo Hello"),
        // the close, with the code of the client
        0x88,
        2,
        0x03,
        0xe8,
      ]);
      await stop(server, app);
    });

    it("reads frames that came with the handshake, in one write", async () => {
      const seen: unknown[] = [];
      const { app, server } = await start(chat({
        message: (data: string) => void seen.push(data),
      }));
      const bytes = [
        ...new TextEncoder().encode(handshake()),
        ...frame(1, "early"),
      ];
      const net = await import("node:net");
      const socket = net.connect(server.port, "127.0.0.1");
      await new Promise<void>((resolve) => socket.on("connect", resolve));
      socket.write(new Uint8Array(bytes));
      await until(() => seen.length === 1, "the early message");
      assert.deepEqual(seen, ["early"]);
      socket.destroy();
      await stop(server, app);
    });

    it("closes with 1002 for a frame that is not masked, and runs @WsClose", async () => {
      const closes: unknown[] = [];
      const { app, server } = await start(chat({
        close: (code: number, reason: string) =>
          void closes.push([code, reason]),
      }));
      const connection = await raw(server, handshake());
      await until(() => connection.head().length > 0, "the handshake");
      connection.socket.write(frame(1, "x", { masked: false }));
      await connection.ended;
      assert.deepEqual([...connection.body()].slice(0, 4), [
        0x88,
        36,
        0x03,
        0xea,
      ]);
      assert.deepEqual(closes, [[
        1002,
        "A frame of a client must be masked",
      ]]);
      await stop(server, app);
    });

    it("runs @WsClose with 1006 for a connection that is cut", async () => {
      const closes: number[] = [];
      const { app, server } = await start(chat({
        close: (code: number) => void closes.push(code),
      }));
      const connection = await raw(server, handshake());
      await until(() => connection.head().length > 0, "the handshake");
      connection.socket.destroy();
      await until(() => closes.length === 1, "@WsClose");
      assert.deepEqual(closes, [1006]);
      await stop(server, app);
    });

    it("refuses a handshake that is not valid, and answers a refusal of the route", async () => {
      const deny: ChoWebMiddlewareFn = (ctx, next) =>
        ctx.params.room === "private"
          ? Response.json({ error: "who are you?" }, { status: 401 })
          : next();
      const { app, server } = await start(chat({}, loose(Middlewares(deny))));
      const cases: [string, RegExp, RegExp][] = [
        [
          handshake().replace("Version: 13", "Version: 8"),
          /^HTTP\/1\.1 426 Upgrade Required/,
          /sec-websocket-version: 13/,
        ],
        [
          handshake().replace("dGhlIHNhbXBsZSBub25jZQ==", "short"),
          /^HTTP\/1\.1 400 Bad Request/,
          /connection: close/,
        ],
        [
          handshake("/chat/private"),
          /^HTTP\/1\.1 401 Unauthorized/,
          /content-type: application\/json/,
        ],
        [
          handshake("/nowhere"),
          /^HTTP\/1\.1 404 Not Found/,
          /connection: close/,
        ],
      ];
      for (const [request, status, header] of cases) {
        const connection = await raw(server, request);
        await connection.ended;
        assert.match(connection.head(), status);
        assert.match(connection.head().toLowerCase(), header);
      }
      const refused = await raw(server, handshake("/chat/private"));
      await refused.ended;
      assert.equal(
        new TextDecoder().decode(refused.body()),
        '{"error":"who are you?"}',
      );
      await stop(server, app);
    });

    it("upgrades on a node:http server of your own, with nodeUpgrade()", async () => {
      class Feature {}
      Module({ controllers: [chat({ message: (data: string) => data })] })(
        Feature,
      );
      const app = await ChoWeb.create(Feature);
      const { createServer } = await import("node:http");
      const native = createServer((_request, response) => {
        response.end("mine");
      });
      native.on("upgrade", nodeUpgrade(app));
      await new Promise<void>((resolve) =>
        native.listen(0, "127.0.0.1", resolve)
      );
      const { port } = native.address() as { port: number };
      const client = connect({ port } as ChoWebServer);
      assert.equal(await client.opened, true);
      client.ws.send("own server");
      assert.deepEqual(await client.got(1), ["own server"]);
      await app.close();
      assert.equal((await client.closed).code, 1001);
      await new Promise((resolve) => native.close(resolve));
    });

    it("checks what nodeUpgrade() is given", () => {
      assert.throws(() => nodeUpgrade(loose(null)), {
        code: "CHO_WEB_INVALID_HANDLER",
      });
      assert.throws(() =>
        nodeUpgrade({ handler: () => new Response() }, {
          maxPayload: 0,
        }), {
        code: "CHO_WEB_INVALID_OPTION",
        message: /^nodeUpgrade\(\): maxPayload must be/,
      });
    });
  },
);

// What the context of the test file is for.
export type { ChoWebContext };
