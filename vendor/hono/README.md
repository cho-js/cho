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

- Each feature module and each controller becomes a Hono sub-application,
  mounted at its route, with its middlewares (`use`) and error handler
  (`onError`).
- Handlers receive Hono's `Context`. A `Response` they return is sent as is;
  anything else is sent with `ctx.json()`.
- Middlewares are Hono middlewares, `(ctx, next) => Promise`. They run in order:
  the feature's, the controller's, then the handler's.
- An error goes to the nearest `@Catch` handler (the handler's, the
  controller's, then the feature's), called as `(error, ctx)`; without one, Hono
  logs it and answers `500`.
- Routes are matched in declaration order: declare static routes before
  parameter routes (`@Get("me")` before `@Get(":id")`).
- Supported HTTP methods: GET, POST, PUT, DELETE and PATCH.
- Debug logging: `CHO_DEBUGLOG=cho:web:hono` logs each route registered and each
  error a `@Catch` handler receives (`CHO_DEBUGLOG=cho:web*` adds `@chojs/web`'s
  routes).

## Known issues

- The global `prefix` of `ChoWeb.create` is not applied yet.

See [`web/issues.md`](../../web/issues.md) for details, and the
[`@chojs/web` specification](../../web/specs.md) for the full behavior.
