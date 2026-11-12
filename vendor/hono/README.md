# @chojs/vendor-hono

[![JSR](https://jsr.io/badges/@chojs/vendor-hono)](https://jsr.io/@chojs/vendor-hono)

> **Early stage.** The API may change.

Runs [`@chojs/web`](../../web/README.md) applications on
[Hono](https://hono.dev). `HonoLinker` turns the routes of a CHO web application
into a Hono application.

## Install

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

Deno.serve(app.handler); // the Hono app's fetch
app.linked.instance; // the Hono app itself
```

## Behavior

The adapter only matches requests. `@chojs/web` builds each route as one
function that runs its middlewares, its handler and its error handler; the
adapter registers it on a Hono application with its method and full path (global
`prefix` included), and calls it with the raw `Request` and Hono's decoded path
parameters.

- Handlers, middlewares and error handlers receive a `ChoWebContext`, not Hono's
  `Context`. Hono's is its `native` property, for what only Hono can do:

  ```ts
  import type { Context } from "hono";

  @Get("ip")
  ip(ctx: ChoWebContext) {
    return (ctx.native as Context).env; // this handler now needs Hono
  }
  ```

- Hono middlewares (`cors()`, `logger()`, …) are not CHO middlewares. To use
  them, add them to a Hono application and give it to the linker. The routes are
  registered after them, so they wrap every route:

  ```ts
  import { Hono } from "hono";
  import { cors } from "hono/cors";

  const hono = new Hono();
  hono.use(cors());
  const app = await ChoWeb.create(App, { linker: new HonoLinker(hono) });
  ```

- Routes are matched in declaration order: declare static routes before
  parameter routes (`@Get("me")` before `@Get(":id")`).
- A route that fails without a `@Catch` handler goes to Hono's error handler,
  which logs the error and answers `500`. Set your own with `onError`, and the
  answer to unmatched requests with `notFound`, on the Hono application.
- Any HTTP method is registered as given.

## Known issues

None open for the adapter itself. See [`web/issues.md`](../../web/issues.md),
and the [`@chojs/web` specification](../../web/specs.md) for the full behavior.
