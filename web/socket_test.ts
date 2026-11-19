/**
 * Tests for the sockets of an application: `@Ws`, `@WsOpen`, `@WsMessage` and
 * `@WsClose`, from the decorators to the methods of the controller.
 *
 * No connection is opened: `app.upgrade` gives the upgrade a route accepted,
 * and the tests give it a connection of their own, which records what is
 * sent. So they run on every runtime. Decorators are applied as plain
 * function calls.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  type AnyMethodDecorator,
  capture,
  legacy,
  loose,
  tc39,
  tc39_record,
  with_env,
} from "@chojs/core/utils/test_utils";
import { Param, Query } from "./args.ts";
import type { ChoWebContext } from "./context.ts";
import {
  Args,
  Catch,
  Controller,
  Doc,
  Get,
  Middlewares,
  Module,
  Ws,
  WsClose,
  WsMessage,
  WsOpen,
} from "./decorators.ts";
import { HttpError } from "./http-error.ts";
import { HTTP, WS } from "./keys.ts";
import { to_message } from "./socket.ts";
import { TestLinker } from "./testing.ts";
import type {
  ChoWebMiddlewareFn,
  ChoWebSocket,
  ChoWebUpgrade,
} from "./types.ts";
import { validate } from "./validate.ts";
import { ChoWeb } from "./web.ts";

type Class = new () => object;
// deno-lint-ignore no-explicit-any
type Fn = (...args: any[]) => unknown;

/** The methods of a controller with a socket: each runs on the controller. */
type Methods = { join?: Fn; open?: Fn; message?: Fn; close?: Fn };

/**
 * A controller, `Chat`, at `chat`, with a `@Ws` method at `:room`, and a
 * method for each event that is given.
 *
 * @param methods What each method does.
 * @param decorations Other decorators of the `@Ws` method.
 */
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
  }
  legacy(Ws(":room"), Chat, "join");
  for (const decoration of decorations) {
    legacy(decoration, Chat, "join");
  }
  if (methods.open) legacy(loose(WsOpen()), Chat, "open");
  if (methods.message) legacy(loose(WsMessage()), Chat, "message");
  if (methods.close) legacy(loose(WsClose()), Chat, "close");
  Controller({ route: "chat" })(Chat);
  return Chat;
}

/** Create the application of controllers, with the test linker. */
async function create(...controllers: Class[]) {
  class Feature {}
  Module({ controllers })(Feature);
  const linker = new TestLinker();
  const app = await ChoWeb.create(Feature, { linker });
  return { app, linker };
}

/** A request that asks for a WebSocket. */
function asking(path = "/chat/lobby", headers: Record<string, string> = {}) {
  return new Request(`http://localhost${path}`, {
    headers: { upgrade: "websocket", connection: "Upgrade", ...headers },
  });
}

/** A connection of the tests: it records what the application does. */
type Wire = {
  /** What was sent, in order. */
  sent: (string | Uint8Array)[];
  /** The closes the application asked for. */
  closes: [number, string][];
  /** Give a message to the socket. */
  message(data: string | Uint8Array): void;
  /** Tell the socket its connection is closed. */
  closed(code?: number, reason?: string): void;
  /** The headers for the `101`. */
  headers: Headers;
};

/** Accept an upgrade with a connection that records. */
function accept(upgrade: ChoWebUpgrade): Wire {
  const sent: (string | Uint8Array)[] = [];
  const closes: [number, string][] = [];
  const events = upgrade.accept({
    send: (data) => void sent.push(data),
    close: (code, reason) => void closes.push([code, reason]),
    native: "the socket of the runtime",
  });
  return {
    sent,
    closes,
    message: events.message,
    closed: (code = 1000, reason = "") => events.closed(code, reason),
    headers: upgrade.headers,
  };
}

/** Ask an application for a socket, and accept it. */
async function connect(
  app: ChoWeb<unknown>,
  path?: string,
  headers?: Record<string, string>,
): Promise<Wire> {
  const upgrade = await app.upgrade(asking(path, headers));
  if (upgrade instanceof Response) {
    assert.fail(`the upgrade was refused with ${upgrade.status}`);
  }
  return accept(upgrade);
}

/** Wait for what a socket has to do: every event that was given. */
const settle = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wait some milliseconds, in a method. */
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The record a decorator applied with `tc39` wrote on a method. */
function record_of(fn: Fn, name: string): Record<symbol, unknown> {
  return (tc39_record(fn, name) ?? {}) as Record<symbol, unknown>;
}

/** No debug logging, whatever the environment of the test run says. */
const OFF = { CHO_DEBUG: undefined, CHO_DEBUGLOG: undefined };

