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
  - [Middlewares](#middlewares)
  - [Error handling](#error-handling)
  - [Serving](#serving)
  - [Dependency injection and shutdown](#dependency-injection-and-shutdown)
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
await serve(app.handler, { port: 3000 }); // on Deno, Node.js or Bun
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

Each of the five functions takes a validator as its last argument: any object
with a `parse(value)` method that returns the value or throws. That is the shape
of a [zod](https://zod.dev) schema, and `@chojs/web` does not depend on zod.

Validators are run by one middleware, `validate()`, on a handler, a controller
or a feature module. What a validator returns is what the handler receives, so
it can convert too:

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
  onInvalid: ({ source, key, error }) =>
    Response.json({ message: `bad ${source}` }, { status: 422 }),
});
```

Without the middleware, validators are not run: the handler receives the values
as they are. Enable `CHO_DEBUGLOG=cho:web` to see which handlers have a
validator and are not covered.

### Describing the API

Everything declared about a handler is kept on `app.graph`: its method, path and
name, its arguments with their source, key and validator, and whether it is
validated. It is what an OpenAPI document of the application will be generated
from. What the code cannot tell is added with `@Doc`, which changes nothing in
how a request is handled:

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

| Option        | On                                 | Holds                                       |
| ------------- | ---------------------------------- | ------------------------------------------- |
| `summary`     | A handler                          | One line about the operation                |
| `description` | A handler, a controller, a feature | A longer text                               |
| `tags`        | A handler, a controller, a feature | The tags of the handlers under it           |
| `deprecated`  | A handler, a controller, a feature | `true` when it should no longer be used     |
| `responses`   | A handler                          | By status: a `description` and a `schema`   |
| `hidden`      | A handler, a controller, a feature | `true` to leave it out of the documentation |

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

The middlewares of the HTTP library of an adapter can be used too: each adapter
has a function that makes one a CHO middleware, `fromHono(cors())` in
`@chojs/vendor-hono` and `fromFastify(hook)` in `@chojs/vendor-fastify`.

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

### Serving

`app.handler` is a `fetch`-style function, and every runtime has its own way to
serve one. `serve` picks it for you: `Deno.serve` on Deno, `Bun.serve` on Bun,
and the `node:http` server on Node.js, so the same file runs on the three.

```ts
import { ChoWeb } from "@chojs/web";
import { serve } from "@chojs/web/serve";

const app = await ChoWeb.create(App);
const server = await serve(app.handler, { port: 3000 });

console.log(`listening on http://localhost:${server.port}`);
```

| Option     | Default               | Use                                     |
| ---------- | --------------------- | --------------------------------------- |
| `port`     | `3000`                | The port; `0` picks a free one          |
| `hostname` | the runtime's default | The host name or address to listen on   |
| `signal`   | none                  | An `AbortSignal` that closes the server |

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

### Dependency injection and shutdown

`@Module`, `@Controller`, `@Injectable`, `token` and `provider` come from the
CHO core and are exported by this package, so an application imports everything
from `@chojs/web`.

`ChoWeb.create` creates every instance before it resolves. `app.close()`
releases them in reverse creation order: every instance with a
`[Symbol.asyncDispose]()` or `[Symbol.dispose]()` method is disposed. After it,
`app.handler` answers `503`.

```ts
const server = await serve(app.handler);
process.once("SIGTERM", async () => {
  await server.close(); // stop accepting, finish the requests in flight
  await app.close();
});
```

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

The application exposes `handler`, `close()`, `routes` (every route with its
method, path and name), `graph` (the same routes as a tree) and `linked` (the
adapter's own application object).

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

There is no runtime context on this router: `ctx.native` is `undefined`.

| Topic              | Behavior                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Matching order     | Routes are matched in declaration order: declare static routes before parameter routes (`@Get("me")` before `@Get(":id")`) |
| Paths              | Matched as written: case and a trailing slash count. A parameter matches one segment, never an empty one                   |
| Path parameters    | Percent-decoded. One that cannot be decoded is passed as it was sent                                                       |
| `HEAD` requests    | Run the `@Head` handler of the route. Without one, the `@Get` handler answers, without the body                            |
| Unhandled errors   | A route that fails with no `@Catch` and no `onError` is logged with `console.error`, and answered with `500`               |
| Unmatched requests | Answered by the `notFound` option; `404` by default, also when the path exists under another method                        |
| HTTP methods       | Any method is matched as given                                                                                             |
| Several apps       | A linker can be used for several applications: each `link()` makes a new router                                            |

## Runtime support

Deno, Node.js and Bun, and any runtime that serves a `fetch`-style handler. The
built-in router needs the global `URLPattern` (Deno, Node.js 24, Bun 1.3.4,
Cloudflare Workers); on a runtime without it, use the Hono adapter. Deno and Bun
run TypeScript decorators directly; on Node.js, compile the application with
TypeScript 5 or run it with a tool such as `tsx`. Both standard (TC39) and
legacy (`experimentalDecorators`) decorators are supported.

Debug logging is enabled with `CHO_DEBUG=1`, or with `CHO_DEBUGLOG=cho:web`.

## Documentation

- [Specification](./specs.md): routes, the context, responses, middlewares,
  error handlers, writing a runtime adapter, and error messages.
- [`@chojs/vendor-hono`](../vendor/hono/README.md): the Hono adapter.
- [`@chojs/vendor-fastify`](../vendor/fastify/README.md): the Fastify adapter,
  for Node.js.
- Example: [`hello-world-http.ts`](../examples/hello-world-http.ts).

## License

[MIT](./LICENSE)
