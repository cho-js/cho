/**
 * A Worker as an application would write it, run by `tools/workerd/run.sh`
 * with no `nodejs_compat` flag: decorator syntax, the built-in router, the
 * middlewares of `@chojs/vendor-cho`, validation, server-sent events and the
 * OpenAPI document. It imports no `node:` module, so it has no `node:assert`:
 * its `test` handler checks by hand, and prints what `run.sh` reads.
 */
import {
  Args,
  Body,
  ChoLinker,
  ChoWeb,
  type ChoWebContext,
  type ChoWebSocket,
  Controller,
  engine,
  env,
  Get,
  HttpError,
  Injectable,
  Middlewares,
  Module,
  Param,
  Post,
  Query,
  setEnv,
  Sse,
  validate,
  Ws,
  WsClose,
  WsMessage,
  WsOpen,
} from "@chojs/web";
import {
  bearerAuth,
  bodyLimit,
  compress,
  cors,
  etag,
  requestId,
  secureHeaders,
  timeout,
} from "@chojs/vendor-cho";
import { openApi } from "@chojs/openapi";

const Order = {
  parse(value: unknown) {
    const id = (value as { id?: unknown } | null)?.id;
    if (typeof id !== "number") throw new Error("id: expected a number");
    return { id };
  },
};

@Injectable()
class Store {
  readonly orders = new Map<number, { id: number }>();
}

@Middlewares(validate())
@Controller({ route: "orders", dependencies: [Store] })
class Orders {
  constructor(readonly store: Store) {}

  @Post("")
  @Args(Body(Order))
  create(order: { id: number }) {
    this.store.orders.set(order.id, order);
    return Response.json(order, { status: 201 });
  }

  @Get("slow")
  @Middlewares(timeout({ ms: 30 }))
  async slow() {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return "late";
  }

  @Middlewares(bearerAuth({ token: "secret" }))
  @Get("private")
  secret() {
    return "for you";
  }

  @Sse("events")
  async *events() {
    yield { data: "one" };
    yield { event: "tick", data: { n: 2 } };
  }

  @Get(":id")
  @Args(Param("id"), Query("fields"))
  get(id: string, fields: string | undefined, ctx: ChoWebContext) {
    const order = this.store.orders.get(Number(id));
    if (!order) throw new HttpError(404, `no order ${id}`);
    return { ...order, fields, native: typeof ctx.native };
  }
}

/** What the sockets of the Worker did, for the checks. */
const socket_log: string[] = [];

@Controller({ route: "chat" })
class Chat {
  @Ws(":room")
  @Args(Param("room"))
  join(room: string) {
    if (room === "closed") throw new HttpError(404, "no such room");
    return { joined: room };
  }

  @WsOpen()
  open(socket: ChoWebSocket) {
    socket_log.push(`open ${socket.ctx.params.room}`);
    return "welcome";
  }

  @WsMessage()
  async message(data: string | Uint8Array, socket: ChoWebSocket) {
    await Promise.resolve();
    if (data === "bye") {
      socket.close(4000, "said bye");
      return;
    }
    return typeof data === "string" ? `echo ${data}` : data;
  }

  @WsClose()
  close(code: number, reason: string) {
    socket_log.push(`close ${code} ${reason}`);
  }
}

@Middlewares(
  requestId(),
  secureHeaders(),
  cors({ origin: "https://app.example" }),
  bodyLimit({ maxSize: 1000 }),
  compress(),
  etag(),
)
@Module({ route: "api", providers: [Store], controllers: [Orders, Chat] })
class App {}

// Created at the top level of the module: the global scope of a Worker.
const app = await ChoWeb.create(App, { linker: new ChoLinker() });
openApi(app, { route: "docs", info: { title: "Smoke", version: "1.0.0" } });