describe("@Ws, @WsOpen, @WsMessage and @WsClose", () => {
  it("writes a GET route that upgrades, in both call shapes", () => {
    class A {
      join() {}
    }
    legacy(Ws("rooms/:id"), A, "join");
    assert.deepEqual(
      Object.getOwnPropertyDescriptor(A.prototype, "join")!.value as Fn,
      A.prototype.join,
    );
    class B {
      join() {}
    }
    tc39(Ws(), B.prototype.join, "join");
    assert.deepEqual(record_of(B.prototype.join, "join")[HTTP], {
      method: "GET",
      route: "",
      socket: true,
    });
  });

  it("writes the event of each event decorator, in both call shapes", () => {
    for (
      const [decorator, event] of [
        [WsOpen(), "open"],
        [WsMessage(), "message"],
        [WsClose(), "close"],
      ] as const
    ) {
      class A {
        on() {}
      }
      tc39(loose(decorator), A.prototype.on, "on");
      assert.equal(record_of(A.prototype.on, "on")[WS], event);
      // the legacy shape: the application below is created with it
      class B {
        on() {}
      }
      assert.doesNotThrow(() => legacy(loose(decorator), B, "on"));
    }
  });

  it("refuses a route that is not valid", () => {
    class A {
      join() {}
    }
    assert.throws(() => legacy(Ws("/rooms"), A, "join"), {
      code: "CHO_WEB_INVALID_ROUTE",
    });
  });

  it("refuses a method that already handles a request, or an event", () => {
    const pairs: [AnyMethodDecorator, AnyMethodDecorator, RegExp][] = [
      [
        Get("x"),
        loose(WsMessage()),
        /^Cannot add @WsMessage\(\) to method on: it already handles GET "x"/,
      ],
      [
        loose(WsOpen()),
        Get("x"),
        /^Cannot add @Get\(\) to method on: it already has @WsOpen\(\)/,
      ],
      [
        Ws("x"),
        loose(WsClose()),
        /^Cannot add @WsClose\(\) to method on: it already handles GET "x"/,
      ],
      [
        loose(WsClose()),
        Ws("x"),
        /^Cannot add @Ws\(\) to method on: it already has @WsClose\(\)/,
      ],
      [
        loose(WsOpen()),
        loose(WsMessage()),
        /^Cannot add @WsMessage\(\) to method on: it already has @WsOpen\(\)/,
      ],
      [
        Ws("x"),
        Ws("y"),
        /^Cannot add @Ws\(\) to method on: it already handles GET "x"/,
      ],
    ];
    for (const [first, second, message] of pairs) {
      class A {
        on() {}
      }
      legacy(first, A, "on");
      assert.throws(() => legacy(second, A, "on"), {
        code: "CHO_WEB_DUPLICATE_DECORATOR",
        message,
      });
    }
  });

  it("refuses a method that is static, private, or named by a symbol", () => {
    for (const decorator of [WsOpen(), WsMessage(), WsClose()]) {
      const on = loose(decorator);
      assert.throws(() => tc39(on, () => {}, Symbol("on")), {
        code: "CHO_WEB_INVALID_TARGET",
        message: /must have a string name$/,
      });
      assert.throws(() => tc39(on, () => {}, "on", { isStatic: true }), {
        code: "CHO_WEB_INVALID_TARGET",
        message: /must not be static$/,
      });
      assert.throws(() => tc39(on, () => {}, "#on", { isPrivate: true }), {
        code: "CHO_WEB_INVALID_TARGET",
        message: /must be public$/,
      });
    }
  });
});

