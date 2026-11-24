# @chojs/web

[![JSR](https://jsr.io/badges/@chojs/web)](https://jsr.io/@chojs/web)
[![JSR score](https://jsr.io/badges/@chojs/web/score)](https://jsr.io/@chojs/web)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

HTTP applications built with decorators, on the dependency injection of the
[CHO](../README.md) framework. Controllers declare route handlers; `ChoWeb`
turns the application into a `fetch`-style request handler that any server can
call.

## Contents

- [Highlights](#highlights)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Guide](#guide)
  - [Routes](#routes)
  - [The request context](#the-request-context)
  - [Handler arguments](#handler-arguments)
  - [Validation](#validation)
  - [Describing the API](#describing-the-api)
  - [Responses](#responses)
  - [Server-sent events](#server-sent-events)
  - [WebSockets](#websockets)
  - [Middlewares](#middlewares)
  - [Error handling](#error-handling)
  - [Answering with an error](#answering-with-an-error)
  - [Errors of the framework](#errors-of-the-framework)
  - [Serving](#serving)
  - [Cloudflare Workers](#cloudflare-workers)
  - [Dependency injection and shutdown](#dependency-injection-and-shutdown)
  - [Mounting a route](#mounting-a-route)
  - [Testing](#testing)
- [Options](#options)
- [Runtime adapters](#runtime-adapters)
- [The built-in router](#the-built-in-router)
- [Runtime support](#runtime-support)
- [Documentation](#documentation)

## Highlights

- **Built on web standards.** Handlers receive the standard `Request` and answer
  with a standard `Response`. Nothing in a controller depends on the HTTP
  library underneath.
- **Portable.** `app.handler` is a plain `(req: Request) => Promise<Response>`
  that Deno, Bun, Node.js and edge runtimes can serve.
- **No HTTP library needed.** A router on the standard URL Pattern API is built
  in, so an application depends on `@chojs/web` alone.
- **Or bring your own router.** A small adapter matches requests to routes on
  another library: pick one of the [available adapters](#runtime-adapters), or
  write your own.
- **Same behavior on every adapter.** Middlewares, error handling and the
  conversion of results are done by `@chojs/web` itself.
- **Server-sent events.** An `async *` method is a stream of events: every
  `yield` is one.
- **WebSockets.** A controller upgrades a request and handles the events of the
  socket with four decorators. The same code runs on Deno, Bun, Node.js and
  Cloudflare Workers, and needs no WebSocket library.
- **Dependency injection.** Controllers, middlewares and error handlers receive
  their dependencies. Everything is created and checked before the server
  starts.
- **Fails early.** A bad route, a duplicate route or a missing provider is
  reported when the application is created, not on the first request.

## Installation

```sh
deno add jsr:@chojs/web    # Deno
npx jsr add @chojs/web     # Node.js
bunx jsr add @chojs/web    # Bun
```

## Quick start

```ts
import {
  ChoWeb,
  type ChoWebContext,
  Controller,
  Get,
  Injectable,
  Module,
  Post,
} from "@chojs/web";
import { serve } from "@chojs/web/serve";

@Injectable()
class UserStore {
  find(id: string) {
    return { id, name: "Ada" };
  }
}

@Controller({ route: "users", dependencies: [UserStore] })
class UsersController {
  constructor(readonly store: UserStore) {}

  @Get(":id") // GET /v1/users/42
  get(ctx: ChoWebContext) {
    return this.store.find(ctx.params.id!); // sent as JSON
  }

  @Post("") // POST /v1/users
  async create(ctx: ChoWebContext) {
    const user = await ctx.req.json(); // ctx.req is the standard Request
    return Response.json(user, { status: 201 });
  }
}

@Module({ route: "v1", providers: [UserStore], controllers: [UsersController] })
class App {}

const app = await ChoWeb.create(App);
await serve(app, { port: 3000 }); // on Deno, Node.js or Bun
```

## Guide

### Routes

A handler is a controller method marked with `@Get`, `@Post`, `@Put`, `@Patch`,
`@Delete`, `@Head` or `@Options`. Its path joins up to four levels, each
optional:

| Level         | Declared by                             |
| ------------- | --------------------------------------- |
| Global prefix | The `prefix` option of `ChoWeb.create`  |
| Feature       | The `route` option of the `@Module`     |
| Controller    | The `route` option of the `@Controller` |
| Handler       | The argument of `@Get`, `@Post`, …      |

Routes are written without leading or trailing `/`. A segment that starts with
`:` is a parameter (`"users/:id"`); it is the only pattern, so a route means the
same on every adapter. An invalid route, or two handlers with the same method
and path, is an error when the application is created.

### The request context

Handlers, middlewares and error handlers of a request share one `ChoWebContext`:

| Property | Holds                                                                         |
| -------- | ----------------------------------------------------------------------------- |
| `req`    | The standard `Request`: `ctx.req.json()`, `ctx.req.headers`, …                |
| `params` | The path parameters of the route, decoded: `ctx.params.id`                    |
| `url`    | The request URL, parsed on first use: `ctx.url.searchParams`                  |
| `state`  | A `Map` for the request: what a middleware sets, later ones and handlers read |
| `native` | The adapter's own context, for what only that adapter can do                  |

### Handler arguments

A handler can declare what it receives instead of reading the context. Standard
decorators cannot decorate a parameter, so the arguments are listed once, on the
method, in the order of its parameters:

```ts
import { Args, Body, Param, Query } from "@chojs/web";

@Put(":id") // PUT /users/42?notify=1
@Args(Param("id"), Query("notify"), Body<UpdateUser>())
update(id: string, notify: string | undefined, user: UpdateUser, ctx: ChoWebContext) {
  return this.store.update(id, user);
}
```

The handler is called with the value of each argument, and the context last (it
can leave the context out). The parameters are checked against the arguments at
compile time: `update(id: number)` above would not compile.

| Function | Reads                           | `Fn()`                           | `Fn("key")`                |
| -------- | ------------------------------- | -------------------------------- | -------------------------- |
| `Param`  | The path parameters             | All of them, as an object        | One: a string              |
| `Query`  | The query string                | All of it, as an object          | One key, or `undefined`    |
| `Header` | The headers of the request      | All of them, names in lower case | One header, or `undefined` |
| `Body`   | The body, parsed as JSON        | The parsed body                  | One property of it         |
| `Form`   | The body, as a URL-encoded form | All the fields, as an object     | One field, or `undefined`  |

`Body` and `Form` read the body for you, once for a request. An argument can
also be any function `(ctx) => value`, for what is your own:

```ts
const CurrentUser = (ctx: ChoWebContext) => ctx.state.get("user") as User;

@Get("me")
@Args(CurrentUser)
me(user: User) {
  return user;
}
```

### Validation

Each of the five functions takes a validator as its last argument: a
[Standard Schema](https://standardschema.dev/). The schemas of
[Zod](https://zod.dev), [Valibot](https://valibot.dev),
[ArkType](https://arktype.io) and many other libraries are, so they are given as
they are, and `@chojs/web` depends on none of them. An object with a
`parse(value)` method that returns the value, or throws, is a validator too.

Validators are run by one middleware, `validate()`, on a handler, a controller
or a feature module. What a validator gives is what the handler receives, so it
can convert too:

```ts
import { z } from "zod";
import { Args, Body, Middlewares, Param, validate } from "@chojs/web";

const NewUser = z.object({ name: z.string(), age: z.number().optional() });

@Middlewares(validate())
@Controller({ route: "users" })
class UsersController {
  @Put(":id")
  @Args(Param("id", z.coerce.number()), Body(NewUser))
  update(id: number, user: z.infer<typeof NewUser>) {
    return this.store.update(id, user);
  }
}
```

A request that is not valid never reaches the handler. The middleware answers
`400` with `error`, `source`, `key` and `issues`, or with what its `onInvalid`
option returns:

```ts
validate({
  onInvalid: ({ source, key, issues }) =>
    Response.json({ message: `bad ${source}`, issues }, { status: 422 }),
});
```

- **One body for every library.** Each issue is a `message`, and a `path` when
  it is about a part of the value. What else a library writes in an issue is not
  sent.
- **A schema that throws is not a `400`.** A Standard Schema says what is not
  valid in its result. What it throws is an error like any other: it goes to the
  error handler, and answers `500` by default.
- **Asynchronous checks need no wrapper.** A validator that gives a promise is
  awaited.

Without the middleware, validators are not run: the handler receives the values
as they are. Enable `CHO_DEBUGLOG=cho:web` to see which handlers have a
validator and are not covered.

### Describing the API

Everything declared about a handler is kept on `app.graph`: its method, path and
name, its arguments with their source, key and validator, and whether it is
validated. It is what [`@chojs/openapi`](../extras/openapi/README.md) makes the
OpenAPI document of the application from, with a page that shows it. What the
code cannot tell is added with `@Doc`, which changes nothing in how a request is
handled:

```ts
@Doc({ tags: ["users"] })
@Controller({ route: "users" })
class UsersController {
  @Doc({
    summary: "Find a user",
    responses: {
      200: { description: "The user", schema: User },
      404: { description: "No such user" },
    },
  })
  @Get(":id")
  @Args(Param("id"))
  get(id: string) {
    return this.store.find(id);
  }
}
```

| Option        | On                                 | Holds                                                                                    |
| ------------- | ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `summary`     | A handler                          | One line about the operation                                                             |
| `description` | A handler, a controller, a feature | A longer text                                                                            |
| `tags`        | A handler, a controller, a feature | The tags of the handlers under it                                                        |
| `deprecated`  | A handler, a controller, a feature | `true` when it should no longer be used                                                  |
| `responses`   | A handler                          | By status: a `description` and a `schema`                                                |
| `hidden`      | A handler, a controller, a feature | `true` to leave it out of the documentation                                              |
| `operationId` | A handler                          | The id of the operation                                                                  |
| `security`    | A handler, a controller, a feature | What it requires: a list of `{ scheme: scopes }`. The nearest one wins, and `[]` is none |

A response also takes a `contentType`, the media type of its body
(`application/json` by default):

```ts
@Doc({ security: [{ bearer: [] }] })
@Controller({ route: "users" })
class UsersController {
  @Doc({ operationId: "listUsers", security: [] }) // public
  @Get("")
  list() {}

  @Doc({
    responses: { 200: { description: "The avatar", contentType: "image/png" } },
  })
  @Get(":id/avatar")
  avatar() {}
}
```

`security` documents what a middleware enforces: `@chojs/web` checks its shape,
and nothing more.

`@chojs/web` keeps what is declared, and writes no document. What a document
holds is up to the package that makes it: `@chojs/openapi` writes the
`description` of a handler, and not the one of a controller or of a feature. A
tag is described by its `tags` option.

### Responses

What a handler returns is the response.

| Returned                                               | Sent                              |
| ------------------------------------------------------ | --------------------------------- |
| A `Response`                                           | As is                             |
| Nothing                                                | `204 No Content`                  |
| A string                                               | Text, `text/plain;charset=UTF-8`  |
| Bytes, a `Blob`, a `ReadableStream`, a form            | As is, like `new Response(value)` |
| Anything else: objects, arrays, numbers, `null`, dates | JSON, `application/json`          |

For another status or content type, return a `Response`.

### Server-sent events

`@Sse` declares a handler that answers with a stream of
[server-sent events](https://developer.mozilla.org/docs/Web/API/Server-sent_events):
the response stays open, and the handler sends events for as long as it wants.
The handler is an `async *` method, and every `yield` is an event:

```ts
import { type ChoWebContext, Controller, Sse } from "@chojs/web";

@Controller({ route: "orders", dependencies: [Orders] })
class OrdersController {
  constructor(readonly orders: Orders) {}

  @Sse("events") // GET /orders/events
  async *events(ctx: ChoWebContext) {
    yield "listening"; // a string is the event { data: "listening" }
    for await (const order of this.orders.changes(ctx.req.signal)) {
      yield { event: "order", id: String(order.version), data: order };
    }
  }
}
```

```js
// in the browser
const source = new EventSource("/orders/events");
source.addEventListener("order", (event) => show(JSON.parse(event.data)));
```

An event is an object:

| Property | Holds                                                                     |
| -------- | ------------------------------------------------------------------------- |
| `data`   | The data, required. A string is sent as it is, anything else as JSON      |
| `event`  | The name of the event, for `addEventListener(name)`. Default: a `message` |
| `id`     | The id of the event: a client that reconnects sends it, `Last-Event-ID`   |
| `retry`  | How long the client waits before it reconnects, in milliseconds           |

`@Sse(route, options)` takes two options:

| Option      | Default | Use                                                               |
| ----------- | ------- | ----------------------------------------------------------------- |
| `method`    | `"GET"` | The HTTP method: `GET`, `POST`, `PUT`, `PATCH` or `DELETE`        |
| `keepAlive` | None    | Send a comment when that many milliseconds pass with nothing sent |

The comment is ignored by clients; it keeps a proxy from closing a connection
that is idle.

`EventSource` only sends `GET` requests. A stream that answers a request with a
body is declared on another method, and read with `fetch`:

```ts
@Sse("answers", { method: "POST" }) // POST /chat/answers
@Args(Body<{ question: string }>())
async *answer(body: { question: string }) {
  for await (const word of this.model.answer(body.question)) {
    yield word;
  }
}
```

What to know:

- **Before the stream, everything is as usual.** Middlewares, `@Args` and
  `validate()` run first, and answer a request they refuse (`401`, `400`). The
  last id a client got is `Header("last-event-id")`.
- **An `async *` method cannot refuse.** Its body runs as part of the stream,
  when the `200` is already sent. A handler that must be able to answer `404` is
  a plain method, which returns a `Response` or the events:

  ```ts
  @Sse(":id/events")
  @Args(Param("id"))
  events(id: string) {
    const order = this.orders.find(id);
    return order
      ? this.orders.eventsOf(order) // an async iterable
      : new Response("no such order", { status: 404 });
  }
  ```

- **When the client goes away**, the iteration is ended, so the `finally` blocks
  of the method run, and `ctx.req.signal` is aborted. A method that waits for
  long (a queue, a timer) should watch the signal: an `async *` method only ends
  once what it awaits settles.
- **An error in the stream cuts it**, and `EventSource` reconnects.
  [Error handlers](#error-handling) are **not** called: `@Catch` and `onError`
  answer a request, and this one is already answered. Catch the error in the
  method, to log it or to `yield` an event that tells the client:

  ```ts
  @Sse("events")
  async *events(ctx: ChoWebContext) {
    try {
      yield* this.orders.changes(ctx.req.signal);
    } catch (error) {
      this.log.error(error);
      yield { event: "failed", data: "the feed is not available" };
    }
  }
  ```

- **A middleware gets the response when the stream opens**, not when it ends,
  and must not read its body.
- **An open stream is a request in flight**: `server.close()` waits for it, for
  ever when the stream has no end. Give [`serve`](#serving) a `closeTimeout`:
  what is still open after that long is cut.

The response has three headers:

| Header              | Value                    | Why                                             |
| ------------------- | ------------------------ | ----------------------------------------------- |
| `content-type`      | `text/event-stream`      | What `EventSource` expects                      |
| `cache-control`     | `no-cache, no-transform` | Nothing on the way keeps or rewrites the events |
| `x-accel-buffering` | `no`                     | See below                                       |

`x-accel-buffering` is not a standard header: it is one that nginx reads. As a
reverse proxy, nginx collects a response before it passes it on, so the events
of a stream would reach the client late, and in batches. `no` turns that off for
this response, which saves setting `proxy_buffering off` in the configuration of
the proxy. Everything else ignores the header.

[`examples/sse-http.ts`](../examples/sse-http.ts) is a runnable application with
both kinds of streams, and a page that reads them.

### WebSockets

A controller upgrades a request to a WebSocket with `@Ws`, and handles the
events of the socket with `@WsOpen`, `@WsMessage` and `@WsClose`:

```ts
import {
  Args,
  type ChoWebSocket,
  Controller,
  HttpError,
  Param,
  Ws,
  WsClose,
  WsMessage,
  WsOpen,
} from "@chojs/web";

@Controller({ route: "chat", dependencies: [Rooms] })
class ChatController {
  constructor(readonly rooms: Rooms) {}

  @Ws(":room") // GET /chat/:room, with "Upgrade: websocket"
  @Args(Param("room"))
  join(room: string) {
    if (!this.rooms.has(room)) throw new HttpError(404); // refused: no socket
    return { joined: room }; // the first message on the socket
  }

  @WsOpen()
  open(socket: ChoWebSocket) {
    this.rooms.add(socket.ctx.params.room, socket);
  }

  @WsMessage()
  async message(data: string | Uint8Array, socket: ChoWebSocket) {
    await this.rooms.send(socket.ctx.params.room, data);
    return { ok: true }; // sent back on the socket
  }

  @WsClose()
  close(code: number, reason: string, socket: ChoWebSocket) {
    this.rooms.remove(socket.ctx.params.room, socket);
  }
}
```

- **What a method returns is sent on the socket**: a string as a text message,
  bytes as a binary message, anything else as JSON. A method that returns
  nothing sends nothing. Every method can be asynchronous.
- **`@Ws` is an ordinary `GET` handler.** Its middlewares run before the
  upgrade, so `bearerAuth()` answers `401` before any socket opens, and it has
  `@Args`, `validate()` and `@Catch`. To refuse a connection, throw an
  `HttpError` or return a `Response`. A request that does not ask for an upgrade
  is answered `426`.
- **A controller has one socket**: one method at most for each of the four
  decorators. It can have other handlers next to them.
- **The data of a connection is `socket.ctx`**, the context of the request that
  was upgraded: its `params`, its `url`, its headers and its `state`. A
  controller is one instance for every connection, so nothing of one connection
  is kept on `this`.
- **The events of a socket run one after another**, in the order they arrived,
  also when the methods are asynchronous. `@WsClose` runs once, whoever closed
  the socket.
- **A method that throws closes the socket** with the code `1011`, and the error
  is reported.

The socket has `send(data)`, `close(code?, reason?)`, `open`, `ctx`, and
`native`, the socket of the runtime. It is one object for a connection: keep it
in a `Set` to send to every socket of a room.

**Serving.** [`serve(app)`](#serving) upgrades the connections on Deno, Bun and
Node.js. Give it the application, not `app.handler` alone:

| Runtime            | Who upgrades the connection                               |
| ------------------ | --------------------------------------------------------- |
| Deno               | `serve(app)`, or `app.handler` with `Deno.serve`          |
| Cloudflare Workers | `app.handler`                                             |
| Bun                | `serve(app)`, or `Bun.serve({ ...bunOptions(app) })`      |
| Node.js            | `serve(app)`, or `server.on("upgrade", nodeUpgrade(app))` |

Node.js has no WebSocket server: the protocol is part of this package, with no
dependency and no compression of messages. The Fastify adapter does not upgrade
connections yet, and refuses a `@Ws` route when the application is created.

> **Security.** A browser does not apply CORS to a WebSocket: any page can open
> one to your application, with the cookies of the user. A socket that trusts a
> cookie checks the `Origin` header, in a middleware of its `@Ws` method.

[`examples/ws-chat.ts`](../examples/ws-chat.ts) is a runnable chat, with a page
that connects to it.

### Middlewares

`@Middlewares` applies to a feature module, a controller or a handler. A
middleware wraps what comes after it: `next()` resolves to the `Response` of the
rest of the chain.

```ts
const auth: ChoWebMiddlewareFn = (ctx, next) =>
  ctx.req.headers.has("authorization")
    ? next()
    : new Response("unauthorized", { status: 401 }); // answers early

const timing: ChoWebMiddlewareFn = async (ctx, next) => {
  const start = Date.now();
  const response = await next();
  response.headers.set("x-time", `${Date.now() - start}ms`);
  return response;
};

@Middlewares(auth) // every route of the controller
@Controller({ route: "admin" })
class AdminController {
  @Middlewares(timing) // this route only
  @Get("stats")
  stats() {
    return { users: 3 };
  }
}
```

A middleware can also be a class with a `handle(ctx, next)` method. It is
created by the injector, so it can have dependencies; list it in the module's
`providers`. Middlewares only run for the routes they apply to.

The middlewares of the HTTP library of an adapter can be used too: each adapter
has a function that makes one a CHO middleware, `fromHono(cors())` in
`@chojs/vendor-hono` and `fromFastify(hook)` in `@chojs/vendor-fastify`. The
built-in router has no HTTP library: its middlewares, such as `cors`, are in
[`@chojs/vendor-cho`](../vendor/cho/README.md), and it can run them for every
request (see [The built-in router](#the-built-in-router)).

### Error handling

An error thrown by a handler or a middleware goes to the nearest `@Catch`
handler (the handler's, the controller's, then the feature's), then to the
application's `onError`. What the handler returns is the response.

```ts
@Catch((error, ctx) =>
  error instanceof NotFound
    ? new Response(`no user ${ctx.params.id}`, { status: 404 })
    : Response.json({ error: "internal error" }, { status: 500 })
)
@Controller({ route: "users" })
class UsersController {}
```

An error handler that returns nothing has not handled the error: the adapter
answers `500`. A handler that only logs therefore never hides a failure.

### Answering with an error

Throw an `HttpError` to answer a request with a status, from anywhere the
request is handled: a handler, a middleware, a function of `@Args`.

```ts
import { HttpError } from "@chojs/web";

@Get(":id")
@Args(Param("id"))
get(id: string) {
  const user = this.users.get(id);
  if (!user) {
    throw new HttpError(404, "no such user");
  }
  return user;
}
```

The request is answered `404`, with a JSON body:

```json
{ "error": "no such user" }
```

`new HttpError(status, message?, options?)` takes a status from 400 to 599. The
message is the text of the status (`Not Found`) when there is none. The options
are the `headers` of the answer, and the `cause`:

```ts
throw new HttpError(401, "token expired", {
  headers: { "www-authenticate": "Bearer" },
});
throw new HttpError(503, "the database is down", { cause: error });
```

- **There is one class**, and no class for each status: what handles an error
  looks at `error.status`.
- **Below 500 the message is sent to the client**: write it for the client. From
  500 only the text of the status is sent (`Service Unavailable`), and the
  message and the `cause` are for the logs. The message of any other error is
  never sent.
- **The error handlers come first.** An `HttpError` goes to `@Catch` and
  `onError` like any error. It answers for itself only when none of them
  answers: a handler that returns nothing changes nothing.
- **An error handler can throw one**, to turn an error of the application into a
  status:

  ```ts
  @Catch((error) => {
    if (error instanceof OutOfStock) {
      throw new HttpError(409, error.message);
    }
  })
  ```

To answer in another shape, such as `application/problem+json`, answer in
`onError`. `isHttpError` recognizes the error, and `error.toResponse()` is the
answer the framework would send:

```ts
const app = await ChoWeb.create(AppModule, {
  onError: (error) => {
    if (isHttpError(error)) {
      return Response.json(
        { title: error.message, status: error.status },
        {
          status: error.status,
          headers: { "content-type": "application/problem+json" },
        },
      );
    }
  },
});
```

Use `isHttpError(error)` and not `error instanceof HttpError`: a middleware of
another package can throw the `HttpError` of another copy of `@chojs/web`.

### Errors of the framework

A mistake the framework finds (a duplicate route, an option that does not exist,
a class that cannot be injected) is a `ChoError`: an `Error` with a `code`. The
code is stable: it is part of the API, where the message is for people and can
change.

```ts
import { ChoWeb, isChoError } from "@chojs/web";

try {
  await ChoWeb.create(AppModule);
} catch (error) {
  if (isChoError(error, "CHO_WEB_DUPLICATE_ROUTE")) {
    // ...
  }
  throw error;
}
```

The codes of this package start with `CHO_WEB_` (type `ChoWebErrorCode`), and
those of the core with `CHO_CORE_` (type `ChoCoreErrorCode`). Every code is
listed with its mistake in the [specification](./specs.md#9-errors).

### Serving

`app.handler` is a `fetch`-style function, and every runtime has its own way to
serve one. `serve` picks it for you: `Deno.serve` on Deno, `Bun.serve` on Bun,
and the `node:http` server on Node.js, so the same file runs on the three.

```ts
import { ChoWeb } from "@chojs/web";
import { serve } from "@chojs/web/serve";

const app = await ChoWeb.create(App);
const server = await serve(app, { port: 3000 });

console.log(`listening on http://localhost:${server.port}`);
```

| Option         | Default               | Use                                                                |
| -------------- | --------------------- | ------------------------------------------------------------------ |
| `port`         | `3000`                | The port; `0` picks a free one                                     |
| `hostname`     | the runtime's default | The host name or address to listen on                              |
| `signal`       | none                  | An `AbortSignal` that closes the server                            |
| `closeTimeout` | none                  | How long closing waits for the requests in flight, in milliseconds |
| `maxPayload`   | 1 MiB                 | The bytes a message of a [WebSocket](#websockets) can hold         |

`serve` takes the application, or its handler alone: `serve(app.handler)`. With
the handler alone, the server upgrades no connection to a WebSocket.

`server.close()` stops accepting requests and waits for the ones in flight. It
closes the open sockets first, with the code `1001`. A request that never ends,
such as an open stream of [server-sent events](#server-sent-events), would hold
it for ever. With `closeTimeout`, the requests that are still in flight after
that long are cut; their handlers see a client that went away.

```ts
const server = await serve(app, { closeTimeout: 10_000 });
```

It resolves, once the server is listening, to
`{ runtime, port, hostname,
close() }`. `serve` has no dependency: the bridge
between `node:http` and `Request` / `Response` is part of this package, and the
Node.js modules are loaded on Node.js only. On another runtime, such as
Cloudflare Workers, give `app.handler` to the runtime's own entry point.

`serve` is imported from `@chojs/web/serve`, not from `@chojs/web`, so an
application that does not use it loads nothing of it. That is the case on
Cloudflare Workers and the other runtimes that serve an exported handler:

```ts
export default { fetch: app.handler };
```

You can still call the runtime's server yourself: `Deno.serve(app.handler)` or
`Bun.serve({ fetch: app.handler })`.

### Cloudflare Workers

`app.handler` is the `fetch` of a Worker. There is no `serve()` on a Worker: the
runtime calls the handler itself.

```ts
import { ChoWeb, Controller, Get, Injectable, Module } from "@chojs/web";
import { env, waitUntil } from "cloudflare:workers";

@Injectable()
class Config {
  readonly greeting = (env as { GREETING: string }).GREETING; // a binding
}

@Controller({ dependencies: [Config] })
class HelloController {
  constructor(readonly config: Config) {}

  @Get("hello")
  hello() {
    waitUntil(audit("hello")); // work that goes on after the answer
    return { message: this.config.greeting };
  }
}

@Module({ providers: [Config], controllers: [HelloController] })
class AppModule {}

const app = await ChoWeb.create(AppModule);

export default { fetch: app.handler };
```

- **The bindings** (KV, D1, queues, secrets) are `env` of `cloudflare:workers`.
  A handler reads it, and so does a provider, when the application is created.
  With the Hono adapter they are also in `ctx.native.env`.
- **Work after the answer** is given to `waitUntil` of `cloudflare:workers`: the
  Worker stays alive until it is done. With the Hono adapter it is also
  `ctx.native.executionCtx.waitUntil`.
- **Creating the application.** A Worker does no I/O outside a request. An
  application whose providers only compute is created at the top level, as
  above. One whose providers connect to something is created in the first
  request:

  ```ts
  let app: Promise<ChoWeb<unknown>> | undefined;

  export default {
    async fetch(request: Request) {
      app ??= ChoWeb.create(AppModule);
      return (await app).handler(request);
    },
  };
  ```
- **The environment.** A Worker has no `process`: give `set_env()` of
  `@chojs/core/utils` what `CHO_DEBUG` and the others are read from.
- **Keep the names.** A minified bundle renames classes and functions, and CHO
  puts their names in error messages, in logs and in the tags of an OpenAPI
  document: set `keep_names = true` in `wrangler.toml` (the default of
  wrangler).
- The packages need no `nodejs_compat` flag.

[`examples/worker`](../examples/worker) is a Worker to run with wrangler.

### Dependency injection and shutdown

`@Module`, `@Controller`, `@Injectable`, `token`, `provider` and `configure`
come from the CHO core and are exported by this package, so an application
imports everything from `@chojs/web`. A feature module of a library is given its
settings with [`configure`](../core/README.md#configuring-a-module): the module
it makes keeps the route, the controllers and the middlewares of the one it is
made from.

`ChoWeb.create` creates every instance before it resolves. `app.close()`
releases them in reverse creation order: every instance with a
`[Symbol.asyncDispose]()` or `[Symbol.dispose]()` method is disposed. After it,
`app.handler` answers `503`.

```ts
const server = await serve(app, { closeTimeout: 10_000 });
process.once("SIGTERM", async () => {
  // stop accepting, give the requests in flight 10 seconds to finish
  await server.close();
  await app.close();
});
```

`app.injector` is the injector of the application. Another CHO module can build
a second application on it, which then shares the instances of this one: an
application that also handles the messages of a broker is made with
`ChoMessage.from(app.injector)` of `@chojs/message`. The web application owns
the injector: close the other application first, then `app.close()`.

### Mounting a route

The routes of an application are declared by its controllers. `app.mount` adds
one more route to an application that is created. It is for a route that cannot
be declared, because it is made from the application itself: the documentation
of its routes, which reads `app.graph`.

```ts
const app = await ChoWeb.create(App, { prefix: "api" });

app.mount("GET", "health", () => ({ status: "ok" })); // GET /health
app.mount("GET", "internal/routes", () => app.routes.map((r) => r.path), {
  middlewares: [onlyAdmins],
});

await serve(app);
```

`app.mount(method, route, handler, options?)`:

| Argument      | What it is                                                                                     |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `method`      | `"GET"`, `"POST"`, `"PUT"`, `"PATCH"`, `"DELETE"`, `"HEAD"` or `"OPTIONS"`                     |
| `route`       | The whole route, written like the route of a decorator: `"internal/docs"`, `"users/:id"`, `""` |
| `handler`     | A function of the context. What it returns is the response, as for a declared handler          |
| `middlewares` | Middleware functions `(ctx, next)`, in order, around the handler                               |
| `name`        | The name of the route, for logs and errors. Default: the name of the handler, or `mounted`     |

- **It is not under the global prefix.** The prefix is for the routes the
  application declares: a mounted route says its whole path.
- **It is a route of the application**: it is added to `app.routes`, after the
  others. It is not in `app.graph`, which holds what is declared.
- **Nothing of the application runs for it**: no middleware of a feature or of a
  controller, and no `@Catch` handler. It has its own `middlewares`. When it
  fails, the `onError` of `ChoWeb.create` answers, if there is one.
- **It is the last route.** Where the first declared route wins (the built-in
  router, Hono), a declared route that matches the same path answers first: a
  `@Get(":slug")` at the root answers `/docs`.
- **A route that already exists throws**: the same method and path as a route of
  the application, declared or mounted.
- **Mount before the application serves.** Later, the adapter decides: the
  built-in router takes the route, Hono throws once it answered a request, and
  Fastify once it is ready.

### Testing

`app.handler` takes a `Request`, so a test needs no server. The `overrides`
option replaces providers with fakes, anywhere in the module graph:

```ts
const app = await ChoWeb.create(App, {
  overrides: [provider({ provide: UserStore, factory: () => new FakeStore() })],
});

const response = await app.handler(new Request("http://localhost/v1/users/42"));
assert.equal(response.status, 200);
```

## Options

`ChoWeb.create(App, options)`:

| Option      | Default                                | Use                                             |
| ----------- | -------------------------------------- | ----------------------------------------------- |
| `linker`    | `new ChoLinker()`, the built-in router | The runtime adapter, such as `new HonoLinker()` |
| `prefix`    | `""`                                   | A route prefix for every route, such as `"api"` |
| `onError`   | none                                   | The error handler for what no `@Catch` covers   |
| `overrides` | none                                   | Providers that replace declared ones, for tests |

Without a `linker`, `ChoWeb.create(App)` uses the
[built-in router](#the-built-in-router).

The application exposes `handler`, `close()`, `mount()`
([Mounting a route](#mounting-a-route)), `routes` (every route with its method,
path and name), `graph` (the declared routes as a tree), `linked` (the adapter's
own application object) and `injector` (the injector that holds its instances).

## Runtime adapters

| Adapter                                                | Router                                             | Runs on                                                                     |
| ------------------------------------------------------ | -------------------------------------------------- | --------------------------------------------------------------------------- |
| `ChoLinker`, [built in](#the-built-in-router)          | The standard URL Pattern API, with no HTTP library | Runtimes with `URLPattern`: Deno, Node.js 24, Bun 1.3.4, Cloudflare Workers |
| [`@chojs/vendor-hono`](../vendor/hono/README.md)       | [Hono](https://hono.dev)                           | Deno, Node.js, Bun and edge runtimes                                        |
| [`@chojs/vendor-fastify`](../vendor/fastify/README.md) | [Fastify](https://fastify.dev)                     | Node.js only                                                                |

Pass the adapter's linker to `ChoWeb.create`: `new HonoLinker()` or
`new FastifyLinker()`. With no linker, the built-in router is used. Routes,
middlewares and error handlers are the same on each. What differs is listed in
the "Behavior" table of each adapter, such as which route wins when two match.

To write one, implement `Linker`: it receives the application's routes, each
ready to call, and registers them on its router. What it returns also has a
`mount`, which registers one more route later, for `app.mount`. It does no
plumbing, so an adapter is a few lines:

```ts
import type { Linked, Linker, Route } from "@chojs/web/linker";

class MyLinker implements Linker<MyServer> {
  link(routes: readonly Route[]): Linked<MyServer> {
    const server = new MyServer();
    const mount = (route: Route) =>
      server.on(
        route.method,
        route.path,
        (req, params) => route.handle(req, params),
      );
    routes.forEach(mount);
    return { instance: server, handler: (req) => server.fetch(req), mount };
  }
}
```

## The built-in router

`ChoLinker` matches requests with one `URLPattern` for each route. It is what
`ChoWeb.create` uses when it is given no linker, and `app.linked.instance` is
then its `ChoRouter`:

```ts
const app = await ChoWeb.create(App);
const router = app.linked.instance;

router.routes; // the routes, in declaration order
router.match("GET", "/users/42"); // { route, params: { id: "42" } }, or undefined
router.fetch; // the request handler, the same function as app.handler
```

Create it yourself to answer the requests no route matches:

```ts
import { ChoLinker, ChoWeb } from "@chojs/web";

const linker = new ChoLinker({
  notFound: (req) =>
    Response.json({ error: "not found", path: new URL(req.url).pathname }, {
      status: 404,
    }),
});
const app = await ChoWeb.create(App, { linker });
```

The router takes middlewares of its own. Unlike the middlewares of
`@Middlewares`, they run for **every** request, in order, the requests no route
matches included:

```ts
import { ChoLinker, ChoWeb } from "@chojs/web";
import { cors } from "@chojs/vendor-cho";

const app = await ChoWeb.create(App, {
  linker: new ChoLinker({ middlewares: [cors()] }),
});
```

They are functions `(ctx, next)` like any CHO middleware. Their context has the
`params` of the route that matched (empty when there is none), and its `state`
is the one the middlewares and the handler of the route see: what a middleware
of the router sets there (a request id, the authenticated user) reaches them.
[`@chojs/vendor-cho`](../vendor/cho/README.md) has the middlewares an HTTP
library would bring: `cors`, `bodyLimit`, `secureHeaders`, `logger`, `timeout`,
`requestId`, `etag`, `basicAuth`, `bearerAuth` and `compress`.

There is no runtime context on this router: `ctx.native` is `undefined`.

| Topic              | Behavior                                                                                                                                      |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Matching order     | Routes are matched in declaration order: declare static routes before parameter routes (`@Get("me")` before `@Get(":id")`)                    |
| Paths              | Matched as written: case and a trailing slash count. A parameter matches one segment, never an empty one                                      |
| Path parameters    | Percent-decoded. One that cannot be decoded (`/users/%`) is answered `400`, and the route does not run                                        |
| `HEAD` requests    | Run the `@Head` handler of the route. Without one, the `@Get` handler answers, without the body                                               |
| Unhandled errors   | A route that fails with no `@Catch` and no `onError` is logged with `console.error`, and answered with `500`                                  |
| Unmatched requests | Answered by the `notFound` option; `404` by default, also when the path exists under another method                                           |
| Middlewares        | The `middlewares` option: they wrap every request, the `notFound` answer included. A middleware that fails is logged, and answered with `500` |
| HTTP methods       | Any method is matched as given                                                                                                                |
| Mounted routes     | `app.mount` adds a route at any time, also after the router answered requests. It is matched after the others                                 |
| Several apps       | A linker can be used for several applications: each `link()` makes a new router                                                               |

## Runtime support

Deno, Node.js, Bun and [Cloudflare Workers](#cloudflare-workers), and any
runtime that serves a `fetch`-style handler. The tests run on the four:
Cloudflare Workers is tested in workerd, at the compatibility date `2025-09-01`
and with no `nodejs_compat` flag. The built-in router needs the global
`URLPattern` (Deno, Node.js 24, Bun 1.3.4, Cloudflare Workers); on a runtime
without it, use the Hono adapter. Deno and Bun run TypeScript decorators
directly; on Node.js, compile the application with TypeScript 5 or run it with a
tool such as `tsx`. Both standard (TC39) and legacy (`experimentalDecorators`)
decorators are supported.

Debug logging is enabled with `CHO_DEBUG=1`, or with `CHO_DEBUGLOG=cho:web`.

## Documentation

- [Specification](./specs.md): routes, the context, responses, middlewares,
  error handlers, writing a runtime adapter, and error messages.
- [`@chojs/vendor-hono`](../vendor/hono/README.md): the Hono adapter.
- [`@chojs/vendor-fastify`](../vendor/fastify/README.md): the Fastify adapter,
  for Node.js.
- Examples: [`hello-world-http.ts`](../examples/hello-world-http.ts),
  [`sse-http.ts`](../examples/sse-http.ts) for server-sent events,
  [`ws-chat.ts`](../examples/ws-chat.ts) for WebSockets, and
  [`worker`](../examples/worker) for a Cloudflare Worker.

## License

[MIT](./LICENSE)
