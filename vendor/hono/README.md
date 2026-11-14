# @chojs/vendor-hono

[![JSR](https://jsr.io/badges/@chojs/vendor-hono)](https://jsr.io/@chojs/vendor-hono)
[![JSR score](https://jsr.io/badges/@chojs/vendor-hono/score)](https://jsr.io/@chojs/vendor-hono)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

The [Hono](https://hono.dev) adapter for [`@chojs/web`](../../web/README.md): it
registers the routes of a CHO web application on a Hono application.

## Contents

- [Installation](#installation)
- [Usage](#usage)
- [Using Hono middlewares](#using-hono-middlewares)
- [Reaching Hono from a handler](#reaching-hono-from-a-handler)
- [How it works](#how-it-works)
- [Behavior](#behavior)
- [Documentation](#documentation)

## Installation

```sh
deno add jsr:@chojs/web jsr:@chojs/vendor-hono    # Deno
npx jsr add @chojs/web @chojs/vendor-hono         # Node.js
bunx jsr add @chojs/web @chojs/vendor-hono        # Bun
```

## Usage

Pass a `HonoLinker` to `ChoWeb.create`:

```ts
import { ChoWeb } from "@chojs/web";
import { HonoLinker } from "@chojs/vendor-hono";

const app = await ChoWeb.create(App, { linker: new HonoLinker() });

Deno.serve(app.handler); // Bun: Bun.serve({ fetch: app.handler })
app.linked.instance; // the Hono application
```

## Using Hono middlewares

Hono middlewares (`cors()`, `basicAuth()`, `etag()`, …) are written for Hono's
context. There are two ways to use them.

**On a handler, a controller or a feature**, with `fromHono`, which turns a Hono
middleware into a CHO middleware for `@Middlewares`:

```ts
import { basicAuth } from "hono/basic-auth";
import { etag } from "hono/etag";
import { Controller, Get, Middlewares } from "@chojs/web";
import { fromHono } from "@chojs/vendor-hono";

@Middlewares(fromHono(basicAuth({ username: "ada", password: "secret" })))
@Controller({ route: "admin" })
class AdminController {
  @Middlewares(fromHono(etag()))
  @Get("report")
  report() {
    return { users: 3 };
  }
}
```

The Hono middleware runs with Hono's context, at its place among the CHO
middlewares:

| In the Hono middleware            | What happens                                                   |
| --------------------------------- | -------------------------------------------------------------- |
| `await next()`                    | The rest of the CHO chain runs, and `c.res` is its response    |
| Changing `c.res`, or `c.header()` | Changes the response, as in Hono                               |
| Returning a `Response`            | Answers the request                                            |
| Throwing an `HTTPException`       | Answers with the exception's response, as Hono does            |
| Throwing anything else            | The error goes to the CHO error handlers (`@Catch`, `onError`) |

A middleware made with `fromHono` only runs on this adapter: on another one it
fails the request.

**On every request**, unmatched ones included: add the middleware to a Hono
application and give it to the linker. The routes are registered after it, so it
wraps every route. This is the place for what must also answer requests no route
matches, such as CORS preflight requests:

```ts
import { Hono } from "hono";
import { cors } from "hono/cors";

const hono = new Hono();
hono.use(cors());
hono.notFound((c) => c.json({ error: "not found" }, 404));

const app = await ChoWeb.create(App, { linker: new HonoLinker(hono) });
```

The same Hono application takes your `onError` and `notFound` handlers.

## Reaching Hono from a handler

Handlers, middlewares and error handlers receive a `ChoWebContext`, not Hono's
`Context`. Hono's is its `native` property, for what only Hono can do. A handler
that uses it only runs on this adapter.

```ts
import type { Context } from "hono";

@Get("ip")
ip(ctx: ChoWebContext) {
  return (ctx.native as Context).env;
}
```

## How it works

The adapter only matches requests. `@chojs/web` builds each route as one
function that runs its middlewares, its handler and its error handler; the
adapter registers it on Hono with its method and full path, and calls it with
the raw `Request`, Hono's decoded path parameters and Hono's context.

Middlewares, error handling and the conversion of results are therefore the same
as on any other adapter.

## Behavior

| Topic               | Behavior                                                                                                                   |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Matching order      | Routes are matched in declaration order: declare static routes before parameter routes (`@Get("me")` before `@Get(":id")`) |
| `HEAD` requests     | Run the `@Head` handler of the route, matched before the others. Without one, Hono answers from `@Get`, without the body   |
| Unhandled errors    | A route that fails with no `@Catch` and no `onError` goes to Hono's error handler, which logs it and answers `500`         |
| Unmatched requests  | Answered by Hono's `notFound`                                                                                              |
| HTTP methods        | Any method is registered as given                                                                                          |
| One linker, one app | A second `link()` on the same linker throws: its Hono application already holds the routes of the first                    |

## Documentation

- [`@chojs/web`](../../web/README.md): the web package and its
  [specification](../../web/specs.md).
- [Hono](https://hono.dev/docs): the router underneath.

## License

[MIT](./LICENSE)