describe("a controller with a socket", () => {
  it("is in the graph, with its event methods, and its route says it upgrades", async () => {
    const { app } = await create(
      chat({ open() {}, message() {}, close() {} }),
    );
    const [method] = app.graph.features[0]!.controllers[0]!.methods;
    assert.deepEqual(
      [method!.name, method!.method, method!.route],
      ["join", "GET", ":room"],
    );
    assert.deepEqual(
      Object.entries(method!.socket ?? {}).map(([event, ref]) => [
        event,
        ref.name,
        typeof ref.handler,
      ]),
      [["open", "open", "function"], ["message", "message", "function"], [
        "close",
        "close",
        "function",
      ]],
    );
    assert.deepEqual(
      app.routes.map((route) => [route.method, route.path, route.socket]),
      [["GET", "/chat/:room", true]],
    );
  });

  it("needs no event method, and has other handlers next to its socket", async () => {
    class Chat {
      join() {}
      history() {
        return ["hello"];
      }
    }
    legacy(Ws("live"), Chat, "join");
    legacy(Get("history"), Chat, "history");
    Controller({ route: "chat" })(Chat);
    const { app } = await create(Chat);
    assert.deepEqual(
      app.graph.features[0]!.controllers[0]!.methods[0]!.socket,
      {},
    );
    const history = app.routes.find((route) => route.path === "/chat/history");
    assert.equal(history?.socket, undefined);
    assert.deepEqual(
      await (await app.handler(new Request("http://localhost/chat/history")))
        .json(),
      ["hello"],
    );
    const wire = await connect(app, "/chat/live");
    await settle();
    assert.deepEqual(wire.sent, []);
  });

  it("has one socket: one method for each of the four decorators", async () => {
    for (
      const [decorator, name] of [
        [Ws("b"), "@Ws()"],
        [loose(WsOpen()), "@WsOpen()"],
        [loose(WsMessage()), "@WsMessage()"],
        [loose(WsClose()), "@WsClose()"],
      ] as const
    ) {
      class Chat {
        join() {}
        first() {}
        second() {}
      }
      legacy(Ws("a"), Chat, "join");
      // "join" is the first @Ws; for an event, "first" is the first one
      if (name !== "@Ws()") {
        legacy(decorator, Chat, "first");
      }
      legacy(decorator, Chat, "second");
      Controller()(Chat);
      await assert.rejects(create(Chat), {
        code: "CHO_WEB_INVALID_SOCKET",
        message: `Controller Chat has two ${name} methods, ${
          name === "@Ws()" ? "join" : "first"
        } and second: a controller has one socket, and one method for each of its events. Put the second socket in a controller of its own`,
      });
    }
  });

  it("needs a @Ws method for its event methods", async () => {
    class Chat {
      open() {}
      message() {}
      list() {}
    }
    legacy(loose(WsOpen()), Chat, "open");
    legacy(loose(WsMessage()), Chat, "message");
    Controller()(Chat);
    const expected = {
      code: "CHO_WEB_INVALID_SOCKET",
      message:
        "Controller Chat has @WsOpen(), @WsMessage() and no @Ws() method: the events of a socket need the method that upgrades the request",
    };
    // a controller with no route handler at all is not left out silently
    await assert.rejects(create(Chat), expected);
    legacy(Get("list"), Chat, "list");
    await assert.rejects(create(Chat), expected);
  });

  it("refuses @Middlewares, @Catch, @Args and @Doc on an event method", async () => {
    const pass: ChoWebMiddlewareFn = (_ctx, next) => next();
    for (
      const [decoration, name] of [
        [loose(Middlewares(pass)), "@Middlewares()"],
        [loose(Catch(() => new Response())), "@Catch()"],
        [loose(Args(Param("room"))), "@Args()"],
        [loose(Doc({ summary: "x" })), "@Doc()"],
      ] as const
    ) {
      class Chat {
        join() {}
        message() {}
      }
      legacy(Ws(":room"), Chat, "join");
      legacy(loose(WsMessage()), Chat, "message");
      legacy(decoration, Chat, "message");
      Controller()(Chat);
      await assert.rejects(create(Chat), {
        code: "CHO_WEB_INVALID_SOCKET",
        message:
          `@WsMessage() method Chat.message cannot have ${name}: an event of a socket has no request. Put ${name} on the @Ws() method of the controller, which handles the request that is upgraded`,
      });
    }
  });

  it("is a route like any other: two with one path are refused", async () => {
    class Chat {
      join() {}
      page() {}
    }
    legacy(Ws("x"), Chat, "join");
    legacy(Get("x"), Chat, "page");
    Controller()(Chat);
    await assert.rejects(create(Chat), { code: "CHO_WEB_DUPLICATE_ROUTE" });
  });
});

describe("to_message", () => {
  it("sends a string and bytes as they are, anything else as JSON", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    assert.equal(to_message(undefined, "x"), undefined);
    assert.equal(to_message("text", "x"), "text");
    assert.equal(to_message("", "x"), "");
    assert.equal(to_message(bytes, "x"), bytes);
    assert.deepEqual(to_message(bytes.buffer, "x"), bytes);
    // a view gives its own bytes, not those of its whole buffer
    const view = new DataView(new Uint8Array([9, 1, 2, 9]).buffer, 1, 2);
    assert.deepEqual(to_message(view, "x"), new Uint8Array([1, 2]));
    assert.deepEqual(
      to_message(new Uint16Array([258]), "x"),
      new Uint8Array(new Uint16Array([258]).buffer),
    );
    assert.equal(to_message({ ok: true }, "x"), '{"ok":true}');
    assert.equal(to_message([1, "a"], "x"), '[1,"a"]');
    assert.equal(to_message(null, "x"), "null");
    assert.equal(to_message(42, "x"), "42");
    assert.equal(to_message(false, "x"), "false");
  });

  it("refuses a value that has no JSON", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    for (const value of [() => {}, Symbol("s"), 10n, circular]) {
      assert.throws(() => to_message(value, "Chat.message"), {
        code: "CHO_WEB_INVALID_SOCKET_RESULT",
        message:
          /^Chat\.message gave a value that cannot be sent on a socket: expected a string, bytes or a value JSON can hold, got /,
      });
    }
  });
});

