# @chojs/web

HTTP applications built with decorators: controllers declare route handlers, and
`ChoWeb` turns the application into a `fetch`-style request handler that any
server can call. It is built on the dependency injection of `@chojs/core` (see
`core/specs.md`), and runs on Deno, Node.js and Bun.

This document describes what an application gets. The source code is the
reference: when this document and the code disagree, the code wins.

## 1. Overview

An application imports everything from `@chojs/web` (the core's `@Injectable`,
`token` and `provider` included, so it never imports `@chojs/core`). Requests
are matched to routes by a **linker**: the built-in router, `ChoLinker` (the
standard URL Pattern API, with no HTTP library), or a **runtime adapter**,
`@chojs/vendor-hono` (Hono) or `@chojs/vendor-fastify` (Fastify, on Node.js
only). Section 7 compares them.

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
- only characters a URL path allows, or percent-encoded bytes;
- a segment that starts with `:` is a **parameter**, `:name` (letters, digits
  and `_`), and matches one segment. It is the only pattern: there are no
  wildcards (`*` is rejected) and no optional or regular-expression segments, so
  a route means the same on every adapter.

Two handlers with the same HTTP method and the same full path are an error.
Parameter names do not count: `users/:id` and `users/:name` are the same path.

Routes are given to the adapter in declaration order. The plain adapter and the
Hono adapter match them in that order: a parameter route declared first
(`@Get(":id")`) also matches the static routes declared after it
(`@Get("raw")`). On the Fastify adapter a static route wins wherever it is
declared. Declare static routes first, and a route means the same on all three.

## 3. Handlers and the context

A handler receives the request's `ChoWebContext`. A handler that declares
arguments with `@Args` receives them first, and the context last (section 3.1).

| Property | Holds                                                                         |
| -------- | ----------------------------------------------------------------------------- |
| `req`    | the standard `Request` (`ctx.req.json()`, `ctx.req.headers`, …)               |
| `params` | the path parameters of the route, decoded (`ctx.params.id`)                   |
| `url`    | the request URL, parsed on first use (`ctx.url.searchParams`)                 |
| `state`  | a `Map` for the request: what a middleware sets, later ones and handlers read |
| `native` | the adapter's own context (section 7); `undefined` if it has none             |

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
  up to the adapter (the three adapters answer it from the `@Get` handler,
  without the body).
- A handler runs on its controller instance, so `this` works. Controllers are
  created once, with their dependencies, when the application is created.

### 3.1 Handler arguments: `@Args`

Standard decorators cannot decorate a parameter, so a handler declares what it
receives with one decorator on the method: `@Args`, with the list of its
arguments, in the order of the parameters. It is the same idea as the
`dependencies` of a constructor.

```ts
@Controller({ route: "users" })
class UsersController {
  @Put(":id")
  @Args(Param("id"), Query("notify"), Body(UpdateUser))
  update(
    id: string,
    notify: string | undefined,
    user: UpdateUser,
    ctx: ChoWebContext,
  ) {
    // …
  }
}
```

**The call.** With `@Args`, the handler is called with the value of each
argument, in order, and then with the context: `handler(...values, ctx)`. The
context is always the last argument, so a handler that declares arguments can
still reach it; a handler can also leave it out of its parameters. Without
`@Args`, a handler is called with the context alone, as before.

**The arguments.** Five functions make an argument. Each reads one source of the
request:

| Function | Source                                              | Without a key                                  | With a key                          |
| -------- | --------------------------------------------------- | ---------------------------------------------- | ----------------------------------- |
| `Param`  | the path parameters of the route, decoded           | all of them, as an object of strings           | that parameter: a string            |
| `Query`  | the query string                                    | all of it, as an object of strings             | that key: a string or `undefined`   |
| `Header` | the headers of the request                          | all of them, as an object, names in lower case | that header, or `undefined`         |
| `Body`   | the body of the request, read and parsed as JSON    | the parsed body                                | that property of the parsed body    |
| `Form`   | the body of the request, read as a URL-encoded form | all the fields, as an object of strings        | that field: a string or `undefined` |

Every one of them has the same four signatures:

