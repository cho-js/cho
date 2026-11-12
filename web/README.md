# @chojs/web

[![JSR](https://jsr.io/badges/@chojs/web)](https://jsr.io/@chojs/web)

> **Early stage.** The API may change.

HTTP applications built with decorators, on top of the [CHO](../README.md)
dependency injection. Controllers declare route handlers; `ChoWeb` turns the
application into a `fetch`-style request handler that any server can call.

## Features

- **Portable application code.** Handlers, middlewares and error handlers
  receive a `ChoWebContext` built on the standard `Request`, and answer with a
  standard `Response`: nothing in a controller depends on the HTTP library.
- **Runtime adapters.** `@chojs/web` does not depend on an HTTP library: an
  adapter only matches requests to routes. Today:
  [`@chojs/vendor-hono`](../vendor/hono/README.md) (Hono).
- **Dependency injection.** Controllers, middlewares and error handlers receive
  their dependencies from the module graph. Everything is created and checked
  when the application starts.
- **Four route levels.** A global prefix, the feature module, the controller and
  the handler.
- **Middlewares and error handlers** on modules, controllers and handlers, as
  functions or injectable classes, and one error handler for the whole
  application (`onError`).
- **Every runtime.** Deno, Node.js and Bun: `app.handler` is a plain
  `(req: Request) => Promise<Response>`.

## Install

```sh
deno add jsr:@chojs/web jsr:@chojs/vendor-hono    # Deno
npx jsr add @chojs/web @chojs/vendor-hono         # Node.js
bunx jsr add @chojs/web @chojs/vendor-hono        # Bun
```

## Example

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
Deno.serve(app.handler); // or Bun.serve({ fetch: app.handler })
```

See also [`examples/hello-world-http.ts`](../examples/hello-world-http.ts).

## Documentation

- [Specification](./specs.md): routes, handlers, middlewares, error handlers,
  writing a runtime adapter, and error messages.
- [Known issues](./issues.md).
