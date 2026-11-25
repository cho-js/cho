# @chojs/vendor-cho

| Field    | Value                                                         |
| -------- | ------------------------------------------------------------- |
| Package  | `@chojs/vendor-cho`                                           |
| Title    | The Middlewares of the Built-In Router of `@chojs/web`        |
| Status   | Stable                                                        |
| Requires | `@chojs/web`                                                  |
| Guide    | [README](./README.md)                                         |
| See also | [The web specification](../../web/specs.md), sections 4 and 7 |

## Abstract

This document specifies `@chojs/vendor-cho`, the package of middlewares for a
`@chojs/web` application that runs on the built-in router. It defines the rules
every middleware of the package follows, and the behavior of each of the ten:
`cors`, `bodyLimit`, `secureHeaders`, `logger`, `timeout`, `requestId`, `etag`,
`basicAuth`, `bearerAuth` and `compress`.

## Status of This Document

This document is the specification of the package. Where the code and this
document disagree, one of the two has a bug.

What a middleware is, and where one runs, is defined by sections 4 and 7 of the
web specification [WEB]. This document does not repeat it. Where the two
documents disagree about middlewares in general, [WEB] governs.

The appendices are not normative.

## Table of Contents

1. [Introduction](#1-introduction)
2. [Rules of Every Middleware](#2-rules-of-every-middleware)
3. [`cors`](#3-cors)
4. [`bodyLimit`](#4-bodylimit)
5. [`secureHeaders`](#5-secureheaders)
6. [`logger`](#6-logger)
7. [`timeout`](#7-timeout)
8. [`requestId`](#8-requestid)
9. [`etag`](#9-etag)
10. [`basicAuth`](#10-basicauth)
11. [`bearerAuth`](#11-bearerauth)
12. [`compress`](#12-compress)
13. [Public API](#13-public-api)
14. [Errors](#14-errors)
15. [Runtime Considerations](#15-runtime-considerations)
16. [Security Considerations](#16-security-considerations)
17. [References](#17-references)

- [Appendix A. Rationale](#appendix-a-rationale)
- [Appendix B. Not in This Version](#appendix-b-not-in-this-version)

## 1. Introduction

The built-in router of `@chojs/web` has no HTTP library underneath, so nothing
brings the middlewares an application usually takes from one. This package has
them, written as CHO middlewares: functions `(ctx, next)` on the standard
`Request` and `Response`, with no dependency.

```ts
import { ChoLinker, ChoWeb } from "@chojs/web";
import { bodyLimit, cors, logger, secureHeaders } from "@chojs/vendor-cho";

const app = await ChoWeb.create(AppModule, {
  linker: new ChoLinker({
    middlewares: [
      logger(),
      cors({ origin: "https://example.com" }),
      secureHeaders(),
      bodyLimit({ maxSize: 1024 * 1024 }),
    ],
  }),
});
```

### 1.1 Requirements Language

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD",
"SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this
document are to be interpreted as described in BCP 14 [RFC2119] [RFC8174] when,
and only when, they appear in all capitals, as shown here.

### 1.2 Terminology

| Term              | Meaning                                                                                   |
| ----------------- | ----------------------------------------------------------------------------------------- |
| Middleware        | A function `(ctx, next)` of `@chojs/web`: a `ChoWebMiddlewareFn`                          |
| Factory           | A function of this package that makes a middleware from options: `cors(options)`          |
| Chain             | What `next()` runs: the middlewares after this one, then the handler                      |
| Response          | What `next()` resolved to, unless said otherwise                                          |
| Router middleware | A middleware given to `new ChoLinker({ middlewares })`: it runs for every request         |
| Route middleware  | A middleware declared with `@Middlewares`: it runs for the requests that match its routes |
| Event stream      | A response whose `Content-Type` is `text/event-stream`: what an `@Sse` handler answers    |
| Refuse            | Answer a request without running the chain, or in place of what the chain answered        |

## 2. Rules of Every Middleware

### 2.1 Factories

Every export of the package that is not a type or a constant is a factory: it
takes options, and returns a middleware.

- A factory MUST check its options when it is called, where this document names
  a check. An option that fails one MUST make the factory throw
  `CHO_VENDOR_INVALID_OPTION`, synchronously. No middleware is returned.
- A factory MUST NOT keep state between requests, other than its options.
- A middleware MUST use nothing but the standard `Request`, `Response`,
  `Headers`, streams and Web Crypto. The package has no dependency.

### 2.2 Where a Middleware Runs

A middleware of the package is a plain CHO middleware. It is a router middleware
or a route middleware, as [WEB] defines them:

- **On the router** (`new ChoLinker({ middlewares })`), it runs for every
  request, around the route that answers it, and around the answer to a request
  no route matches.
- **On routes** (`@Middlewares`), it runs for the requests that match them. That
  works on every adapter, the Hono and Fastify adapters included.

The first middleware of a list is the outermost.

### 2.3 Refusing a Request

A middleware that refuses a request (`401`, `413`, `504`) MUST do it by
resolving to a `Response`. It MUST NOT throw: no error handler is called for a
request the package refuses.

### 2.4 Changing the Headers of a Response

A middleware that adds a header to the response MUST change the headers of the
response itself when they can be changed. The headers of some responses cannot
(`Response.redirect()`, a response of `fetch`): the middleware MUST then answer
with a copy that has the same status and the same body, and the changed headers.

### 2.5 Event Streams

The body of an event stream has no end to wait for, and its events have to go
out as they come. A middleware MUST NOT read, buffer or transform the body of an
event stream. `etag` and `compress` pass such a response on as it is; the other
middlewares never read the body of a response.

### 2.6 WebSockets

A route that upgrades its request to a WebSocket (`@Ws`) passes through every
middleware of the package as any `GET` route: a middleware needs nothing for it,
and can refuse the request before the upgrade. What a middleware adds to the
answer goes out with the `101`, apart from the headers that describe a body
([WEB], section 3.5).

### 2.7 Options That Are Not Checked

Where this document names no check for an option, a factory does not check it.
The behavior of a middleware made with such an option of the wrong type is not
defined.

## 3. `cors`

```ts
cors(options?: CorsOptions): ChoWebMiddlewareFn
```

Cross-Origin Resource Sharing [FETCH]: it tells a browser which pages of other
origins may read the responses of the application.

### 3.1 Options

| Option           | Type                                              | Default                                         | Check                        |
| ---------------- | ------------------------------------------------- | ----------------------------------------------- | ---------------------------- |
| `origin`         | `"*"`, a string, a list of strings, or a function | `"*"`                                           | One of those four            |
| `methods`        | A list of strings                                 | `GET`, `HEAD`, `PUT`, `POST`, `DELETE`, `PATCH` | A list of strings            |
| `allowedHeaders` | A list of strings                                 | What the preflight request asks for             | A list of strings            |
| `exposedHeaders` | A list of strings                                 | None                                            | A list of strings            |
| `credentials`    | A boolean                                         | `false`                                         | A boolean                    |
| `maxAge`         | A number of seconds                               | Not sent                                        | A whole number, zero or more |

The function of `origin` is `(origin, ctx) => boolean | Promise<boolean>`.

### 3.2 The Allowed Origin

For a request, the **requested origin** is the value of its `Origin` header. The
**allowed origin** is the value of `Access-Control-Allow-Origin` for it, or
nothing:

| `origin` option   | The request has no `Origin` | The request has an `Origin`                                |
| ----------------- | --------------------------- | ---------------------------------------------------------- |
| `"*"`             | Nothing                     | `*`; with `credentials`, the requested origin              |
| A string          | Nothing                     | The requested origin, when it equals the string            |
| A list of strings | Nothing                     | The requested origin, when the list has it                 |
| A function        | Nothing: it is not called   | The requested origin, when the function resolves to `true` |

- Origins MUST be compared as strings, exactly: scheme, host and port, with no
  trailing slash.
- With `credentials`, the middleware MUST NOT answer `*`: it names the origin.

The answer **varies** when `origin` is not `"*"`, or `credentials` is `true`:
two requests can then get two answers.

### 3.3 A Preflight Request

A request is a preflight request when its method is `OPTIONS` and it has an
`Access-Control-Request-Method` header.

The middleware MUST answer a preflight request itself, with the status `204` and
no body, and MUST NOT call `next()`. The headers of the answer:

| Header                             | Sent when                                                                          | Value                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `Vary`                             | The answer varies                                                                  | `Origin`                                                                       |
| `Access-Control-Allow-Origin`      | There is an allowed origin                                                         | The allowed origin                                                             |
| `Access-Control-Allow-Credentials` | Allowed, and `credentials`                                                         | `true`                                                                         |
| `Access-Control-Allow-Methods`     | Allowed                                                                            | `methods`, joined with `,`                                                     |
| `Access-Control-Allow-Headers`     | Allowed, and `allowedHeaders` is given                                             | `allowedHeaders`, joined with `,`                                              |
| `Access-Control-Allow-Headers`     | Allowed, no `allowedHeaders`, and the request has `Access-Control-Request-Headers` | That header, as it was sent. `Vary` also gets `Access-Control-Request-Headers` |
| `Access-Control-Max-Age`           | Allowed, and `maxAge` is given                                                     | `maxAge`                                                                       |

A preflight request from an origin that is not allowed is answered `204` too,
with no `Access-Control-*` header.

An `OPTIONS` request that is not a preflight request is any other request
(section 3.4).

### 3.4 Any Other Request

The middleware MUST call `next()`, and add these headers to the response
(section 2.4):

| Header                             | Added when                                 | Value                               |
| ---------------------------------- | ------------------------------------------ | ----------------------------------- |
| `Vary`                             | The answer varies                          | `Origin`, appended to what is there |
| `Access-Control-Allow-Origin`      | There is an allowed origin                 | The allowed origin                  |
| `Access-Control-Allow-Credentials` | Allowed, and `credentials`                 | `true`                              |
| `Access-Control-Expose-Headers`    | Allowed, and `exposedHeaders` is not empty | `exposedHeaders`, joined with `,`   |

- The middleware MUST NOT refuse a request: a request from an origin that is not
  allowed runs, and its response has no `Access-Control-*` header. The browser
  is what keeps the response from the page (section 16.1).
- A request with no `Origin` header gets no `Access-Control-*` header. When the
  answer varies, its response still gets `Vary: Origin`, for the caches.
- When the answer does not vary and there is no allowed origin, the response
  MUST be passed on as it is.

### 3.5 Where It Goes

A browser sends a preflight request to the path of the real request, with the
method `OPTIONS`. As a route middleware, `cors` answers a preflight request only
where an `@Options` route exists. To answer the preflight requests of every
path, `cors` MUST be a router middleware.

## 4. `bodyLimit`

```ts
bodyLimit(options: BodyLimitOptions): ChoWebMiddlewareFn
```

It refuses a request whose body is larger than a limit. A server on the standard
`Request` has no limit of its own.

### 4.1 Options

| Option       | Type                                     | Default                                  | Check                        |
| ------------ | ---------------------------------------- | ---------------------------------------- | ---------------------------- |
| `maxSize`    | A number of bytes                        | None: it is required                     | A whole number, zero or more |
| `onExceeded` | `(ctx) => Response \| Promise<Response>` | `413`, with the text `Payload Too Large` | None                         |

The **refusal** is what `onExceeded` resolves to or, without it, the default.

### 4.2 Behavior

1. **A request with no body** (`ctx.req.body` is `null`): the middleware MUST
   call `next()`, and change nothing.
2. **A request that declares its size**: it has a `Content-Length` header, and
   no `Transfer-Encoding` header. When the declared size is over `maxSize`, the
   middleware MUST answer with the refusal, MUST NOT call `next()`, and MUST NOT
   read the body. Otherwise it MUST call `next()`, and change nothing.
3. **Any other request**: the body is counted while it is read (section 4.3).

### 4.3 A Counted Body

The middleware MUST replace `ctx.req` with a `Request` that has the same method,
URL and headers, and a body that counts the bytes it gives. What reads the body
after the middleware reads the counted one.

- The body MUST NOT be read ahead: bytes are taken from the connection when
  something reads them. A body nobody reads is not counted, and not refused.
- When the count passes `maxSize`, the middleware MUST stop reading the
  connection, and the read in progress MUST fail with a `ChoError` whose code is
  `CHO_VENDOR_BODY_TOO_LARGE`.
- Once the count has passed `maxSize`, the middleware MUST answer with the
  refusal, **whatever the chain did**: whether it resolved to a response (an
  error handler answered the failed read), or rejected.
- When the count did not pass `maxSize`, the middleware MUST pass on what the
  chain did: its response, or its error.

## 5. `secureHeaders`

```ts
secureHeaders(options?: SecureHeadersOptions): ChoWebMiddlewareFn
```

It adds the response headers browsers use to protect a site.

### 5.1 Defaults

| Header                              | Value                                 |
| ----------------------------------- | ------------------------------------- |
| `Cross-Origin-Opener-Policy`        | `same-origin`                         |
| `Cross-Origin-Resource-Policy`      | `same-origin`                         |
| `Origin-Agent-Cluster`              | `?1`                                  |
| `Referrer-Policy`                   | `no-referrer`                         |
| `Strict-Transport-Security`         | `max-age=15552000; includeSubDomains` |
| `X-Content-Type-Options`            | `nosniff`                             |
| `X-DNS-Prefetch-Control`            | `off`                                 |
| `X-Download-Options`                | `noopen`                              |
| `X-Frame-Options`                   | `SAMEORIGIN`                          |
| `X-Permitted-Cross-Domain-Policies` | `none`                                |
| `X-XSS-Protection`                  | `0`                                   |

There is no `Content-Security-Policy` by default: it depends on the application.

### 5.2 Options

The options are headers by name: an object whose keys are header names, in any
case.

| Value of a key | Does                                                      |
| -------------- | --------------------------------------------------------- |
| A string       | Sets the header: one of the defaults, or any other header |
| `false`        | Leaves a default out                                      |
| Anything else  | The factory throws `CHO_VENDOR_INVALID_OPTION`            |

### 5.3 Behavior

The middleware MUST call `next()`, and add each header of the resulting list to
the response (section 2.4), **unless the response already has that header**: a
handler that sets one of them keeps its own value.

## 6. `logger`

```ts
logger(options?: LoggerOptions): ChoWebMiddlewareFn
```

It writes one line for each request, when the request is done.

### 6.1 Options

| Option   | Type                             | Default                | Check |
| -------- | -------------------------------- | ---------------------- | ----- |
| `log`    | `(line: string) => void`         | `console.log`          | None  |
| `format` | `(entry: LoggerEntry) => string` | The default line (6.3) | None  |

### 6.2 The Entry

| Field    | Is                                                                      |
| -------- | ----------------------------------------------------------------------- |
| `method` | The method of the request                                               |
| `path`   | The path of the request, without its query string: `ctx.url.pathname`   |
| `status` | The status of the response; `undefined` when the chain threw            |
| `ms`     | How long the chain took, in milliseconds, rounded to a whole number     |
| `error`  | What the chain threw. The field is there for a request that failed only |
| `ctx`    | The context of the request                                              |

### 6.3 Behavior

- The middleware MUST call `next()`. When it resolves, the middleware MUST write
  one line, `log(format(entry))`, and pass the response on as it is.
- When `next()` rejects, the middleware MUST write one line too, with no status
  and with the error, and then MUST throw the same error.
- The default line is `<method> <path> <status> <ms>ms`, where a request that
  failed has `failed` for its status: `GET /users/42 200 3ms`,
  `GET /users/42 failed 3ms`.
- The default line MUST NOT have the query string of the request.
- An error of `log` or of `format` is not caught: it fails the request.

## 7. `timeout`

```ts
timeout(options: TimeoutOptions): ChoWebMiddlewareFn
```

It answers a request when the chain takes longer than a limit.

### 7.1 Options

| Option      | Type                                     | Default                                | Check                              |
| ----------- | ---------------------------------------- | -------------------------------------- | ---------------------------------- |
| `ms`        | A number of milliseconds                 | None: it is required                   | A finite number, greater than zero |
| `onTimeout` | `(ctx) => Response \| Promise<Response>` | `504`, with the text `Gateway Timeout` | None                               |

### 7.2 Behavior

The middleware MUST call `next()`, and start a timer of `ms` milliseconds.

| What comes first  | The middleware                                                        |
| ----------------- | --------------------------------------------------------------------- |
| `next()` resolves | Stops the timer, and passes the response on                           |
| `next()` rejects  | Stops the timer, and throws the same error                            |
| The timer         | Answers with what `onTimeout` resolves to or, without it, the default |

- After the timer, what the chain does is dropped: its response, or its error.
- The chain is **not stopped**. JavaScript has no way to stop it, and the
  middleware MUST NOT pretend it did: it does not abort `ctx.req.signal`.
- An error of `onTimeout` fails the request.

## 8. `requestId`

```ts
requestId(options?: RequestIdOptions): ChoWebMiddlewareFn
const REQUEST_ID = "requestId";
```

It gives every request an id, to follow it through the logs.

### 8.1 Options

| Option     | Type              | Default        | Check |
| ---------- | ----------------- | -------------- | ----- |
| `header`   | A header name     | `x-request-id` | None  |
| `generate` | `(ctx) => string` | A random UUID  | None  |

### 8.2 Behavior

1. **The id.** When the request has the header, and its value is 1 to 255
   characters of letters, digits and `_-.=+/:`, the id MUST be that value.
   Otherwise the id MUST be what `generate` returns: a value a client sent that
   is not of that form is never used.
2. **The state.** Before it calls `next()`, the middleware MUST put the id in
   `ctx.state`, under the key `REQUEST_ID` (`"requestId"`).
3. **The response.** The middleware MUST set the header on the response (section
   2.4), to the id. A value the response already has is replaced.

## 9. `etag`

```ts
etag(options?: EtagOptions): ChoWebMiddlewareFn
```

It tags a response with a hash of its body, and answers `304 Not Modified` to a
request that already has that tag [RFC9110].

### 9.1 Options

| Option | Type      | Default | Check |
| ------ | --------- | ------- | ----- |
| `weak` | A boolean | `false` | None  |

### 9.2 Which Responses

The middleware MUST call `next()`. It MUST pass the response on as it is, unless
all of these hold:

- the method of the request is `GET` or `HEAD`;
- the status of the response is `200`;
- the response is not an event stream (section 2.5).

### 9.3 The Tag

- A response that has an `ETag` header keeps it: that is the tag, and the body
  is not read.
- A response with no `ETag` and no body is passed on as it is.
- Otherwise the middleware MUST read the body whole, and tag the response: the
  tag is the SHA-1 of the body, as lower case hexadecimal digits in double
  quotes. With `weak`, it has the prefix `W/`. The response that goes on has the
  same status, the same headers and the same body, and the `ETag` header.

A response that was a stream is not one after the middleware: it was read whole.

### 9.4 A Conditional Request

When the request has an `If-None-Match` header that matches the tag, the
middleware MUST answer `304`, with no body, and with these headers of the
response only, where it has them: `Cache-Control`, `Content-Location`, `Date`,
`ETag`, `Expires` and `Vary`.

The header matches when it is `*`, or when one of the tags it lists, separated
by commas, equals the tag. Two tags are compared without their `W/` prefix (the
weak comparison of [RFC9110], section 8.8.3.2).

Otherwise the response goes on, in full.

## 10. `basicAuth`

```ts
basicAuth(options: BasicAuthOptions): ChoWebMiddlewareFn
```

It asks for a name and a password, with HTTP Basic authentication [RFC7617].

### 10.1 Options

| Option                 | Type                                                       | Default       |
| ---------------------- | ---------------------------------------------------------- | ------------- |
| `realm`                | A string                                                   | `Secure Area` |
| `username`, `password` | Two strings: the one user                                  |               |
| `verify`               | `(username, password, ctx) => boolean \| Promise<boolean>` |               |

The factory MUST throw `CHO_VENDOR_INVALID_OPTION` unless `verify` is a
function, or `username` and `password` are both strings. When both forms are
given, `verify` is used.

### 10.2 The Credentials

The credentials of a request are read from its `Authorization` header:

1. The header, without the white space around it, MUST be the scheme `Basic`, in
   any case, one space or more, and a Base64 value.
2. The value MUST decode to bytes that are valid UTF-8.
3. The text MUST have a `:`. The name is what comes before the first one, and
   the password everything after it: a password can have a `:`.

A header that fails one of the three has no credentials.

### 10.3 Behavior

- When the request has credentials, and they are accepted, the middleware MUST
  call `next()`, and pass the response on.
- Otherwise the middleware MUST refuse the request: `401`, with the text
  `Unauthorized`, and the header
  `WWW-Authenticate: Basic realm="<realm>", charset="UTF-8"`. A `"` in the realm
  is written `\"`.

Credentials are accepted when `verify` resolves to `true`. With `username` and
`password`, they are accepted when both equal the ones of the request, and:

- both MUST be compared, whatever the result of the first;
- each comparison MUST take a time that does not depend on where the two values
  differ (section 16.2).

`verify` receives the context: it can keep what it found in `ctx.state`, for the
handler. An error of `verify` fails the request.

## 11. `bearerAuth`

```ts
bearerAuth(options: BearerAuthOptions): ChoWebMiddlewareFn
```

It asks for a token, sent as `Authorization: Bearer <token>` [RFC6750].

### 11.1 Options

| Option   | Type                                                |
| -------- | --------------------------------------------------- |
| `token`  | A string, or a list of strings: the tokens accepted |
| `verify` | `(token, ctx) => boolean \| Promise<boolean>`       |

The factory MUST throw `CHO_VENDOR_INVALID_OPTION` unless `verify` is a
function, or `token` is a string that is not empty, or a list that is not empty
of such strings. When both forms are given, `verify` is used.

### 11.2 Behavior

| The request                                                                              | The middleware                                               |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Has no `Authorization` header                                                            | `401`, with `WWW-Authenticate: Bearer`                       |
| Has a token that is accepted                                                             | Calls `next()`, and passes the response on                   |
| Anything else: another scheme, a value that is not a token, a token that is not accepted | `401`, with `WWW-Authenticate: Bearer error="invalid_token"` |

- The header, without the white space around it, MUST be the scheme `Bearer`, in
  any case, one space or more, and a token: letters, digits and `-._~+/`, with
  `=` at its end only.
- The body of a `401` is the text `Unauthorized`.
- A token is accepted when `verify` resolves to `true`. With `token`, it is
  accepted when it equals one of the tokens of the option: **every** token of
  the option MUST be compared, and each comparison MUST take a time that does
  not depend on where the two values differ (section 16.2).

`verify` receives the context, as the one of `basicAuth`. An error of `verify`
fails the request.

## 12. `compress`

```ts
compress(options?: CompressOptions): ChoWebMiddlewareFn
```

It compresses the body of a response, for a client that accepts it.

### 12.1 Options

| Option      | Type              | Default | Check                        |
| ----------- | ----------------- | ------- | ---------------------------- |
| `threshold` | A number of bytes | `1024`  | A whole number, zero or more |

### 12.2 The Encoding

The encodings are `gzip` and `deflate`, in that order of preference: what the
standard `CompressionStream` has [COMPRESSION].

The encoding of a request is the first of the two that its `Accept-Encoding`
header accepts. The header accepts an encoding when it lists it with a quality
over zero (no `q` is `1`) or, when it does not list it, when it lists `*` with a
quality over zero. A request with no `Accept-Encoding` header has no encoding.

### 12.3 Which Responses

The middleware MUST call `next()`. It MUST pass the response on as it is when
one of these holds:

- the runtime has no `CompressionStream`;
- the request has no encoding (section 12.2);
- the method of the request is `HEAD`;
- the response has no body;
- the response has a `Content-Encoding` header: it is compressed already;
- the response is an event stream (section 2.5);
- the `Content-Type` of the response is not a text type (below);
- the `Cache-Control` of the response has `no-transform`;
- the response declares its size (`Content-Length`), and it is under
  `threshold`. A response that does not declare its size is compressed whatever
  its size.

A **text type** is decided by the media type of the response: its
`Content-Type`, without its parameters (`application/ld+json` for
`application/ld+json; charset=utf-8`). It is a text type when the media type
starts with `text/`, `application/json`, `application/javascript`,
`application/xml`, `application/x-www-form-urlencoded`, `application/wasm` or
`image/svg+xml`, or ends with `+json` or `+xml`. The case does not count.

### 12.4 Compressing

Otherwise the response that goes on has the same status and the same headers,
and:

- its body is the body of the response, compressed **as a stream**: a streamed
  response stays streamed, and nothing is read whole;
- `Content-Encoding` is the encoding;
- `Content-Length` is removed;
- `Vary` gets `Accept-Encoding`, appended to what is there;
- a strong `ETag` becomes a weak one (`W/`): the bytes changed.

## 13. Public API

The package has one entry point, `@chojs/vendor-cho`. Each middleware is in a
file of its own.

| Export          | Kind     | Types that come with it        | Section |
| --------------- | -------- | ------------------------------ | ------- |
| `cors`          | factory  | `CorsOptions`                  | 3       |
| `bodyLimit`     | factory  | `BodyLimitOptions`             | 4       |
| `secureHeaders` | factory  | `SecureHeadersOptions`         | 5       |
| `logger`        | factory  | `LoggerOptions`, `LoggerEntry` | 6       |
| `timeout`       | factory  | `TimeoutOptions`               | 7       |
| `requestId`     | factory  | `RequestIdOptions`             | 8       |
| `REQUEST_ID`    | constant |                                | 8       |
| `etag`          | factory  | `EtagOptions`                  | 9       |
| `basicAuth`     | factory  | `BasicAuthOptions`             | 10      |
| `bearerAuth`    | factory  | `BearerAuthOptions`            | 11      |
| `compress`      | factory  | `CompressOptions`              | 12      |

The package also exports the type `ChoVendorErrorCode`, and, as types, what its
API refers to in `@chojs/web`: `ChoWebContext`, `ChoWebMiddlewareFn` and
`ChoWebNext`. It exports nothing else.

## 14. Errors

A mistake the package finds is a `ChoError`: an `Error` with a stable `code`,
recognized with `isChoError(error, code)`. A code that was released MUST NOT be
renamed, and MUST NOT be used for another mistake. A message is for a person,
and MAY change.

| Code                        | Thrown by                             | When                                    |
| --------------------------- | ------------------------------------- | --------------------------------------- |
| `CHO_VENDOR_INVALID_OPTION` | A factory                             | An option fails its check (section 2.1) |
| `CHO_VENDOR_BODY_TOO_LARGE` | The read of a body `bodyLimit` counts | The body passed the limit (section 4.3) |

`CHO_VENDOR_INVALID_OPTION` is thrown when a middleware is made: where the
application is declared, before it is created. Its messages:

| Factory         | Message                                                              |
| --------------- | -------------------------------------------------------------------- |
| `cors`          | `cors(): origin must be a string, a list of strings or a function`   |
| `cors`          | `cors(): <option> must be a list of strings`                         |
| `cors`          | `cors(): credentials must be a boolean`                              |
| `cors`          | `cors(): maxAge must be a whole number of seconds`                   |
| `bodyLimit`     | `bodyLimit(): maxSize must be a whole number of bytes`               |
| `secureHeaders` | `secureHeaders(): the value of "<name>" must be a string or false`   |
| `timeout`       | `timeout(): ms must be a positive number of milliseconds`            |
| `basicAuth`     | `basicAuth(): give a username and a password, or a verify function`  |
| `bearerAuth`    | `bearerAuth(): give a token, a list of tokens, or a verify function` |
| `compress`      | `compress(): threshold must be a whole number of bytes`              |

`CHO_VENDOR_BODY_TOO_LARGE` has the message
`the body of the request is too large`. It is what the handler that reads the
body gets. It is never the outcome of the request: `bodyLimit` answers with its
refusal, whatever the chain made of the error (section 4.3).

A request the package refuses is a `Response`, and not an error (section 2.3).

## 15. Runtime Considerations

The package uses the standard `Request`, `Response`, `Headers`, streams and Web
Crypto, and nothing of a runtime. Its tests run on Deno, on Node.js, on Bun and
on Cloudflare Workers.

| Middleware                | Needs                                                                  |
| ------------------------- | ---------------------------------------------------------------------- |
| `compress`                | `CompressionStream`. Without it, the middleware changes nothing        |
| `etag`                    | `crypto.subtle.digest`, with SHA-1                                     |
| `basicAuth`, `bearerAuth` | `crypto.subtle.digest`, with SHA-256, for the options without `verify` |
| `requestId`               | `crypto.randomUUID`, for the default of `generate`                     |
| `logger`, `timeout`       | `performance.now`, and `setTimeout`                                    |

## 16. Security Considerations

### 16.1 CORS Is Not Access Control

`cors` refuses nothing (section 3.4). A request from an origin that is not
allowed runs, and so does its handler: only a browser keeps the response from
the page. A client that is not a browser ignores the headers altogether. An
application MUST NOT rely on `cors` to protect a route: that is the task of an
authentication.

`origin: "*"` with `credentials: true` names the origin of every request, so it
lets every site send requests with the cookies of the user, and read the
answers. An application SHOULD NOT use the two together: it SHOULD list its
origins.

A function of `origin` receives a string the client chose. It SHOULD compare it
with a list, and SHOULD NOT accept it by a pattern that another host can match
(a suffix, a substring).

### 16.2 Comparing Secrets

With `username` and `password`, and with `token`, a secret of the request is
compared with one of the options. The time of that comparison MUST NOT tell
where the two differ, or which of several values was the wrong one. The package
hashes the two values, compares every byte of the two hashes, and compares every
value there is to compare before it answers.

A `verify` function is the code of the application: comparing in constant time,
and slowing down or refusing repeated guesses, is its task. The package has no
limit on the number of attempts.

### 16.3 Basic Authentication

Basic authentication sends the password with every request, encoded and not
encrypted. `basicAuth` MUST be used over HTTPS only. The `username` and the
`password` of the options are kept in memory as they were given.

### 16.4 The Size of a Body

- `bodyLimit` SHOULD be the first middleware that can read the body, and SHOULD
  be a router middleware: a body is then limited on every route.
- A declared size within the limit is trusted (section 4.2): the server is what
  holds a client to its `Content-Length`.
- `bodyLimit` limits a size, and not a time: a client that sends its body slowly
  is not refused.
- On the Fastify adapter, the body limit of Fastify does not apply to the routes
  of a CHO application: `bodyLimit` is the limit there.

### 16.5 `timeout` Stops Nothing

A request that is answered `504` still runs (section 7.2): its handler, its
queries and its memory. `timeout` protects a client from waiting, and does not
protect the server from the work. A handler that can stop SHOULD watch
`ctx.req.signal`, or a timer of its own.

### 16.6 An Id of the Client

`requestId` takes the id a client sent. It is limited to a short list of
characters (section 8.2), so that it cannot break a log line or a header. It is
still a value the client chose: an application MUST NOT take it for a secret,
for a proof of who sent the request, or for a unique value.

### 16.7 What a Log Holds

The default line of `logger` leaves out the query string, which can hold tokens.
A path can hold what should not be logged too. A `format` of the application
receives the whole context, and SHOULD NOT write headers such as `Authorization`
and `Cookie`.

### 16.8 The Defaults of `secureHeaders`

- `Strict-Transport-Security` is on by default, with `includeSubDomains`. A
  browser that received it over HTTPS refuses plain HTTP for the host and its
  subdomains for 180 days. An application that has a subdomain served over HTTP
  SHOULD leave the header out, or set its own value.
- There is no `Content-Security-Policy` by default. An application that serves
  HTML SHOULD give one.

### 16.9 Compression and Secrets

A response that holds a secret, and also text the client chose, tells something
about the secret by its compressed size (the BREACH attack). An application
SHOULD NOT compress such a response: it keeps `compress` off its route, or sets
`Cache-Control: no-transform` on it.

### 16.10 `etag`

- The SHA-1 of `etag` says whether a body changed. It is not a signature, and
  MUST NOT be used as one.
- `etag` reads a body whole (section 9.3): on a route with a large or endless
  body, it holds that body in memory. It SHOULD be kept off the routes that
  stream.

### 16.11 Requests No Route Matches

A route middleware does not run for a request no route matches. Security
headers, CORS headers and a log are on every answer only as router middlewares
(section 2.2).

## 17. References

### 17.1 Normative References

- **[RFC2119]** Bradner, S., "Key words for use in RFCs to Indicate Requirement
  Levels", BCP 14, RFC 2119, March 1997.
- **[RFC8174]** Leiba, B., "Ambiguity of Uppercase vs Lowercase in RFC 2119 Key
  Words", BCP 14, RFC 8174, May 2017.
- **[WEB]** [The specification of `@chojs/web`](../../web/specs.md): section 3.4
  (server-sent events), section 3.5 (WebSockets), section 4 (middlewares) and
  section 7 (runtime adapters, and the middlewares of the built-in router).
- **[FETCH]** WHATWG, "Fetch Standard", <https://fetch.spec.whatwg.org/>: the
  CORS protocol.
- **[RFC9110]** Fielding, R., Ed., Nottingham, M., Ed., and J. Reschke, Ed.,
  "HTTP Semantics", STD 97, RFC 9110, June 2022: `ETag` and `If-None-Match`,
  `304`, `413`, `504`, `Vary`, `Content-Encoding` and `Accept-Encoding`.
- **[RFC7617]** Reschke, J., "The 'Basic' HTTP Authentication Scheme", RFC 7617,
  September 2015.
- **[RFC6750]** Jones, M. and D. Hardt, "The OAuth 2.0 Authorization Framework:
  Bearer Token Usage", RFC 6750, October 2012.
- **[COMPRESSION]** WHATWG, "Compression Standard",
  <https://compression.spec.whatwg.org/>: `CompressionStream`.

### 17.2 Informative References

- **[README]** [The guide of the package](./README.md).
- **[RFC6797]** Hodges, J., Jackson, C., and A. Barth, "HTTP Strict Transport
  Security (HSTS)", RFC 6797, November 2012.
- **[RFC9111]** Fielding, R., Ed., Nottingham, M., Ed., and J. Reschke, Ed.,
  "HTTP Caching", STD 98, RFC 9111, June 2022.

## Appendix A. Rationale

This appendix is not normative. It says why some rules are what they are.

| Rule                                                   | Why                                                                                              |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| A refusal is a `Response` (2.3)                        | A `401` is an answer, and not a failure: no error handler should see it, or replace it           |
| A response with fixed headers is copied (2.4)          | `Response.redirect()` and a response of `fetch` throw when a header is set                       |
| An event stream is left as it is (2.5)                 | Its body has no end to hash, and compressed events would wait for the compressor to fill a block |
| A preflight request is answered by `cors` (3.3)        | A browser sends it to paths that have no `OPTIONS` route                                         |
| `*` becomes the origin with `credentials` (3.2)        | A browser refuses `*` on a request with credentials                                              |
| `Vary: Origin` (3.3, 3.4)                              | A cache must keep the answers to two origins apart                                               |
| A streamed body is counted when it is read (4.3)       | Nothing is read ahead: a body nobody reads costs nothing, and is not refused                     |
| `413` whatever the chain answered (4.3)                | An error handler that turns every error into a `500` would hide the cause                        |
| A header of the response is kept (5.3)                 | A handler can set its own policy for one route                                                   |
| The query string is not logged (6.3)                   | It can hold what should not be in a log                                                          |
| The chain is not stopped at the limit (7.2)            | JavaScript has no way to stop it                                                                 |
| An id of the client is checked (8.2)                   | It goes into logs and into a header                                                              |
| A strong tag becomes weak when compressed (12.4)       | The bytes of the body changed                                                                    |
| The secrets are hashed before they are compared (16.2) | Hashing gives two values of the same length, whatever the inputs                                 |

## Appendix B. Not in This Version

This appendix is not normative.

- **Brotli**, and any encoding `CompressionStream` does not have (section 12.2).
- **A `Content-Security-Policy` by default** (section 5.1).
- **Stopping the work of a request that timed out** (section 7.2).
- **A limit on the time a body takes to arrive** (section 16.4).
- **A limit on the number of attempts** of an authentication (section 16.2).
- **Checks of every option.** `logger`, `requestId` and `etag` check none, and
  the callbacks of the others are not checked (section 2.7).
