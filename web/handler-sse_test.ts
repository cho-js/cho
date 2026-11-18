/**
 * Tests for `@Sse` handlers, end to end: through `ChoWeb.create` and a test
 * linker, and over a real connection, with the built-in router and `serve`.
 *
 * Decorators are applied as plain function calls, so the tests run on every
 * runtime.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { engine } from "@chojs/core/utils";
import { capture, legacy, loose } from "@chojs/core/utils/test_utils";
import { Body, Header, Param } from "./args.ts";
import type { ChoWebContext } from "./context.ts";
import {
  Args,
  Catch,
  Controller,
  Get,
  Middlewares,
  Module,
  Sse,
} from "./decorators.ts";
import { serve } from "./serve.ts";
import { TestLinker } from "./testing.ts";
import type {
  ChoWebMiddlewareFn,
  ChoWebSseEvent,
  ChoWebSseOptions,
} from "./types.ts";
import { validate } from "./validate.ts";
import { ChoWeb } from "./web.ts";

type Class = new () => object;

/** A method of a class, as a test decorates it. */
type Decoration = Parameters<typeof legacy>[0];

/** A module declaring the given controllers. */
function feature(controllers: Class[], options: Record<string, unknown> = {}) {
  class Feature {}
  Module({ ...options, controllers })(Feature);
  return Feature;
}

/**
 * A controller, `feed`, with one `@Sse` handler, `events`, at `events`.
 *
 * @param handler The handler: it runs on the controller instance.
 * @param options The options of `@Sse`.
 * @param decorations Other decorators of the handler.
 */
function feed(
  handler: (...args: never[]) => unknown,
  options?: ChoWebSseOptions,
  ...decorations: Decoration[]
) {
  class Feed {
    events(...args: never[]) {
      return handler.apply(this, args);
    }
  }
  legacy(loose(Sse("events", options)), Feed, "events");
  for (const decoration of decorations) {
    legacy(decoration, Feed, "events");
  }
  Controller({ route: "feed" })(Feed);
  return Feed;
}

/** Create the application of controllers, with the test linker. */
async function create(...controllers: Class[]) {
  const linker = new TestLinker();
  const app = await ChoWeb.create(feature(controllers), { linker });
  return { app, linker };
}

/** Send a request to an application. */
function send(app: ChoWeb<unknown>, path: string, init?: RequestInit) {
  return app.handler(new Request(`http://localhost${path}`, init));
}

/** Read the events of a response, one at a time, as they were written. */
function events_of(response: Response) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let text = "";
  return {
    /** The next event; `undefined` at the end of the stream. */
    async next(): Promise<string | undefined> {
      while (!text.includes("\n\n")) {
        const { done, value } = await reader.read();
        if (done) {
          return undefined;
        }
        text += decoder.decode(value, { stream: true });
      }
      const end = text.indexOf("\n\n") + 2;
      const event = text.slice(0, end);
      text = text.slice(end);
      return event;
    },
    cancel: () => reader.cancel(),
  };
}