describe("the upgrade of a request", () => {
  it("answers 426 to a request that does not ask for it, and runs nothing", async () => {
    let ran = 0;
    const counting: ChoWebMiddlewareFn = (_ctx, next) => {
      ran++;
      return next();
    };
    const { app } = await create(
      chat({ join: () => void ran++ }, loose(Middlewares(counting))),
    );
    for (
      const request of [
        new Request("http://localhost/chat/lobby"),
        new Request("http://localhost/chat/lobby", {
          headers: { upgrade: "h2c" },
        }),
      ]
    ) {
      for (const answer of [app.handler(request), app.upgrade(request)]) {
        const response = await answer;
        assert.ok(response instanceof Response);
        assert.equal(response.status, 426);
        assert.equal(response.headers.get("upgrade"), "websocket");
        assert.equal(await response.text(), "Upgrade Required");
      }
    }
    assert.equal(ran, 0);
  });

  it("reads the Upgrade header in any case, among others", async () => {
    const { app } = await create(chat());
    for (const upgrade of ["WebSocket", "h2c, websocket", " websocket "]) {
      const answer = await app.upgrade(asking("/chat/lobby", { upgrade }));
      assert.equal(answer instanceof Response, false);
    }
  });

  it("runs the middlewares and the handler, with its arguments, once", async () => {
    const seen: unknown[] = [];
    const audit: ChoWebMiddlewareFn = (ctx, next) => {
      seen.push(`middleware ${ctx.url.pathname}`);
      return next();
    };
    const { app } = await create(
      chat(
        {
          join(room: string, page: string, ctx: ChoWebContext) {
            seen.push(["join", room, page, ctx.req.method]);
          },
        },
        loose(Middlewares(audit)),
        loose(Args(Param("room"), Query("page"))),
      ),
    );
    const wire = await connect(app, "/chat/lobby?page=2");
    wire.message("a");
    wire.message("b");
    await settle();
    assert.deepEqual(seen, ["middleware /chat/lobby", [
      "join",
      "lobby",
      "2",
      "GET",
    ]]);
  });

  it("is refused by a middleware, an HttpError, a Response and an error handler", async () => {
    const events: string[] = [];
    const record = { open: () => void events.push("open") };
    const deny: ChoWebMiddlewareFn = () =>
      new Response("who are you?", { status: 401 });
    const cases: [Class, number, string][] = [
      [chat(record, loose(Middlewares(deny))), 401, "who are you?"],
      [
        chat({
          ...record,
          join() {
            throw new HttpError(404, "no such room");
          },
        }),
        404,
        "no such room",
      ],
      [
        chat({
          ...record,
          join: () => new Response("full", { status: 409 }),
        }),
        409,
        "full",
      ],
      [
        chat(
          {
            ...record,
            join() {
              throw new Error("down");
            },
          },
          loose(Catch(() => new Response("later", { status: 503 }))),
        ),
        503,
        "later",
      ],
    ];
    for (const [controller, status, body] of cases) {
      const { app } = await create(controller);
      const answer = await app.upgrade(asking());
      assert.ok(answer instanceof Response);
      assert.equal(answer.status, status);
      assert.match(await answer.text(), new RegExp(body));
    }
    await settle();
    assert.deepEqual(events, []);
  });

  it("validates the arguments of the handler before it upgrades", async () => {
    const number = {
      parse(value: unknown) {
        if (Number.isNaN(Number(value))) throw new Error("not a number");
        return Number(value);
      },
    };
    const seen: unknown[] = [];
    const { app } = await create(
      chat(
        { join: (page: number) => void seen.push(page) },
        loose(Args(Query("page", number))),
        loose(Middlewares(validate())),
      ),
    );
    const refused = await app.upgrade(asking("/chat/lobby?page=x"));
    assert.ok(refused instanceof Response);
    assert.equal(refused.status, 400);
    await connect(app, "/chat/lobby?page=3");
    assert.deepEqual(seen, [3]);
  });

  it("is refused by a middleware that answers with another status afterwards", async () => {
    const events: string[] = [];
    const veto: ChoWebMiddlewareFn = async (_ctx, next) => {
      await next();
      return new Response("not today", { status: 403 });
    };
    const { app } = await create(
      chat({ open: () => void events.push("open") }, loose(Middlewares(veto))),
    );
    const answer = await app.upgrade(asking());
    assert.ok(answer instanceof Response);
    assert.equal(answer.status, 403);
    await settle();
    assert.deepEqual(events, []);
  });

  it("keeps the headers a middleware added, also on a copy of the answer", async () => {
    const stamp: ChoWebMiddlewareFn = async (_ctx, next) => {
      const response = await next();
      // as `cors` and `requestId` of @chojs/vendor-cho do
      const copy = new Response(response.body, response);
      copy.headers.set("x-request-id", "r1");
      copy.headers.append("set-cookie", "seen=1");
      return copy;
    };
    const { app } = await create(chat({}, loose(Middlewares(stamp))));
    const wire = await connect(app);
    // by name: the order of the headers is the runtime's
    assert.deepEqual([...wire.headers.keys()].sort(), [
      "set-cookie",
      "x-request-id",
    ]);
    assert.equal(wire.headers.get("x-request-id"), "r1");
    assert.deepEqual(wire.headers.getSetCookie(), ["seen=1"]);
  });

  it("answers 404 where no route matches, and 503 once the application is closed", async () => {
    const { app } = await create(chat());
    const missing = await app.upgrade(asking("/nowhere"));
    assert.ok(missing instanceof Response);
    assert.equal(missing.status, 404);
    await app.close();
    const closed = await app.upgrade(asking());
    assert.ok(closed instanceof Response);
    assert.equal(closed.status, 503);
  });

  it("is accepted once", async () => {
    const { app } = await create(chat());
    const upgrade = await app.upgrade(asking());
    assert.ok(!(upgrade instanceof Response));
    accept(upgrade);
    assert.throws(() => accept(upgrade), {
      code: "CHO_WEB_INVALID_SOCKET",
      message:
        "The upgrade of Chat.join was already accepted: accept() is called once for a connection",
    });
  });

  it("is not accepted when what the handler returns cannot be sent", async () => {
    const { app, linker } = await create(chat({ join: () => 10n }));
    const answer = await app.upgrade(asking());
    assert.ok(answer instanceof Response);
    assert.equal(answer.status, 500);
    assert.equal(
      (linker.errors[0] as { code: string }).code,
      "CHO_WEB_INVALID_SOCKET_RESULT",
    );
    assert.match(
      (linker.errors[0] as Error).message,
      /^@Ws\(\) handler Chat\.join gave a value that cannot be sent/,
    );
  });
});

