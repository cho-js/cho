# @chojs/web

HTTP applications built with decorators: controllers declare route handlers, and
`ChoWeb` turns the application into a `fetch`-style request handler that any
server can call. It is built on the dependency injection of `@chojs/core` (see
`core/specs.md`), and runs on Deno, Node.js and Bun.

**Early stage.** The API may change. This document describes what an application
gets today. The source code is the reference: when this document and the code
disagree, the code wins. Known bugs are tracked in `web/issues.md`.

## 1. Overview

An application imports everything from `@chojs/web` (the core's `@Injectable`,
`token` and `provider` included, so it never imports `@chojs/core`), plus a
**runtime adapter** that matches requests to routes with an HTTP library. The
only adapter today is `@chojs/vendor-hono` (Hono).

`@chojs/web` does the rest itself, the same way on every adapter: it creates the
request context, runs the middlewares, the handler and the error handler, and
converts the result to a `Response`. Application code only sees the standard
`Request` and `Response`, never the HTTP library.

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

`examples/hello-world-http.ts` is a minimal application.

## 2. Routes

### 2.1 Features, controllers and handlers

- A **feature** is a module that declares controllers. Every feature is mounted
  at the root of the application, whatever imports it: importing a module does
  not nest its routes.
- A **controller** is a `@Controller` class declared by a feature. Besides its
  own handlers, it has the handlers it **inherits** from a base class. An
  override keeps the inherited route unless it declares one itself:
  `@Middlewares` on it adds to the parent's middlewares (which run first), and
  `@Get(…)` on it replaces the route.
- A **handler** is a controller method marked with `@Get(route)`,
  `@Post(route)`, `@Put(route)`, `@Patch(route)`, `@Delete(route)`,
  `@Head(route)` or `@Options(route)`. Other methods are not routes. A handler
  is a public, non-static method with a string name, and has one HTTP method
  decorator: anything else throws when the class is defined.

Only what serves a route counts. A controller without a handler is not part of
the web application, and a module left without such a controller is not a
feature: its `route` option, middlewares and error handler are ignored, and its
middleware and error handler classes are not created.

`@Module` and `@Controller` come from `@chojs/web`: they are the core's, with
one more option, `route`. Any other option is rejected, by the types and when
the class is defined, so a misspelled `dependencies` or `providers` cannot pass
silently. A handler keeps its route under any other method decorator, including
one that replaces the method.

### 2.2 The four levels

A handler's path joins up to four levels, each optional:

| Level         | Declared by                                   |
| ------------- | --------------------------------------------- |
| global prefix | the `prefix` option of `ChoWeb.create`        |
| feature       | the `route` option of the feature's `@Module` |
| controller    | the `route` option of `@Controller`           |
| handler       | the argument of `@Get`, `@Post`, `@Put`, ...  |

A level that is missing or `""` adds nothing: `@Get("")` on a controller with
`route: "users"` in a feature without a route is `GET /users`.

### 2.3 Route rules

Routes are trimmed, then checked: a handler's route when its class is defined,
the others when the application is created.

- no leading or trailing `/`: write `"users/:id"`, not `"/users/:id/"`;
- no empty segment (`a//b`), and no `.` or `..` segment;
- only characters a URL path allows, or percent-encoded bytes. `:` is allowed,
  for parameters (`":id"`).

Two handlers with the same HTTP method and the same full path are an error.
Parameter names do not count: `users/:id` and `users/:name` are the same path.

Routes are given to the adapter in declaration order. With the Hono adapter they
are matched in that order: a parameter route declared first (`@Get(":id")`) also
matches the static routes declared after it (`@Get("raw")`). Declare static
routes first.

## 3. Handlers and the context

A handler receives the request's `ChoWebContext`:

| Property | Holds                                                                         |
| -------- | ----------------------------------------------------------------------------- |
| `req`    | the standard `Request` (`ctx.req.json()`, `ctx.req.headers`, …)               |
| `params` | the path parameters of the route, decoded (`ctx.params.id`)                   |
| `url`    | the request URL, parsed on first use (`ctx.url.searchParams`)                 |
| `state`  | a `Map` for the request: what a middleware sets, later ones and handlers read |
| `native` | the adapter's own context (Hono's `Context`); `undefined` if it has none      |

The middlewares, the handler and the error handler of a request share one
context. Code that uses `native` only runs on that adapter.

