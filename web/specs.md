# @chojs/web

HTTP applications built with decorators: controllers declare route handlers, and
`ChoWeb` turns the application into a `fetch`-style request handler that any
server can call. It is built on the dependency injection of `@chojs/core` (see
`core/specs.md`), and runs on Deno, Node.js and Bun.

**Early stage.** The API may change. This document describes what an application
gets today. The source code is the reference: when this document and the code
disagree, the code wins. Known bugs are tracked in `web/issues.md`.

## 1. Overview

An application imports everything from `@chojs/web`, plus a **runtime adapter**
that runs the routes on an HTTP library. The only adapter today is
`@chojs/vendor-hono` (Hono).

```ts
import { ChoWeb, Controller, Get, Injectable, Module, Post } from "@chojs/web";
import { HonoLinker } from "@chojs/vendor-hono";
import type { Context } from "hono";

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
  get(ctx: Context) {
    return this.store.find(ctx.req.param("id")!); // sent as JSON
  }

  @Post("") // POST /v1/users
  async create(ctx: Context) {
    const user = await ctx.req.json();
    return new Response(JSON.stringify(user), { status: 201 });
  }
}

@Module({ route: "v1", providers: [UserStore], controllers: [UsersController] })
class App {}

const app = await ChoWeb.create(App, { linker: new HonoLinker() });
Deno.serve(app.handler); // or Bun.serve({ fetch: app.handler })
```

`examples/hello-world-http.ts` is a minimal application.

## 2. Routes

### 2.1 Features, controllers and handlers

- A **feature** is a module that declares controllers. Every feature is mounted
  at the root of the application, whatever imports it: importing a module does
  not nest its routes.
- A **controller** is a `@Controller` class declared by a feature.
- A **handler** is a controller method marked with `@Get(route)`,
  `@Post(route)`, `@Put(route)` or `@Delete(route)`. Other methods are not
  routes.

A module without controllers has no route, and its `route` option, middlewares
and error handler are ignored.

### 2.2 The four levels

A handler's path joins up to four levels, each optional:

| Level         | Declared by                                           |
| ------------- | ----------------------------------------------------- |
| global prefix | the `prefix` option of `ChoWeb.create` (\*)           |
| feature       | the `route` option of the feature's `@Module`         |
| controller    | the `route` option of `@Controller`                   |
| handler       | the argument of `@Get` / `@Post` / `@Put` / `@Delete` |

(\*) The Hono adapter does not apply the global prefix yet (`web/issues.md`).

A level that is missing or `""` adds nothing: `@Get("")` on a controller with
`route: "users"` in a feature without a route is `GET /users`.

### 2.3 Route rules

Routes are trimmed, then checked when the application is created:

- no leading or trailing `/`: write `"users/:id"`, not `"/users/:id/"`;
- no empty segment (`a//b`), and no `.` or `..` segment;
- only characters a URL path allows, or percent-encoded bytes. `:` is allowed,
  for parameters (`":id"`).

Two handlers with the same HTTP method and the same full path are an error.

With the Hono adapter, routes are matched **in declaration order**: a parameter
route declared first (`@Get(":id")`) also matches the static routes declared
after it (`@Get("raw")`). Declare static routes first.

## 3. Handlers

- A handler receives the request context of the runtime: Hono's `Context` with
  the Hono adapter (`ctx.req.param("id")`, `ctx.req.json()`, …).
- It can be `async`.
- What it returns is the response: a `Response` is sent as is; anything else is
  sent as JSON with status `200` (a string becomes a JSON string, nothing
  becomes an empty body).
- A handler runs on its controller instance, so `this` works. Controllers are
  created once, with their dependencies, when the application is created.

## 4. Middlewares

`@Middlewares(...)` (from `@chojs/web`) applies to a feature module, a
controller or a handler. A middleware is either:

- a function `(ctx, next) => Promise`, as Hono middlewares are; or
- a class with a `handle(ctx, next)` method. It is created by the injector, in
  the feature module's scope, so it must be a provider visible there, and it can
  have dependencies.

```ts
@Injectable([Tokens])
class Auth {
  constructor(readonly tokens: Tokens) {}
  async handle(ctx: Context, next: () => Promise<void>) {
    if (!this.tokens.valid(ctx.req.header("authorization"))) {
      return ctx.text("unauthorized", 401);
    }
    await next();
  }
}

@Middlewares(Auth) // every route of the controller
@Controller({ route: "admin" })
class Admin {
  @Middlewares(timing) // this route only
  @Get("stats")
  stats() {/* ... */}
}
```

A request runs the feature's middlewares, then the controller's, then the
handler's, each in declaration order.

## 5. Error handlers

`@Catch(handler)` applies to a feature module, a controller or a handler. A
handler is a function, or a class with a `handle` method created by the injector
like a middleware class. It should return a `Response`.

The nearest one handles the error: the handler's, else the controller's, else
the feature's. Without any, the Hono adapter logs the error and answers `500`.

