# @chojs/vendor-cho

[![JSR](https://jsr.io/badges/@chojs/vendor-cho)](https://jsr.io/@chojs/vendor-cho)
[![JSR score](https://jsr.io/badges/@chojs/vendor-cho/score)](https://jsr.io/@chojs/vendor-cho)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

The middlewares of the built-in router of [`@chojs/web`](../../web/README.md).

The built-in router has no HTTP library underneath, so nothing brings the
middlewares an application usually takes from one. This package has them,
written as CHO middlewares: functions `(ctx, next)` on the standard `Request`
and `Response`, with no dependency.

| Middleware                        | For                                                   |
| --------------------------------- | ----------------------------------------------------- |
| [`cors`](#cors)                   | Letting pages of other origins call the application   |
| [`bodyLimit`](#bodylimit)         | Refusing a request whose body is too large            |
| [`secureHeaders`](#secureheaders) | The response headers that protect a site              |
| [`logger`](#logger)               | One log line for each request                         |
| [`timeout`](#timeout)             | Answering a request that takes too long               |
| [`requestId`](#requestid)         | An id for each request, to follow it in the logs      |
| [`etag`](#etag)                   | `ETag`, and `304 Not Modified`                        |
| [`basicAuth`](#basicauth)         | A name and a password, with HTTP Basic authentication |
| [`bearerAuth`](#bearerauth)       | A token, as `Authorization: Bearer`                   |
| [`compress`](#compress)           | Compressing the body of a response                    |

Each middleware is in its own file, and all of them are exported by the package.

## Contents

- [Installation](#installation)
- [Where a middleware goes](#where-a-middleware-goes)
- [`cors`](#cors)
- [`bodyLimit`](#bodylimit)
- [`secureHeaders`](#secureheaders)
- [`logger`](#logger)
- [`timeout`](#timeout)
- [`requestId`](#requestid)
- [`etag`](#etag)
- [`basicAuth`](#basicauth)
- [`bearerAuth`](#bearerauth)
- [`compress`](#compress)
- [Runtime support](#runtime-support)
- [Documentation](#documentation)

## Installation

```sh
deno add jsr:@chojs/web jsr:@chojs/vendor-cho    # Deno
npx jsr add @chojs/web @chojs/vendor-cho         # Node.js
bunx jsr add @chojs/web @chojs/vendor-cho        # Bun
```

## Where a middleware goes

**On the router**, to cover every request, the ones no route matches included:

```ts
import { ChoLinker, ChoWeb } from "@chojs/web";
import { cors } from "@chojs/vendor-cho";

const app = await ChoWeb.create(App, {
  linker: new ChoLinker({ middlewares: [cors()] }),
});
```

**On some routes**, with `@Middlewares`, on a handler, a controller or a feature
module:

```ts
import { Controller, Get, Middlewares } from "@chojs/web";
import { cors } from "@chojs/vendor-cho";

@Middlewares(cors({ origin: "https://example.com" }))
@Controller({ route: "public" })
class PublicController {
  @Get("status")
  status() {
    return { ok: true };
  }
}
```

They are plain CHO middlewares, so they also run on the Hono and Fastify
adapters when they are declared with `@Middlewares`.

The order matters, as for any middleware: the first one is the outermost. A
usual order on the router:

```ts
new ChoLinker({
  middlewares: [
    logger(), //                     sees every request, and its final status
    requestId(),
    cors({ origin: "https://example.com" }),
    secureHeaders(),
    compress(),
    bodyLimit({ maxSize: 1024 * 1024 }),
  ],
});
```

What a middleware of the router puts in `ctx.state` (the request id, the user of
an authentication) is there for the middlewares and the handler of the route.

## `cors`

Cross-Origin Resource Sharing: it lets a page of another origin call the
application from a browser.

```ts
cors({
  origin: ["https://example.com", "https://admin.example.com"],
  credentials: true,
  maxAge: 600,
});
```

| Option           | Default                                         | Use                                                                                                                 |
| ---------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `origin`         | `"*"`                                           | The origins allowed: `"*"`, a string, a list, or a function `(origin, ctx)` that returns `true` (it can be `async`) |
| `methods`        | `GET`, `HEAD`, `PUT`, `POST`, `DELETE`, `PATCH` | The methods a cross-origin request may use                                                                          |
| `allowedHeaders` | the headers the preflight request asks for      | The request headers a cross-origin request may send                                                                 |
| `exposedHeaders` | none                                            | The response headers a script may read                                                                              |
| `credentials`    | `false`                                         | Whether requests may be sent with cookies or authorization                                                          |
| `maxAge`         | not sent                                        | For how long, in seconds, a browser may keep the answer to a preflight                                              |

What it does:

- **A preflight request** (an `OPTIONS` request with
  `Access-Control-Request-Method`) is answered `204` by the middleware itself.
  The handler does not run.
- **Any other request** runs as usual, and the CORS headers are added to its
  response.
- A request without an `Origin` header is left as it is. A request from an
  origin that is not allowed runs, and gets no CORS header: the browser is what
  refuses to give the response to the page.
- With `credentials`, a response never allows `*`: it names the origin of the
  request.
- `Vary: Origin` is added whenever the answer depends on the origin of the
  request, so that caches keep the answers apart.

**Put it on the router.** A browser sends a preflight request to the path of the
real request, with the method `OPTIONS`. A middleware declared with
`@Middlewares` only runs for a request that matches a route, so there it answers
preflight requests only where an `@Options` route exists. On the router
(`new ChoLinker({ middlewares: [cors()] })`) it answers them for every path.

## `bodyLimit`

Refuses a request whose body is larger than a limit, with
`413 Payload Too
Large`. A server on the standard `Request` has no limit of its
own: without it, a handler that reads the body reads all of it.

```ts
bodyLimit({ maxSize: 1024 * 1024 }); // 1 MB
```

| Option       | Default                    | Use                                     |
| ------------ | -------------------------- | --------------------------------------- |
| `maxSize`    | required                   | The largest body, in bytes              |
| `onExceeded` | `413`, `Payload Too Large` | A function `(ctx)` that answers instead |

- A request that declares its size (`Content-Length`) over the limit is refused
  at once, and nothing is read.
- A request that does not declare it (a chunked body) is counted while it is
  read. When it passes the limit, reading it fails, and the request is answered
  `413` whatever the rest of the chain answered.
- Put a larger limit on one handler with `@Middlewares`, such as an upload.

## `secureHeaders`

Adds the response headers browsers use to protect a site.

```ts
secureHeaders({
  "content-security-policy": "default-src 'self'",
  "x-frame-options": "DENY",
  "strict-transport-security": false, // leave this default out
});
```

| Header                              | Default                               |
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

The options are headers by name: a string sets one (a default or any other),
`false` leaves a default out. A header the response already has is kept. There
is no `Content-Security-Policy` by default.

## `logger`

Writes one line for each request, when it is done: `GET /users/42 200 3ms`. The
query string is left out. A request that fails is logged too
(`GET /users/42 failed 3ms`), and its error goes on.

```ts
logger({
  log: (line) => log.info(line), // default: console.log
  format: ({ method, path, status, ms }) =>
    JSON.stringify({ method, path, status, ms }),
});
```

`format` receives `method`, `path`, `status` (`undefined` when the request
failed), `ms`, `error` and the context.

## `timeout`

Answers `504 Gateway Timeout` when the rest of the chain takes longer than a
limit.

```ts
timeout({ ms: 5000 });
```

| Option      | Default                  | Use                                     |
| ----------- | ------------------------ | --------------------------------------- |
| `ms`        | required                 | The limit, in milliseconds              |
| `onTimeout` | `504`, `Gateway Timeout` | A function `(ctx)` that answers instead |

The request is answered at the limit, but what was running is not stopped:
JavaScript has no way to stop it. Its result, or its error, is dropped.

## `requestId`

Gives every request an id. It is the one the request came with (the
`x-request-id` header) when that is a short, safe string, and a new UUID
otherwise. It is kept in `ctx.state` and sent back on the response.

```ts
import { REQUEST_ID, requestId } from "@chojs/vendor-cho";

requestId(); // or requestId({ header: "x-trace-id", generate: (ctx) => … })

// later, in a middleware or a handler
ctx.state.get(REQUEST_ID);
```

## `etag`

Tags each response with a hash of its body (`ETag`), and answers
`304 Not Modified`, without the body, to a request that already has that tag
(`If-None-Match`).

```ts
etag(); // or etag({ weak: true })
```

- It applies to `GET` and `HEAD` requests answered `200`.
- The body is read whole to be hashed: keep it off the routes that stream.
- A response that already has an `ETag` keeps it.

## `basicAuth`

Asks for a name and a password, with HTTP Basic authentication. Anything else is
answered `401`, with the `WWW-Authenticate` header that makes a browser ask for
them. Use it over HTTPS only.

```ts
basicAuth({ username: "ada", password: "secret" });

basicAuth({
  realm: "Admin",
  verify: async (username, password, ctx) => {
    const user = await users.login(username, password);
    if (user) ctx.state.set("user", user);
    return user !== undefined;
  },
});
```

The name and the password of a single user are compared in constant time.

## `bearerAuth`

Asks for a token, sent as `Authorization: Bearer <token>`. A request without the
header is answered `401` with `WWW-Authenticate: Bearer`; one with a token that
is not accepted, `401` with `error="invalid_token"`.

```ts
bearerAuth({ token: "s3cret" }); // or a list of tokens

bearerAuth({
  verify: async (token, ctx) => {
    const claims = await tokens.verify(token); // a JWT, say
    if (claims) ctx.state.set("claims", claims);
    return claims !== undefined;
  },
});
```

## `compress`

Compresses the body of a response, with `gzip` or `deflate`, for a client that
accepts it.

```ts
compress(); // or compress({ threshold: 4096 })
```

- A response is compressed when its body is a text type (text, JSON, XML,
  JavaScript, SVG), is not compressed already, does not say
  `Cache-Control: no-transform`, and is not smaller than `threshold` (1024 bytes
  by default).
- The body is compressed as a stream, so a streamed response stays streamed.
- `Vary: Accept-Encoding` is added, and a strong `ETag` becomes a weak one.
- It uses the standard `CompressionStream`; on a runtime without it, the
  middleware changes nothing. There is no Brotli.

## Runtime support

Deno, Node.js and Bun, and any runtime with the standard `Request`, `Response`
and `Headers`.

## Documentation

- [`@chojs/web`](../../web/README.md): the web package, its
  [built-in router](../../web/README.md#the-built-in-router) and its
  [specification](../../web/specs.md).

## License

[MIT](./LICENSE)
