# @chojs/vendor-fastify

| Field    | Value                                                   |
| -------- | ------------------------------------------------------- |
| Package  | `@chojs/vendor-fastify`                                 |
| Title    | The Fastify Adapter of `@chojs/web`                     |
| Status   | Stable                                                  |
| Requires | `@chojs/web`; [Fastify](https://fastify.dev) 5; Node.js |
| Guide    | [README](./README.md)                                   |
| See also | [The web specification](../../web/specs.md), section 7  |

## Abstract

This document specifies `@chojs/vendor-fastify`, the package that runs a
`@chojs/web` application on Fastify, on Node.js. It defines the linker and the
linked application, the plugin that holds the routes, how a Fastify request
becomes a standard `Request` and how a `Response` is sent, how a request is
matched, what is left to Fastify, and `fromFastify`, the function that makes a
Fastify hook a CHO middleware.

## Status of This Document

This document is the specification of the package. Where the code and this
document disagree, one of the two has a bug.

The contract that every web adapter implements (`Linker`, `Linked`, `Route`) is
defined by section 7 of the web specification [WEB]. This document does not
repeat it: it says what this adapter decides. Where the two documents disagree
about the contract, [WEB] governs.

The appendices are not normative.

## Table of Contents

1. [Introduction](#1-introduction)
2. [Division of Work](#2-division-of-work)
3. [The Linker](#3-the-linker)
4. [The Linked Application](#4-the-linked-application)
5. [The Plugin of the Routes](#5-the-plugin-of-the-routes)
6. [Registering a Route](#6-registering-a-route)
7. [Answering a Request](#7-answering-a-request)
8. [Matching](#8-matching)
9. [What Is Left to Fastify](#9-what-is-left-to-fastify)
10. [The `fetch`-Style Handler](#10-the-fetch-style-handler)
11. [Fastify Hooks: `fromFastify`](#11-fastify-hooks-fromfastify)
12. [Event Streams and WebSockets](#12-event-streams-and-websockets)
13. [Closing](#13-closing)
14. [Public API](#14-public-api)
15. [Errors](#15-errors)
16. [Runtime Considerations](#16-runtime-considerations)
17. [Security Considerations](#17-security-considerations)
18. [References](#18-references)

- [Appendix A. Rationale](#appendix-a-rationale)
- [Appendix B. Not in This Version](#appendix-b-not-in-this-version)

## 1. Introduction

`@chojs/web` builds every route of an application as one function, which runs
the middlewares of the route, its handler and its error handler. It does not
match requests: a linker does. The linker of this package registers each route
on a Fastify application. Fastify decides which route a request reaches, and
holds the server.

```ts
import { ChoWeb } from "@chojs/web";
import { FastifyLinker } from "@chojs/vendor-fastify";

const app = await ChoWeb.create(AppModule, { linker: new FastifyLinker() });
await app.linked.instance.listen({ port: 3000 });
```

Fastify does not work on the standard `Request` and `Response`, as `@chojs/web`
does. So this adapter has one more task than the others: it makes a `Request` of
a Fastify request, and gives Fastify a `Response` to send.

### 1.1 Requirements Language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this
document are to be interpreted as described in BCP 14 [RFC2119] [RFC8174] when,
and only when, they appear in all capitals, as shown here.

### 1.2 Terminology

| Term                | Meaning                                                                                             |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Adapter             | This package                                                                                        |
| Application         | A `ChoWeb` application that was created with a `FastifyLinker`                                      |
| Fastify application | The `FastifyInstance` the routes are registered on                                                  |
| Request, reply      | The `FastifyRequest` and the `FastifyReply` of a request                                            |
| Route               | A `Route` of `@chojs/web/linker`: `method`, `path`, `name`, `handle` and, for a WebSocket, `socket` |
| Chain               | What `Route.handle` runs: the middlewares of the route, its handler and its error handler           |
| Declaration order   | The order of the routes in the list `link()` receives                                               |
| Mounted route       | A route registered after `link()`, with `mount()`: what `app.mount` of `ChoWeb` calls               |
| Ready               | The Fastify application has loaded its plugins: after `ready()`, `listen()` or a first `inject()`   |
| Hook                | A function of the request phase of Fastify: `(request, reply, done)` (section 11)                   |

## 2. Division of Work

The adapter matches requests to routes, and converts between the request and
reply of Fastify and the standard `Request` and `Response`. It does nothing
else.

- The adapter MUST register every route it is given, with the method and the
  full path of the route.
- The adapter MUST answer a request that matches a route with what
  `Route.handle` resolves to.
- The adapter MUST NOT run a middleware, convert a result, or handle the error
  of a route. Those belong to `@chojs/web`, so they are the same on every
  adapter.
- The adapter MUST NOT do anything for an `HttpError` of `@chojs/web`: the route
  answers it, and resolves.

## 3. The Linker

`FastifyLinker` implements `Linker<FastifyInstance>` of `@chojs/web/linker`.

### 3.1 Construction

```ts
new FastifyLinker(fastify?: FastifyInstance)
```

- Without an argument, the linker MUST create a new Fastify application, with
  the default options of Fastify.
- With a Fastify application, the linker MUST use it. What it already has (its
  options, its plugins, its hooks, its error handler and its not-found handler)
  stays, and applies to every route of the application.

Construction registers nothing.

### 3.2 `link(routes)`

`link(routes)` returns a `FastifyLinked` (section 4), and mounts each route on
it, in declaration order (section 4.2).

- A linker serves one application. A second call of `link()` on the same linker
  MUST throw `CHO_FASTIFY_ALREADY_LINKED`, and MUST NOT register a route.
- `link()` MUST be synchronous, and MUST NOT do any I/O. It does not make the
  Fastify application ready.

## 4. The Linked Application

`FastifyLinked` implements `Linked<FastifyInstance>`. It is what `app.linked` of
a `ChoWeb` application holds.

| Member         | Is                                                                 |
| -------------- | ------------------------------------------------------------------ |
| `instance`     | The Fastify application                                            |
| `handler`      | A `fetch`-style function, through `inject()` (section 10)          |
| `mount(route)` | Takes one more route, until the application is ready (section 4.2) |

### 4.1 Serving

An application is served by Fastify: `instance.listen()`. `handler` is for
tests, and for code that needs a `fetch`-style function (section 10). It SHOULD
NOT serve real traffic.

### 4.2 `mount(route)`

`mount(route)` takes a route. The checks are made in this order:

1. A route that upgrades its request to a WebSocket (`socket: true`) MUST be
   refused with `CHO_FASTIFY_NO_SOCKET` (section 12).
2. Once the plugin of the routes was loaded (section 5), the route MUST be
   refused with `CHO_FASTIFY_MOUNT_TOO_LATE`.
3. Otherwise the route is kept, to be registered when the plugin is loaded.

- `mount()` MUST be synchronous.
- A mounted route MUST behave as a route given to `link()`: the same call, the
  same answer to a `HEAD` request, and the same `ctx.native`.
- The first route that is taken gives the plugin of the routes to Fastify
  (section 5). When that happens on a Fastify application that is ready, Fastify
  throws an error of its own. The adapter MUST NOT catch that error: it is not a
  `ChoError`. It is the case of a linker that was given no route, and whose
  first route is mounted late.

An application SHOULD mount its routes before `listen()`, `ready()` and the
first call of `handler`.

## 5. The Plugin of the Routes

The routes are registered in one Fastify plugin, so that what the adapter sets
for them does not reach the rest of the Fastify application.

- The plugin MUST be given to Fastify once, when the first route is taken.
- Fastify loads the plugin when it gets ready. The plugin MUST then register
  every route that was taken until that moment, in the order they were taken.
- Inside the plugin, Fastify MUST NOT parse the body of a request: every content
  type parser is removed, and one parser takes every content type and reads
  nothing. The body stays a stream, for the `Request` (section 7.1).
- What is set inside the plugin MUST NOT apply outside it. A route the
  application adds to the Fastify application itself keeps the body parsing of
  Fastify.

Until the plugin is loaded, the Fastify application has no route of the
application. `listen()`, `ready()` and `handler` wait for it.

## 6. Registering a Route

### 6.1 Method

A route MUST be registered with its method as it is given.

### 6.2 Path

A path of `@chojs/web` is `/`-separated segments, where a segment that starts
with `:` is a parameter that matches one segment ([WEB], section 2.3). The
router of Fastify also reads a `:` inside a segment as the start of a parameter.
So the adapter MUST translate a path:

- a segment that starts with `:` is left as it is;
- in any other segment, every `:` is written `::`, which the router of Fastify
  matches as one literal `:`.

Every other character of a path MUST be matched literally.

### 6.3 `HEAD` Requests

Fastify can add a `HEAD` route to every `GET` route. The adapter MUST turn that
off for its routes (`exposeHeadRoute: false`), and register its own:

| The path has       | Registered                                                        |
| ------------------ | ----------------------------------------------------------------- |
| A `HEAD` route     | The `HEAD` route, as any route                                    |
| A `GET` route only | The `GET` route, and a `HEAD` route that answers without the body |

The result:

| Request | The path has       | Answered by                       |
| ------- | ------------------ | --------------------------------- |
| `HEAD`  | A `HEAD` route     | The `HEAD` route                  |
| `HEAD`  | A `GET` route only | The `GET` route, without the body |

"The path has a `HEAD` route" is decided when the plugin is loaded, from every
route that was taken: where the routes are declared, or mounted, does not count.

## 7. Answering a Request

When Fastify gives a request to a route, the adapter does four things, in this
order.

### 7.1 An Empty Parameter

The router of Fastify matches a parameter that is empty (`/users/` for
`/users/:id`). A parameter of `@chojs/web` is one segment, and never an empty
one. So when a path parameter of the match is the empty string, the adapter MUST
NOT call the route: it MUST answer as for a request no route matches (section
9).

### 7.2 The `Request`

The adapter MUST make a standard `Request` of the Fastify request:

| Part    | Value                                                                                 |
| ------- | ------------------------------------------------------------------------------------- |
| URL     | `<protocol>://<host><url>`, from `request.protocol`, `request.host` and `request.url` |
| Method  | `request.method`                                                                      |
| Headers | Every header of the request                                                           |
| Signal  | Aborted when the connection closes before the response was sent                       |
| Body    | The raw stream of the request, for every method but `GET` and `HEAD`                  |

- **Headers.** A header that was sent several times MUST be given once for each
  value. A name that starts with `:` is a pseudo-header of HTTP/2, and MUST be
  left out.
- **Signal.** `ctx.req.signal` MUST be aborted when the connection closes and
  the response is not fully written. It MUST NOT be aborted by the normal end of
  a response.
- **Body.** The body MUST be the stream of the connection, unread and unparsed:
  a handler reads it with `ctx.req.json()`, `ctx.req.text()`,
  `ctx.req.formData()`, or as a stream. A `GET` or a `HEAD` request has no body,
  whatever the client sent.

The `Request` is new for every request: it is not the object of Fastify.

### 7.3 Calling the Route

The adapter MUST call `Route.handle(request, params, native)` with:

| Argument  | Value                                                                                 |
| --------- | ------------------------------------------------------------------------------------- |
| `request` | The `Request` of section 7.2                                                          |
| `params`  | The path parameters Fastify decoded: `request.params`                                 |
| `native`  | `{ request, reply }` of Fastify (`FastifyNative`). A handler reads it as `ctx.native` |

The adapter MUST NOT catch a rejection of `Route.handle` (section 9).

### 7.4 Sending the `Response`

- When a hook answered the request (section 11.4), the response is the one
  Fastify sends: the adapter MUST NOT send the response of the route.
- Otherwise the adapter MUST give Fastify the `Response` the route resolved to:
  its status, its headers and its body. A body that is a stream is sent as it
  comes.
- A `HEAD` request that a `GET` route answers (section 6.3) MUST be sent with
  the status and the headers of the response, and no body.

## 8. Matching

The router of Fastify decides which route a request reaches.

- **A static path wins over a parameter**, wherever the two are declared or
  mounted: `me` wins over `:id`. The built-in router and the Hono adapter match
  in declaration order instead. An application SHOULD declare its static routes
  first: a route then means the same on every adapter.
- **Paths are matched as written.** The case of a path counts, and so does a
  trailing slash, unless the options of the Fastify application say otherwise.
- **A parameter matches one segment**, and never an empty one (section 7.1).
- **Path parameters are percent-decoded** by Fastify. A path that cannot be
  decoded is answered `400` by Fastify, and the route does not run.

## 9. What Is Left to Fastify

The adapter sets no error handler and no not-found handler.

| Event                         | Who answers                                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| No route matches the request  | The not-found handler of the Fastify application. Default: `404`                                                       |
| A path that cannot be decoded | Fastify: `400`                                                                                                         |
| `Route.handle` rejects        | The error handler of the Fastify application. Default: `500`, and the error is logged when the logger of Fastify is on |
| A route throws an `HttpError` | The route: `Route.handle` resolves with its answer                                                                     |

`Route.handle` rejects when the route failed and no error handler of CHO
answered: no `@Catch` and no `onError` option of `ChoWeb.create`, or one that
returned nothing, or one that threw.

An application that wants another answer sets `setNotFoundHandler` and
`setErrorHandler` on a Fastify application, and gives it to the linker (section
3.1).

## 10. The `fetch`-Style Handler

`handler` sends a `Request` through `inject()` of Fastify, with no network
connection, and resolves to a `Response`.

- The first call makes the Fastify application ready (section 5).
- The request is sent with its method, its URL, its headers and its body. The
  body MUST be read whole before it is sent.
- The response has the status, the status text and the headers of the answer of
  Fastify. A header with several values (`Set-Cookie`) MUST be given once for
  each value.
- The body of the response is the whole body of the answer. It MUST be `null`
  for a `HEAD` request, and for the statuses `101`, `204`, `205` and `304`.

Nothing is streamed through `handler`: neither the body of the request nor the
body of the response. A stream of events (`@Sse`) is collected until it ends, so
`handler` suits a stream that does end, and no other.

## 11. Fastify Hooks: `fromFastify`

```ts
fromFastify(hook: FastifyHook): ChoWebMiddlewareFn

type FastifyHook = (
  this: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  done: (error?: Error) => void,
) => unknown;
```

A hook of the request phase (`onRequest`, `preValidation`, `preHandler`) is what
many Fastify plugins give to protect a route: `fastify.basicAuth`,
`fastify.auth([...])`, `fastify.rateLimit()`, `fastify.csrfProtection`. It is
not a CHO middleware. `fromFastify` makes it one, for `@Middlewares`: on a
handler, a controller or a feature module. The hook then runs at the place of
the CHO middleware in the chain.

### 11.1 The Request and the Reply

The middleware `fromFastify` returns MUST run the hook with the request and the
reply of Fastify, which it reads from `ctx.native`.

When `ctx.native` is not `{ request, reply }` of Fastify, the application was
created with another linker. The middleware MUST then throw
`CHO_FASTIFY_WRONG_ADAPTER`, and MUST NOT call `next()`: the request fails, and
the error goes to the error handlers of the route.

### 11.2 Running the Hook

The hook MUST be called with the Fastify application of the route as `this`
(`request.server`), and with `(request, reply, done)`.

A hook has two styles, and the adapter MUST take both:

| Style    | The hook is done when                                                              |
| -------- | ---------------------------------------------------------------------------------- |
| Promise  | The promise it returned settles                                                    |
| Callback | It calls `done()`, or `done(error)`                                                |
| Either   | The response of the reply is closed: the hook answered, and never said it was done |

### 11.3 Outcome

| The hook                                                | The CHO middleware                                            |
| ------------------------------------------------------- | ------------------------------------------------------------- |
| Is done, and did not answer                             | Calls `next()`: the rest of the chain runs                    |
| Answered by itself (`reply.send()`, `reply.redirect()`) | Does not call `next()`: section 11.4                          |
| Throws, rejects, or calls `done(error)`                 | Throws that error: it goes to the error handlers of the route |
| Throws or rejects with nothing (`undefined`, `null`)    | Throws `CHO_FASTIFY_HOOK_FAILED`                              |

A hook **answered** when one of these holds, once it is done:

- its promise resolved to the reply (`return reply`, as in a Fastify handler);
- Fastify has sent, or is sending, the response of the reply;
- the response was closed before the hook said it was done.

An error a hook fails with is passed on as it is. When no error handler of CHO
answers it, it reaches the error handler of Fastify (section 9).

### 11.4 A Hook That Answers

When a hook answered:

- the rest of the chain MUST NOT run;
- the response of the request is the one Fastify sends. The adapter MUST NOT
  send another (section 7.4);
- the middleware MUST resolve to a `Response` with the status and the headers of
  the reply, and no body. It is what the CHO middlewares around the hook see.
  They cannot change the answer: what they do to that `Response` is dropped.

### 11.5 Limits

- **A hook is a step before the handler.** It cannot read or change the response
  of the handler. What does that, and a plugin that is not a hook
  (`@fastify/cors`, `@fastify/helmet`), MUST be registered on the Fastify
  application given to the linker.
- **`request.body` is not set in a hook.** Fastify parses no body for the routes
  of the application (section 5).
- **A middleware made with `fromFastify` runs for the requests that match a
  route it is declared on**, as any middleware of `@Middlewares`, and never for
  a request no route matches.

## 12. Event Streams and WebSockets

**An event stream** (`@Sse`) is a `Response` with a body that is a stream.
Served by `listen()`, the events are sent as they come. Through `handler`, the
stream is collected until it ends (section 10).

**A WebSocket** (`@Ws`) is not upgraded. Fastify holds the server, so
`serve(app)` of `@chojs/web/serve` cannot upgrade the connection, and this
adapter does not do it either. A route with `socket: true` MUST be refused when
it is registered, with `CHO_FASTIFY_NO_SOCKET`: an application with a `@Ws`
handler fails when it is created, and not on its first connection, which would
be answered `426`.

## 13. Closing

`ChoWeb.close()` does not close the Fastify application. An application SHOULD
close Fastify first, so that no request is running, and then itself:

```ts
await fastify.close();
await app.close();
```

## 14. Public API

The package has one entry point, `@chojs/vendor-fastify`.

| Export                | Kind     | Section |
| --------------------- | -------- | ------- |
| `FastifyLinker`       | class    | 3       |
| `FastifyLinked`       | class    | 4       |
| `FastifyNative`       | type     | 7.3     |
| `fromFastify`         | function | 11      |
| `FastifyHook`         | type     | 11      |
| `ChoFastifyErrorCode` | type     | 15      |

The package also exports, as types, what its API refers to in `@chojs/web`:
`ChoWebContext`, `ChoWebMiddlewareFn`, `ChoWebNext`, `Linked`, `Linker` and
`Route`. The types of Fastify (`FastifyInstance`, `FastifyRequest`,
`FastifyReply`) are imported from `fastify`.

## 15. Errors

A mistake the adapter finds is a `ChoError`: an `Error` with a stable `code`,
recognized with `isChoError(error, code)`. A code that was released MUST NOT be
renamed, and MUST NOT be used for another mistake. A message is for a person,
and MAY change.

| Code                         | Thrown by                       | When                                                                |
| ---------------------------- | ------------------------------- | ------------------------------------------------------------------- |
| `CHO_FASTIFY_ALREADY_LINKED` | `FastifyLinker.link()`          | It was already called on that linker (section 3.2)                  |
| `CHO_FASTIFY_NO_SOCKET`      | `link()`, `mount()`             | A route upgrades its request to a WebSocket (section 12)            |
| `CHO_FASTIFY_MOUNT_TOO_LATE` | `FastifyLinked.mount()`         | The plugin of the routes was loaded (section 4.2)                   |
| `CHO_FASTIFY_WRONG_ADAPTER`  | A middleware of `fromFastify()` | `ctx.native` is not the request and reply of Fastify (section 11.1) |
| `CHO_FASTIFY_HOOK_FAILED`    | A middleware of `fromFastify()` | A hook threw or rejected with nothing (section 11.3)                |

The messages:

| Code                         | Message                                                                                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CHO_FASTIFY_ALREADY_LINKED` | `FastifyLinker.link() was already called: use one linker for one application`                                                                             |
| `CHO_FASTIFY_NO_SOCKET`      | `FastifyLinker cannot register <name> (<method> <path>): the route upgrades its request to a WebSocket, and this adapter does not upgrade connections. …` |
| `CHO_FASTIFY_MOUNT_TOO_LATE` | `FastifyLinked.mount(): cannot add <method> <path>: the Fastify application is ready. Mount routes before listen(), ready() and the first request`        |
| `CHO_FASTIFY_WRONG_ADAPTER`  | `fromFastify(): a Fastify hook runs on the Fastify adapter only: create the application with a FastifyLinker`                                             |
| `CHO_FASTIFY_HOOK_FAILED`    | `the hook threw`, or `the hook rejected`                                                                                                                  |

The three first are thrown when routes are registered: `ALREADY_LINKED` and
`NO_SOCKET` when the application is created, `NO_SOCKET` and `MOUNT_TOO_LATE` by
`app.mount`. The two last are thrown while a request is answered, and go to the
error handlers of the route.

Errors that are not of the adapter stay what they are: the error of Fastify for
a plugin given to an application that is ready (section 4.2), and what a hook
fails with (section 11.3).

## 16. Runtime Considerations

**Node.js only.** Fastify is built on the HTTP server of Node.js, and the
adapter uses `node:buffer` and `node:stream`. Its tests run on Node.js alone. On
Deno, on Bun and on an edge runtime, an application uses the built-in router of
`@chojs/web`, or `@chojs/vendor-hono`.

The range of versions of Fastify the package depends on is in its `deno.json`.
The adapter gives Fastify a `Response` to send, which Fastify 5 takes.

## 17. Security Considerations

### 17.1 The Body Limit of Fastify Does Not Apply

Fastify limits the size of a body where it reads one (`bodyLimit`, 1 MiB by
default). It reads no body for the routes of the application (section 5), so
**that limit does not protect them**: a handler that reads the body reads all of
it, whatever its size and whatever `bodyLimit` says.

An application that takes bodies SHOULD limit them itself: `bodyLimit()` of
`@chojs/vendor-cho`, declared with `@Middlewares`, counts the bytes of the
`Request` on this adapter as on the others.

### 17.2 The URL of the `Request`

The URL of `ctx.req` is made of the protocol and the host Fastify reports
(section 7.2). The host comes from a header the client sends. With the
`trustProxy` option of Fastify, both come from the `X-Forwarded-*` headers. An
application MUST NOT take the origin of `ctx.url` for a fact about who it is
talking to, unless the proxy in front of it sets those headers.

### 17.3 A Hook of Another Adapter

A hook often protects a route. On an application created with another linker, a
middleware made with `fromFastify` fails the request (section 11.1): the handler
does not run. It fails closed, and this document requires it.

### 17.4 The Answer of a Hook Is Not Wrapped

When a hook answers (a `401`, a `429`), the CHO middlewares around it cannot
change the answer (section 11.4). A CHO middleware that adds security headers or
CORS headers does not add them to that answer. What must be on every answer
SHOULD be registered on the Fastify application given to the linker.

### 17.5 Requests No Route Matches

A middleware declared with `@Middlewares` does not run for a request no route
matches, nor for the `400` Fastify answers to a path it cannot decode. What must
see every request (a log, a rate limit) SHOULD be on the Fastify application.

### 17.6 `handler` Keeps Whole Bodies in Memory

`handler` reads the body of a request whole, and collects the body of a response
whole (section 10). It has no limit. It SHOULD NOT be exposed to requests an
application does not control.

### 17.7 Errors and Logs

A route that rejects is answered by the error handler of Fastify. An application
that sets its own SHOULD NOT put the message or the stack of an error in the
answer.

## 18. References

### 18.1 Normative References

- **[RFC2119]** Bradner, S., "Key words for use in RFCs to Indicate Requirement
  Levels", BCP 14, RFC 2119, March 1997.
- **[RFC8174]** Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key
  Words", BCP 14, RFC 8174, May 2017.
- **[WEB]** [The specification of `@chojs/web`](../../web/specs.md): section 2.3
  (route rules), section 3.4 (server-sent events), section 3.5 (WebSockets),
  section 4 (middlewares), section 5 (error handlers) and section 7 (runtime
  adapters).

### 18.2 Informative References

- **[README]** [The guide of the package](./README.md).
- **[FASTIFY]**
  [The documentation of Fastify](https://fastify.dev/docs/latest/): routes,
  hooks, plugins and encapsulation, content type parsers, `inject()`.
- **[RFC9110]** Fielding, R., Ed., Nottingham, M., Ed., and J. Reschke, Ed.,
  "HTTP Semantics", STD 97, RFC 9110, June 2022: section 9.3.2, the `HEAD`
  method; section 6.4.1, the responses that have no content.

## Appendix A. Rationale

This appendix is not normative. It says why some rules are what they are.

| Rule                                               | Why                                                                                                               |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| The adapter only matches and converts (section 2)  | Middlewares, error handling and the conversion of results stay the same on every adapter                          |
| One linker, one application (3.2)                  | A second application would add its routes to the Fastify application of the first                                 |
| The routes are in a plugin (5)                     | What is set for them (no body parsing) stays there: the routes the application adds to Fastify itself keep theirs |
| Fastify parses no body (5)                         | A handler reads the body of a standard `Request`. A body Fastify had read could not be read again as a stream     |
| The `HEAD` routes of Fastify are turned off (6.3)  | They do not take a `Response`                                                                                     |
| `:` inside a segment is written `::` (6.2)         | A path means the same on every adapter: only a segment that starts with `:` is a parameter                        |
| An empty parameter is not a match (7.1)            | A parameter is one segment on every adapter                                                                       |
| A socket route is refused when registered (12)     | Otherwise the mistake would show at the first connection, as a `426`                                              |
| A route is taken until Fastify is ready (4.2)      | The routes are registered when the plugin is loaded: a route that comes after it has nowhere to go                |
| The end of the response says a hook is done (11.2) | A hook that answers in the callback style never calls `done`                                                      |
| The answer of a hook is the one of Fastify (11.4)  | Fastify is already sending it when the middleware knows the hook answered                                         |

## Appendix B. Not in This Version

This appendix is not normative.

- **WebSockets.** A `@Ws` route is refused (section 12). An adapter that holds
  the server upgrades its connections with `app.upgrade` of `ChoWeb` ([WEB],
  section 7): this one does not yet.
- **Deno, Bun and edge runtimes** (section 16).
- **A hook that changes the response of the handler**: `onSend`, `onResponse`
  and the other hooks that are not of the request phase (section 11.5).
- **The body parsing of Fastify**, and with it `request.body` and the body limit
  of Fastify, for the routes of the application (sections 5 and 17.1).
- **A streamed `handler`** (section 10).
- **Mounting a route once Fastify is ready** (section 4.2).