| Call                      | Gives                                   |
| ------------------------- | --------------------------------------- |
| `Body()`                  | the whole source                        |
| `Body(validator)`         | the whole source, with a validator      |
| `Body("name")`            | one key of the source                   |
| `Body("name", validator)` | one key of the source, with a validator |

A string is a key, and an object with a `parse` method is a validator (section
3.2); anything else throws when the function is called. A validator is the last
argument.

- **`Query()` and `Form()`** give the first value of a key that is repeated, as
  `Query("key")` does. For every value of a repeated query key, use
  `ctx.url.searchParams.getAll(key)`.
- **`Header()`** gives a header that is sent several times as one value, joined
  with `", "`, as the platform's `Headers` does.
- **`Param("id")`** must name a parameter of the handler's full path. A name
  that is not in the path is a mistake in the wiring: `ChoWeb.create` rejects
  it, so the value is always a string.
- **`Body("name")`** is `undefined` when the body has no such property, or is
  not an object.

**The body.** `Body` and `Form` read the body of the request, so the handler has
nothing to await:

- `Body` parses the text of the body as JSON (`application/json`). An empty body
  is `undefined`.
- `Form` parses it as a URL-encoded form (`application/x-www-form-urlencoded`):
  an object of strings. An empty body is an empty object. Multipart forms and
  files are not covered: read them from `ctx.req.formData()`.
- Neither looks at the `content-type` of the request: the function chosen says
  how the body is read.
- The body of a request can be read once. It is read the first time an argument
  needs it, and every `Body` and `Form` argument of the handler shares it. A
  handler that declares one must not read `ctx.req` itself.
- A body that cannot be parsed (invalid JSON) fails the request (section 3.2
  says how it is answered).

**Your own arguments.** An argument is also any function `(ctx) => value`, which
can be `async`: it is what the five functions return. It is the way to declare
an argument of your own, such as the user a middleware put in `ctx.state`:

```ts
const CurrentUser = (ctx: ChoWebContext) => ctx.state.get("user") as User;

@Get("me")
@Args(CurrentUser)
me(user: User) {
  return user;
}
```

**Types.** The parameters of the handler are checked against the arguments at
compile time, as the parameters of a constructor are against its `dependencies`:
each parameter must accept the value of its argument, and the parameter after
them the context. Without a validator the types are what the source gives:
strings for `Param`, `Query`, `Header` and `Form`, and `unknown` for `Body`. A
type can be given by hand, `Body<UpdateUser>()`; it is a promise of the caller,
and nothing checks it. With a validator, the type is what the validator gives.

**Rules.**

- `@Args` goes on a handler, above or below its HTTP method decorator. On a
  method that is not a handler it has no effect.
- A method has one `@Args`: a second one throws when the class is defined.
- A handler inherited from a base class keeps its arguments. An override that
  declares `@Args` replaces them; one that does not keeps them.
- The arguments are evaluated in order, after the middlewares of the route and
  just before the handler: a middleware that answers by itself (a failed
  authentication) never reads the body. An argument that throws stops the
  request there; the ones after it are not evaluated.
- Middlewares and error handlers are not handlers: they always receive the
  context.

### 3.2 Validation