describe("what a method returns", () => {
  it("is the first message, for @Ws: sent before @WsOpen runs", async () => {
    const order: string[] = [];
    const { app } = await create(chat({
      join: () => ({ joined: "lobby" }),
      open() {
        order.push("open");
        return "welcome";
      },
    }));
    const wire = await connect(app);
    await settle();
    assert.deepEqual(wire.sent, ['{"joined":"lobby"}', "welcome"]);
    assert.deepEqual(order, ["open"]);
  });

  it("is sent back, for @WsMessage: text, bytes, or JSON", async () => {
    const bytes = new Uint8Array([7, 8]);
    const replies: unknown[] = [
      "text",
      bytes,
      bytes.buffer,
      { n: 1 },
      null,
      0,
      "",
    ];
    const { app } = await create(chat({ message: () => replies.shift() }));
    const wire = await connect(app);
    for (let i = replies.length; i > 0; i--) {
      wire.message("next");
    }
    await settle();
    assert.deepEqual(wire.sent, [
      "text",
      bytes,
      bytes,
      '{"n":1}',
      "null",
      "0",
      "",
    ]);
  });

  it("sends nothing when nothing is returned", async () => {
    const { app } = await create(chat({
      join() {},
      open() {},
      message() {},
    }));
    const wire = await connect(app);
    wire.message("a");
    await settle();
    assert.deepEqual(wire.sent, []);
  });

  it("is awaited, for every method", async () => {
    const { app } = await create(chat({
      join: async () => {
        await wait(1);
        return "joined";
      },
      open: async () => {
        await wait(1);
        return "opened";
      },
      message: async (data: string) => {
        await wait(1);
        return `echo ${data}`;
      },
    }));
    const wire = await connect(app);
    wire.message("a");
    await settle(20);
    assert.deepEqual(wire.sent, ["joined", "opened", "echo a"]);
  });

  it("is not sent, for @WsClose: the socket is closed", async () => {
    const { app } = await create(chat({ close: () => "goodbye" }));
    const wire = await connect(app);
    wire.closed(1000, "bye");
    await settle();
    assert.deepEqual(wire.sent, []);
  });
});