- A handler can be `async`.
- What it returns is the response:

  | Returned                                                         | Sent                                                        |
  | ---------------------------------------------------------------- | ----------------------------------------------------------- |
  | a `Response`                                                     | as is                                                       |
  | nothing (`undefined`)                                            | `204 No Content`                                            |
  | a string                                                         | as text: `text/plain;charset=UTF-8`                         |
  | bytes: `Uint8Array` and other typed arrays, `ArrayBuffer`        | as bytes, with no content type                              |
  | a `Blob`                                                         | its bytes, with the blob's own type                         |
  | a `ReadableStream`                                               | streamed, with no content type                              |
  | a `FormData`, a `URLSearchParams`                                | as a form: `multipart/form-data` or `x-www-form-urlencoded` |
  | anything else: objects, arrays, numbers, booleans, `null`, dates | as JSON: `application/json`                                 |

  The rows between `undefined` and "anything else" are the bodies the platform's
  `Response` accepts: the value is given to `new Response(value)`, with status
  `200`. The platform sets the content type, except for a string, where
  `@chojs/web` sets it so that it is the same on every runtime (Bun only adds it
  when the response is sent). For another status or content type, return a
  `Response`. A value that cannot be serialized as JSON (a `BigInt`, a cycle) is
  an error (section 5).
- The response of a `@Head` handler is sent **without its body**: only its
  status and headers. Without a `@Head` handler, what a `HEAD` request gets is
  up to the adapter (Hono answers it from the `@Get` handler, without the body).
- A handler runs on its controller instance, so `this` works. Controllers are
  created once, with their dependencies, when the application is created.

## 4. Middlewares

`@Middlewares(...)` (from `@chojs/web`) applies to a feature module, a
controller or a handler. A middleware is either:

- a function `(ctx, next)`; or
- a class with a `handle(ctx, next)` method. It is created by the injector, in
  the feature module's scope, so it must be a provider visible there, and it can
  have dependencies.

A middleware wraps the rest of the chain (the next middlewares, then the
handler):

- `next()` runs the rest of the chain and resolves to its `Response`;
- returning a `Response` answers the request with it: without calling `next()`
  to answer early, or after it to replace the response;
- returning nothing after calling `next()` passes the response on, so
  `await next();` alone is enough.

```ts
const timing: ChoWebMiddlewareFn = async (ctx, next) => {
  const start = Date.now();
  const response = await next();
  response.headers.set("x-time", `${Date.now() - start}ms`);
  return response;
};

@Injectable([Tokens])
class Auth {
  constructor(readonly tokens: Tokens) {}
  handle(ctx: ChoWebContext, next: () => Promise<Response>) {
    const user = this.tokens.user(ctx.req.headers.get("authorization"));
    if (!user) {
      return new Response("unauthorized", { status: 401 });
    }
    ctx.state.set("user", user); // for the handler
    return next();
  }
}

@Middlewares(Auth) // every route of the controller
@Controller({ route: "admin" })
class Admin {
  @Middlewares(timing) // this route only
  @Get("stats")
  stats(ctx: ChoWebContext) {
    return { for: ctx.state.get("user") };
  }
}
```

A request runs the feature's middlewares, then the controller's, then the
handler's, each in declaration order. Middlewares belong to their routes: they
only run for a request that matches a route they apply to, never for another
feature's or controller's routes, nor for a request that matches nothing.