/** Wait for a number of milliseconds. */
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("@Sse", () => {
  it("answers with the events of an async generator method", async () => {
    const { app } = await create(feed(async function* () {
      yield "hello";
      yield { event: "tick", id: "2", data: { n: 2 } };
    }));
    const response = await send(app, "/feed/events");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    assert.equal(
      response.headers.get("cache-control"),
      "no-cache, no-transform",
    );
    assert.equal(
      await response.text(),
      'data: hello\n\nevent: tick\nid: 2\ndata: {"n":2}\n\n',
    );
  });

  it("runs the handler on its controller, with the context", async () => {
    class Feed {
      readonly prefix = "from";
      async *events(ctx: ChoWebContext) {
        yield `${this.prefix} ${ctx.url.pathname}`;
      }
    }
    legacy(loose(Sse("")), Feed, "events");
    Controller({ route: "feed" })(Feed);
    const { app } = await create(Feed);
    assert.equal(
      await (await send(app, "/feed")).text(),
      "data: from /feed\n\n",
    );
  });

  it("is a GET route, or the route of its method option", async () => {
    const { app } = await create(
      feed(async function* () {}),
      (() => {
        class Chat {
          async *answer(body: { question: string }) {
            yield `you asked: ${body.question}`;
          }
        }
        legacy(loose(Sse("answers", { method: "POST" })), Chat, "answer");
        legacy(loose(Args(Body())), Chat, "answer");
        Controller({ route: "chat" })(Chat);
        return Chat;
      })(),
    );
    assert.deepEqual(app.routes.map((r) => [r.method, r.path, r.name]), [
      ["GET", "/feed/events", "Feed.events"],
      ["POST", "/chat/answers", "Chat.answer"],
    ]);

    const response = await send(app, "/chat/answers", {
      method: "POST",
      body: JSON.stringify({ question: "why?" }),
    });
    assert.equal(response.headers.get("content-type"), "text/event-stream");
    assert.equal(await response.text(), "data: you asked: why?\n\n");
    assert.equal((await send(app, "/chat/answers")).status, 404);
  });

  it("exposes its options on the graph", async () => {
    class Feed {
      plain() {}
      async *bare() {}
      async *kept() {}
    }
    legacy(Get("plain"), Feed, "plain");
    legacy(loose(Sse("bare")), Feed, "bare");
    legacy(loose(Sse("kept", { keepAlive: 5000 })), Feed, "kept");
    Controller({ route: "feed" })(Feed);
    const { app } = await create(Feed);
    assert.deepEqual(
      app.graph.features[0]!.controllers[0]!.methods.map((m) => [
        m.name,
        m.method,
        m.sse,
      ]),
      [
        ["plain", "GET", undefined],
        ["bare", "GET", {}],
        ["kept", "GET", { keepAlive: 5000 }],
      ],
    );
  });

  it("sends a Response the handler returns as it is", async () => {
    const { app } = await create(
      feed(() => new Response("no such order", { status: 404 })),
    );
    const response = await send(app, "/feed/events");
    assert.equal(response.status, 404);
    assert.notEqual(response.headers.get("content-type"), "text/event-stream");
    assert.equal(await response.text(), "no such order");
  });

  it("takes the events a plain method returns, now or as a promise", async () => {
    async function* source() {
      yield "from a plain method";
    }
    for (const handler of [() => source(), () => Promise.resolve(source())]) {
      const { app } = await create(feed(handler));
      assert.equal(
        await (await send(app, "/feed/events")).text(),
        "data: from a plain method\n\n",
      );
    }
  });

  it("gives a result that is not a stream to the error handler", async () => {
    for (
      const [result, got] of [
        ["text", "string"],
        [undefined, "undefined"],
        [null, "null"],
        [{ data: "x" }, "object"],
        [[{ data: "x" }], "object"],
      ] as const
    ) {
      const { app } = await create(feed(
        () => result,
        {},
        Catch((error) =>
          new Response((error as Error).message, { status: 500 })
        ),
      ));
      const response = await send(app, "/feed/events");
      assert.equal(response.status, 500);
      assert.equal(
        await response.text(),
        `@Sse() handler Feed.events must return an async iterable or a Response, got ${got}`,
      );
    }
  });

  it("rejects a result that is not a stream, without an error handler", async () => {
    const { app, linker } = await create(feed(() => "text"));
    assert.equal((await send(app, "/feed/events")).status, 500);
    assert.equal(
      (linker.errors[0] as { code?: string }).code,
      "CHO_WEB_INVALID_SSE_RESULT",
    );
  });
});

describe("@Sse, before the stream", () => {
  it("runs the middlewares first, and opens the stream before the first event", async () => {
    const seen: string[] = [];
    const middleware: ChoWebMiddlewareFn = async (_ctx, next) => {
      seen.push("before");
      const response = await next();
      seen.push(`after ${response.status}`);
      response.headers.set("x-feed", "yes");
      return response;
    };
    const { app } = await create(feed(
      async function* () {
        seen.push("first event");
        yield "one";
      },
      {},
      Middlewares(middleware),
    ));
    const response = await send(app, "/feed/events");
    assert.deepEqual(seen, ["before", "after 200"]);
    assert.equal(response.headers.get("x-feed"), "yes");
    assert.equal(await response.text(), "data: one\n\n");
    assert.deepEqual(seen, ["before", "after 200", "first event"]);
  });

  it("lets a middleware refuse the request", async () => {
    let started = 0;
    const { app } = await create(feed(
      async function* () {
        started++;
        yield "one";
      },
      {},
      Middlewares(() => new Response("unauthorized", { status: 401 })),
    ));
    assert.equal((await send(app, "/feed/events")).status, 401);
    assert.equal(started, 0);
  });

  it("gives the handler its arguments, then the context", async () => {
    class Orders {
      async *events(id: string, last: string | undefined, ctx: ChoWebContext) {
        yield { data: { id, last, path: ctx.url.pathname } };
      }
    }
    legacy(loose(Sse(":id/events")), Orders, "events");
    legacy(
      loose(Args(Param("id"), Header("last-event-id"))),
      Orders,
      "events",
    );
    Controller({ route: "orders" })(Orders);
    const { app } = await create(Orders);
    const response = await send(app, "/orders/7/events", {
      headers: { "last-event-id": "41" },
    });
    assert.equal(
      await response.text(),
      'data: {"id":"7","last":"41","path":"/orders/7/events"}\n\n',
    );
  });

  it("answers an invalid argument before the stream, with validate()", async () => {
    let started = 0;
    const number = {
      parse(value: unknown) {
        const n = Number(value);
        if (!Number.isInteger(n)) {
          throw new Error("expected a whole number");
        }
        return n;
      },
    };
    class Orders {
      async *events(id: number) {
        started++;
        yield { data: id };
      }
    }
    legacy(loose(Sse(":id/events")), Orders, "events");
    legacy(loose(Args(Param("id", number))), Orders, "events");
    legacy(Middlewares(validate()), Orders, "events");
    Controller({ route: "orders" })(Orders);
    const { app } = await create(Orders);

    const invalid = await send(app, "/orders/abc/events");
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).source, "param");
    assert.equal(started, 0);
    assert.equal(
      await (await send(app, "/orders/7/events")).text(),
      "data: 7\n\n",
    );
  });
});