At every level, a handler is called **error first**: a function as
`(error, ctx)`, a class through `handle(error, ctx)`, where `ctx` is the request
context of the runtime (Hono's `Context` with the Hono adapter).

```ts
@Catch((error) => Response.json({ error: String(error) }, { status: 500 }))
@Controller({ route: "users" })
class UsersController {
  @Catch((error, ctx) => (ctx as Context).text("not found", 404))
  @Get(":id")
  get(ctx: Context) {/* ... */}
}
```

## 6. The application: `ChoWeb`

```ts
const app = await ChoWeb.create(App, {
  linker: new HonoLinker(), // required: the runtime adapter
  prefix: "api", // optional: the global prefix (section 2.2)
});
app.handler; // (req: Request) => Promise<Response>
app.linked.instance; // the runtime's own application (a Hono app)
```

`ChoWeb.create` builds the injector, creates **every** instance of the
application up front (`injector.init()`), builds and checks the routes, and
links them with the adapter. Every wiring, route, middleware or error handler
mistake makes it reject, before the server starts. The `name` and `version`
options are accepted but not used yet.

**Debug logging.** `ChoWeb.create` logs to the `cho:web` debug context, and the
Hono adapter to `cho:web:hono`, on stderr. They are off by default; enable both
with `CHO_DEBUGLOG=cho:web*`, all of CHO with `CHO_DEBUGLOG=cho:*` or
`CHO_DEBUG=1`. The core's `cho:di` context logs the injector (`core/specs.md`,
section 2.9).

```
cho:web GET /v1/users/:id -> Users.get
cho:web GET /v1/users -> Users.list
cho:web:hono registered GET /v1/users/:id
cho:web:hono registered GET /v1/users
cho:web:hono linked 2 routes +0ms
cho:web application App created +2ms
cho:web:hono ERROR GET /v1/users/1 failed: Error: db down
```

`cho:web` logs every route with its handler, and the error that stops the
application from being created. `cho:web:hono` logs each route it registers, and
each error a `@Catch` handler receives, with the request's method and path.

## 7. Runtime adapters

An adapter implements `Linker` (`@chojs/web/linker`): it receives the
application's HTTP graph (`@chojs/web/graph`) and returns a `Linked`, the
runtime's application object and its `fetch`-style handler. `@chojs/web` never
imports an adapter: applications pass one to `ChoWeb.create`.

The graph is ready to run without the DI system: every instance, middleware and
error handler is already created.

| Node            | Holds                                                                            |
| --------------- | -------------------------------------------------------------------------------- |
| `AppRef`        | `route` (the global prefix), `features`                                          |
| `FeatureRef`    | `route`, `middlewares`, `errorHandler`, `controllers`                            |
| `ControllerRef` | `route`, `middlewares`, `errorHandler`, `instance`, `methods`                    |
| `MethodRef`     | `route`, `middlewares`, `errorHandler`, `name`, `method` (`"GET"`, …), `handler` |

```ts
class MyLinker implements Linker<MyServer> {
  link(graph: AppRef): Linked<MyServer> {
    const server = new MyServer();
    for (const feature of graph.features) {
      for (const controller of feature.controllers) {
        for (const m of controller.methods) {
          const path = [graph.route, feature.route, controller.route, m.route]
            .filter(Boolean).join("/");
          server.on(m.method, `/${path}`, m.handler);
        }
      }
    }
    return { instance: server, handler: (req) => server.fetch(req) };
  }
}
```

The Hono adapter supports GET, POST, PUT, DELETE and PATCH; any other method
throws when linking.

## 8. Public API

| Entry point          | Exports                                                                                                                                                                                                                 |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@chojs/web`         | `ChoWeb`, `ChoWebOptions`, `Get`, `Post`, `Put`, `Delete`, and from the core `Controller`, `Module`, `Injectable`, `Middlewares`, `Catch`, `ControllerOptions`, `ModuleOptions`, `InjectableOptions`, `ChoMiddlewareFn` |
| `@chojs/web/linker`  | `Linker`, `Linked`                                                                                                                                                                                                      |
| `@chojs/web/graph`   | `AppRef`, `FeatureRef`, `ControllerRef`, `MethodRef`, `NodeRef`, `ControllerInstance`, `ErrorHandlerRef`, `ChoMiddlewareFn`                                                                                             |
| `@chojs/vendor-hono` | `HonoLinker`, `HonoLinked`                                                                                                                                                                                              |

## 9. Errors

`ChoWeb.create` rejects with any module graph error of the core
(`core/specs.md`, section 2.8), and:

| Mistake                                       | Message                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| A route is not a string                       | `TypeError: Invalid route of <where>: expected a string, got <v>`                           |
| A route breaks a rule (section 2.3)           | `Invalid route "<route>" of <where>: <reason>`                                              |
| Two handlers with the same method and path    | `Duplicate route "<METHOD> /<path>": already declared by another method.`                   |
| A middleware class has no `handle` method     | `Middleware class <Name> must implement 'handle' method.`                                   |
| A middleware class cannot be created          | `Failed to create middleware <Name> in module <Module>`, with the injector's error as cause |
| An error handler class has no `handle` method | `Error handler class <Name> must implement 'handle' method.`                                |
| An error handler class cannot be created      | `Failed to create error handler <Name> in module <Module>`, with `cause`                    |
| An HTTP method the adapter does not support   | `Unsupported HTTP method: <METHOD>` (Hono adapter)                                          |

`<where>` names the declaration: `the global prefix`, `feature <Module>`,
`controller <Controller>` or `method <name> of controller <Controller>`.

## 10. Internals

- **Records.** `@Get` and its siblings write `{ method, route }` on the method
  under a private symbol key (`web/keys.ts`, `Symbol.for("chojs.web.http")`).
  The `route` option of `@Module` / `@Controller` is a plain user option of the
  core.
- **Building the graph** (`web/build-graph.ts`, internal): for each module of
  the injector that declares controllers, the routes are read and checked, the
  controllers are resolved in that module's scope, and middleware and error
  handler classes are created there. Middlewares and error handlers come from
  the core's metadata (`middlewares` and `errorHandler` of modules, controllers
  and methods).
- **The Hono adapter** builds one Hono sub-application per feature and per
  controller, with its middlewares (`use`) and error handler (`onError`), and
  registers each handler with its own middlewares.