Middlewares of the HTTP library (Hono's `cors()`, …) are not CHO middlewares:
they go on the library's own application, which the adapter takes
(`new HonoLinker(hono)`, see `vendor/hono/README.md`).

A middleware that calls `next()` twice, returns something that is not a
`Response`, or returns nothing without calling `next()`, makes the request fail
(section 5).

## 5. Error handlers

`@Catch(handler)` applies to a feature module, a controller or a handler. A
handler is a function `(error, ctx)`, or a class with a `handle(error, ctx)`
method created by the injector like a middleware class. Its result is the
response, converted like a handler's result. It can be `async`.

**An error handler that returns nothing has not handled the error.** A handler's
`undefined` is a `204`; an error handler's is not, or a handler that only logs
would report every failed request as a success. The error goes on to the adapter
instead, as if there were no handler. To answer with an empty body, return a
`Response`.

An error thrown by a handler or by a middleware goes to the nearest one: the
handler's, else the controller's, else the feature's, else the application's.

**The application's error handler** is the `onError` option of `ChoWeb.create`:
the fallback for every route, in every feature, that no `@Catch` covers. It
takes what `@Catch` takes; a class is created in the scope of the root module.

```ts
const app = await ChoWeb.create(App, {
  linker: new HonoLinker(),
  onError: (error, ctx) => {
    console.error(ctx.req.method, ctx.url.pathname, error);
    return Response.json({ error: "internal error" }, { status: 500 });
  },
});
```

It handles the errors of routes only. A request that matches no route never
reaches it: that answer belongs to the adapter (with Hono, `notFound` on the
Hono application given to the linker).

```ts
@Catch((error) => Response.json({ error: String(error) }, { status: 500 }))
@Controller({ route: "users" })
class UsersController {
  @Catch((error, ctx) =>
    new Response(`no user ${ctx.params.id}`, { status: 404 })
  )
  @Get(":id")
  get(ctx: ChoWebContext) {/* ... */}
}
```

Without any error handler at any level, when the error handler returns nothing,
or when it throws too, the error goes to the adapter: the Hono adapter logs it
and answers `500` (or calls the `onError` of the Hono application given to the
linker).

## 6. The application: `ChoWeb`

```ts
const app = await ChoWeb.create(App, {
  linker: new HonoLinker(), // required: the runtime adapter
  prefix: "api", // optional: the global prefix (section 2.2)
  onError: (error, ctx) => new Response("oops", { status: 500 }), // optional: section 5
});
app.handler; // (req: Request) => Promise<Response>
app.linked.instance; // the runtime's own application (a Hono app)
app.routes; // every route: method, path, name
app.graph; // the same routes as a tree: features, controllers, handlers
await app.close(); // when the server has stopped: release the instances
```

`ChoWeb.create` builds the injector, creates **every** instance of the
application up front (`injector.init()`), builds and checks the routes, and
registers them with the adapter. Every wiring, route, middleware or error
handler mistake makes it reject, before the server starts; what was created
until then is disposed.

**Closing.** `app.close()` disposes the application's instances, in reverse
creation order: every provider, controller or module with a
`[Symbol.asyncDispose]()` or `[Symbol.dispose]()` method (`core/specs.md`,
section 2.7). `@chojs/web` does not run the server, so it never closes on its
own: stop the server first, then close.

```ts
const server = Deno.serve(app.handler);
Deno.addSignalListener("SIGTERM", async () => {
  await server.shutdown(); // stop accepting, finish the requests in flight
  await app.close();
});
```

**Testing.** The `overrides` option replaces providers with fakes, anywhere in
the module graph (`core/specs.md`, section 2.7):

```ts
const app = await ChoWeb.create(App, {
  linker: new HonoLinker(),
  overrides: [provider({ provide: Db, factory: () => new FakeDb() })],
});
const response = await app.handler(new Request("http://localhost/users/1"));
```

**Debug logging.** `@chojs/web` logs to the `cho:web` debug context, on stderr.
It is off by default; enable it with `CHO_DEBUGLOG=cho:web`, all of CHO with
`CHO_DEBUGLOG=cho:*` or `CHO_DEBUG=1`. The core's `cho:di` context logs the
injector (`core/specs.md`, section 2.9).

```
cho:web GET /v1/users/:id -> Users.get
cho:web GET /v1/users -> Users.list
cho:web application App created +2ms
cho:web ERROR GET /v1/users/1 failed: Error: db down
```

It logs every route with its handler, the error that stops the application from
being created, and each error a `@Catch` handler receives, with the request's
method and path.

## 7. Runtime adapters

An adapter implements `Linker` (`@chojs/web/linker`): it receives the
application's routes and returns a `Linked`, the runtime's application object
and its `fetch`-style handler. `@chojs/web` never imports an adapter:
applications pass one to `ChoWeb.create`.

An adapter does no plumbing. Each `Route` is ready to call:

| Property | Holds                                                                      |
| -------- | -------------------------------------------------------------------------- |
| `method` | the HTTP method, upper case (`"GET"`)                                      |
| `path`   | the full path, global prefix included (`"/api/users/:id"`)                 |
| `name`   | where it is declared, for logs (`"UsersController.get"`)                   |
| `handle` | `(req, params?, native?) => Promise<Response>`: answers a matching request |

`handle` runs the route's middlewares, its handler and its error handler. The
adapter gives it the `Request`, the decoded path parameters of the match and,
optionally, its own request context, which handlers see as `ctx.native`. It
rejects when the route fails without an error handler: the adapter answers
`500`.

```ts
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

A path is `/`-separated segments; a segment that starts with `:` is a parameter
that matches one segment. An adapter whose router uses another syntax translates
it.

The tree behind the routes is on `app.graph` (`@chojs/web/graph`), with every
instance, middleware and error handler already created:

| Node            | Holds                                                                            |
| --------------- | -------------------------------------------------------------------------------- |
| `AppRef`        | `route` (the global prefix), `errorHandler` (the application's), `features`      |
| `FeatureRef`    | `route`, `middlewares`, `errorHandler`, `controllers`                            |
| `ControllerRef` | `route`, `middlewares`, `errorHandler`, `instance`, `methods`                    |
| `MethodRef`     | `route`, `middlewares`, `errorHandler`, `name`, `method` (`"GET"`, …), `handler` |

## 8. Public API

| Entry point          | Exports                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@chojs/web`         | `ChoWeb`, `ChoWebOptions`, `Get`, `Post`, `Put`, `Patch`, `Delete`, `Head`, `Options`, `Middlewares`, `Catch`, the types `ChoWebContext`, `ChoWebHandler`, `ChoWebNext`, `ChoWebMiddlewareFn`, `ChoWebMiddleware`, `ChoWebErrorHandlerFn`, `ChoWebErrorHandler`, `Module`, `Controller` (the core's, with the `route` option), `WebModuleOptions`, `WebControllerOptions`, and from the core `Injectable`, `token`, `provider`, `InjectionToken`, `Provider` and the option types |
| `@chojs/web/linker`  | `Linker`, `Linked`, `Route`                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `@chojs/web/graph`   | `AppRef`, `FeatureRef`, `ControllerRef`, `MethodRef`, `NodeRef`, `ErrorHandlerRef`                                                                                                                                                                                                                                                                                                                                                                                                |
| `@chojs/vendor-hono` | `HonoLinker`, `HonoLinked`                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

`@Middlewares` and `@Catch` are the core's decorators, typed for `@chojs/web`.

## 9. Errors

**Thrown by the decorators**, when the class is defined:

| Mistake                                        | Message                                                                                                                     |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| A handler's route is invalid                   | `Invalid route "<route>" of @Get() on method <name>: <reason>`                                                              |
| A second HTTP method decorator on a method     | `Cannot add @Get() to method <name>: it already handles POST "<route>". A method can have one HTTP method decorator.`       |
| An unknown option of `@Module` / `@Controller` | `@Controller(): unknown option "deps". Known options: dependencies, route`                                                  |
| A static, private or symbol-named handler      | `TypeError: @Get() cannot decorate static method <name>: a handler must not be static` (and `private …`, `… a string name`) |

**Rejected by `ChoWeb.create`**: any module graph error of the core
(`core/specs.md`, section 2.8), and:

| Mistake                                       | Message                                                                                      |
| --------------------------------------------- | -------------------------------------------------------------------------------------------- |
| A route is not a string                       | `TypeError: Invalid route of <where>: expected a string, got <v>`                            |
| A route breaks a rule (section 2.3)           | `Invalid route "<route>" of <where>: <reason>`                                               |
| Two handlers with the same method and path    | `Duplicate route "<METHOD> <path>": declared by <Controller.method> and <Controller.method>` |
| `onError` is not a function or a class        | `TypeError: The application's error handler must be a function or a class, got <v>`          |
| A middleware class has no `handle` method     | `Middleware class <Name> must implement 'handle' method.`                                    |
| A middleware class cannot be created          | `Failed to create middleware <Name> in module <Module>`, with the injector's error as cause  |
| An error handler class has no `handle` method | `Error handler class <Name> must implement 'handle' method.`                                 |
| An error handler class cannot be created      | `Failed to create error handler <Name> in module <Module>`, with `cause`                     |

`<where>` names the declaration: `the global prefix`, `feature <Module>`,
`controller <Controller>` or `method <name> of controller <Controller>`.

**Failing a request** (given to the route's error handler, section 5):

| Mistake                                               | Message                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| A middleware calls `next()` twice                     | `middleware <name>: next() called more than once`                              |
| A middleware returns nothing without calling `next()` | `middleware <name> returned no response: return a Response or call next()`     |
| A middleware returns something else                   | `TypeError: middleware <name> must return a Response or nothing, got <typeof>` |

A middleware class is named `<Class>.handle`.

## 10. Internals

- **Records.** `@Get` and its siblings write `{ method, route }` on the method
  under a private symbol key (`web/keys.ts`, `Symbol.for("chojs.web.http")`).
  The `route` option of `@Module` / `@Controller` is a plain user option of the
  core. `@Middlewares` and `@Catch` write the core's records.
- **Building the graph** (`web/build-graph.ts`): for each module of the injector
  with a controller that has handlers, the routes are read and checked, the
  controllers are resolved in that module's scope, and middleware and error
  handler classes are created there.
- **Compiling the routes** (`web/routes.ts`): each handler of the graph becomes
  one `Route`. Its `handle` creates the context (`web/context.ts`), runs the
  feature's, controller's and handler's middlewares around the handler (the
  core's `compose`, through `web/compose.ts`), converts the result
  (`web/response.ts`), and gives an error to the nearest error handler.
  Duplicate routes are rejected here.
- **The Hono adapter** registers each route on one Hono application with
  `app.on(method, path, …)`, and calls `route.handle` with the raw `Request`,
  Hono's decoded parameters and Hono's context.
- **Testing without an adapter.** `web/testing.ts` (not published) has a linker
  that matches requests itself; the tests of `@chojs/web` use it.