describe("@Sse, the end of the stream", () => {
  it("ends the iteration when the response is cancelled", async () => {
    const ended = Promise.withResolvers<void>();
    const { app } = await create(feed(async function* () {
      try {
        while (true) {
          yield "tick";
        }
      } finally {
        ended.resolve();
      }
    }));
    const events = events_of(await send(app, "/feed/events"));
    assert.equal(await events.next(), "data: tick\n\n");
    await events.cancel();
    await ended.promise;
  });

  it("sends keep-alive comments, with the keepAlive option", async () => {
    const release = Promise.withResolvers<void>();
    const { app } = await create(feed(
      async function* () {
        yield "first";
        await release.promise;
      },
      { keepAlive: 20 },
    ));
    const events = events_of(await send(app, "/feed/events"));
    assert.equal(await events.next(), "data: first\n\n");
    assert.equal(await events.next(), ":\n\n");
    release.resolve();
    assert.equal(await events.next(), undefined);
  });

  it("cuts the stream on an error, and calls no error handler", async () => {
    const failure = new Error("db down");
    const caught: unknown[] = [];
    const { app, linker } = await create(feed(
      async function* () {
        yield "one";
        throw failure;
      },
      {},
      // the status is sent: there is nothing left for it to answer
      Catch((error) => void caught.push(error)),
    ));
    const response = await send(app, "/feed/events");
    assert.equal(response.status, 200);
    const events = events_of(response);
    assert.equal(await events.next(), "data: one\n\n");
    await assert.rejects(events.next(), failure);
    assert.deepEqual(caught, []);
    assert.deepEqual(linker.errors, []);
  });

  it("calls no error handler of the controller, of the feature or of the application either", async () => {
    for (const level of ["controller", "feature", "application"] as const) {
      const caught: unknown[] = [];
      const on_error = (error: unknown) => void caught.push(error);
      const Feed = feed(async function* () {
        yield 42; // not an event
      });
      if (level === "controller") {
        Catch(on_error)(Feed);
      }
      const Feature = feature([Feed]);
      if (level === "feature") {
        Catch(on_error)(Feature);
      }
      const app = await ChoWeb.create(Feature, {
        linker: new TestLinker(),
        ...(level === "application" ? { onError: on_error } : {}),
      });
      await assert.rejects(
        events_of(await send(app, "/feed/events")).next(),
        {
          code: "CHO_WEB_INVALID_EVENT",
          message:
            "@Sse() handler Feed.events: an event must be a string or an object with data, got 42",
        },
      );
      assert.deepEqual(caught, [], level);
    }
  });

  it("lets the handler catch the error, and send an event of its own", async () => {
    const { app } = await create(feed(async function* () {
      try {
        yield "one";
        throw new Error("db down");
      } catch {
        yield { event: "failed", data: "the feed is not available" };
      }
    }));
    assert.equal(
      await (await send(app, "/feed/events")).text(),
      "data: one\n\nevent: failed\ndata: the feed is not available\n\n",
    );
  });

  it("leaves an error of the stream to the server: it logs nothing", async () => {
    const failure = new Error("db down");
    const { app } = await create(feed(async function* () {
      yield "one";
      throw failure;
    }));
    const { output } = await capture(async () => {
      const events = events_of(await send(app, "/feed/events"));
      await events.next();
      await assert.rejects(events.next(), failure);
    });
    assert.deepEqual(output.error, []);
  });
});

describe("@Sse, inherited handlers", () => {
  it("keeps an inherited stream, and replaces it with another HTTP method decorator", async () => {
    class Base {
      async *events(): AsyncGenerator<ChoWebSseEvent | string> {
        yield "base";
      }
    }
    legacy(loose(Sse("events")), Base, "events");

    class Kept extends Base {}
    Controller({ route: "kept" })(Kept);

    class Replaced extends Base {
      // deno-lint-ignore require-yield
      override async *events(): AsyncGenerator<ChoWebSseEvent | string> {
        return;
      }
    }
    legacy(Get("plain"), Replaced, "events");
    Controller({ route: "replaced" })(Replaced);

    const { app } = await create(Kept, Replaced);
    assert.equal(
      await (await send(app, "/kept/events")).text(),
      "data: base\n\n",
    );
    const [kept, replaced] = app.graph.features[0]!.controllers;
    assert.deepEqual(kept!.methods[0]!.sse, {});
    assert.equal(replaced!.methods[0]!.sse, undefined);
    assert.equal(replaced!.methods[0]!.route, "plain");
  });
});

