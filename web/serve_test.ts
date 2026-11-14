/**
 * Tests for `serve.ts`: a `fetch`-style handler served over HTTP.
 *
 * Every test runs twice: with `serve`, which uses the server of the runtime
 * the tests run on (`Deno.serve`, `Bun.serve` or `node:http`), and with
 * `serve_node`, the bridge to `node:http`, which Deno and Bun can run too.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { engine } from "@chojs/core/utils";
import { capture, legacy } from "@chojs/core/utils/test_utils";
import { Controller, Get, Module } from "./decorators.ts";
import {
  type ChoWebServer,
  serve,
  serve_node,
  serve_on,
  type ServeHandler,
  type ServeOptions,
} from "./serve.ts";
import { TestLinker } from "./testing.ts";
import { ChoWeb } from "./web.ts";

/** A way to start a server: `serve`, or `serve_node`. */
type Start = (
  handler: ServeHandler,
  options?: ServeOptions,
) => Promise<ChoWebServer>;

const starts: [string, Start][] = [
  [
    `serve, on ${engine()}`,
    (handler, options) =>
      serve(handler, { port: 0, hostname: "127.0.0.1", ...options }),
  ],
  ["serve_node", (handler, options) =>
    serve_on("node", handler, {
      port: 0,
      hostname: "127.0.0.1",
      ...options,
    })],
];

/** Start a server, run a test against its address, and close it. */
async function using_server(
  start: Start,
  handler: ServeHandler,
  test: (url: string, server: ChoWebServer) => Promise<void>,
) {
  const server = await start(handler);
  try {
    await test(`http://127.0.0.1:${server.port}`, server);
  } finally {
    await server.close();
  }
}

for (const [name, start] of starts) {
  describe(name, () => {
    it("listens on a free port, and answers", async () => {
      await using_server(start, () => new Response("hello"), async (url, s) => {
        assert.ok(s.port > 0);
        assert.equal(s.hostname, "127.0.0.1");
        const response = await fetch(url);
        assert.deepEqual([response.status, await response.text()], [
          200,
          "hello",
        ]);
      });
    });

    it("gives the handler a standard Request", async () => {
      const echo: ServeHandler = async (req) =>
        Response.json({
          method: req.method,
          url: req.url,
          token: req.headers.get("x-token"),
          accept: req.headers.get("accept"),
          body: req.body === null ? null : await req.text(),
        });
      await using_server(start, echo, async (url) => {
        const get = await fetch(`${url}/users/a%20b?page=2`, {
          headers: [["x-token", "abc"], ["accept", "text/html"], [
            "accept",
            "text/plain",
          ]],
        });
        assert.deepEqual(await get.json(), {
          method: "GET",
          url: `${url}/users/a%20b?page=2`,
          token: "abc",
          accept: "text/html, text/plain",
          body: null,
        });
        const post = await fetch(`${url}/users`, {
          method: "POST",
          body: '{"name":"Ada"}',
          headers: { "content-type": "application/json" },
        });
        const posted = await post.json();
        assert.deepEqual([posted.method, posted.body], [
          "POST",
          '{"name":"Ada"}',
        ]);
      });
    });

    it("sends the status, the headers and the body of the Response", async () => {
      const handler: ServeHandler = (req) => {
        const { pathname } = new URL(req.url);
        if (pathname === "/none") {
          return new Response(null, { status: 204 });
        }
        return new Response("made", {
          status: 201,
          headers: [["set-cookie", "a=1"], ["set-cookie", "b=2"], [
            "x-one",
            "1",
          ], ["content-type", "text/plain"]],
        });
      };
      await using_server(start, handler, async (url) => {
        const made = await fetch(`${url}/made`);
        assert.deepEqual(
          [made.status, made.headers.get("x-one"), await made.text()],
          [201, "1", "made"],
        );
        assert.deepEqual(made.headers.getSetCookie(), ["a=1", "b=2"]);
        const none = await fetch(`${url}/none`);
        assert.deepEqual([none.status, await none.text()], [204, ""]);
        // a HEAD response has the headers, and no body
        const head = await fetch(`${url}/made`, { method: "HEAD" });
        assert.deepEqual(
          [head.status, head.headers.get("x-one"), await head.text()],
          [201, "1", ""],
        );
      });
    });

    it("streams the body of the Response", async () => {
      const chunks = ["one ", "two ", "three"];
      const handler: ServeHandler = () =>
        new Response(
          new ReadableStream({
            async start(controller) {
              for (const chunk of chunks) {
                controller.enqueue(new TextEncoder().encode(chunk));
                await new Promise((resolve) => setTimeout(resolve, 5));
              }
              controller.close();
            },
          }),
        );
      await using_server(start, handler, async (url) => {
        assert.equal(await (await fetch(url)).text(), "one two three");
      });
    });

    it("sends a large body whole", async () => {
      const big = "x".repeat(2_000_000);
      await using_server(start, () => new Response(big), async (url) => {
        assert.equal((await (await fetch(url)).text()).length, big.length);
      });
    });

    it("closes: once closed, nothing answers", async () => {
      const server = await start(() => new Response("up"));
      const url = `http://127.0.0.1:${server.port}`;
      assert.equal(await (await fetch(url)).text(), "up");
      await server.close();
      await server.close(); // again: nothing more
      await assert.rejects(fetch(url));
    });

    it("closes when the signal is aborted", async () => {
      const stop = new AbortController();
      const server = await start(() => new Response("up"), {
        signal: stop.signal,
      });
      const url = `http://127.0.0.1:${server.port}`;
      assert.equal(await (await fetch(url)).text(), "up");
      stop.abort();
      await server.close(); // the same close: wait for it
      await assert.rejects(fetch(url));
    });

    it("serves a ChoWeb application", async () => {
      class Users {
        get(ctx: { params: Record<string, string | undefined> }) {
          return { id: ctx.params.id };
        }
      }
      legacy(Get(":id"), Users, "get");
      Controller({ route: "users" })(Users);
      class App {}
      Module({ controllers: [Users] })(App);
      const app = await ChoWeb.create(App, { linker: new TestLinker() });

      await using_server(start, app.handler, async (url) => {
        const found = await fetch(`${url}/users/42`);
        assert.deepEqual(await found.json(), { id: "42" });
        const missing = await fetch(`${url}/nope`);
        assert.deepEqual([missing.status, await missing.text()], [
          404,
          "Not Found",
        ]);
      });
      await app.close();
    });
  });
}

