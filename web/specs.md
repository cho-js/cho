# @chojs/web

HTTP applications built with decorators: controllers declare route handlers, and
`ChoWeb` turns the application into a `fetch`-style request handler that any
server can call. It is built on the dependency injection of `@chojs/core` (see
`core/specs.md`), and runs on Deno, Node.js, Bun and Cloudflare Workers (section
7.1).

This document describes what an application gets. The source code is the
reference: when this document and the code disagree, the code wins.

## 1. Overview

An application imports everything from `@chojs/web` (the core's `@Injectable`,
`token`, `provider` and `configure` included, so it never imports
`@chojs/core`). Requests are matched to routes by a **linker**: the built-in
router, `ChoLinker` (the standard URL Pattern API, with no HTTP library), or a
**runtime adapter**, `@chojs/vendor-hono` (Hono) or `@chojs/vendor-fastify`
(Fastify, on Node.js only). Section 7 compares them.

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
  `@Head(route)` or `@Options(route)`, or with `@Sse(route)`, a handler (`GET`
  by default) that answers with a stream of events (section 3.4), or with
  `@Ws(route)`, the `GET` handler that upgrades its request to a WebSocket
  (section 3.5). Other methods are not routes: the methods marked with
  `@WsOpen`, `@WsMessage` and `@WsClose` handle the events of a socket, not a
  request. A handler is a public, non-static method with a string name, and has
  one HTTP method decorator: anything else throws when the class is defined.

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

Routes are given to the adapter in declaration order. The built-in router and
the Hono adapter match them in that order: a parameter route declared first
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
- An `@Sse` handler returns the events of a stream instead (section 3.4).
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

A string is a key, and a Standard Schema or an object with a `parse` method is a
validator (section 3.2); anything else throws when the function is called. A
validator is the last argument.

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