describe("the events of a socket", () => {
  it("gives a message as a string or as bytes, then the socket", async () => {
    const seen: unknown[] = [];
    const { app } = await create(chat({
      message(data: unknown, socket: ChoWebSocket, ...more: unknown[]) {
        seen.push([data, typeof socket.send, more.length]);
      },
    }));
    const wire = await connect(app);
    const bytes = new Uint8Array([1, 2]);
    wire.message("text");
    wire.message(bytes);
    await settle();
    assert.deepEqual(seen, [["text", "function", 0], [bytes, "function", 0]]);
  });

  it("runs on the controller, which is one instance for every socket", async () => {
    const instances = new Set<unknown>();
    const sockets = new Set<unknown>();
    const { app } = await create(chat({
      open(this: unknown, socket: ChoWebSocket) {
        instances.add(this);
        sockets.add(socket);
      },
      message(this: unknown, _data: unknown, socket: ChoWebSocket) {
        instances.add(this);
        sockets.add(socket);
      },
    }));
    const first = await connect(app);
    const second = await connect(app);
    first.message("a");
    second.message("b");
    await settle();
    assert.equal(instances.size, 1);
    // one object for a connection, for its whole life
    assert.equal(sockets.size, 2);
  });

  it("gives the context of the upgraded request: params, url, headers and state", async () => {
    const seen: unknown[] = [];
    const counts: Record<string, unknown> = {};
    const auth: ChoWebMiddlewareFn = (ctx, next) => {
      ctx.state.set("user", ctx.req.headers.get("x-user"));
      return next();
    };
    const { app } = await create(
      chat(
        {
          join: (ctx: ChoWebContext) => void ctx.state.set("joined", true),
          message(_data: unknown, { ctx, native }: ChoWebSocket) {
            seen.push([
              ctx.params.room,
              ctx.url.searchParams.get("v"),
              ctx.state.get("user"),
              ctx.state.get("joined"),
              native,
            ]);
            ctx.state.set("count", (ctx.state.get("count") as number ?? 0) + 1);
          },
          close(_code: number, _reason: string, { ctx }: ChoWebSocket) {
            counts[ctx.params.room!] = ctx.state.get("count");
          },
        },
        loose(Middlewares(auth)),
      ),
    );
    const ada = await connect(app, "/chat/lobby?v=1", { "x-user": "ada" });
    const bob = await connect(app, "/chat/kitchen?v=2", { "x-user": "bob" });
    ada.message("a");
    bob.message("b");
    ada.message("c");
    ada.closed();
    bob.closed();
    await settle();
    assert.deepEqual(seen, [
      ["lobby", "1", "ada", true, "the socket of the runtime"],
      ["kitchen", "2", "bob", true, "the socket of the runtime"],
      ["lobby", "1", "ada", true, "the socket of the runtime"],
    ]);
    // the state of a request is the state of its connection
    assert.deepEqual(counts, { lobby: 2, kitchen: 1 });
  });

  it("run one after another: @WsOpen ends before the first message", async () => {
    const order: string[] = [];
    const { app } = await create(chat({
      async open() {
        order.push("open starts");
        await wait(15);
        order.push("open ends");
      },
      async message(data: string) {
        order.push(`${data} starts`);
        // the first message is the slowest
        await wait(data === "a" ? 15 : 1);
        order.push(`${data} ends`);
        return data;
      },
      close: () => void order.push("close"),
    }));
    const wire = await connect(app);
    wire.message("a");
    wire.message("b");
    wire.message("c");
    wire.closed();
    await settle(80);
    assert.deepEqual(order, [
      "open starts",
      "open ends",
      "a starts",
      "a ends",
      "b starts",
      "b ends",
      "c starts",
      "c ends",
      "close",
    ]);
    // The connection is closed: what the methods returned was not sent.
    assert.deepEqual(wire.sent, []);
  });

  it("sends the replies in the order of the messages", async () => {
    const { app } = await create(chat({
      async message(data: string) {
        await wait(data === "slow" ? 15 : 0);
        return data;
      },
    }));
    const wire = await connect(app);
    wire.message("slow");
    wire.message("fast");
    await settle(50);
    assert.deepEqual(wire.sent, ["slow", "fast"]);
  });

  it("does not make one socket wait for another", async () => {
    const order: string[] = [];
    const { app } = await create(chat({
      async message(data: string, socket: ChoWebSocket) {
        await wait(data === "slow" ? 30 : 0);
        order.push(`${socket.ctx.params.room} ${data}`);
      },
    }));
    const lobby = await connect(app, "/chat/lobby");
    const kitchen = await connect(app, "/chat/kitchen");
    lobby.message("slow");
    kitchen.message("fast");
    await settle(60);
    assert.deepEqual(order, ["kitchen fast", "lobby slow"]);
  });
});

