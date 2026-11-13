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
  - [Responses](#responses)
  - [Middlewares](#middlewares)
  - [Error handling](#error-handling)
  - [Dependency injection and shutdown](#dependency-injection-and-shutdown)
  - [Testing](#testing)
- [Options](#options)
- [Runtime adapters](#runtime-adapters)
- [Runtime support](#runtime-support)
- [Documentation](#documentation)

## Highlights

- **Built on web standards.** Handlers receive the standard `Request` and answer
  with a standard `Response`. Nothing in a controller depends on the HTTP
  library underneath.
- **Portable.** `app.handler` is a plain `(req: Request) => Promise<Response>`
  that Deno, Bun, Node.js and edge runtimes can serve.
- **Bring your own router.** `@chojs/web` depends on no HTTP library. A small
  adapter matches requests to routes: pick one of the
  [available adapters](#runtime-adapters), or write your own.
- **Same behavior on every adapter.** Middlewares, error handling and the
  conversion of results are done by `@chojs/web` itself.
- **Dependency injection.** Controllers, middlewares and error handlers receive
  their dependencies. Everything is created and checked before the server
  starts.
- **Fails early.** A bad route, a duplicate route or a missing provider is
  reported when the application is created, not on the first request.

## Installation

```sh
deno add jsr:@chojs/web jsr:@chojs/vendor-hono    # Deno
npx jsr add @chojs/web @chojs/vendor-hono         # Node.js
bunx jsr add @chojs/web @chojs/vendor-hono        # Bun
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
import { HonoLinker } from "@chojs/vendor-hono";

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

const app = await ChoWeb.create(App, { linker: new HonoLinker() });
Deno.serve(app.handler); // Bun: Bun.serve({ fetch: app.handler })
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

### Dependency injection and shutdown

`@Module`, `@Controller`, `@Injectable`, `token` and `provider` come from the
CHO core and are exported by this package, so an application imports everything
from `@chojs/web`.

`ChoWeb.create` creates every instance before it resolves. `app.close()`
releases them in reverse creation order: every instance with a
`[Symbol.asyncDispose]()` or `[Symbol.dispose]()` method is disposed. After it,
`app.handler` answers `503`.

```ts
const server = Deno.serve(app.handler);
Deno.addSignalListener("SIGTERM", async () => {
  await server.shutdown(); // stop accepting, finish the requests in flight
  await app.close();
});
```

### Testing

`app.handler` takes a `Request`, so a test needs no server. The `overrides`
option replaces providers with fakes, anywhere in the module graph:

```ts
const app = await ChoWeb.create(App, {
  linker: new HonoLinker(),
  overrides: [provider({ provide: UserStore, factory: () => new FakeStore() })],
});

const response = await app.handler(new Request("http://localhost/v1/users/42"));
assert.equal(response.status, 200);
```

## Options

`ChoWeb.create(App, options)`:

| Option      | Default                                  | Use                                             |
| ----------- | ---------------------------------------- | ----------------------------------------------- |
| `linker`    | `new ChoLinker()` of `@chojs/vendor-cho` | The runtime adapter, such as `new HonoLinker()` |
| `prefix`    | `""`                                     | A route prefix for every route, such as `"api"` |
| `onError`   | none                                     | The error handler for what no `@Catch` covers   |
| `overrides` | none                                     | Providers that replace declared ones, for tests |

Without a `linker`, `ChoWeb.create(App)` uses the plain adapter,
[`@chojs/vendor-cho`](../vendor/cho/README.md). It is loaded when the
application is created, and it is not a dependency of `@chojs/web`: install it
in the application (`deno add jsr:@chojs/vendor-cho`). When it is missing,
`ChoWeb.create` rejects with an error that says what to install.

The application exposes `handler`, `close()`, `routes` (every route with its
method, path and name), `graph` (the same routes as a tree) and `linked` (the
adapter's own application object).

## Runtime adapters

| Adapter                                                | Router                                             | Runs on                                                 |
| ------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------- |
| [`@chojs/vendor-cho`](../vendor/cho/README.md)         | The standard URL Pattern API, with no HTTP library | Runtimes with `URLPattern`: Deno, Node.js 24, Bun 1.3.4 |
| [`@chojs/vendor-hono`](../vendor/hono/README.md)       | [Hono](https://hono.dev)                           | Deno, Node.js, Bun and edge runtimes                    |
| [`@chojs/vendor-fastify`](../vendor/fastify/README.md) | [Fastify](https://fastify.dev)                     | Node.js only                                            |

Pass the adapter's linker to `ChoWeb.create`: `new ChoLinker()`,
`new HonoLinker()` or `new FastifyLinker()`. With no linker, the first one is
used. Routes, middlewares and error handlers are the same on each. What differs
is listed in the "Behavior" table of each adapter, such as which route wins when
two match.

To write one, implement `Linker`: it receives the application's routes, each
ready to call, and registers them on its router. It does no plumbing, so an
adapter is a few lines:

```ts
import type { Linked, Linker, Route } from "@chojs/web/linker";

class MyLinker implements Linker<MyServer> {
  link(routes: readonly Route[]): Linked<MyServer> {
    const server = new MyServer();
    for (const route of routes) {
      server.on(
        route.method,
        route.path,
        (req, params) => route.handle(req, params),
      );
    }
    return { instance: server, handler: (req) => server.fetch(req) };
  }
}
```

## Runtime support

Deno, Node.js and Bun, and any runtime that serves a `fetch`-style handler. Deno
and Bun run TypeScript decorators directly; on Node.js, compile the application
with TypeScript 5 or run it with a tool such as `tsx`. Both standard (TC39) and
legacy (`experimentalDecorators`) decorators are supported.

Debug logging is enabled with `CHO_DEBUG=1`, or with `CHO_DEBUGLOG=cho:web`.

## Documentation

- [Specification](./specs.md): routes, the context, responses, middlewares,
  error handlers, writing a runtime adapter, and error messages.
- [`@chojs/vendor-cho`](../vendor/cho/README.md): the plain adapter, on the URL
  Pattern API.
- [`@chojs/vendor-hono`](../vendor/hono/README.md): the Hono adapter.
- [`@chojs/vendor-fastify`](../vendor/fastify/README.md): the Fastify adapter,
  for Node.js.
- Example: [`hello-world-http.ts`](../examples/hello-world-http.ts).

## License

[MIT](./LICENSE)