describe("serve_node", () => {
  it("answers 500 when the handler rejects, and logs the error", async () => {
    const server = await serve_node(
      () => Promise.reject(new Error("boom")),
      0,
      "127.0.0.1",
    );
    try {
      const { result, output } = await capture(async () => {
        const response = await fetch(`http://127.0.0.1:${server.port}`);
        return [response.status, await response.text()];
      });
      assert.deepEqual(result, [500, "Internal Server Error"]);
      assert.equal((output.error[0] as Error).message, "boom");
    } finally {
      await server.close();
    }
  });

  it("aborts the signal of the Request when the client goes away", async () => {
    const started = Promise.withResolvers<AbortSignal>();
    const server = await serve_node(
      (req) => {
        started.resolve(req.signal);
        return new Promise<Response>((resolve) =>
          req.signal.addEventListener(
            "abort",
            () => resolve(new Response("gone")),
          )
        );
      },
      0,
      "127.0.0.1",
    );
    try {
      const client = new AbortController();
      const pending = fetch(`http://127.0.0.1:${server.port}`, {
        signal: client.signal,
      });
      const signal = await started.promise;
      assert.equal(signal.aborted, false);
      const aborted = new Promise((resolve) =>
        signal.addEventListener("abort", resolve)
      );
      client.abort();
      await assert.rejects(pending);
      await aborted;
      assert.equal(signal.aborted, true);
    } finally {
      await server.close();
    }
  });

  it("cuts the response when its body fails, and logs the error", async () => {
    let pulls = 0;
    const server = await serve_node(
      () =>
        new Response(
          new ReadableStream({
            async pull(controller) {
              if (pulls++ === 0) {
                controller.enqueue(new TextEncoder().encode("partial"));
              } else {
                await new Promise((resolve) => setTimeout(resolve, 20));
                controller.error(new Error("broken body"));
              }
            },
          }),
        ),
      0,
      "127.0.0.1",
    );
    // The server logs after it cut the connection: wait for the log itself.
    const logged = Promise.withResolvers<unknown>();
    const console_error = console.error;
    console.error = (error: unknown) => logged.resolve(error);
    try {
      // the client never gets a whole response
      await assert.rejects(async () => {
        const response = await fetch(`http://127.0.0.1:${server.port}`);
        await response.text();
      });
      assert.equal(((await logged.promise) as Error).message, "broken body");
    } finally {
      console.error = console_error;
      await server.close();
    }
  });

  it("stops reading the body when the client goes away, and logs nothing", async () => {
    const cancelled = Promise.withResolvers<void>();
    const server = await serve_node(
      () =>
        new Response(
          new ReadableStream({
            async pull(controller) {
              controller.enqueue(new TextEncoder().encode("x".repeat(1024)));
              await new Promise((resolve) => setTimeout(resolve, 5));
            },
            cancel() {
              cancelled.resolve();
            },
          }),
        ),
      0,
      "127.0.0.1",
    );
    try {
      const { output } = await capture(async () => {
        const client = new AbortController();
        const response = await fetch(`http://127.0.0.1:${server.port}`, {
          signal: client.signal,
        });
        const reader = response.body!.getReader();
        await reader.read(); // the body has started
        client.abort();
        await reader.read().catch(() => {});
        await cancelled.promise; // the server stopped reading the body
      });
      assert.deepEqual(output.error, []);
    } finally {
      await server.close();
    }
  });

  it("rejects when the port is taken", async () => {
    const first = await serve_node(() => new Response("1"), 0, "127.0.0.1");
    try {
      await assert.rejects(
        serve_node(() => new Response("2"), first.port, "127.0.0.1"),
        (error: NodeJS.ErrnoException) => error.code === "EADDRINUSE",
      );
    } finally {
      await first.close();
    }
  });
});

describe("serve", () => {
  it("reports the runtime it serves on", async () => {
    const server = await serve(() => new Response(""), {
      port: 0,
      hostname: "127.0.0.1",
    });
    assert.equal(server.runtime, engine());
    await server.close();
  });

  it("rejects on a runtime it has no server for", async () => {
    await assert.rejects(serve_on("workerd", () => new Response("")), {
      message:
        "serve() has no server for this runtime (workerd): give app.handler to the runtime's own entry point",
    });
  });

  it("rejects what is not a handler", async () => {
    await assert.rejects(
      // deno-lint-ignore no-explicit-any
      serve({ handler: () => new Response("") } as any),
      {
        name: "TypeError",
        message: "serve() expects a request handler, such as app.handler",
      },
    );
  });
});