describe("closing a socket", () => {
  it("runs @WsClose once, with the code and the reason of the other side", async () => {
    const closes: unknown[] = [];
    const { app } = await create(chat({
      close(code: number, reason: string, socket: ChoWebSocket) {
        closes.push([code, reason, socket.open]);
      },
    }));
    const wire = await connect(app);
    wire.closed(4001, "bye");
    wire.closed(1000, "again");
    await settle();
    assert.deepEqual(closes, [[4001, "bye", false]]);
    // the application did not close it
    assert.deepEqual(wire.closes, []);
  });

  it("closes from the application, and runs @WsClose with what it gave", async () => {
    const closes: unknown[] = [];
    const { app } = await create(chat({
      message(data: string, socket: ChoWebSocket) {
        if (data === "kick") {
          socket.close(4000, "kicked");
        } else if (data === "leave") {
          socket.close();
        }
      },
      close: (code: number, reason: string) => void closes.push([code, reason]),
    }));
    const kicked = await connect(app);
    kicked.message("kick");
    await settle();
    assert.deepEqual(kicked.closes, [[4000, "kicked"]]);
    // what the runtime reports afterwards is not a second close
    kicked.closed(1005, "");
    const left = await connect(app);
    left.message("leave");
    await settle();
    assert.deepEqual(left.closes, [[1000, ""]]);
    assert.deepEqual(closes, [[4000, "kicked"], [1000, ""]]);
  });

  it("handles what arrived before a close, and nothing after it", async () => {
    const seen: string[] = [];
    const { app } = await create(chat({
      async message(data: string, socket: ChoWebSocket) {
        await wait(2);
        seen.push(data);
        if (data === "last") {
          socket.close();
        }
        return `echo ${data}`;
      },
      close: () => void seen.push("close"),
    }));
    const wire = await connect(app);
    wire.message("first");
    wire.message("last");
    await settle(30);
    wire.message("late");
    await settle();
    assert.deepEqual(seen, ["first", "last", "close"]);
    // nothing is sent once the socket is closed, the reply of "last" included
    assert.deepEqual(wire.sent, ["echo first"]);
  });

  it("answers a message that is followed at once by a close, when the method is not asynchronous", async () => {
    const order: string[] = [];
    const answer = async (message: Fn) => {
      const { app } = await create(chat({
        open: () => "welcome",
        message,
        close: () => void order.push("close"),
      }));
      const wire = await connect(app);
      // in one turn, as the frames of one read
      wire.message("a");
      wire.message("b");
      wire.closed(1000, "");
      const at_once = [...wire.sent];
      await settle();
      return [at_once, wire.sent];
    };
    // Not asynchronous: each event has ended before the next one is read.
    assert.deepEqual(
      await answer((data: string) => {
        order.push(data);
        return `echo ${data}`;
      }),
      [["welcome", "echo a", "echo b"], ["welcome", "echo a", "echo b"]],
    );
    assert.deepEqual(order, ["a", "b", "close"]);
    // Asynchronous: the close has arrived when the replies are ready.
    assert.deepEqual(
      await answer(async (data: string) => {
        await Promise.resolve();
        return `echo ${data}`;
      }),
      [["welcome"], ["welcome"]],
    );
  });

  it("runs the close a method asks for after the method, also when it is not asynchronous", async () => {
    const order: string[] = [];
    const { app } = await create(chat({
      message(_data: string, socket: ChoWebSocket) {
        socket.close(4000, "done");
        order.push("message ends");
      },
      close: () => void order.push("close"),
    }));
    const wire = await connect(app);
    wire.message("a");
    await settle();
    assert.deepEqual(order, ["message ends", "close"]);
  });

  it("sends nothing on a socket that is not open, and says so", async () => {
    let kept: ChoWebSocket | undefined;
    const { app } = await create(chat({
      open: (socket: ChoWebSocket) => void (kept = socket),
    }));
    const wire = await connect(app);
    await settle();
    assert.equal(kept?.open, true);
    kept?.send("one");
    wire.closed();
    assert.equal(kept?.open, false);
    kept?.send("two");
    kept?.close(4000, "too late");
    await settle();
    assert.deepEqual(wire.sent, ["one"]);
    assert.deepEqual(wire.closes, []);
  });

  it("sends with send() as a returned value is sent, to any socket", async () => {
    const room = new Set<ChoWebSocket>();
    const { app } = await create(chat({
      open: (socket: ChoWebSocket) => void room.add(socket),
      message(data: string, from: ChoWebSocket) {
        for (const socket of room) {
          if (socket !== from) {
            socket.send({ from: from.ctx.params.room, data });
            socket.send(undefined);
          }
        }
      },
    }));
    const ada = await connect(app, "/chat/ada");
    const bob = await connect(app, "/chat/bob");
    await settle();
    ada.message("hi");
    await settle();
    assert.deepEqual(ada.sent, []);
    assert.deepEqual(bob.sent, ['{"from":"ada","data":"hi"}']);
  });

  it("closes every open socket with 1001 when the application closes", async () => {
    const closes: unknown[] = [];
    const { app } = await create(chat({
      async close(code: number, reason: string, socket: ChoWebSocket) {
        await wait(5);
        closes.push([socket.ctx.params.room, code, reason]);
      },
    }));
    const lobby = await connect(app, "/chat/lobby");
    const kitchen = await connect(app, "/chat/kitchen");
    const gone = await connect(app, "/chat/gone");
    gone.closed(1000, "left");
    await settle(20);
    // close() waits for the @WsClose methods
    await app.close();
    assert.deepEqual(closes, [
      ["gone", 1000, "left"],
      ["lobby", 1001, "Going Away"],
      ["kitchen", 1001, "Going Away"],
    ]);
    assert.deepEqual(lobby.closes, [[1001, "Going Away"]]);
    assert.deepEqual(kitchen.closes, [[1001, "Going Away"]]);
    assert.deepEqual(gone.closes, []);
  });
});