**Validators.** A validator is a [Standard Schema](https://standardschema.dev/):
an object with a `~standard` key. The schemas of [Zod](https://zod.dev),
[Valibot](https://valibot.dev), [ArkType](https://arktype.io) and many other
libraries are, so they are validators as they are, and `@chojs/web` depends on
none of them. An object with a `parse(value)` method that returns the value, or
throws, is a validator too.

```ts
type ChoValidator<Output = unknown, Input = unknown> =
  | StandardSchemaV1<Input, Output>
  | { parse(value: unknown): Output | Promise<Output> };
```

The type, and the rules of the two shapes, are those of `@chojs/core`
(`core/specs.md`, section 5); `@chojs/web` exports the types again. What matters
to a request:

| Shape             | Not valid                        | When it throws                  |
| ----------------- | -------------------------------- | ------------------------------- |
| A Standard Schema | its result has `issues`: a `400` | an error, as from a handler     |
| A `parse` method  | it throws: a `400`               | that is how it says "not valid" |

For an object with both shapes, as a Zod schema is, the Standard Schema is used.

A validator given to an argument does two things: it describes the argument
(section 3.3), and it validates it **when the validation middleware is on the
route**.

**The validation middleware.** Validation is the work of one middleware,
`validate()`. It is declared like any middleware, with `@Middlewares`, on a
handler, on a controller or on a feature module, and covers the handlers under
it, or given to the `middlewares` option of `ChoWeb.create` (section 4), where
it covers every handler of the application.

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

- Every argument that has a validator goes through it before the handler is
  called. What the validator gives is what the handler receives, so a validator
  can also convert: `Param("id", z.coerce.number())` gives a number.
- A validator can give a promise: it is awaited. A schema with asynchronous
  checks needs no wrapper.
- When an argument is not valid, the handler is not called, and the request is
  answered. The same goes for a body that cannot be parsed.
- What the `validate` function of a Standard Schema throws is not a request that
  is not valid. It is an error like any other, given to the nearest error
  handler (section 5): `500` by default, and `onInvalid` is not called.
- Wherever the middleware is declared, validation happens at the same moment:
  after every middleware of the route, just before the handler. The middleware
  only marks the request, in its state: the arguments are read, and validated,
  at the end of the chain, where the request that is not valid is answered. So
  the middlewares of the route see that answer as a response, and no error
  handler is called for it.
- When several cover a handler, the nearest one decides how a request that is
  not valid is answered: the handler's, the controller's, the feature's, then
  the application's.

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
the argument has one.

`issues` has one issue at least. Each is a `message`, and a `path` when it is
about a part of the value: the body is the same for every library. The other
fields a library writes in an issue (`code`, `expected`, the value that was
refused) are not sent.

| What failed                             | `issues`                                           |
| --------------------------------------- | -------------------------------------------------- |
| A Standard Schema                       | the issues of its result                           |
| A `parse` method, with a list of issues | the `issues` of the error it threw, as Zod's has   |
| A `parse` method, with any other error  | one issue, with the message of the error           |
| A body that cannot be parsed            | one issue, with the message of the error of `JSON` |

To answer differently, give the middleware an `onInvalid` function. It receives
what failed and the context, and what it returns is the response, converted like
the result of a handler. When it returns nothing (it only logs, say), the
default answer is sent. It can also throw an `HttpError` (section 5.1), which
answers as it does anywhere:

```ts
validate({
  onInvalid: ({ source, key, issues }, ctx) =>
    Response.json({ message: `bad ${source}`, issues }, { status: 422 }),
});
```

What failed is a `ChoWebInvalid`:

| Property | Holds                                                                                        |
| -------- | -------------------------------------------------------------------------------------------- |
| `source` | where the argument reads from                                                                |
| `key`    | its key, when it has one                                                                     |
| `issues` | what is not valid, as in the body above                                                      |
| `error`  | what was thrown, when something was: by a `parse` method, or by a body that cannot be parsed |

A Standard Schema throws nothing for a value that is not valid, so `error` is
not there for one.

**Without the middleware** on the route or on the application, there is no
validation:

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
Swagger UI and the like. `@chojs/openapi` generates it
(`extras/openapi/specs.md`); this section says what it is built from.

**Collected from what is already declared:**

| Known                        | From                                                 | In an OpenAPI document         |
| ---------------------------- | ---------------------------------------------------- | ------------------------------ |
| The HTTP method              | `@Get`, `@Post`, …                                   | the operation                  |
| The full path                | the four route levels (section 2.2)                  | the path, `:id` written `{id}` |
| The name                     | the controller and the method: `UsersController.get` | `operationId`                  |
| The controller, the feature  | the classes                                          | default `tags`                 |
| Each argument                | `@Args`                                              | `parameters` and `requestBody` |
| That it is an event stream   | `@Sse` (section 3.4)                                 | a `text/event-stream` response |
| That it upgrades to a socket | `@Ws` (section 3.5), with the methods of its events  | left out of the document       |

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

A validator is kept as it was given. `@chojs/web` does not turn one into a JSON
Schema: `@chojs/openapi` asks the validator itself, when it implements
[Standard JSON Schema](https://standardschema.dev/json-schema), and otherwise
takes that function from the application.

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

| Option        | On                                 | Holds                                                                                    |
| ------------- | ---------------------------------- | ---------------------------------------------------------------------------------------- |
| `summary`     | a handler                          | one line about the operation                                                             |
| `description` | a handler, a controller, a feature | a longer text                                                                            |
| `tags`        | a handler, a controller, a feature | the tags of the handlers under it; they add up, feature first                            |
| `deprecated`  | a handler, a controller, a feature | `true` when it should no longer be used                                                  |
| `responses`   | a handler                          | by status: a `description`, and a `schema` (a validator) of the body                     |
| `hidden`      | a handler, a controller, a feature | `true` to leave it out of the document                                                   |
| `operationId` | a handler                          | the id of the operation; default: `UsersController.update`                               |
| `security`    | a handler, a controller, a feature | what it requires: a list of `{ scheme: scopes }`; the nearest one wins, and `[]` is none |

A response also takes a `contentType`: the media type of its body,
`application/json` by default.

```ts
@Doc({ security: [{ bearer: [] }] })
@Controller({ route: "users" })
class UsersController {
  @Doc({ operationId: "listUsers", security: [] }) // public
  @Get("")
  list() {}

  @Doc({
    responses: { 200: { description: "The avatar", contentType: "image/png" } },
  })
  @Get(":id/avatar")
  avatar() {}
}
```

`security` documents what a middleware enforces: it changes nothing in how a
request is handled. `@chojs/web` checks its shape, a list of objects of lists of
strings, and does not know the schemes: what generates the document does.

`@chojs/web` keeps what is declared, and writes no document: what a document
holds of it is up to what generates the document. The `description` of a
controller or of a feature is on the graph, and `@chojs/openapi` does not write
it: it writes the one of a handler, and describes a tag with its `tags` option
(`extras/openapi/specs.md`, section 2.2).

An unknown option throws when the decorator is called, like the options of
`@Module` and `@Controller`. A class or a method has one `@Doc`.

**Where it is exposed.** On the graph of the application (`app.graph`,
`@chojs/web/graph`), with every instance already created:

| Node            | Gains                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `MethodRef`     | `args`: the arguments of the handler, in order; `doc`: its `@Doc`; `sse`: its `@Sse`; `socket`: the event methods of its `@Ws` |
| `ControllerRef` | `doc`: its `@Doc`                                                                                                              |
| `FeatureRef`    | `doc`: its `@Doc`                                                                                                              |

`doc` is an empty object when there is no `@Doc`, and `args` an empty list when
there is no `@Args`. `validated` on a `MethodRef` says whether the validation
middleware covers the handler: whether it is among the middlewares of the
application, of the feature, of the controller or of the handler. `sse` holds
the options of `@Sse` (an empty object when it has none), and is `undefined` for
a handler that is not an event stream. `handler` on a `MethodRef` is still
called with the context alone: it evaluates the arguments itself.

### 3.4 Server-sent events: `@Sse`

`@Sse(route, options?)` declares a handler that answers with a stream of
[server-sent events](https://html.spec.whatwg.org/multipage/server-sent-events.html):
the response stays open, and the handler sends events for as long as it wants.
Its route is `GET route`, which a browser reads with `EventSource`, unless the
`method` option says otherwise (below).

| Option      | Default | Use                                                                     |
| ----------- | ------- | ----------------------------------------------------------------------- |
| `method`    | `"GET"` | the HTTP method of the route: `GET`, `POST`, `PUT`, `PATCH` or `DELETE` |
| `keepAlive` | none    | send a comment when that many milliseconds pass with nothing sent       |

An unknown option, a `method` that is not one of the five, and a `keepAlive`
that is not a positive whole number throw when the decorator is called.

The handler returns the events as an **async iterable**, so the natural handler
is an `async *` method, where every `yield` is an event:

```ts
@Controller({ route: "orders", dependencies: [Orders] })
class OrdersController {
  constructor(readonly orders: Orders) {}

  @Sse("events") // GET /orders/events
  async *events(ctx: ChoWebContext) {
    yield { event: "ready", data: "listening" };
    for await (const order of this.orders.changes(ctx.req.signal)) {
      yield { event: "order", id: String(order.version), data: order };
    }
  }
}
```

**An event** is an object, a `ChoWebSseEvent`:

| Property | Holds                                                                                       |
| -------- | ------------------------------------------------------------------------------------------- |
| `data`   | the data of the event, required. A string is sent as it is; anything else is sent as JSON   |
| `event`  | the name of the event, for `addEventListener(name)`. Without it the event is a `message`    |
| `id`     | the id of the event. A client that reconnects sends the last one it got, as `Last-Event-ID` |
| `retry`  | how long the client waits before it reconnects, in milliseconds                             |

A string is short for `{ data: string }`. Anything else that is yielded, an
`event` or an `id` that is not a string or that has a line break, and a `retry`
that is not a whole number of milliseconds, are errors of the stream (below).

**On another method.** `EventSource` only sends `GET` requests, with no body. A
stream that answers a request with a body, such as the answer of a model to a
question, is declared with the `method` option, and the client reads it with
`fetch`. The arguments of the handler are those of any handler:

```ts
@Sse("answers", { method: "POST" }) // POST /chat/answers
@Args(Body(Question))
async *answer(question: Question) {
  for await (const word of this.model.answer(question)) {
    yield word;
  }
}
```

`HEAD` and `OPTIONS` are not methods of a stream: their responses have no body.

**The response** is a `200` with these headers, and it is sent as soon as the
handler has returned, before the first event:

| Header              | Value                    | Why                                             |
| ------------------- | ------------------------ | ----------------------------------------------- |
| `content-type`      | `text/event-stream`      | what `EventSource` expects                      |
| `cache-control`     | `no-cache, no-transform` | nothing on the way keeps or rewrites the events |
| `x-accel-buffering` | `no`                     | a proxy (nginx) passes each event on at once    |

`x-accel-buffering` is not a standard header: it is one that nginx reads. As a
reverse proxy, nginx collects a response before it passes it on, so the events
of a stream would reach the client late, and in batches. `no` turns that off for
this response, without `proxy_buffering off` in the configuration of the proxy.
Everything else ignores the header.

A middleware adds headers to the response as to any other, after `next()`.

**Before the stream.** What runs before the handler is what it is for any
handler: the middlewares of the route, the arguments of `@Args` and their
validation. They answer a request they refuse (`401`, `400`) the usual way, an
`HttpError` included (section 5.1), and the last id a client got is an argument
like any other, `Header("last-event-id")`.

The body of an `async *` method is different: it runs as part of the stream,
when the response has already started, so it cannot answer with another status.
A handler that must be able to refuse is a plain method, which returns either a
`Response` or the events, or throws an `HttpError` before it returns them:

```ts
@Sse(":id/events")
@Args(Param("id"), Header("last-event-id"))
events(id: string, last: string | undefined) {
  const order = this.orders.find(id);
  if (!order) {
    return new Response("no such order", { status: 404 });
  }
  return this.orders.eventsOf(order, last); // an async iterable
}
```

A `Response` is sent as it is. A result that is neither a `Response` nor an
async iterable is an error of the request, given to the nearest error handler
like any other (section 5).

**The end of the stream.**

- When the iteration ends, the response ends. `EventSource` then reconnects by
  itself: to make it stop, the client closes it, or the handler answers the next
  request with `new Response(null, { status: 204 })`.
- When the client goes away, the iteration is ended (`return()` is called on the
  iterator), so the `finally` blocks of an `async *` method run. An `async *`
  method that is waiting only ends once what it awaits settles: something that
  waits for long should watch `ctx.req.signal`, which the server aborts when the
  client goes away.
- An event is read from the iteration when the connection can take it: a slow
  client slows the handler down, and nothing piles up in memory.
- A `HEAD` request to a `GET` stream gets the headers, and the events are never
  read.
- An open stream is a request in flight: a server that waits for the requests in
  flight before it closes waits for it, for ever when the stream has no end.
  Give `serve` a `closeTimeout` (section 6): the streams that are still open
  after that long are cut, which ends their iteration like a client that goes
  away.

**An error in the stream.** When the iteration throws, or yields something that
is not an event, the status is already sent:

- **no error handler is called**: not the `@Catch` of the handler, of the
  controller or of the feature, and not `onError`. An error handler answers a
  request, and this one is already answered;
- the stream is cut: the body of the response fails with the error, so the
  server closes the connection without a proper end. A client sees a failed
  connection, and `EventSource` reconnects;
- the error is the server's to report: `Deno.serve`, `Bun.serve` and the
  `node:http` bridge of `serve` print a body that fails. It is also logged to
  the `cho:web` debug context, with the method and the path of the request.

So the errors of a stream are the handler's own business: catch them in the
handler, to log them, to report them, or to tell the client what went wrong with
an event of your own.

```ts
@Sse("events")
async *events(ctx: ChoWebContext) {
  try {
    yield* this.orders.changes(ctx.req.signal);
  } catch (error) {
    this.log.error(error);
    yield { event: "failed", data: "the feed is not available" };
  }
}
```

What the end of the iteration throws once the client has gone away (a `finally`
block that fails) is logged with `console.error`: there is no response left to
fail, and no one else would see it.

**Keep-alive.** A proxy closes a connection on which nothing is sent for a while
(often a minute). With the `keepAlive` option, a comment line, which clients
ignore, is sent whenever that many milliseconds pass with nothing sent, from the
moment the response is read:

```ts
@Sse("events", { keepAlive: 15_000 })
```

It is off by default.

**With middlewares.** For a middleware, `next()` resolves when the stream opens,
not when it ends: what it measures or logs is the time until the first byte. A
middleware must not read the body of an event stream, which would wait for its
end. The middlewares of `@chojs/vendor-cho` that read or rewrite a body (`etag`,
`compress`) leave an event stream as it is.

**Rules.**

- `@Sse` is an HTTP method decorator: a method has one of them, the route
  follows the rules of section 2.3, and `@Args`, `@Middlewares`, `@Catch` and
  `@Doc` go above or below it.
- The result of the handler is checked at compile time: an async iterable of
  events, a `Response`, or a promise of one of them.
- Every adapter sends the events as they come when a server runs it. The
  `app.handler` of the Fastify adapter goes through `inject()`, which collects
  the whole response: there it only suits a stream that ends (section 7).

### 3.5 WebSockets: `@Ws`

A controller can upgrade a request to a
[WebSocket](https://developer.mozilla.org/docs/Web/API/WebSockets_API), and
handle the events of the socket, with four decorators. The code is the same on
every runtime.

```ts
@Middlewares(bearerAuth({ verify })) // runs before the upgrade
@Controller({ route: "chat" })
class ChatController {
  constructor(readonly rooms: Rooms) {}

  @Ws(":room") // GET /chat/:room, with "Upgrade: websocket"
  @Args(Param("room"))
  join(room: string, ctx: ChoWebContext) {
    if (!this.rooms.has(room)) throw new HttpError(404); // refused: no socket
    return { joined: room }; // the first message on the socket
  }

  @WsOpen()
  open(socket: ChoWebSocket) {
    this.rooms.add(socket.ctx.params.room, socket);
  }

  @WsMessage()
  async message(data: string | Uint8Array, socket: ChoWebSocket) {
    await this.rooms.send(socket.ctx.params.room, data);
    return { ok: true }; // sent back on the socket
  }

  @WsClose()
  close(code: number, reason: string, socket: ChoWebSocket) {
    this.rooms.remove(socket.ctx.params.room, socket);
  }
}
```

| Decorator      | The method                                              | It receives                |
| -------------- | ------------------------------------------------------- | -------------------------- |
| `@Ws(route?)`  | handles the request that is upgraded, once a connection | as any handler (`@Args`)   |
| `@WsOpen()`    | runs when the socket opens                              | `socket`                   |
| `@WsMessage()` | handles each message                                    | `data`, `socket`           |
| `@WsClose()`   | runs when the socket is closed, by either side          | `code`, `reason`, `socket` |

**One socket for a controller.** A controller has one method at most for each of
the four decorators, and its event methods need its `@Ws` method. It can have
other handlers (`@Get`, …) next to them. A second socket goes in a controller of
its own. A method handles a request or one event, never both.

**What a method returns is sent on the socket.** The four methods can be
asynchronous: a promise is awaited.

| Returned                                    | Sent                     |
| ------------------------------------------- | ------------------------ |
| nothing (`undefined`)                       | nothing                  |
| a string                                    | a text message, as it is |
| bytes (`Uint8Array`, `ArrayBuffer`, a view) | a binary message         |
| anything else                               | a text message, as JSON  |

- What `@Ws` returns is the **first message**: it is sent when the socket opens,
  before `@WsOpen` runs.
- What `@WsClose` returns is not sent: the socket is closed.
- A value that has no JSON (a function, a symbol, a `bigint`, an object that
  refers to itself) is an error of the method (`CHO_WEB_INVALID_SOCKET_RESULT`).

**The upgrade is a request.** `@Ws` is an HTTP method decorator, and its method
an ordinary `GET` handler: the middlewares of the feature, of the controller and
its own run before it, and it has `@Args`, `validate()` and `@Catch`.

- **To accept**, the method returns.
- **To refuse**, the request is answered, and no socket opens: a middleware that
  answers, a `Response` the method returns, an `HttpError` it throws, or what an
  error handler returns.
- A request that does not ask for an upgrade (`Upgrade: websocket`) is answered
  `426 Upgrade Required`, before any middleware runs.
- A middleware sees the answer of a route that accepted as a `426`: it is what a
  server that cannot upgrade sends. The headers it adds to it are sent with the
  `101`, apart from those that describe a body. A middleware that answers with
  another status after the handler refuses the connection.
- It is not in an OpenAPI document: that describes requests and responses.

**The socket.** Each event method receives the socket, last:

| Property                | Holds                                                          |
| ----------------------- | -------------------------------------------------------------- |
| `ctx`                   | the `ChoWebContext` of the request that was upgraded           |
| `open`                  | whether the socket is open: `false` once either side closed it |
| `send(data)`            | sends a message, converted as a returned value is              |
| `close(code?, reason?)` | closes the socket: `1000` and no reason by default             |
| `native`                | the socket of the runtime (section 6)                          |

- **The data of a connection is the context of its request.** A controller is
  one instance for every connection, so nothing of one connection is kept on
  `this`. `socket.ctx` has the `params` and the `url` of the request, the
  headers of its `req`, and its `state`: what a middleware put there (the user),
  and what the methods add.
- **It is one object for a connection**, for its whole life: keep it in a `Set`
  to send to the sockets of a room.
- `send` and `close` do nothing on a socket that is not open.
- `data` is a string for a text message and a `Uint8Array` for a binary one, on
  every runtime.

**The events of a socket run one after another**, in the order they arrived:
`@WsOpen` ends before the first message is handled, and a message is handled
when the one before it has ended, so the replies are in the order of the
messages. Two sockets do not wait for each other.

- **An event runs at once when none waits before it.** A method that is not
  asynchronous has replied before the next message, or the close, is read: a
  client that sends a message and closes right after it gets its reply.
- **A reply is not sent once the socket is closed.** The messages that arrived
  before a close are still handled, in order, and `@WsClose` runs after them.
  What an asynchronous method returns after the close of the client has arrived
  has nowhere to go.

**`@WsClose` runs once** for every socket that was opened, after the events that
arrived before, whoever closed it:

| Who closed                                 | `code`, `reason`                 |
| ------------------------------------------ | -------------------------------- |
| the client                                 | what it gave; `1005` for no code |
| the application, with `socket.close()`     | what it gave                     |
| an event method that threw                 | `1011`, `Internal Error`         |
| `app.close()`, or the `close()` of `serve` | `1001`, `Going Away`             |
| the connection was cut                     | `1006`                           |

**An error of an event method** closes the socket with `1011`, and the messages
that wait are dropped. It is never silent, as nobody else answers it: it is
logged to the `cho:web` debug context when that is enabled, and with
`console.error` otherwise. An error of `@WsClose` is only reported.

**Event methods have no request**: `@Middlewares`, `@Catch`, `@Args` and `@Doc`
on one of them are a mistake, and the application is not created
(`CHO_WEB_INVALID_SOCKET`). They belong on the `@Ws` method.

**Security.** A browser does not apply CORS to a WebSocket: any page can open
one to the application, with the cookies of the user. A socket that trusts a
cookie checks the `Origin` header of the request, in a middleware of its `@Ws`
method.

**Testing a socket** needs no connection. `app.upgrade(request)` gives the
upgrade a route accepted (section 6), and `accept` takes a connection of the
test, which records what is sent:

```ts
const upgrade = await app.upgrade(
  new Request("http://localhost/chat/lobby", {
    headers: { upgrade: "websocket" },
  }),
);
assert.ok(!(upgrade instanceof Response)); // not refused

const sent: unknown[] = [];
const events = upgrade.accept({
  send: (data) => void sent.push(data),
  close() {},
  native: undefined,
});
events.message("hello");
events.closed(1000, "");
```

**Not in this version:** compression of messages, subprotocols, a validator for
messages, telling the application that a client reads slowly, and sockets
through the Fastify adapter (section 7).

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

**The middlewares of the application.** The `middlewares` option of
`ChoWeb.create` takes what `@Middlewares` takes, for the whole application:

```ts
const app = await ChoWeb.create(App, {
  middlewares: [logger(), cors(), Auth, validate()],
});
```

- **They run for every request**, in order, on every adapter: around the route
  that answers it, and around the not-found answer of a request no route
  matches. That is what a CORS middleware needs, to answer the preflight
  requests of every path. A route `app.mount` added is covered too.
- **They are the outermost.** They wrap the whole answer of a route: its own
  middlewares, its handler and its error handlers. So `next()` resolves with the
  response as it is sent: the one a `@Catch` handler made, or the answer of an
  `HttpError` (section 5.1). The middlewares of a route, which are inside the
  error handlers, see such an error pass through them.
- **A class is created by the injector, in the scope of the root module**: it is
  a provider of the root module, or exported by a module it imports. The
  mistakes are those of a middleware class of a feature.
- **Their context is not the one of the route**, and its state is. What one of
  them sets in `ctx.state` (a request id, the authenticated user) is in the
  state of the middlewares and of the handler of the route. Its `params` and its
  `native` are what the adapter knows before the route runs, and its `req` is
  the request the route then receives, also when a middleware replaced it.
- **`validate()`** given here covers every handler (section 3.2).
- They are on the graph: `app.graph.middlewares`, created and in order.

The adapter runs them: section 7 says how each does, and what differs.

Middlewares of the HTTP library (Hono's `cors()`, a Fastify hook, …) are not CHO
middlewares. Each adapter has a function that makes one a CHO middleware, for
`@Middlewares` and for the `middlewares` option: `fromHono(middleware)` and
`fromFastify(hook)`. Such a middleware runs on its own adapter only; on another
one it fails the request. See `vendor/hono/README.md` and
`vendor/fastify/README.md`.

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
or when it throws too, the error leaves the route: an `HttpError` answers for
itself (section 5.1), and any other error goes to the adapter, which answers
`500` (section 7).

An error in an event stream that has already started is **not** given to an
error handler: the response is on its way, and there is nothing left to answer.
The stream is cut (section 3.4).

### 5.1 Answering with a status: `HttpError`

`HttpError` is what an application throws to answer a request with a status,
from anywhere the request is handled: a handler, a middleware, a function of
`@Args`, the `onInvalid` of `validate()`, a mounted route.

```ts
import { HttpError } from "@chojs/web";

@Get(":id")
@Args(Param("id"))
get(id: string) {
  const user = this.users.get(id);
  if (!user) {
    throw new HttpError(404, "no such user");
  }
  return user;
}
```

`new HttpError(status, message?, options?)`:

| Argument          | What it is                                                                         |
| ----------------- | ---------------------------------------------------------------------------------- |
| `status`          | A whole number from 400 to 599.                                                    |
| `message`         | What went wrong. Default: the text of the status (`Not Found`).                    |
| `options.headers` | Headers of the answer, as `new Headers()` takes them: `www-authenticate` of a 401. |
| `options.cause`   | The error that led to this one. It is logged, and never sent.                      |

**There is one class, and no class for each status**: no `NotFoundError`, no
`UnauthorizedError`. What handles an error looks at its `status`.

**The answer** has the status, the headers, and a JSON body:

```json
{ "error": "no such user" }
```

It is the shape `validate()` answers with (section 3.2). An application that
wants another one, `application/problem+json` for one, writes it in an error
handler:

```ts
const app = await ChoWeb.create(App, {
  onError: (error) => {
    if (isHttpError(error)) {
      return Response.json(
        { title: error.message, status: error.status },
        {
          status: error.status,
          headers: { "content-type": "application/problem+json" },
        },
      );
    }
  },
});
```

**What a client sees.** Below 500 the message is sent: the application wrote it
for the client. From 500 only the text of the status is sent
(`Service Unavailable`): the message, and the `cause`, are for the logs. The
message of an error that is not an `HttpError` is never sent.

**The error handlers come first.** An `HttpError` is an error like any other for
`@Catch` and `onError`: it goes to the nearest one, which answers it or returns
nothing. It answers for itself only when no error handler answered:

| What happens                                           | The answer                        |
| ------------------------------------------------------ | --------------------------------- |
| An error handler returns something                     | what it returned                  |
| No error handler, or the error handler returns nothing | the status of the `HttpError`     |
| An error handler throws an `HttpError`                 | the status of the one it threw    |
| The error is not an `HttpError`, and nothing answers   | `500`, by the adapter (section 7) |

So an error handler that only logs changes nothing, and one that turns the
errors of the application into statuses is three lines:

```ts
@Catch((error) => {
  if (error instanceof OutOfStock) {
    throw new HttpError(409, error.message);
  }
})
```

`error.toResponse()` gives the answer the framework would send: an error handler
calls it to answer the same way after it did something of its own (it adds a
header, it counts the error).

**`isHttpError(error)`** says whether an error is an `HttpError`. It does not
use `instanceof`, which is false for an `HttpError` of another copy of
`@chojs/web`: a middleware of another package can bring one. The framework
recognizes an `HttpError` the same way.

**Logging.** An `HttpError` below 500 is what the application chose to answer,
not a failure: it is a line of the `cho:web` debug context
(`GET /users/7 answered 404: no such user`), and no `ERROR`. From 500 it is
logged as an error, with its `cause`.

**What it is not.**

- It is not a `ChoError` (section 9): it has a `status`, and no `code`.
- It is not for a request no route matches: that answer is the adapter's
  (section 7).
- It does nothing in an event stream that has started: the stream is cut, as for
  any error (section 3.4).
- A middleware that returns a `Response` needs no `HttpError`: returning a
  `Response` is still the way to end a request in a middleware.

## 6. The application: `ChoWeb`

```ts
const app = await ChoWeb.create(App, {
  linker: new HonoLinker(), // optional: the runtime adapter (default below)
  prefix: "api", // optional: the global prefix (section 2.2)
  onError: (error, ctx) => new Response("oops", { status: 500 }), // optional: section 5
  middlewares: [cors()], // optional: for every request (section 4)
});
app.handler; // (req: Request) => Promise<Response>
app.linked.instance; // the runtime's own application (a Hono app)
app.routes; // every route: method, path, name
app.graph; // the declared routes as a tree: features, controllers, handlers
app.mount("GET", "health", () => "ok"); // one more route
app.injector; // the injector: the instances of the application
await app.close(); // when the server has stopped: release the instances
```

`ChoWeb.create` builds the injector, creates **every** instance of the
application up front (`injector.init()`), builds and checks the routes, and
registers them with the adapter. Every wiring, route, middleware or error
handler mistake makes it reject, before the server starts; what was created
until then is disposed.

**The injector.** `app.injector` is the injector `ChoWeb.create` built. It is
there for another CHO module to build a second application on the same
instances: `ChoMessage.from(app.injector)` of `@chojs/message`
(`message/specs.md`, section 6.5). The web application owns it: `app.close()`
disposes it, after the other application is closed.

**Mounting a route.** The routes of an application are declared: they come from
its controllers, and they are known when `ChoWeb.create` returns. `app.mount`
adds one more route to an application that is created. It is for what cannot be
declared, because it is made from the application itself: the documentation of
its routes (`@chojs/openapi`), which reads `app.graph`.

```ts
const app = await ChoWeb.create(App, { prefix: "api" });

app.mount("GET", "health", () => ({ status: "ok" }));
app.mount("GET", "internal/routes", () => app.routes.map((r) => r.path), {
  middlewares: [onlyAdmins],
});

await serve(app);
```

```ts
mount(
  method: string,
  route: string,
  handler: (ctx: ChoWebContext) => unknown,
  options?: { middlewares?: ChoWebMiddlewareFn[]; name?: string },
): void;
```

| Argument      | What it is                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `method`      | `"GET"`, `"POST"`, `"PUT"`, `"PATCH"`, `"DELETE"`, `"HEAD"` or `"OPTIONS"`                       |
| `route`       | the whole route, written like the route of a decorator: `"internal/docs"`, `"users/:id"`, `""`   |
| `handler`     | a function of the context; what it returns is converted like the result of a handler (section 3) |
| `middlewares` | middleware functions `(ctx, next)`, in order, around the handler                                 |
| `name`        | the name of the route, for logs and errors; default: the name of the handler, or `mounted`       |

- **The route is not under the global prefix.** The prefix is the application's:
  it belongs to the routes the application declares. A mounted route says its
  whole path: `app.mount("GET", "docs", …)` answers `/docs`, whatever the
  `prefix` is.
- **It is a route of the application**: it is added to `app.routes`, after the
  others, it is registered on the adapter (section 7), and it is logged to
  `cho:web` like the others.
- **It is not in the graph.** `app.graph` is what the application declares. So
  no feature or controller middleware runs for it, and no `@Catch` handler of
  the application answers for it: it has the `middlewares` it was given, inside
  the middlewares of the application (section 4), which run for every request.
  When it fails, the `onError` of `ChoWeb.create` answers, if there is one;
  without one, an `HttpError` answers for itself (section 5.1) and the adapter
  answers `500` for anything else, as for any route.
- **It is the last route.** Where the first declared route wins (the built-in
  router, Hono), a declared route that matches the same path answers first: a
  `@Get(":slug")` at the root answers `/docs`.
- **A route that already exists throws**: the same method and path as a route of
  the application, declared or mounted.
- **Mount before the application serves.** `mount` is synchronous, and is called
  between `ChoWeb.create` and the start of the server. After the first request,
  or once the server of the adapter is ready, what happens is the adapter's: the
  built-in router accepts the route, Hono and Fastify throw. A route the adapter
  refuses is not added to `app.routes`. After `close()`, `mount` throws.
- **What it does not take**: classes (a middleware class, an error handler
  class), `@Args`, `@Sse` and `@Doc`. They are for declared routes.

**The default linker.** Without a `linker` (`ChoWeb.create(App)`, or options
that have none), the application is linked with the built-in router, a
`new ChoLinker()`, and `app.linked.instance` is typed as its `ChoRouter`. The
router is part of `@chojs/web` and is imported statically, so the default works
wherever the application is bundled. It needs the global `URLPattern`; on a
runtime without it `ChoWeb.create` rejects with
`ChoLinker needs the URL Pattern API (URLPattern), which this runtime does not have: give ChoWeb.create another linker, such as HonoLinker`.

**Serving.** `serve(app, options?)`, imported from `@chojs/web/serve`, runs an
application on the server of the current runtime: `Deno.serve` on Deno,
`Bun.serve` on Bun, and the `node:http` server on Node.js, through a bridge to
`Request` and `Response` that is part of this package. It resolves, once the
server is listening, to `{ runtime, port, hostname, close() }`.

It takes the application, or a `fetch`-style handler alone, such as
`app.handler`: `serve(app.handler)`. With a handler alone the server upgrades no
connection to a WebSocket.

| Option         | Default               | Use                                                                |
| -------------- | --------------------- | ------------------------------------------------------------------ |
| `port`         | `3000`                | the port; `0` picks a free one                                     |
| `hostname`     | the runtime's default | the host name or address to listen on                              |
| `signal`       | none                  | an `AbortSignal` that closes the server                            |
| `closeTimeout` | none                  | how long closing waits for the requests in flight, in milliseconds |
| `maxPayload`   | 1 MiB                 | the bytes a message of a WebSocket can hold                        |

**Who upgrades a connection.** A route marked with `@Ws` (section 3.5) accepts
or refuses; the code that holds the connection upgrades it. What that code needs
differs by runtime, so it is not in the handler of the route:

| Runtime            | Who upgrades  | With                                                                 |
| ------------------ | ------------- | -------------------------------------------------------------------- |
| Deno               | `app.handler` | `Deno.upgradeWebSocket(req)`: the request is enough                  |
| Cloudflare Workers | `app.handler` | a `WebSocketPair`, and a `101` response                              |
| Bun                | `serve(app)`  | `server.upgrade(req)`, and one set of callbacks given to `Bun.serve` |
| Node.js            | `serve(app)`  | the `'upgrade'` event, and the protocol, which Node.js has not       |

- `serve(app)` upgrades on Deno too, so that it knows its sockets.
- **`app.upgrade(req)`** is what `serve` calls for a request that asks for an
  upgrade. It runs the route, and resolves with the upgrade the route accepted,
  or with the `Response` that answers the request: a refusal, `404`, `426`,
  `503`. An adapter with a server of its own calls it the same way: it upgrades
  the connection, then gives what the connection can do to `upgrade.accept`,
  which returns where to give the messages and the close.

  | Of an upgrade (`ChoWebUpgrade`) | What it is                                                               |
  | ------------------------------- | ------------------------------------------------------------------------ |
  | `headers`                       | the headers the middlewares added to the answer, to send with the `101`  |
  | `accept(io)`                    | starts the socket, once the connection is upgraded. It is called once    |
  | `io.send(data)`                 | sends a text message (a string) or a binary one (bytes)                  |
  | `io.close(code, reason)`        | closes the connection                                                    |
  | `io.native`                     | the socket of the runtime: `socket.native`                               |
  | `events.message(data)`          | what `accept` returns: a message arrived, a string or bytes              |
  | `events.closed(code, reason)`   | the connection is closed, whoever closed it; `1006` for one that was cut |

  The first message is sent inside `accept`, and `@WsOpen` runs there. The order
  of the events, what a method returns, and its errors are handled behind
  `accept`, the same for every runtime: who upgrades only moves messages.
- **A server of your own.** `Bun.serve({ port, ...bunOptions(app) })` gives Bun
  the `fetch` and the `websocket` it needs, and
  `server.on("upgrade", nodeUpgrade(app))` gives a `node:http` server its
  listener. Both are in `@chojs/web/serve`, and take `maxPayload`.
- **On Node.js the protocol is part of this package** (RFC 6455, the server
  side), with no dependency. It has no extension: messages are not compressed. A
  connection is pinged every 30 seconds, and one that does not answer is cut. A
  frame the protocol does not allow closes the socket with the code of the RFC
  (`1002`, `1007`), and a message above `maxPayload` with `1009`.
  - **The handshake is checked before the route runs.** A request that asks for
    a WebSocket and is not a valid handshake is answered at once: `405` for a
    method that is not `GET`, `400` for a `Connection` header without `Upgrade`
    or a `Sec-WebSocket-Key` that is missing or not valid, and `426`, with
    `Sec-WebSocket-Version: 13`, for another version of the protocol.
  - **A refusal of the route** is written to the connection as an HTTP answer,
    with its status, its headers and its body, and the connection is closed.
  - **A close frame is answered** with its code and its reason, then the
    connection ends. A client that does not end its side is cut after 5 seconds,
    and one that goes away with no close frame closes its socket with `1006`.
  - **Text that is not UTF-8** is refused when its message is whole, not at the
    first byte that is wrong.
  - **It passes the Autobahn test suite**: 301 cases, none failed
    (`tools/autobahn/README.md`). On Bun and on Deno the protocol is the
    runtime's.
- `maxPayload` applies on Node.js and on Bun. Deno has no such limit to set.
- **The socket of the runtime** is `socket.native`: a `WebSocket` on Deno and on
  Workers, a `ServerWebSocket` on Bun (with its `subscribe` and `publish`), and
  the connection on Node.js.
- A middleware that replaces the request of the context (`ctx.req`) before a
  `@Ws` route refuses its upgrade: the route and who upgrades know the upgrade
  by the request.

- `serve` is asynchronous because the Node.js modules are imported when they are
  needed, on Node.js only: `@chojs/web` has no dependency, and loads nothing of
  Node.js on another runtime.
- On Node.js the body of the request is the stream of the connection, the body
  of the response is streamed, `req.signal` is aborted when the client goes
  away, and a handler that rejects is logged and answered with `500`.
- `close()` stops accepting requests and waits for the ones in flight. A request
  that never ends, such as an open stream of server-sent events (section 3.4),
  would hold it for ever: with `closeTimeout`, the connections of the requests
  that are still in flight after that long are cut, and `0` cuts them at once.
  The handler of a request that is cut sees what it sees when a client goes
  away: `req.signal` is aborted, and the body of its response is cancelled. The
  timeout also applies when the `signal` closes the server.
- `close()` first closes the sockets the server upgraded, with the code `1001`:
  their `@WsClose` methods run. A client that does not end its side is cut after
  `closeTimeout`, and on Node.js after 5 seconds at most.
- On Deno, a request that arrives while a server with a `closeTimeout` is
  closing is answered `503`: `Deno.serve` cannot both wait for its requests and
  then cut them, so the requests in flight are counted by `serve`, which keeps
  the server listening until they have ended, or until it cuts them. A server
  whose requests end in time is closed without cutting anything, so the last
  response is sent whole.
- It is a separate entry point, so that an application that does not call it
  loads nothing of it. On Cloudflare Workers and the other runtimes that serve
  an exported handler, the entry module is
  `export default { fetch: app.handler }`.
- A `closeTimeout` that is not a whole number of milliseconds rejects
  (`CHO_WEB_INVALID_OPTION`):
  `serve(): closeTimeout must be a whole number of milliseconds, got <v>`.
- On a runtime that is not Deno, Bun or Node.js it rejects
  (`CHO_WEB_NO_SERVER`):
  `serve() has no server for this runtime (<runtime>): give app.handler to the runtime's own entry point`.
- On Deno it needs `--allow-net`.

**Closing.** `app.close()` closes the open sockets of the application with the
code `1001`, waits for their `@WsClose` methods, and then disposes the
application's instances, in reverse creation order: every provider, controller
or module with a `[Symbol.asyncDispose]()` or `[Symbol.dispose]()` method
(`core/specs.md`, section 2.7). `@chojs/web` does not run the server, so it
never closes on its own: stop the server first, then close. A request that still
reaches `app.handler` after `close()` is answered `503 Service Unavailable`, and
runs no route.

```ts
const server = await serve(app, { closeTimeout: 10_000 });
process.once("SIGTERM", async () => {
  // stop accepting, give the requests in flight 10 seconds to finish
  await server.close();
  await app.close();
});
```

**The environment.** `@chojs/web` gives an application what it reads its
environment with: `env`, `envNum`, `envBool`, `setEnv` and `engine`. They are
the core's (`core/specs.md`, section 3.3), under the names of a public API, and
the same in every CHO module. Variables are read from the source given to
`setEnv`, then from `process.env`.

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

|                                           | `ChoLinker` (built in)                                                       | `@chojs/vendor-hono`                             | `@chojs/vendor-fastify`                                                                      |
| ----------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Linker                                    | `new ChoLinker(options?)`                                                    | `new HonoLinker(hono?)`                          | `new FastifyLinker(fastify?)`                                                                |
| Runs on                                   | runtimes with `URLPattern` (Deno, Node.js 24, Bun 1.3.4, Cloudflare Workers) | Deno, Node.js, Bun, edge runtimes                | Node.js only                                                                                 |
| `app.linked.instance`                     | a `ChoRouter`                                                                | the `Hono` application                           | the Fastify application                                                                      |
| Served with                               | `app.handler`                                                                | `app.handler`                                    | `instance.listen()`; `app.handler` goes through `inject()`                                   |
| `ctx.native`                              | `undefined`                                                                  | Hono's `Context`                                 | `{ request, reply }` of Fastify                                                              |
| When two routes match                     | the first declared                                                           | the first declared                               | the static one                                                                               |
| `HEAD` without `@Head`                    | `@Get`, without the body                                                     | `@Get`, without the body                         | `@Get`, without the body                                                                     |
| No route matches                          | the `notFound` option; `404`                                                 | `notFound` of the Hono application               | the not-found handler of the Fastify application                                             |
| An undecodable path parameter             | `400`; the route does not run                                                | passed as it was sent                            | `400`, by Fastify                                                                            |
| A route rejects                           | logged with `console.error`; `500`                                           | `onError` of the Hono application; logged, `500` | the error handler of the Fastify application; `500`                                          |
| A route throws an `HttpError`             | answered by the route (section 5.1)                                          | answered by the route                            | answered by the route                                                                        |
| An event stream (`@Sse`)                  | streamed by the server that runs `app.handler`                               | streamed by the server that runs `app.handler`   | streamed by `instance.listen()`; `app.handler` waits for its end                             |
| A WebSocket (`@Ws`)                       | upgraded: `app.handler` on Deno and Workers, `serve(app)` on Bun and Node.js | the same: `@chojs/web` upgrades, not Hono        | not upgraded: the route is refused when the application is created (`CHO_FASTIFY_NO_SOCKET`) |
| Application middlewares: `ctx.params`     | those of the route that matched                                              | empty: no route is matched yet                   | those of the route that matched                                                              |
| Application middlewares: no route matches | around the `notFound` option                                                 | around `notFound` of the Hono application        | around a `404` of the adapter: the Fastify application has no not-found handler of its own   |
| Application middlewares: a route rejects  | they get the `500` response                                                  | they get the response of `onError`               | the error goes through them, to the error handler of Fastify                                 |
| A middleware of the library               | none: `@chojs/vendor-cho` has CHO middlewares                                | `fromHono(middleware)`                           | `fromFastify(hook)`                                                                          |
| A route mounted late                      | accepted                                                                     | throws, after the first request                  | throws, once the application is ready                                                        |

**The middlewares of the application** (section 4) are run by the adapter, for
every request. `@chojs/web` creates them, and gives the linker one function with
the routes, `around`, when the application has some:

```ts
type Around = (
  req: Request,
  answer: (ctx: ChoWebContext) => Promise<Response>,
  native?: unknown,
  params?: Readonly<Record<string, string>>,
) => Promise<Response>;
```

`around` creates the context of the request, and runs the middlewares, in order,
around `answer`. The adapter calls it with what answers the request: the route,
or its not-found answer.

- **`answer` receives the context the middlewares had.** A middleware can have
  replaced the request (`ctx.req`), to limit or change how the body is read, and
  the state is the one the route must have: the adapter gives the route both,
  `route.handle(ctx.req, params, native, ctx.state)`.
- **`native` and `params`** are what the adapter knows when it calls: they are
  the `ctx.native` and the `ctx.params` of the middlewares. Hono runs a
  middleware before it matches a route, so its `params` are empty.
- **An `HttpError` a middleware throws** (section 5.1) is answered with its
  status, on every adapter, and the middlewares before it get that response:
  nothing is logged.
- **A middleware that fails** (it throws, or breaks a rule of section 4) makes
  `around` reject. The adapter answers as it does for a route that rejects: the
  built-in router logs it and answers `500`, Hono and Fastify give it to their
  error handler.
- **A route that rejects** reaches the middlewares as the adapter has it: the
  `500` response on the built-in router and on Hono, the error itself on
  Fastify, which answers it after them.
- **Without `around`**, the application has no middlewares, and an adapter does
  what it did before: nothing is created for a request.

| Adapter             | Where it calls `around`                                                                                     |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| The built-in router | in `fetch`, once the route is found: around the route, or around `notFound`                                 |
| Hono                | in one Hono middleware, registered before the routes: around the route, Hono's `notFound` and its `onError` |
| Fastify             | in the handler of each route, and in a not-found handler the adapter sets                                   |

Fastify has no hook that wraps a request and gets its response. So the adapter
sets the not-found handler of the Fastify application, which answers `404` with
the body Fastify gives by default. A Fastify application that set one of its own
cannot have application middlewares: it fails when it gets ready
(`CHO_FASTIFY_NOT_FOUND_SET`). Without application middlewares, the adapter sets
nothing.

The built-in router has no middlewares of its own. `new ChoLinker()` that is
given `middlewares` throws (`CHO_WEB_INVALID_OPTION`), so that an application
written for an earlier version does not run without them, and says where they
moved.

`@chojs/vendor-cho` has the middlewares an HTTP library would bring
(`vendor/cho/README.md`): `cors`, `bodyLimit`, `secureHeaders`, `logger`,
`timeout`, `requestId`, `etag`, `basicAuth`, `bearerAuth` and `compress`. They
are CHO middlewares: they run on every adapter, for an application or for some
of its routes. None of them reads the body of an event stream (section 3.4):
`etag` and `compress` pass a `text/event-stream` response on as it is. A route
that upgrades to a WebSocket (section 3.5) passes through all of them: what they
add to its answer goes with the `101`, apart from the headers that describe a
body (`content-*`, `etag`), which a `101` has not.

An adapter implements `Linker` (`@chojs/web/linker`): `link(routes, options)`
receives the application's routes, and `around` in its options, and returns a
`Linked`. `@chojs/web` never imports an adapter: applications pass one to
`ChoWeb.create`.

| Member of `Linked` | What it is                                                     |
| ------------------ | -------------------------------------------------------------- |
| `instance`         | the runtime's application object                               |
| `handler`          | its `fetch`-style handler                                      |
| `mount(route)`     | registers one more route, after `link()`. Every adapter has it |

`mount` is what `app.mount` calls. It receives a `Route`, as `link()` does, and
registers it the same way: the route behaves like one that was given to
`link()`, with the same answer to a `HEAD` request, the same `ctx.native`, and
the same order when two routes match, after the routes it already has. It is
synchronous, and it throws when the runtime can no longer take a route.

An adapter does no plumbing. Each `Route` is ready to call:

| Property | Holds                                                                                    |
| -------- | ---------------------------------------------------------------------------------------- |
| `method` | the HTTP method, upper case (`"GET"`)                                                    |
| `path`   | the full path, global prefix included (`"/api/users/:id"`)                               |
| `name`   | where it is declared, for logs (`"UsersController.get"`)                                 |
| `handle` | `(req, params?, native?, state?) => Promise<Response>`: answers a matching request       |
| `socket` | `true` for a route that upgrades its request to a WebSocket (`@Ws`); not there otherwise |

`handle` runs the route's middlewares, its handler and its error handler. The
adapter gives it the `Request`, the decoded path parameters of the match and,
optionally, its own request context, which handlers see as `ctx.native`, and the
state of the request, when something ran for it before the route (the
middlewares of the application): handlers see it as `ctx.state`. It rejects when
the route fails without an error handler: the adapter answers `500`. It does not
reject for an `HttpError` (section 5.1): the route resolves with its answer, so
an adapter has nothing to do for one.

**A route that upgrades** (`socket: true`) is registered as any `GET` route, and
an adapter has nothing to do for it either, as long as two things hold:

- **The route receives the `Request` the adapter was given.** The route and who
  upgrades know an accepted upgrade by that object: an adapter that gives the
  route a copy of the request refuses every upgrade.
- **The answer of the route goes out with its status.** A route that accepted
  answers `426`, and who upgrades (`app.handler`, or `serve`) replaces it. The
  response itself can be copied, to add a header.

An adapter that holds the server itself, as the Fastify adapter does, cannot
leave the upgrade to `serve`. It upgrades the connection with `app.upgrade`
(section 6), or refuses such a route when it is registered, as the Fastify
adapter does for now.

```ts
class MyLinker implements Linker<MyServer> {
  link(routes: readonly Route[], { around }: LinkOptions): Linked<MyServer> {
    const server = new MyServer();
    // The middlewares of the application, around every request.
    if (around) {
      server.use((req, next) => around(req, (ctx) => next(ctx.req, ctx.state)));
    }
    const mount = (route: Route) =>
      server.on(
        route.method,
        route.path,
        (req, params, state) => route.handle(req, params, undefined, state),
      );
    routes.forEach(mount);
    return { instance: server, handler: (req) => server.fetch(req), mount };
  }
}
```

A path is `/`-separated segments; a segment that starts with `:` is a parameter
that matches one segment. An adapter whose router uses another syntax translates
it.

The tree behind the declared routes is on `app.graph` (`@chojs/web/graph`), with
every instance, middleware and error handler already created. A mounted route is
not in it:

| Node            | Holds                                                                                                                         |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `AppRef`        | `route` (the global prefix), `errorHandler` (the application's), `features`                                                   |
| `FeatureRef`    | `route`, `middlewares`, `errorHandler`, `doc`, `controllers`                                                                  |
| `ControllerRef` | `route`, `middlewares`, `errorHandler`, `doc`, `instance`, `methods`                                                          |
| `MethodRef`     | `route`, `middlewares`, `errorHandler`, `doc`, `name`, `method` (`"GET"`, …), `handler`, `args`, `validated`, `sse`, `socket` |

`socket` is there for a handler marked with `@Ws`: the methods of the controller
that handle the events of its socket, `open`, `message` and `close`, each with
its `name` and its `handler`, bound to the controller. An event with no method
is not there.

### 7.1 Cloudflare Workers

Cloudflare Workers is the fourth runtime the package is tested on: its tests run
in workerd, the runtime of Workers (`tools/workerd/README.md`), at the
compatibility date `2025-09-01` and, for the package itself, with no
`nodejs_compat` flag.

- **The entry point** is `export default { fetch: app.handler }`. `serve()` has
  no server there, and rejects with `CHO_WEB_NO_SERVER`.
- **WebSockets** (section 3.5) are upgraded by `app.handler`: it answers a
  request a `@Ws` route accepted with a `101` and the client side of a
  `WebSocketPair`. Durable Objects, and their sockets that hibernate, are not
  covered.
- **The runtime calls `fetch(request, env, ctx)`.** `app.handler` takes the
  request. The bindings and the execution context are reached with the module of
  the runtime, `import { env, waitUntil } from "cloudflare:workers"`, in a
  handler and in the factory of a provider. With `HonoLinker` they are also
  `ctx.native.env` and `ctx.native.executionCtx`; with the built-in router
  `ctx.native` is `undefined`.
- **Creation.** A Worker does no I/O outside a request, so an application whose
  providers do some is created in the first request. `ChoWeb.create` at the top
  level is for providers that only compute.
- **The environment** is given with `setEnv()` (section 6), before the
  application is created: there is no `process`.
- **Names.** CHO puts the names of classes and functions in error messages, in
  logs and in the tags of an OpenAPI document. A bundle that renames them
  changes those: the bundle keeps the names.
- **What is skipped in the tests**: what needs a server (`serve()`), what reads
  files (the check of the error codes), and Fastify.
- **Not covered**: a deployment to Cloudflare, and the bindings other than a
  text one. The tests run in workerd, on a machine.

## 8. Public API

| Entry point             | Exports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@chojs/web`            | `ChoWeb`, `ChoWebOptions`, `ChoWebMountOptions`, `ChoWebMountMethod`, `ChoLinker`, `ChoRouter`, `ChoLinkerOptions`, `ChoMatch`, `Get`, `Post`, `Put`, `Patch`, `Delete`, `Head`, `Options`, `Sse`, `Ws`, `WsOpen`, `WsMessage`, `WsClose`, `Middlewares`, `Catch`, `Args`, `Param`, `Query`, `Header`, `Body`, `Form`, `validate`, `Doc`, `HttpError`, `isHttpError`, `HttpErrorOptions`, `ChoError`, `isChoError` (the core's), `ChoWebErrorCode`, `ChoCoreErrorCode`, the types `ChoWebSseEvent`, `ChoWebSseOptions`, `ChoWebSseMethod`, `ChoWebSseResult`, `ChoWebSseDecorator`, `ChoWebSocket`, `ChoWebUpgrade`, `ChoWebSocketIo`, `ChoWebSocketEvents`, `ChoWebWsOpenDecorator`, `ChoWebWsMessageDecorator`, `ChoWebWsCloseDecorator`, `ChoWebWsEventDecorator`, `ChoWebArg`, `ChoWebArgInfo`, `ChoWebArgSource`, `ChoWebValidateOptions`, `ChoWebInvalid`, `ChoValidator`, `ChoParseValidator`, `ChoIssue`, `ChoInput`, `ChoOutput`, `StandardSchemaV1`, `StandardJSONSchemaV1`, `StandardTypedV1` (the core's), `ChoWebDoc`, `ChoWebDocResponse`, `ChoWebDocSecurity`, `ChoWebContext`, `ChoWebHandler`, `ChoWebNext`, `ChoWebMiddlewareFn`, `ChoWebMiddleware`, `ChoWebErrorHandlerFn`, `ChoWebErrorHandler`, `Module`, `Controller` (the core's, with the `route` option), `WebModuleOptions`, `WebControllerOptions`, and from the core `Injectable`, `token`, `provider`, `configure`, `InjectionToken`, `Provider` and the option types, and `env`, `envNum`, `envBool`, `setEnv`, `engine`, `EnvSource`, `EngineType` |
| `@chojs/web/linker`     | `Linker`, `Linked`, `Route`, `LinkOptions`, `Around`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `@chojs/web/graph`      | `AppRef`, `FeatureRef`, `ControllerRef`, `MethodRef`, `NodeRef`, `ErrorHandlerRef`, `SocketRef`, `SocketMethodRef`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `@chojs/web/serve`      | `serve`, `bunOptions`, `nodeUpgrade`, `ServeHandler`, `ServeApp`, `ServeOptions`, `SocketOptions`, `BunOptions`, `NodeUpgradeListener`, `ChoWebServer`, `EngineType`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `@chojs/vendor-cho`     | CHO middlewares, for an application or for its routes: `cors`, `bodyLimit`, `secureHeaders`, `logger`, `timeout`, `requestId` (and `REQUEST_ID`), `etag`, `basicAuth`, `bearerAuth`, `compress`, and their option types                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `@chojs/vendor-hono`    | `HonoLinker`, `HonoLinked`, `fromHono`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `@chojs/vendor-fastify` | `FastifyLinker`, `FastifyLinked`, `FastifyNative`, `FastifyHook`, `fromFastify`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

`@Middlewares` and `@Catch` are the core's decorators, typed for `@chojs/web`.

## 9. Errors

Every mistake the framework finds is a `ChoError` with a `code`
(`core/specs.md`, section 2.8). The code is part of the API. The messages below
are the current wording, for people to read: they are not part of the API and
can change in any release. Do not match on their text.

```ts
import { ChoWeb, isChoError } from "@chojs/web";

try {
  await ChoWeb.create(App);
} catch (error) {
  if (isChoError(error, "CHO_WEB_DUPLICATE_ROUTE")) {
    // ...
  }
  throw error;
}
```

The codes of this package start with `CHO_WEB_` (type `ChoWebErrorCode`). A
mistake the core finds has a code of the core, `CHO_CORE_…` (type
`ChoCoreErrorCode`): it is named in the tables below where a web application
meets it. An `HttpError` (section 5.1) is not a `ChoError`, and has no code.

**Thrown by the decorators**, when the class is defined:

| Mistake                                         | Code                          | Message                                                                                                                                                                                                     |
| ----------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A handler's route is invalid                    | `CHO_WEB_INVALID_ROUTE`       | `Invalid route "<route>" of @Get() on method <name>: <reason>`                                                                                                                                              |
| A second HTTP method decorator on a method      | `CHO_WEB_DUPLICATE_DECORATOR` | `Cannot add @Get() to method <name>: it already handles POST "<route>". A method can have one HTTP method decorator.`                                                                                       |
| An event decorator on a handler, or the reverse | `CHO_WEB_DUPLICATE_DECORATOR` | `Cannot add @WsMessage() to method <name>: it already handles GET "<route>". A method handles a request, or one event of a socket.` (and `Cannot add @Get() to method <name>: it already has @WsOpen(). …`) |
| An unknown option of `@Module` / `@Controller`  | `CHO_CORE_UNKNOWN_OPTION`     | `@Controller(): unknown option "deps". Known options: dependencies, route`                                                                                                                                  |
| An unknown option of `@Doc`                     | `CHO_CORE_UNKNOWN_OPTION`     | `@Doc(): unknown option "tag". Known options: deprecated, description, hidden, operationId, responses, security, summary, tags`                                                                             |
| A static, private or symbol-named handler       | `CHO_WEB_INVALID_TARGET`      | `@Get() cannot decorate static method <name>: a handler must not be static` (and `private …`, `… a string name`)                                                                                            |
| A second `@Args` on a method                    | `CHO_WEB_DUPLICATE_DECORATOR` | `Cannot add @Args() to method <name>: it already has one.`                                                                                                                                                  |
| An argument of `@Args` is not a function        | `CHO_WEB_INVALID_ARGUMENT`    | `@Args() on method <name>: argument <n> must be made with Param, Query, Header, Body or Form, or be a function, got <v>`                                                                                    |
| A key or a validator of the wrong type          | `CHO_WEB_INVALID_ARGUMENT`    | `Body(): expected a key (a string) or a validator (a Standard Schema, or an object with a parse method), got <v>`                                                                                           |
| Something after a validator                     | `CHO_WEB_INVALID_ARGUMENT`    | `Body(): a validator is the last argument, got <v> after it`                                                                                                                                                |
| A second `@Doc` on a class or a method          | `CHO_WEB_DUPLICATE_DECORATOR` | `Cannot add @Doc() to class <Name>: it already has one.` (and `… to method <name> …`)                                                                                                                       |
| A handler option of `@Doc` on a class           | `CHO_WEB_INVALID_OPTION`      | `@Doc(): option "summary" is for a handler, not for a class (class <Name>)` (and `"responses"`, `"operationId"`)                                                                                            |
| An `operationId` that is not a string           | `CHO_WEB_INVALID_OPTION`      | `@Doc(): operationId must be a non-empty string, got <v>`                                                                                                                                                   |
| A `security` of the wrong shape                 | `CHO_WEB_INVALID_OPTION`      | `@Doc(): security must be a list of objects of lists of strings, such as [{ bearer: [] }], got <v>`                                                                                                         |
| A `contentType` that is not a string            | `CHO_WEB_INVALID_OPTION`      | `@Doc(): the contentType of response <status> must be a non-empty string, got <v>`                                                                                                                          |
| An unknown option of `@Sse`                     | `CHO_CORE_UNKNOWN_OPTION`     | `@Sse(): unknown option "keepalive". Known options: keepAlive, method`                                                                                                                                      |
| A `method` a stream cannot answer               | `CHO_WEB_INVALID_OPTION`      | `@Sse(): method must be one of GET, POST, PUT, PATCH, DELETE, got <v>`                                                                                                                                      |
| A `keepAlive` that is not a time                | `CHO_WEB_INVALID_OPTION`      | `@Sse(): keepAlive must be a positive whole number of milliseconds, got <v>`                                                                                                                                |

**Rejected by `ChoWeb.create`**: any module graph error of the core
(`core/specs.md`, section 2.8), and:

| Mistake                                                             | Code                             | Message                                                                                                                                                                                                         |
| ------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A route is not a string                                             | `CHO_WEB_INVALID_ROUTE`          | `Invalid route of <where>: expected a string, got <v>`                                                                                                                                                          |
| A route breaks a rule (section 2.3)                                 | `CHO_WEB_INVALID_ROUTE`          | `Invalid route "<route>" of <where>: <reason>`                                                                                                                                                                  |
| Two handlers with the same method and path                          | `CHO_WEB_DUPLICATE_ROUTE`        | `Duplicate route "<METHOD> <path>": declared by <Controller.method> and <Controller.method>`                                                                                                                    |
| The same controller declared by two modules                         | `CHO_WEB_DUPLICATE_ROUTE`        | the message above, followed by `Its controller is declared in more than one module: declare it in one.`                                                                                                         |
| A wildcard in a route                                               | `CHO_WEB_INVALID_ROUTE`          | `Invalid route "<route>" of <where>: "<segment>" has a "*": wildcards are not part of the route syntax`                                                                                                         |
| A malformed parameter (`:`, `:1id`, `:a:b`)                         | `CHO_WEB_INVALID_ROUTE`          | `Invalid route "<route>" of <where>: "<segment>" is not a valid parameter: write ":name", with letters, digits and "_"`                                                                                         |
| `Param("x")` names no parameter of the path                         | `CHO_WEB_UNKNOWN_PARAM`          | `@Args() of <Controller.method>: Param("x") is not a parameter of the route "<path>"`                                                                                                                           |
| A controller with two methods for one of the four socket decorators | `CHO_WEB_INVALID_SOCKET`         | `Controller <Name> has two @WsMessage() methods, <a> and <b>: a controller has one socket, and one method for each of its events. Put the second socket in a controller of its own`                             |
| Event methods in a controller with no `@Ws` method                  | `CHO_WEB_INVALID_SOCKET`         | `Controller <Name> has @WsOpen(), @WsMessage() and no @Ws() method: the events of a socket need the method that upgrades the request`                                                                           |
| `@Middlewares`, `@Catch`, `@Args` or `@Doc` on an event method      | `CHO_WEB_INVALID_SOCKET`         | `@WsMessage() method <Controller.method> cannot have @Middlewares(): an event of a socket has no request. Put @Middlewares() on the @Ws() method of the controller, which handles the request that is upgraded` |
| `onError` is not a function or a class                              | `CHO_CORE_INVALID_ERROR_HANDLER` | `Invalid error handler <v>: must be a function or a class with a 'handle' method.`                                                                                                                              |
| A middleware class has no `handle` method                           | `CHO_CORE_INVALID_MIDDLEWARE`    | `Middleware class <Name> must implement 'handle' method.`                                                                                                                                                       |
| A middleware class cannot be created                                | `CHO_WEB_CREATE_FAILED`          | `Failed to create middleware <Name> in module <Module>`, with the injector's error as cause                                                                                                                     |
| An error handler class has no `handle` method                       | `CHO_CORE_INVALID_ERROR_HANDLER` | `Error handler class <Name> must implement 'handle' method.`                                                                                                                                                    |
| An error handler class cannot be created                            | `CHO_WEB_CREATE_FAILED`          | `Failed to create error handler <Name> in module <Module>`, with `cause`                                                                                                                                        |

`<where>` names the declaration: `the global prefix`, `feature <Module>`,
`controller <Controller>` or `method <name> of controller <Controller>`.

**Thrown by `app.mount`**:

| Mistake                                  | Code                         | Message                                                                                                                      |
| ---------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| A method that is not an HTTP method      | `CHO_WEB_INVALID_METHOD`     | `ChoWeb.mount(): method must be one of GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS, got <v>`                                |
| A route that breaks a rule (section 2.3) | `CHO_WEB_INVALID_ROUTE`      | `Invalid route "<route>" of ChoWeb.mount(): <reason>`                                                                        |
| A handler that is not a function         | `CHO_WEB_INVALID_HANDLER`    | `ChoWeb.mount(): the handler of <METHOD> <path> must be a function, got <v>`                                                 |
| A middleware that is not a function      | `CHO_WEB_INVALID_MIDDLEWARE` | `ChoWeb.mount(): middleware <n> of <METHOD> <path> must be a function, got <v>`                                              |
| An unknown option                        | `CHO_CORE_UNKNOWN_OPTION`    | `ChoWeb.mount(): unknown option "<name>". Known options: middlewares, name`                                                  |
| The route already exists                 | `CHO_WEB_DUPLICATE_ROUTE`    | `Duplicate route "<METHOD> <path>": declared by <name> and mounted as <name>` (or `mounted as <name> and mounted as <name>`) |
| The application is closed                | `CHO_WEB_CLOSED`             | `The application is closed`                                                                                                  |
| The adapter can no longer take a route   | the adapter's                | the error of the adapter                                                                                                     |

**Thrown by `new HttpError()`** (section 5.1):

| Mistake                                  | Code                      | Message                                                                          |
| ---------------------------------------- | ------------------------- | -------------------------------------------------------------------------------- |
| A status an error cannot have            | `CHO_WEB_INVALID_STATUS`  | `HttpError: the status must be a whole number from 400 to 599, got <v>`          |
| A message that is not a string           | `CHO_WEB_INVALID_OPTION`  | `HttpError: the message must be a string, got <v>`                               |
| Options that are not an object           | `CHO_WEB_INVALID_OPTION`  | `HttpError: the options must be an object, got <v>`                              |
| An unknown option                        | `CHO_CORE_UNKNOWN_OPTION` | `HttpError: unknown option "<name>". Known options: cause, headers`              |
| Headers that `new Headers()` cannot take | `CHO_WEB_INVALID_OPTION`  | `HttpError: the headers must be what new Headers() takes, got <v>`, with `cause` |

**Thrown by the built-in router and by `serve`** (section 7):

| Mistake                                                                                         | Code                      | Message                                                                                                                                     |
| ----------------------------------------------------------------------------------------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| The runtime has no URL Pattern API                                                              | `CHO_WEB_NO_URL_PATTERN`  | `ChoLinker needs the URL Pattern API (URLPattern), which this runtime does not have: give ChoWeb.create another linker, such as HonoLinker` |
| `middlewares` given to `ChoLinker`, where it was an option                                      | `CHO_WEB_INVALID_OPTION`  | `ChoLinker: "middlewares" is not an option of the router: give the middlewares of the application to ChoWeb.create(App, { middlewares })`   |
| The `middlewares` of `ChoWeb.create` are not an array                                           | `CHO_WEB_INVALID_OPTION`  | `ChoWeb.create(): "middlewares" must be an array, got <v>`                                                                                  |
| `serve`, `bunOptions` or `nodeUpgrade` is given something else than an application or a handler | `CHO_WEB_INVALID_HANDLER` | `serve() expects an application, or a request handler such as app.handler`                                                                  |
| A `closeTimeout` that is not a time                                                             | `CHO_WEB_INVALID_OPTION`  | `serve(): closeTimeout must be a whole number of milliseconds, got <v>`                                                                     |
| A `maxPayload` that is not a size                                                               | `CHO_WEB_INVALID_OPTION`  | `serve(): maxPayload must be a positive whole number of bytes, got <v>`                                                                     |
| `accept` of an upgrade is called twice                                                          | `CHO_WEB_INVALID_SOCKET`  | `The upgrade of <Controller.method> was already accepted: accept() is called once for a connection`                                         |
| The runtime has no server `serve` knows                                                         | `CHO_WEB_NO_SERVER`       | `serve() has no server for this runtime (<runtime>): give app.handler to the runtime's own entry point`                                     |

**Failing a request** (given to the route's error handler, section 5):

| Mistake                                               | Code                                 | Message                                                                                                                                      |
| ----------------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| A middleware calls `next()` twice                     | `CHO_CORE_NEXT_CALLED_TWICE`         | `middleware <name>: next() called more than once`                                                                                            |
| A middleware returns nothing without calling `next()` | `CHO_CORE_MISSING_MIDDLEWARE_RESULT` | `middleware <name> returned no response: return a Response or call next()`                                                                   |
| A middleware returns something else                   | `CHO_CORE_INVALID_MIDDLEWARE_RESULT` | `middleware <name> must return a Response or nothing, got <typeof>`                                                                          |
| An `@Sse` handler returns something else              | `CHO_WEB_INVALID_SSE_RESULT`         | `@Sse() handler <Controller.method> must return an async iterable or a Response, got <typeof>`                                               |
| A `@Ws` handler returns what cannot be sent           | `CHO_WEB_INVALID_SOCKET_RESULT`      | `@Ws() handler <Controller.method> gave a value that cannot be sent on a socket: expected a string, bytes or a value JSON can hold, got <v>` |

An event method of a socket that returns such a value, or gives one to
`socket.send`, has the same error (`<Controller.method> gave a value …`,
`send() gave a value …`). There is no request to fail: the socket is closed with
`1011` (section 3.5).

A middleware class is named `<Class>.handle`.

**Cutting an event stream** (no error handler is called: section 3.4), besides
what the iteration itself throws:

| Mistake                                   | Code                    | Message                                                                                                                                                         |
| ----------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Something that is not an event is yielded | `CHO_WEB_INVALID_EVENT` | `@Sse() handler <Controller.method>: an event must be a string or an object with data, got <v>`                                                                 |
| An `event` or an `id` that cannot be sent | `CHO_WEB_INVALID_EVENT` | `@Sse() handler <Controller.method>: "event" must be a string with no line break, got <v>` (and `"id"`)                                                         |
| A `retry` that is not a time              | `CHO_WEB_INVALID_EVENT` | `@Sse() handler <Controller.method>: "retry" must be a whole number of milliseconds, got <v>`                                                                   |
| `data` that cannot be serialized as JSON  | `CHO_WEB_INVALID_EVENT` | `@Sse() handler <Controller.method>: "data" cannot be serialized as JSON, got <v>`, or the `TypeError` of `JSON.stringify` (which is not ours, and has no code) |

**What has no code**: an argument of `@Args` that throws fails the request with
its own error, unchanged, and so does a handler or a middleware. A value a
handler returns that cannot be serialized as JSON fails the request with the
`TypeError` of `JSON.stringify`. An argument that is not valid is answered by
the validation middleware, when it is on the route (section 3.2).

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
- **Validation** (`web/validate.ts`). `validate()` is a middleware that leaves
  its options in the state of the request, under a registered symbol
  (`Symbol.for("chojs.web.validation")`), and calls `next()`. The function that
  calls a handler with its arguments (`web/build-graph.ts`) finds them there:
  the arguments of a marked request go through their validators, and for one
  that is not valid the function answers, with `onInvalid` or `400`, in place of
  the handler. Nothing is thrown through the chain, so the middleware covers a
  handler from wherever it sits, the application included: the state is one
  `Map` from the first middleware of the application to the handler.
- **The middlewares of the application** (`web/compose.ts`). `around` composes
  them, each one wrapped so that an `HttpError` it throws becomes its answer,
  and runs them on a context made for the request. `ChoWeb.create` gives it to
  `Linker.link` when the application has middlewares.
- **Event streams** (`web/sse.ts`). `@Sse` writes the same record as `@Get`,
  with its method and its options. When the routes are compiled, the result of
  such a handler becomes the body of a `text/event-stream` response: a
  `ReadableStream`, with no queue of its own, that asks the iterator for one
  event each time the connection can take one, writes it in the format of the
  events, ends the iterator when it is cancelled, and fails with the error of
  the iteration.
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
- **Answering an `HttpError`** (`web/http-error.ts`, `web/routes.ts`). The
  answer is made in one place, `make_route`, for the declared routes and the
  mounted ones, on every adapter: the error that would leave the route (no error
  handler, one that returned nothing, or what one threw) is turned into
  `error.toResponse()` when `isHttpError` says so. The same is done for what
  runs outside a route: `around` for a middleware of the application, on every
  adapter, and the built-in router for its `notFound`. The class is recognized
  by a property of its prototype keyed by `Symbol.for("cho.http_error")`, which
  two copies of the package share.
- **Errors** (`web/errors.ts`). `web_error(code, message, options)` makes the
  `ChoError`s of this package, with a code of `ChoWebErrorCode`
  (`core/specs.md`, section 4.4). `web/errors_test.ts` checks the codes against
  section 9 and against the tests.
- **Mounting a route** (`web/web.ts`). `app.mount` makes a `Route` with the
  function that makes the declared ones (`make_route`, in `web/routes.ts`),
  around its own middlewares and handler, with the error handler of the
  application. It compares the route with those the application has, gives it to
  the `mount` of the adapter, and only then adds it to `app.routes`.
- **The Hono adapter** registers each route on one Hono application with
  `app.on(method, path, …)`, and calls `route.handle` with the raw `Request`,
  Hono's decoded parameters and Hono's context. Hono answers a `HEAD` request
  with its `GET` routes: a `HEAD` route is a `GET` route that only answers
  `HEAD` requests, and the `GET` route of a path looks, for each `HEAD` request,
  for a `HEAD` route of that path, so that one mounted later still answers. With
  `around`, it registers one Hono middleware first, which calls it around Hono's
  `next()` and keeps its context for the Hono context of the request: a route is
  given the request and the state of that context.
- **The built-in router** (`web/router.ts`) makes one `URLPattern` for each
  route, and calls the `route.handle` of the first route whose method and
  pattern match, with the `Request` and the decoded parameters. A mounted route
  is one more pattern, at the end. A parameter that is not valid
  percent-encoding (`%`, `%zz`, a sequence of UTF-8 that is cut) is not passed
  as it was sent, where a handler could not tell `%` from `%25`: `match` throws
  an `HttpError` of `400`, and `fetch` answers with it, inside the middlewares
  of the application, with no parameters in their context. The router calls
  `around` once the route is found, so those middlewares have its parameters.
- **The Fastify adapter** registers the routes as one Fastify plugin, in which
  Fastify parses no body. It builds a standard `Request` from Fastify's (its
  body is the raw stream), calls `route.handle` with it, Fastify's decoded
  parameters and Fastify's request and reply, and lets Fastify send the
  `Response`. The plugin runs when Fastify gets ready, and registers the routes
  the adapter holds then: those of `link()`, and those mounted since. That is
  why a route is taken until Fastify is ready, and not after. With `around`, the
  handler of each route calls it around `route.handle`, and the plugin sets a
  not-found handler that calls it around a `404`.
- **Sockets** (`web/socket.ts`). `@Ws` writes the record of `@Get`, with
  `socket: true`, and each event decorator writes its event under a key of its
  own (`Symbol.for("chojs.web.ws")`). When the graph is built, the rules of one
  socket for a controller are checked, and the event methods are bound to the
  controller. When the routes are compiled, the chain of such a route ends by
  recording the upgrade for its `Request`, in a `WeakMap`, and answering `426`.
  `app.upgrade` and `app.handler` take the record when the route has answered,
  if the answer is still a `426`. `accept` then makes one connection: a queue
  that runs an event at once when none waits and after the one before it
  otherwise, sends what the methods return, and closes the socket for an error.
  The application keeps its open connections, to close them with `1001`.
- **Who upgrades.** On Deno and on Workers, `upgrade_here` (`web/socket.ts`)
  makes the response that upgrades, and gives the events of the standard
  `WebSocket` to the connection. On Bun, `serve` gives `Bun.serve` one set of
  callbacks, which find the connection in the data of each socket. On Node.js,
  `serve` listens to the `'upgrade'` event, and speaks the protocol itself
  (`web/ws-protocol.ts`): the handshake, a reader that joins fragments and
  checks what a client may send, and a writer of frames. That module works on
  bytes and uses nothing of Node.js, so its tests run on every runtime.
- **Testing without an adapter.** `web/testing.ts` (not published) has a linker
  that matches requests itself, mounted routes included; the tests of
  `@chojs/web` use it.
