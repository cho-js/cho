# @chojs/vendor-cho

[![JSR](https://jsr.io/badges/@chojs/vendor-cho)](https://jsr.io/@chojs/vendor-cho)
[![JSR score](https://jsr.io/badges/@chojs/vendor-cho/score)](https://jsr.io/@chojs/vendor-cho)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

The middlewares of the built-in router of [`@chojs/web`](../../web/README.md).

The built-in router has no HTTP library underneath, so nothing brings the
middlewares an application usually takes from one. This package has them,
written as CHO middlewares: functions `(ctx, next)` on the standard `Request`
and `Response`, with no dependency.

| Middleware      | For                                                        |
| --------------- | ---------------------------------------------------------- |
| [`cors`](#cors) | Letting pages of other origins call the application (CORS) |

## Contents

- [Installation](#installation)
- [Where a middleware goes](#where-a-middleware-goes)
- [`cors`](#cors)
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

## Runtime support

Deno, Node.js and Bun, and any runtime with the standard `Request`, `Response`
and `Headers`.

## Documentation

- [`@chojs/web`](../../web/README.md): the web package, its
  [built-in router](../../web/README.md#the-built-in-router) and its
  [specification](../../web/specs.md).

## License

[MIT](./LICENSE)