describe("an error of an event method", () => {
  /** Run with `console.error` captured, and give what was written. */
  async function errors_of(run: () => Promise<void>): Promise<string> {
    const { output } = await capture(run);
    return output.error.map(String).join(" ");
  }

  it("closes the socket with 1011, drops what waits, and still runs @WsClose", async () => {
    const seen: string[] = [];
    let wire!: Wire;
    const written = await errors_of(async () => {
      const { app } = await create(chat({
        message(data: string) {
          seen.push(data);
          if (data === "bad") {
            throw new Error("boom");
          }
          return data;
        },
        close: (code: number, reason: string) =>
          void seen.push(`close ${code} ${reason}`),
      }));
      wire = await connect(app);
      wire.message("good");
      wire.message("bad");
      wire.message("never");
      await settle();
    });
    assert.deepEqual(seen, ["good", "bad", "close 1011 Internal Error"]);
    assert.deepEqual(wire.sent, ["good"]);
    assert.deepEqual(wire.closes, [[1011, "Internal Error"]]);
    // never silent: there is nobody else to answer it
    assert.match(
      written,
      /the socket of Chat\.join failed in Chat\.message: Error: boom/,
    );
  });

  it("is the same for a rejection, for @WsOpen, and for a value that cannot be sent", async () => {
    const failing: Methods[] = [
      { message: () => Promise.reject(new Error("boom")) },
      {
        open() {
          throw new Error("boom");
        },
        message: () => "never",
      },
      { message: () => 10n },
      {
        message: (_data: unknown, socket: ChoWebSocket) =>
          socket.send(() => {}),
      },
    ];
    for (const methods of failing) {
      const closes: number[] = [];
      let wire!: Wire;
      await errors_of(async () => {
        const { app } = await create(chat({
          ...methods,
          close: (code: number) => void closes.push(code),
        }));
        wire = await connect(app);
        wire.message("a");
        await settle();
      });
      assert.deepEqual(wire.closes, [[1011, "Internal Error"]]);
      assert.deepEqual(closes, [1011]);
      assert.deepEqual(wire.sent, []);
    }
  });

  it("is only reported, for @WsClose", async () => {
    let wire!: Wire;
    const written = await errors_of(async () => {
      const { app } = await create(chat({
        close() {
          throw new Error("late");
        },
      }));
      wire = await connect(app);
      wire.closed(1000, "bye");
      await settle();
    });
    assert.deepEqual(wire.closes, []);
    assert.match(written, /failed in Chat\.close: Error: late/);
  });

  it("goes to the cho:web debug context when it is enabled", async () => {
    const { output } = await capture(async () => {
      let created!: ReturnType<typeof create>;
      with_env({ ...OFF, CHO_DEBUGLOG: "cho:web" }, () => {
        created = create(chat({
          message() {
            throw new Error("boom");
          },
        }));
      });
      const wire = await connect((await created).app);
      wire.message("a");
      await settle();
    });
    assert.match(
      output.error.map(String).join(" "),
      /cho:web ERROR the socket of Chat\.join failed in Chat\.message:/,
    );
  });
});