/** Whether `serve` has a server here: not on Cloudflare Workers. */
const SERVES = ["deno", "node", "bun"].includes(engine());

(SERVES ? describe : describe.skip)(
  "@Sse, over a connection (the built-in router and serve)",
  () => {
    /** Serve the application of a controller, and run a test against it. */
    async function using_app(
      controller: Class,
      test: (url: string) => Promise<void>,
    ) {
      const app = await ChoWeb.create(feature([controller]));
      const server = await serve(app.handler, {
        port: 0,
        hostname: "127.0.0.1",
      });
      try {
        await test(`http://127.0.0.1:${server.port}`);
      } finally {
        await server.close();
        await app.close();
      }
    }

    it("sends each event when it is yielded", async () => {
      const release = Promise.withResolvers<void>();
      await using_app(
        feed(async function* () {
          yield { event: "first", data: "now" };
          await release.promise;
          yield { event: "second", data: "later" };
        }),
        async (url) => {
          const response = await fetch(`${url}/feed/events`);
          assert.equal(
            response.headers.get("content-type"),
            "text/event-stream",
          );
          const events = events_of(response);
          // read while the handler is still waiting: nothing is held back
          assert.equal(await events.next(), "event: first\ndata: now\n\n");
          release.resolve();
          assert.equal(await events.next(), "event: second\ndata: later\n\n");
          assert.equal(await events.next(), undefined);
        },
      );
    });

    it("ends the iteration and aborts the signal when the client goes away", async () => {
      const ended = Promise.withResolvers<boolean>();
      await using_app(
        feed(async function* (ctx: ChoWebContext) {
          try {
            yield "first";
            await new Promise((resolve) =>
              ctx.req.signal.addEventListener("abort", resolve)
            );
          } finally {
            ended.resolve(ctx.req.signal.aborted);
          }
        }),
        async (url) => {
          const client = new AbortController();
          const response = await fetch(`${url}/feed/events`, {
            signal: client.signal,
          });
          const events = events_of(response);
          assert.equal(await events.next(), "data: first\n\n");
          client.abort();
          assert.equal(await ended.promise, true);
        },
      );
    });

    it("answers a HEAD request with the headers, and reads no event", async () => {
      let started = 0;
      await using_app(
        feed(async function* () {
          started++;
          yield "one";
        }),
        async (url) => {
          const response = await fetch(`${url}/feed/events`, {
            method: "HEAD",
          });
          assert.equal(response.status, 200);
          assert.equal(
            response.headers.get("content-type"),
            "text/event-stream",
          );
          assert.equal(await response.text(), "");
          await sleep(20);
          assert.equal(started, 0);
        },
      );
    });

    it("cuts the connection when the stream fails", async () => {
      const failure = new Error("db down");
      const read = Promise.withResolvers<void>();
      // The server reports a body that fails, its own way: keep it out of the
      // output of the tests where it goes through `console.error`.
      const console_error = console.error;
      console.error = () => {};
      try {
        await using_app(
          feed(async function* () {
            yield "one";
            // Fail once the first event is with the client: a server may
            // drop a response that fails before it sent anything.
            await read.promise;
            throw failure;
          }),
          async (url) => {
            const events = events_of(await fetch(`${url}/feed/events`));
            assert.equal(await events.next(), "data: one\n\n");
            read.resolve();
            // the client never gets a proper end
            await assert.rejects(events.next());
          },
        );
      } finally {
        console.error = console_error;
      }
    });

    it("ends an open stream when the server closes, after its closeTimeout", async () => {
      const ended = Promise.withResolvers<void>();
      const app = await ChoWeb.create(feature([
        feed(async function* (ctx: ChoWebContext) {
          try {
            yield "first";
            // a stream with no end: it waits for the client to go away
            await new Promise((resolve) =>
              ctx.req.signal.addEventListener("abort", resolve)
            );
          } finally {
            ended.resolve();
          }
        }),
      ]));
      const server = await serve(app.handler, {
        port: 0,
        hostname: "127.0.0.1",
        closeTimeout: 50,
      });
      const response = await fetch(
        `http://127.0.0.1:${server.port}/feed/events`,
      );
      const events = events_of(response);
      assert.equal(await events.next(), "data: first\n\n");

      // without the timeout, this would wait for the stream for ever
      await server.close();
      await ended.promise;
      await app.close();
      await events.cancel().catch(() => {});
    });
  },
);