const checks: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  checks.push(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`);
}

export default {
  fetch: app.handler,
  async test(_ctrl: unknown, bindings: Record<string, unknown>) {
    const call = (path: string, init?: RequestInit) =>
      app.handler(new Request(`https://worker.example${path}`, init));
    try {
      check("engine() is workerd", engine() === "workerd", engine());
      check(
        "no process without nodejs_compat",
        typeof (globalThis as { process?: unknown }).process === "undefined",
      );
      check("env() without process", env("CHO_NOTHING") === undefined);
      // The bindings of the Worker, as the environment of the application.
      setEnv(bindings as Record<string, string>);
      check(
        "setEnv() gives the bindings to env()",
        env("GREETING") === "hello from a binding",
        String(env("GREETING")),
      );

      const created = await call("/api/orders", {
        method: "POST",
        body: JSON.stringify({ id: 7 }),
        headers: { "content-type": "application/json", origin: "https://app.example" },
      });
      check("POST with @Args(Body(validator))", created.status === 201 && (await created.json()).id === 7, String(created.status));
      check("cors header", created.headers.get("access-control-allow-origin") === "https://app.example");
      check("secure headers", created.headers.has("x-content-type-options"));
      check("request id", created.headers.has("x-request-id"));

      const invalid = await call("/api/orders", { method: "POST", body: '{"id":"x"}' });
      check("invalid body is 400", invalid.status === 400, String(invalid.status));

      const got = await call("/api/orders/7?fields=id", { headers: { "accept-encoding": "gzip" } });
      const text = got.headers.get("content-encoding") === "gzip"
        ? await new Response(got.body!.pipeThrough(new DecompressionStream("gzip"))).text()
        : await got.text();
      check("GET with Param and Query", got.status === 200 && JSON.parse(text).fields === "id", text);
      check("etag", got.headers.has("etag"), String(got.headers.get("etag")));
      check("compress", true, `content-encoding: ${got.headers.get("content-encoding")}`);
      check("ctx.native of the built-in router", true, JSON.parse(text).native);

      const cached = await call("/api/orders/7?fields=id", { headers: { "if-none-match": got.headers.get("etag") ?? "" } });
      check("if-none-match is 304", cached.status === 304, String(cached.status));

      const missing = await call("/api/orders/99");
      check("HttpError is 404", missing.status === 404 && (await missing.json()).error === "no order 99");

      const slow = await call("/api/orders/slow");
      check("timeout middleware", slow.status === 504 || slow.status === 408, String(slow.status));

      const denied = await call("/api/orders/private");
      const allowed = await call("/api/orders/private", { headers: { authorization: "Bearer secret" } });
      check("bearer auth (crypto.subtle)", denied.status === 401 && allowed.status === 200, `${denied.status} ${allowed.status}`);

      const events = await call("/api/orders/events");
      const stream = await events.text();
      check("SSE", events.headers.get("content-type")?.startsWith("text/event-stream") === true && stream.includes("data: one") && stream.includes("event: tick"), stream.replace(/\n/g, "\\n"));

      const doc = await call("/docs/openapi.json");
      const json = doc.status === 200 ? await doc.json() as { paths: Record<string, unknown> } : undefined;
      check("OpenAPI document", !!json && "/api/orders/{id}" in json.paths, String(doc.status));
      const page = await call("/docs");
      check("OpenAPI page", page.status === 200 && (await page.text()).includes("swagger"), String(page.status));

      // A WebSocket: on a Worker the handler of the application upgrades.
      const plain = await call("/api/chat/lobby");
      check("@Ws without Upgrade is 426", plain.status === 426, String(plain.status));
      const refused = await call("/api/chat/closed", { headers: { upgrade: "websocket" } });
      check("@Ws refused by its handler is 404", refused.status === 404, String(refused.status));
      const upgraded = await call("/api/chat/lobby", { headers: { upgrade: "websocket" } });
      const client = (upgraded as Response & { webSocket?: WebSocket & { accept(): void } }).webSocket;
      check("@Ws answers 101 with a socket", upgraded.status === 101 && !!client, String(upgraded.status));
      check("the headers of the middlewares are on the 101", upgraded.headers.has("x-request-id") && !upgraded.headers.has("content-type"));
      if (client) {
        const received: unknown[] = [];
        const closed = new Promise<{ code: number; reason: string }>((resolve) => {
          client.addEventListener("close", (event) => resolve({ code: event.code, reason: event.reason }));
        });
        const got = (count: number) => new Promise<void>((resolve) => {
          const look = () => received.length >= count ? resolve() : setTimeout(look, 1);
          look();
        });
        client.addEventListener("message", (event) => {
          received.push(typeof event.data === "string" ? event.data : [...new Uint8Array(event.data as ArrayBuffer)]);
        });
        client.accept();
        await got(2);
        check("the first message, then what @WsOpen returns", JSON.stringify(received) === '["{\\"joined\\":\\"lobby\\"}","welcome"]', JSON.stringify(received));
        client.send("hello");
        client.send(new Uint8Array([1, 2, 3]));
        await got(4);
        check("@WsMessage replies, text and binary", JSON.stringify(received.slice(2)) === '["echo hello",[1,2,3]]', JSON.stringify(received.slice(2)));
        client.send("bye");
        const end = await closed;
        check("the application closes the socket", end.code === 4000 && end.reason === "said bye", JSON.stringify(end));
        await new Promise((resolve) => setTimeout(resolve, 5));
        check("@WsOpen and @WsClose ran", JSON.stringify(socket_log) === '["open lobby","close 4000 said bye"]', JSON.stringify(socket_log));
      }

      const none = await call("/nothing");
      check("unknown route is 404", none.status === 404);
      await app.close();
      check("app.close()", true);
    } catch (error) {
      check("uncaught", false, String((error as Error)?.stack ?? error));
    }
    for (const line of checks) {
      if (line.startsWith("FAIL")) console.log(line);
    }
    console.log(
      "RESULT " + JSON.stringify({
        pass: checks.filter((line) => line.startsWith("ok")).length,
        fail: checks.filter((line) => line.startsWith("FAIL")).length,
        skip: 0,
      }),
    );
  },
};
