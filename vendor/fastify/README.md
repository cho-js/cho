# @chojs/vendor-fastify

[![JSR](https://jsr.io/badges/@chojs/vendor-fastify)](https://jsr.io/@chojs/vendor-fastify)
[![JSR score](https://jsr.io/badges/@chojs/vendor-fastify/score)](https://jsr.io/@chojs/vendor-fastify)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

The [Fastify](https://fastify.dev) adapter for
[`@chojs/web`](../../web/README.md): it registers the routes of a CHO web
application on a Fastify application.

## Contents

- [Runtime support](#runtime-support)
- [Installation](#installation)
- [Usage](#usage)
- [Using Fastify options, plugins and hooks](#using-fastify-options-plugins-and-hooks)
- [Reaching Fastify from a handler](#reaching-fastify-from-a-handler)
- [Testing without a server](#testing-without-a-server)
- [How it works](#how-it-works)
- [Behavior](#behavior)
- [Documentation](#documentation)

## Runtime support

**Node.js only.** Fastify is built on the HTTP server of Node.js, and this
adapter is tested on Node.js alone. For Deno, Bun and edge runtimes use the
[built-in router](../../web/README.md#the-built-in-router) of `@chojs/web`, or
[`@chojs/vendor-hono`](../hono/README.md).

## Installation

```sh
npx jsr add @chojs/web @chojs/vendor-fastify
```

Fastify comes with the adapter. Add it to your own dependencies
(`npm install fastify`) when you create the Fastify application yourself.

## Usage

Pass a `FastifyLinker` to `ChoWeb.create`, and serve the Fastify application:

```ts
import { ChoWeb } from "@chojs/web";
import { FastifyLinker } from "@chojs/vendor-fastify";

const app = await ChoWeb.create(App, { linker: new FastifyLinker() });
const fastify = app.linked.instance; // the Fastify application

await fastify.listen({ port: 3000 });
```

To stop, close Fastify first, so that no request is running, then the
application:

```ts
await fastify.close();
await app.close();
```

## Using Fastify options, plugins and hooks

Fastify plugins and hooks are written for Fastify's request and reply. There are
two ways to use them.

**On every route:** create the Fastify application yourself, and give it to the
linker. What you add to it applies to every route:

```ts
import Fastify from "fastify";
import cors from "@fastify/cors";

const fastify = Fastify({ logger: true });
await fastify.register(cors);
fastify.setNotFoundHandler((_request, reply) =>
  reply.status(404).send({ error: "not found" })
);

const app = await ChoWeb.create(App, { linker: new FastifyLinker(fastify) });
```

The same Fastify application takes your `setErrorHandler`.

**On a handler, a controller or a feature**, with `fromFastify`, which turns a
Fastify hook into a CHO middleware for `@Middlewares`. A hook is what many
plugins give to protect a route: `fastify.basicAuth`, `fastify.auth([...])`,
`fastify.rateLimit()`, `fastify.csrfProtection`, or a function of your own.

```ts
import Fastify from "fastify";
import basicAuth from "@fastify/basic-auth";
import { ChoWeb, Controller, Get, Middlewares } from "@chojs/web";
import { FastifyLinker, fromFastify } from "@chojs/vendor-fastify";

const fastify = Fastify();
await fastify.register(basicAuth, { validate, authenticate: true });

@Middlewares(fromFastify(fastify.basicAuth))
@Controller({ route: "admin" })
class AdminController {
  @Middlewares(fromFastify(async (request, reply) => {
    if (request.ip !== "127.0.0.1") {
      return reply.code(403).send({ error: "forbidden" });
    }
  }))
  @Get("report")
  report() {
    return { users: 3 };
  }
}

const app = await ChoWeb.create(App, { linker: new FastifyLinker(fastify) });
```

The hook runs with Fastify's request and reply, at its place among the CHO
middlewares, on the Fastify application of the route (`this`):

| In the hook                                | What happens                                                |
| ------------------------------------------ | ----------------------------------------------------------- |
| Its promise resolves, or it calls `done()` | The rest of the CHO chain runs                              |
| `reply.send()`, `reply.redirect()`         | The hook answered: the rest of the chain does not run       |
| It throws, rejects or calls `done(error)`  | The error goes to the CHO error handlers, then to Fastify's |

- A hook is a step before the handler: it cannot change the handler's response.
  For that, and for plugins that are not hooks (`@fastify/cors`,
  `@fastify/helmet`), register the plugin on the Fastify application.
- When a hook answers, the response is the one Fastify sends. The CHO
  middlewares around it see its status and headers, and cannot change it.
- Fastify does not parse the body of CHO routes, so `request.body` is not set in
  a hook.
- A middleware made with `fromFastify` only runs on this adapter: on another one
  it fails the request.

## Reaching Fastify from a handler

Handlers, middlewares and error handlers receive a `ChoWebContext`, with a
standard `Request` built from Fastify's. Fastify's request and reply are its
`native` property, for what only Fastify can do. A handler that uses it only
runs on this adapter.

```ts
import type { FastifyNative } from "@chojs/vendor-fastify";

@Get("ip")
ip(ctx: ChoWebContext) {
  return (ctx.native as FastifyNative).request.ip;
}
```

## Testing without a server

`app.handler` is a `fetch`-style function here too. It sends the request through
Fastify's `inject()`, with no network connection, which is what a test needs:

```ts
const response = await app.handler(new Request("http://localhost/users/42"));
```

It reads the bodies of the request and of the response whole, so serve real
traffic with `listen()`.

## How it works

The adapter only matches requests. `@chojs/web` builds each route as one
function that runs its middlewares, its handler and its error handler; the
adapter registers it on Fastify with its method and full path, and calls it with
a standard `Request`, Fastify's decoded path parameters, and Fastify's request
and reply. Fastify sends the `Response` the route resolves to.

Middlewares, error handling and the conversion of results are therefore the same
as on any other adapter.

The routes are registered as a Fastify plugin. Inside it Fastify parses no body,
so the body of the request reaches the handler untouched, as the stream of
`ctx.req`: read it with `ctx.req.json()`, `ctx.req.text()`, `ctx.req.formData()`
and so on. Routes you add to the Fastify application yourself keep Fastify's
body parsing.

## Behavior

| Topic               | Behavior                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Matching order      | Fastify's router decides: a static path wins over a parameter, wherever they are declared (`me` wins over `:id`)               |
| Paths               | Matched as written: case and a trailing slash count, unless the Fastify application is set otherwise                           |
| Path parameters     | Percent-decoded. A parameter matches one segment, never an empty one. Fastify answers `400` to a path that cannot be decoded   |
| Request body        | Not parsed by Fastify: `ctx.req` reads the stream                                                                              |
| Client disconnects  | `ctx.req.signal` is aborted when the connection closes before the response is sent                                             |
| `HEAD` requests     | Run the `@Head` handler of the route. Without one, the `@Get` handler answers, without the body                                |
| Unhandled errors    | A route that fails with no `@Catch` and no `onError` goes to Fastify's error handler: `500`, logged when the logger is enabled |
| Unmatched requests  | Answered by Fastify's not-found handler                                                                                        |
| When routes exist   | Once the Fastify application is ready: `listen()`, `ready()` and `app.handler` wait for it                                     |
| One linker, one app | A second `link()` on the same linker throws: its Fastify application already holds the routes of the first                     |

## Documentation

- [`@chojs/web`](../../web/README.md): the web package and its
  [specification](../../web/specs.md).
- [Fastify](https://fastify.dev/docs/latest/): the server underneath.

## License

[MIT](./LICENSE)