**Validators.** A validator is any object with a `parse(value)` method that
returns the value, or throws: the shape of a [zod](https://zod.dev) schema, so a
zod schema is a validator, and so is any other object of that shape.
`@chojs/web` does not depend on zod.

```ts
type ChoWebValidator<T> = { parse(value: unknown): T | Promise<T> };
```

A validator given to an argument does two things: it describes the argument
(section 3.3), and it validates it **when the validation middleware is on the
route**.

**The validation middleware.** Validation is the work of one middleware,
`validate()`. It is declared like any middleware, with `@Middlewares`, on a
handler, on a controller or on a feature module, and covers the handlers under
it. There is no application-wide setting for now.

```ts
const UpdateUser = z.object({ name: z.string(), age: z.number().optional() });

@Middlewares(validate()) // every handler of the controller is validated
@Controller({ route: "users" })
class UsersController {
  @Put(":id")
  @Args(Param("id", z.coerce.number()), Body(UpdateUser))
  update(id: number, user: z.infer<typeof UpdateUser>) {
    // …
  }
}
```

With the middleware on the route:

- Every argument that has a validator goes through its `parse` before the
  handler is called. What `parse` returns is what the handler receives, so a
  validator can also convert: `Param("id", z.coerce.number())` gives a number.
- `parse` can return a promise. For a zod schema with asynchronous checks, give
  `{ parse: (value) => schema.parseAsync(value) }`.
- When an argument is not valid, the handler is not called, and the middleware
  answers. The same goes for a body that cannot be parsed.
- Wherever the middleware is declared, validation happens at the same moment:
  after every middleware of the route, just before the handler.

The answer to an invalid request is `400`, with a JSON body:

```json
{
  "error": "Invalid request",
  "source": "body",
  "key": "name",
  "issues": [{ "path": ["name"], "message": "Required" }]
}
```

`source` is `param`, `query`, `header`, `body` or `form`; `key` is there when
the argument has one; `issues` are the `issues` of the error the validator threw
when it has them, as a zod error does, and otherwise one issue with the error's
message. To answer differently, give the middleware an `onInvalid` function. It
receives what failed and the context, and what it returns is the response,
converted like the result of a handler. When it returns nothing (it only logs,
say), the default answer is sent:

```ts
validate({
  onInvalid: ({ source, key, error }, ctx) =>
    Response.json({ message: `bad ${source}` }, { status: 422 }),
});
```

**Without the middleware** on the route, there is no validation:

- validators are not run: the handler receives each value as its source gives
  it, not converted;
- a body that cannot be parsed is an error like any other, given to the nearest
  error handler (section 5).

The type of a parameter still comes from the validator, so it is only true for a
handler the middleware covers. When the application is created, each handler
that has a validator and no validation middleware is logged to the `cho:web`
debug context:
`<Controller.method> has an argument with a validator and no validate() middleware: it is not validated`.

### 3.3 What is known about a handler

Everything declared about a handler is kept, and exposed, so that tools can use
it. The first one it is meant for is an OpenAPI document of the application, for
Swagger UI and the like. Generating that document is not specified yet; this
section says what it will be built from.

**Collected from what is already declared:**

| Known                       | From                                                 | In an OpenAPI document         |
| --------------------------- | ---------------------------------------------------- | ------------------------------ |
| The HTTP method             | `@Get`, `@Post`, …                                   | the operation                  |
| The full path               | the four route levels (section 2.2)                  | the path, `:id` written `{id}` |
| The name                    | the controller and the method: `UsersController.get` | `operationId`                  |
| The controller, the feature | the classes                                          | default `tags`                 |
| Each argument               | `@Args`                                              | `parameters` and `requestBody` |

An argument made by one of the five functions carries its description:

| Property    | Holds                                                        |
| ----------- | ------------------------------------------------------------ |
| `source`    | `"param"`, `"query"`, `"header"`, `"body"` or `"form"`       |
| `key`       | the key, when there is one                                   |
| `validator` | the validator, when there is one: the schema of the argument |

A function of your own has none, and is not part of the document.

| Argument           | In an OpenAPI document                                           |
| ------------------ | ---------------------------------------------------------------- |
| `Param("id", v)`   | a parameter `in: path`, required, with the schema of `v`         |
| `Query("page", v)` | a parameter `in: query`, with the schema of `v`                  |
| `Query(v)`         | one `in: query` parameter for each property of the schema of `v` |
| `Header("x", v)`   | a parameter `in: header`                                         |
| `Body(v)`          | the `requestBody`, `application/json`, with the schema of `v`    |
| `Body("name", v)`  | a property `name` of an `application/json` request body          |
| `Form(v)`          | the `requestBody`, `application/x-www-form-urlencoded`           |

A validator is kept as it was given. `@chojs/web` does not know how to turn one
into a JSON Schema: the generator will take that function from the application
(for zod, `z.toJSONSchema`).

**Declared for documentation only:** what the code cannot tell is given with
`@Doc`, on a handler, a controller or a feature module. It changes nothing in
how a request is handled.

```ts
@Doc({ tags: ["users"], description: "The users of the application" })
@Controller({ route: "users" })
class UsersController {
  @Doc({
    summary: "Update a user",
    responses: {
      200: { description: "The updated user", schema: User },
      404: { description: "No such user" },
    },
  })
  @Put(":id")
  @Args(Param("id"), Body(UpdateUser))
  update(id: string, user: UpdateUser) {}
}
```

| Option        | On                                 | Holds                                                                |
| ------------- | ---------------------------------- | -------------------------------------------------------------------- |
| `summary`     | a handler                          | one line about the operation                                         |
| `description` | a handler, a controller, a feature | a longer text                                                        |
| `tags`        | a handler, a controller, a feature | the tags of the handlers under it; they add up, feature first        |
| `deprecated`  | a handler, a controller, a feature | `true` when it should no longer be used                              |
| `responses`   | a handler                          | by status: a `description`, and a `schema` (a validator) of the body |
| `hidden`      | a handler, a controller, a feature | `true` to leave it out of the document                               |

An unknown option throws when the decorator is called, like the options of
`@Module` and `@Controller`. A class or a method has one `@Doc`.

**Where it is exposed.** On the graph of the application (`app.graph`,
`@chojs/web/graph`), with every instance already created:

| Node            | Gains                                                             |
| --------------- | ----------------------------------------------------------------- |
| `MethodRef`     | `args`: the arguments of the handler, in order; `doc`: its `@Doc` |
| `ControllerRef` | `doc`: its `@Doc`                                                 |
| `FeatureRef`    | `doc`: its `@Doc`                                                 |

`doc` is an empty object when there is no `@Doc`, and `args` an empty list when
there is no `@Args`. `validated` on a `MethodRef` says whether the validation
middleware covers the handler: whether it is among the middlewares of the
feature, of the controller or of the handler. `handler` on a `MethodRef` is
still called with the context alone: it evaluates the arguments itself.

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

Middlewares of the HTTP library (Hono's `cors()`, a Fastify hook, …) are not CHO
middlewares. Each adapter has a function that makes one a CHO middleware, for
`@Middlewares`: `fromHono(middleware)` and `fromFastify(hook)`. Such a
middleware runs on its own adapter only; on another one it fails the request.
What must wrap every request, unmatched ones included, goes on the library's own
application, which the adapter takes (`new HonoLinker(hono)`). See
`vendor/hono/README.md` and `vendor/fastify/README.md`. The built-in router has
its own way: the `middlewares` option of `ChoLinker` (section 7), and the
middlewares of `@chojs/vendor-cho`.

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
reaches it: that answer belongs to the adapter (section 7).

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
or when it throws too, the error goes to the adapter, which answers `500`
(section 7).

## 6. The application: `ChoWeb`

```ts
const app = await ChoWeb.create(App, {
  linker: new HonoLinker(), // optional: the runtime adapter (default below)
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

**The default linker.** Without a `linker` (`ChoWeb.create(App)`, or options
that have none), the application is linked with the built-in router, a
`new ChoLinker()`, and `app.linked.instance` is typed as its `ChoRouter`. The
router is part of `@chojs/web` and is imported statically, so the default works
wherever the application is bundled. It needs the global `URLPattern`; on a
runtime without it `ChoWeb.create` rejects with
`ChoLinker needs the URL Pattern API (URLPattern), which this runtime does not have: give ChoWeb.create another linker, such as HonoLinker`.

**Serving.** `serve(handler, options?)`, imported from `@chojs/web/serve`, runs
a `fetch`-style handler, such as `app.handler`, on the server of the current
runtime: `Deno.serve` on Deno, `Bun.serve` on Bun, and the `node:http` server on
Node.js, through a bridge to `Request` and `Response` that is part of this
package. It resolves, once the server is listening, to
`{ runtime, port, hostname, close() }`.

| Option     | Default               | Use                                     |
| ---------- | --------------------- | --------------------------------------- |
| `port`     | `3000`                | the port; `0` picks a free one          |
| `hostname` | the runtime's default | the host name or address to listen on   |
| `signal`   | none                  | an `AbortSignal` that closes the server |

- `serve` is asynchronous because the Node.js modules are imported when they are
  needed, on Node.js only: `@chojs/web` has no dependency, and loads nothing of
  Node.js on another runtime.
- On Node.js the body of the request is the stream of the connection, the body
  of the response is streamed, `req.signal` is aborted when the client goes
  away, and a handler that rejects is logged and answered with `500`.
- `close()` stops accepting requests and waits for the ones in flight.
- It is a separate entry point, so that an application that does not call it
  loads nothing of it. On Cloudflare Workers and the other runtimes that serve
  an exported handler, the entry module is
  `export default { fetch: app.handler }`.
- On a runtime that is not Deno, Bun or Node.js it rejects:
  `serve() has no server for this runtime (<runtime>): give app.handler to the runtime's own entry point`.
- On Deno it needs `--allow-net`.

**Closing.** `app.close()` disposes the application's instances, in reverse
creation order: every provider, controller or module with a
`[Symbol.asyncDispose]()` or `[Symbol.dispose]()` method (`core/specs.md`,
section 2.7). `@chojs/web` does not run the server, so it never closes on its
own: stop the server first, then close. A request that still reaches
`app.handler` after `close()` is answered `503 Service Unavailable`, and runs no
route.

```ts
const server = await serve(app.handler);
process.once("SIGTERM", async () => {
  await server.close(); // stop accepting, finish the requests in flight
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

|                        | `ChoLinker` (built in)                                   | `@chojs/vendor-hono`                             | `@chojs/vendor-fastify`                                    |
| ---------------------- | -------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| Linker                 | `new ChoLinker(options?)`                                | `new HonoLinker(hono?)`                          | `new FastifyLinker(fastify?)`                              |
| Runs on                | runtimes with `URLPattern` (Deno, Node.js 24, Bun 1.3.4) | Deno, Node.js, Bun, edge runtimes                | Node.js only                                               |
| `app.linked.instance`  | a `ChoRouter`                                            | the `Hono` application                           | the Fastify application                                    |
| Served with            | `app.handler`                                            | `app.handler`                                    | `instance.listen()`; `app.handler` goes through `inject()` |
| `ctx.native`           | `undefined`                                              | Hono's `Context`                                 | `{ request, reply }` of Fastify                            |
| When two routes match  | the first declared                                       | the first declared                               | the static one                                             |
| `HEAD` without `@Head` | `@Get`, without the body                                 | `@Get`, without the body                         | `@Get`, without the body                                   |
| No route matches       | the `notFound` option; `404`                             | `notFound` of the Hono application               | the not-found handler of the Fastify application           |
| A route rejects        | logged with `console.error`; `500`                       | `onError` of the Hono application; logged, `500` | the error handler of the Fastify application; `500`        |
| Its own middlewares    | `@chojs/vendor-cho` (`cors`)                             | `fromHono(middleware)`                           | `fromFastify(hook)`                                        |

**The middlewares of the built-in router.** `new ChoLinker({ middlewares })`
takes functions `(ctx, next)`, as `@Middlewares` does. They are the router's:

- they run for **every** request, in order, around the route that answers it,
  and also around the `notFound` answer of a request no route matches. That is
  what a CORS middleware needs, to answer the preflight requests of every path;
- each request gives them a context of their own: `params` are those of the
  route that matched (empty when there is none), `native` is `undefined`, and
  `state` is not the `state` the middlewares and the handler of the route see;
- a route that rejects reaches them as the `500` response;
- one that fails (it throws, or breaks a rule of section 4) is logged with
  `console.error`, and the request is answered `500`;
- one that is not a function makes `link()` throw
  `TypeError: ChoLinker: middleware <n> must be a function, got <v>`.

`@chojs/vendor-cho` has middlewares written for it, such as `cors`
(`vendor/cho/README.md`). On the other adapters, what wraps every request goes
on the library's own application.

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

| Node            | Holds                                                                                                        |
| --------------- | ------------------------------------------------------------------------------------------------------------ |
| `AppRef`        | `route` (the global prefix), `errorHandler` (the application's), `features`                                  |
| `FeatureRef`    | `route`, `middlewares`, `errorHandler`, `doc`, `controllers`                                                 |
| `ControllerRef` | `route`, `middlewares`, `errorHandler`, `doc`, `instance`, `methods`                                         |
| `MethodRef`     | `route`, `middlewares`, `errorHandler`, `doc`, `name`, `method` (`"GET"`, …), `handler`, `args`, `validated` |

## 8. Public API

| Entry point             | Exports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@chojs/web`            | `ChoWeb`, `ChoWebOptions`, `ChoLinker`, `ChoRouter`, `ChoLinkerOptions`, `ChoMatch`, `Get`, `Post`, `Put`, `Patch`, `Delete`, `Head`, `Options`, `Middlewares`, `Catch`, `Args`, `Param`, `Query`, `Header`, `Body`, `Form`, `validate`, `Doc`, the types `ChoWebArg`, `ChoWebArgInfo`, `ChoWebArgSource`, `ChoWebValidator`, `ChoWebValidateOptions`, `ChoWebInvalid`, `ChoWebDoc`, `ChoWebDocResponse`, `ChoWebContext`, `ChoWebHandler`, `ChoWebNext`, `ChoWebMiddlewareFn`, `ChoWebMiddleware`, `ChoWebErrorHandlerFn`, `ChoWebErrorHandler`, `Module`, `Controller` (the core's, with the `route` option), `WebModuleOptions`, `WebControllerOptions`, and from the core `Injectable`, `token`, `provider`, `InjectionToken`, `Provider` and the option types |
| `@chojs/web/linker`     | `Linker`, `Linked`, `Route`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `@chojs/web/graph`      | `AppRef`, `FeatureRef`, `ControllerRef`, `MethodRef`, `NodeRef`, `ErrorHandlerRef`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `@chojs/web/serve`      | `serve`, `ServeHandler`, `ServeOptions`, `ChoWebServer`, `EngineType`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `@chojs/vendor-cho`     | `cors`, `CorsOptions`: the middlewares of the built-in router                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `@chojs/vendor-hono`    | `HonoLinker`, `HonoLinked`, `fromHono`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `@chojs/vendor-fastify` | `FastifyLinker`, `FastifyLinked`, `FastifyNative`, `FastifyHook`, `fromFastify`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

`@Middlewares` and `@Catch` are the core's decorators, typed for `@chojs/web`.

## 9. Errors

The messages below are the current wording, for people to read: they are not
part of the API and can change in any release (`core/specs.md`, section 2.8). Do
not match on their text.

**Thrown by the decorators**, when the class is defined:

| Mistake                                        | Message                                                                                                                             |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| A handler's route is invalid                   | `Invalid route "<route>" of @Get() on method <name>: <reason>`                                                                      |
| A second HTTP method decorator on a method     | `Cannot add @Get() to method <name>: it already handles POST "<route>". A method can have one HTTP method decorator.`               |
| An unknown option of `@Module` / `@Controller` | `@Controller(): unknown option "deps". Known options: dependencies, route`                                                          |
| An unknown option of `@Doc`                    | `@Doc(): unknown option "tag". Known options: deprecated, description, hidden, responses, summary, tags`                            |
| A static, private or symbol-named handler      | `TypeError: @Get() cannot decorate static method <name>: a handler must not be static` (and `private …`, `… a string name`)         |
| A second `@Args` on a method                   | `Cannot add @Args() to method <name>: it already has one.`                                                                          |
| An argument of `@Args` is not a function       | `TypeError: @Args() on method <name>: argument <n> must be made with Param, Query, Header, Body or Form, or be a function, got <v>` |
| A key or a validator of the wrong type         | `TypeError: Body(): expected a key (a string) or a validator (an object with a parse method), got <v>`                              |
| Something after a validator                    | `TypeError: Body(): a validator is the last argument, got <v> after it`                                                             |
| A second `@Doc` on a class or a method         | `Cannot add @Doc() to class <Name>: it already has one.` (and `… to method <name> …`)                                               |
| A handler option of `@Doc` on a class          | `@Doc(): option "summary" is for a handler, not for a class (class <Name>)`                                                         |

**Rejected by `ChoWeb.create`**: any module graph error of the core
(`core/specs.md`, section 2.8), and:

| Mistake                                       | Message                                                                                                                 |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| A route is not a string                       | `TypeError: Invalid route of <where>: expected a string, got <v>`                                                       |
| A route breaks a rule (section 2.3)           | `Invalid route "<route>" of <where>: <reason>`                                                                          |
| Two handlers with the same method and path    | `Duplicate route "<METHOD> <path>": declared by <Controller.method> and <Controller.method>`                            |
| The same controller declared by two modules   | the message above, followed by `Its controller is declared in more than one module: declare it in one.`                 |
| A wildcard in a route                         | `Invalid route "<route>" of <where>: "<segment>" has a "*": wildcards are not part of the route syntax`                 |
| A malformed parameter (`:`, `:1id`, `:a:b`)   | `Invalid route "<route>" of <where>: "<segment>" is not a valid parameter: write ":name", with letters, digits and "_"` |
| `Param("x")` names no parameter of the path   | `@Args() of <Controller.method>: Param("x") is not a parameter of the route "<path>"`                                   |
| `onError` is not a function or a class        | `Invalid error handler <v>: must be a function or a class with a 'handle' method.`                                      |
| A middleware class has no `handle` method     | `Middleware class <Name> must implement 'handle' method.`                                                               |
| A middleware class cannot be created          | `Failed to create middleware <Name> in module <Module>`, with the injector's error as cause                             |
| An error handler class has no `handle` method | `Error handler class <Name> must implement 'handle' method.`                                                            |
| An error handler class cannot be created      | `Failed to create error handler <Name> in module <Module>`, with `cause`                                                |

`<where>` names the declaration: `the global prefix`, `feature <Module>`,
`controller <Controller>` or `method <name> of controller <Controller>`.

**Failing a request** (given to the route's error handler, section 5):

| Mistake                                               | Message                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| A middleware calls `next()` twice                     | `middleware <name>: next() called more than once`                              |
| A middleware returns nothing without calling `next()` | `middleware <name> returned no response: return a Response or call next()`     |
| A middleware returns something else                   | `TypeError: middleware <name> must return a Response or nothing, got <typeof>` |

A middleware class is named `<Class>.handle`.

An argument of `@Args` that throws fails the request with its own error,
unchanged. An argument that is not valid is answered by the validation
middleware, when it is on the route (section 3.2).

## 10. Internals

- **Records.** `@Get` and its siblings write `{ method, route }` on the method
  under a private symbol key (`web/keys.ts`, `Symbol.for("chojs.web.http")`).
  The `route` option of `@Module` / `@Controller` is a plain user option of the
  core. `@Middlewares` and `@Catch` write the core's records.
- **Arguments.** `@Args` writes the list of arguments in the method's record,
  and `@Doc` its options. `Param`, `Query`, `Header`, `Body` and `Form` return
  functions `(ctx) => value` that carry their source, key and validator; the
  text of the body of a request is kept with its context, so that it is read
  once (`web/args.ts`). When the graph is built, a handler with arguments is
  wrapped in a function that evaluates them and calls it with the values and the
  context.
- **Validation** (`web/validate.ts`). `validate()` is a middleware that marks
  the request, calls `next()`, and answers when the evaluation of an argument
  reports it invalid. The arguments of a marked request go through their
  validators.
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
- **The built-in router** (`web/router.ts`) makes one `URLPattern` for each
  route, and calls the `route.handle` of the first route whose method and
  pattern match, with the `Request` and the decoded parameters.
- **The Fastify adapter** registers the routes as one Fastify plugin, in which
  Fastify parses no body. It builds a standard `Request` from Fastify's (its
  body is the raw stream), calls `route.handle` with it, Fastify's decoded
  parameters and Fastify's request and reply, and lets Fastify send the
  `Response`.
- **Testing without an adapter.** `web/testing.ts` (not published) has a linker
  that matches requests itself; the tests of `@chojs/web` use it.
