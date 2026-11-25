# @chojs/vendor-hono

| Field    | Value                                                  |
| -------- | ------------------------------------------------------ |
| Package  | `@chojs/vendor-hono`                                   |
| Title    | The Hono Adapter of `@chojs/web`                       |
| Status   | Stable                                                 |
| Requires | `@chojs/web`; [Hono](https://hono.dev) 4               |
| Guide    | [README](./README.md)                                  |
| See also | [The web specification](../../web/specs.md), section 7 |

## Abstract

This document specifies `@chojs/vendor-hono`, the package that runs a
`@chojs/web` application on Hono. It defines the linker and the linked
application, how a route is registered and called, how a request is matched,
what is left to Hono, and `fromHono`, the function that makes a Hono middleware
a CHO middleware.

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
5. [Registering a Route](#5-registering-a-route)
6. [Matching](#6-matching)
7. [What Is Left to Hono](#7-what-is-left-to-hono)
8. [Hono Middlewares: `fromHono`](#8-hono-middlewares-fromhono)
9. [Event Streams and WebSockets](#9-event-streams-and-websockets)
10. [Public API](#10-public-api)
11. [Errors](#11-errors)
12. [Runtime Considerations](#12-runtime-considerations)
13. [Security Considerations](#13-security-considerations)
14. [References](#14-references)

- [Appendix A. Rationale](#appendix-a-rationale)
- [Appendix B. Not in This Version](#appendix-b-not-in-this-version)

## 1. Introduction

`@chojs/web` builds every route of an application as one function, which runs
the middlewares of the route, its handler and its error handler. It does not
match requests: a linker does. The linker of this package registers each route
on a Hono application, and Hono decides which route a request reaches.

```ts
import { ChoWeb } from "@chojs/web";
import { HonoLinker } from "@chojs/vendor-hono";

const app = await ChoWeb.create(AppModule, { linker: new HonoLinker() });
Deno.serve(app.handler);
```

### 1.1 Requirements Language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this
document are to be interpreted as described in BCP 14 [RFC2119] [RFC8174] when,
and only when, they appear in all capitals, as shown here.

### 1.2 Terminology

| Term              | Meaning                                                                                             |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| Adapter           | This package                                                                                        |
| Application       | A `ChoWeb` application that was created with a `HonoLinker`                                         |
| Hono application  | The `Hono` object the routes are registered on                                                      |
| Hono context      | The `Context` Hono makes for a request                                                              |
| Route             | A `Route` of `@chojs/web/linker`: `method`, `path`, `name`, `handle` and, for a WebSocket, `socket` |
| Chain             | What `Route.handle` runs: the middlewares of the route, its handler and its error handler           |
| Declaration order | The order of the routes in the list `link()` receives                                               |
| Mounted route     | A route registered after `link()`, with `mount()`: what `app.mount` of `ChoWeb` calls               |

## 2. Division of Work

The adapter matches requests to routes, and does nothing else.

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

`HonoLinker` implements `Linker<Hono>` of `@chojs/web/linker`.

### 3.1 Construction

```ts
new HonoLinker(hono?: Hono)
```

- Without an argument, the linker MUST create a new Hono application, with the
  defaults of Hono.
- With a Hono application, the linker MUST use it, and MUST NOT change it other
  than by registering the routes of the application.
- What the given Hono application already has (its middlewares, its `onError`
  and its `notFound`) stays. The routes are registered after it, so a middleware
  of the Hono application wraps every route.

Construction registers nothing.

### 3.2 `link(routes)`

`link(routes)` registers the routes, and returns a `HonoLinked` (section 4).

- A linker serves one application. A second call of `link()` on the same linker
  MUST throw `CHO_HONO_ALREADY_LINKED`, and MUST NOT register a route.
- The routes whose method is `HEAD` MUST be registered first, in declaration
  order. The other routes MUST be registered after them, in declaration order
  (section 5.3 says why).
- `link()` MUST be synchronous, and MUST NOT do any I/O.

## 4. The Linked Application

`HonoLinked` implements `Linked<Hono>`. It is what `app.linked` of a `ChoWeb`
application holds.

| Member         | Is                                                           |
| -------------- | ------------------------------------------------------------ |
| `instance`     | The Hono application                                         |
| `handler`      | The `fetch` of the Hono application: `(Request) => Response` |
| `mount(route)` | Registers one more route (section 4.1)                       |

`handler` MUST be the `fetch` function of the Hono application itself: a request
given to `app.handler` goes through everything the Hono application has.

### 4.1 `mount(route)`

`mount(route)` registers a route as section 5 says, after the routes the Hono
application already has.

- `mount()` MUST be synchronous.
- A mounted route MUST behave as a route given to `link()`: the same call, the
  same answer to a `HEAD` request, and the same Hono context.
- Hono takes routes until it answers its first request. After that, Hono throws
  an error of its own when a route is added. The adapter MUST NOT catch that
  error, and MUST NOT replace it: it is not a `ChoError`.

An application SHOULD mount its routes before it serves its first request.

## 5. Registering a Route

### 5.1 Method and Path

- A route MUST be registered with its method as it is given. The adapter MUST
  NOT refuse a method.
- A route MUST be registered with its path as it is given. A path of
  `@chojs/web` is `/`-separated segments, where a segment that starts with `:`
  is a parameter that matches one segment ([WEB], section 2.3). Hono reads that
  syntax as it is, so the adapter MUST NOT translate the path.

### 5.2 Calling the Route

When Hono gives a request to a route, the adapter MUST call
`Route.handle(request, params, native)` with:

| Argument  | Value                                                |
| --------- | ---------------------------------------------------- |
| `request` | The `Request` Hono received: `c.req.raw`             |
| `params`  | The path parameters Hono decoded: `c.req.param()`    |
| `native`  | The Hono context. A handler reads it as `ctx.native` |

- `request` MUST be the object Hono received, and not a copy of it. A route that
  upgrades to a WebSocket is known by that object (section 9).
- The adapter MUST give Hono the `Response` the route resolved to, as it is. It
  MUST NOT change its status.
- The adapter MUST NOT catch a rejection of `Route.handle` (section 7).

### 5.3 `HEAD` Requests

Hono answers a `HEAD` request by running the `GET` routes, and drops the body of
the answer. So the adapter registers a `HEAD` route as a `GET` route of Hono:

1. A route whose method is `HEAD` MUST be registered as a `GET` route of Hono
   that answers a request whose method is `HEAD`, and passes any other request
   on to the routes after it.
2. A route whose method is `GET` MUST answer a `HEAD` request with the `HEAD`
   route that has the same path, when there is one. Otherwise it answers the
   request itself, and Hono drops the body.

The result:

| Request | The path has       | Answered by                                 |
| ------- | ------------------ | ------------------------------------------- |
| `HEAD`  | A `HEAD` route     | The `HEAD` route                            |
| `HEAD`  | A `GET` route only | The `GET` route, without the body           |
| `GET`   | A `HEAD` route too | The `GET` route: the `HEAD` route passes it |

Rule 2 holds for a `HEAD` route that is mounted after the `GET` route of its
path: the `GET` route gives way to it. A `GET` route with **another** path that
matches the same request (`/users/:id` for `/users/me`) does not give way: it is
matched in order, as section 6 says. That is why `link()` registers the `HEAD`
routes first.

## 6. Matching

Hono decides which route a request reaches.

- Routes are matched in the order they were registered: the `HEAD` routes, then
  the other routes in declaration order, then the mounted routes in the order
  they were mounted. The first route that matches answers.
- A parameter route that is declared first (`:id`) also matches the static
  routes declared after it (`me`). An application SHOULD declare its static
  routes first: a route then means the same on every adapter.
- Hono percent-decodes the path parameters. A parameter that cannot be decoded
  (`/users/%`) is passed to the route **as it was sent**. The adapter MUST NOT
  answer `400` for it: the built-in router and the Fastify adapter do (section
  13.1).

## 7. What Is Left to Hono

The adapter adds no handler of its own to the Hono application.

| Event                         | Who answers                                                                              |
| ----------------------------- | ---------------------------------------------------------------------------------------- |
| No route matches the request  | `notFound` of the Hono application. Default of Hono: `404`                               |
| `Route.handle` rejects        | `onError` of the Hono application. Default of Hono: it logs the error, and answers `500` |
| A route throws an `HttpError` | The route: `Route.handle` resolves with its answer                                       |

`Route.handle` rejects when the route failed and no error handler of CHO
answered: no `@Catch` and no `onError` option of `ChoWeb.create`, or one that
returned nothing, or one that threw.

An application that wants another answer for the two first rows sets `notFound`
and `onError` on a Hono application, and gives it to the linker (section 3.1).

## 8. Hono Middlewares: `fromHono`

```ts
fromHono(middleware: MiddlewareHandler): ChoWebMiddlewareFn
```

A Hono middleware is written for the Hono context, and is not a CHO middleware.
`fromHono` makes it one, for `@Middlewares`: on a handler, a controller or a
feature module. The Hono middleware then runs at the place of the CHO middleware
in the chain.

### 8.1 The Hono Context

The middleware `fromHono` returns MUST run the Hono middleware with the Hono
context of the request, which it reads from `ctx.native`.

When `ctx.native` is not a Hono context, the application was created with
another linker. The middleware MUST then throw `CHO_HONO_WRONG_ADAPTER`, and
MUST NOT call `next()`: the request fails, and the error goes to the error
handlers of the route.

### 8.2 `next()`

The `next` function the Hono middleware receives MUST run the rest of the CHO
chain (the next middlewares, then the handler), and MUST set `c.res` to the
response of that chain.

Hono merges what the middleware had set on the context before (`c.header()`)
into that response. The headers of the response of the chain are kept,
`Set-Cookie` included. After `next()`, the Hono middleware can read `c.res`, and
change or replace it, as it does in Hono.

An error of the rest of the chain rejects `next()`.

### 8.3 Outcome

| The Hono middleware                                                                       | The CHO middleware                                           |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Returns a `Response`                                                                      | Answers with it                                              |
| Returns nothing, and the context has a response (`next()` was called, or `c.res` was set) | Answers with `c.res`                                         |
| Returns nothing, and the context has no response                                          | Returns nothing: the request fails ([WEB], section 4)        |
| Throws a value that has a `getResponse` method (an `HTTPException`)                       | Answers with what `getResponse()` returns, as Hono does      |
| Throws anything else                                                                      | Throws it: the error goes to the error handlers of the route |

An `HTTPException` is a response, and not a failure: the adapter MUST NOT give
it to an error handler.

### 8.4 Giving the Context Back

When the Hono middleware is done, whatever its outcome, the adapter MUST give
the Hono context back with no response: `c.res` is `undefined`, and
`c.finalized` is `false`.

The response of the request is the one the CHO chain returns to Hono. Hono
ignores it when the context already has a response, so a context that kept one
would answer with it. For the same reason, what a Hono middleware threw MUST NOT
stay on the context for a later request.

### 8.5 Scope

A middleware made with `fromHono` runs for the requests that match a route it is
declared on, as any middleware of `@Middlewares`. It never runs for a request no
route matches.

A middleware that has to cover every request, unmatched ones included, MUST be
added to the Hono application given to the linker (`hono.use(cors())`), and not
declared with `fromHono`. The preflight requests of CORS are the usual case:
they are sent to paths that have no `OPTIONS` route.

## 9. Event Streams and WebSockets

**An event stream** (`@Sse`) is a `Response` with a body that is a stream. The
adapter gives it to Hono as any response. The server that runs `app.handler`
sends the events as they come.

**A WebSocket** (`@Ws`) is a `GET` route (`socket: true`). The adapter registers
it as any `GET` route, and does nothing more. `@chojs/web` upgrades the
connection, not Hono: `app.handler` on Deno and on Cloudflare Workers, and
`serve(app)` on Bun and on Node.js ([WEB], section 3.5). Two rules of section
5.2 make that work:

- the route receives the `Request` Hono received, not a copy;
- the answer of the route goes out with its status.

The middlewares of the Hono application run for such a request too, and what
they add to the answer goes out with it.

## 10. Public API

The package has one entry point, `@chojs/vendor-hono`.

| Export             | Kind     | Section |
| ------------------ | -------- | ------- |
| `HonoLinker`       | class    | 3       |
| `HonoLinked`       | class    | 4       |
| `fromHono`         | function | 8       |
| `ChoHonoErrorCode` | type     | 11      |

The package also exports, as types, what its API refers to in `@chojs/web`:
`ChoWebContext`, `ChoWebMiddlewareFn`, `ChoWebNext`, `Linked`, `Linker` and
`Route`. The types of Hono (`Hono`, `Context`, `MiddlewareHandler`) are imported
from `hono`.

## 11. Errors

A mistake the adapter finds is a `ChoError`: an `Error` with a stable `code`,
recognized with `isChoError(error, code)`. A code that was released MUST NOT be
renamed, and MUST NOT be used for another mistake. A message is for a person,
and MAY change.

| Code                      | Thrown by                    | When                                               |
| ------------------------- | ---------------------------- | -------------------------------------------------- |
| `CHO_HONO_ALREADY_LINKED` | `HonoLinker.link()`          | It was already called on that linker (section 3.2) |
| `CHO_HONO_WRONG_ADAPTER`  | A middleware of `fromHono()` | `ctx.native` is not a Hono context (section 8.1)   |

The messages:

| Code                      | Message                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------- |
| `CHO_HONO_ALREADY_LINKED` | `HonoLinker.link() was already called: use one linker for one application`                              |
| `CHO_HONO_WRONG_ADAPTER`  | `fromHono(): a Hono middleware runs on the Hono adapter only: create the application with a HonoLinker` |

`CHO_HONO_ALREADY_LINKED` is thrown when the application is created.
`CHO_HONO_WRONG_ADAPTER` is thrown while a request is answered.

Errors that are not of the adapter stay what they are: the error of Hono for a
route mounted too late (section 4.1), and what a Hono middleware throws (section
8.3).

## 12. Runtime Considerations

The adapter uses nothing of a runtime: it runs where Hono does. Its tests run on
Deno, on Node.js, on Bun and on Cloudflare Workers.

The range of versions of Hono the package depends on is in its `deno.json`.

On Cloudflare Workers, the Hono context has the bindings and the execution
context of the Worker: `(ctx.native as Context).env` and
`(ctx.native as Context).executionCtx`.

## 13. Security Considerations

### 13.1 Path Parameters That Cannot Be Decoded

A parameter that cannot be percent-decoded reaches the handler as it was sent
(section 6). A handler MUST NOT take a path parameter for a decoded, valid
value. An application SHOULD validate its parameters ([WEB], section 3.2), which
it should do on every adapter.

### 13.2 A Middleware of Another Adapter

A middleware made with `fromHono` often protects a route (`basicAuth()`,
`bearerAuth()`, `jwt()`). On an application created with another linker, it
fails the request (section 8.1): the handler does not run. It fails closed, and
this document requires it.

### 13.3 Requests No Route Matches

A middleware declared with `@Middlewares` does not run for a request no route
matches (section 8.5). What must be on every answer (CORS headers, security
headers) or must see every request (a log, a rate limit) SHOULD be on the Hono
application given to the linker.

### 13.4 Errors and Logs

A route that rejects is answered by `onError` of the Hono application. The
default of Hono writes the error to the console, and answers `500` with no
detail of it. An application that sets its own `onError` SHOULD NOT put the
message or the stack of an error in the answer.

### 13.5 The Hono Context in a Handler

`ctx.native` is the whole Hono context: a handler that uses it can do what Hono
allows, the bindings of a Worker included. Such a handler runs on this adapter
only.

## 14. References

### 14.1 Normative References

- **[RFC2119]** Bradner, S., "Key words for use in RFCs to Indicate Requirement
  Levels", BCP 14, RFC 2119, March 1997.
- **[RFC8174]** Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key
  Words", BCP 14, RFC 8174, May 2017.
- **[WEB]** [The specification of `@chojs/web`](../../web/specs.md): section 2.3
  (route rules), section 3.5 (WebSockets), section 4 (middlewares), section 5
  (error handlers) and section 7 (runtime adapters).

### 14.2 Informative References

- **[README]** [The guide of the package](./README.md).
- **[HONO]** [The documentation of Hono](https://hono.dev/docs).
- **[RFC9110]** Fielding, R., Ed., Nottingham, M., Ed., and J. Reschke, Ed.,
  "HTTP Semantics", STD 97, RFC 9110, June 2022: section 9.3.2, the `HEAD`
  method.

## Appendix A. Rationale

This appendix is not normative. It says why some rules are what they are.

| Rule                                             | Why                                                                                                                          |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| The adapter only matches (section 2)             | Middlewares, error handling and the conversion of results stay the same on every adapter                                     |
| One linker, one application (section 3.2)        | A second application would add its routes to the Hono application of the first                                               |
| A `HEAD` route is a `GET` route of Hono (5.3)    | Hono answers a `HEAD` request by running its `GET` routes: a route registered for `HEAD` would not be reached                |
| The `HEAD` routes are registered first (3.2)     | A `GET` route with another path, declared before, would answer a `HEAD` request that a `HEAD` route is declared for          |
| The `Request` of Hono, not a copy (5.2)          | `@chojs/web` knows an accepted WebSocket upgrade by that object                                                              |
| An undecodable parameter is passed as sent (6)   | It is what Hono does, and the adapter adds no check of its own between Hono and the route                                    |
| The context is given back with no response (8.4) | Hono ignores the response a route returns when the context has one                                                           |
| An `HTTPException` is a response (8.3)           | It is how a Hono middleware refuses a request: a `401` of `basicAuth()` is an answer, and no error handler should replace it |
| An exception is known by `getResponse` (8.3)     | The adapter needs nothing of `hono/http-exception`, and an exception of another copy of Hono is recognized too               |

## Appendix B. Not in This Version

This appendix is not normative.

- **The route patterns of Hono.** A path of `@chojs/web` has parameters and
  nothing else: no wildcard, no optional segment and no regular expression
  ([WEB], section 2.3). Such a route is added to the Hono application itself.
- **A `400` for a parameter that cannot be decoded**, as on the other adapters
  (section 6).
- **The WebSocket helpers of Hono.** `@chojs/web` upgrades the connection
  (section 9).
- **Mounting a route after the first request** (section 4.1).
