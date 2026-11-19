# @chojs/openapi

[![JSR](https://jsr.io/badges/@chojs/openapi)](https://jsr.io/@chojs/openapi)
[![JSR score](https://jsr.io/badges/@chojs/openapi/score)](https://jsr.io/@chojs/openapi)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

The documentation of a [`@chojs/web`](../../web/README.md) application, from
what the application already declares: an
[OpenAPI](https://spec.openapis.org/oas/v3.1.1.html) document of its routes, and
a page that shows it, with Swagger UI, Scalar, Redoc or any other client of
OpenAPI.

## Contents

- [Installation](#installation)
- [Usage](#usage)
- [What is in the document](#what-is-in-the-document)
- [Describing what the code cannot tell](#describing-what-the-code-cannot-tell)
- [Schemas](#schemas)
- [Options](#options)
- [The page](#the-page)
- [Protecting the documentation](#protecting-the-documentation)
- [The document, and the page, by themselves](#the-document-and-the-page-by-themselves)
- [Behavior](#behavior)
- [Errors](#errors)
- [Runtime support](#runtime-support)
- [Documentation](#documentation)

## Installation

```sh
deno add jsr:@chojs/web jsr:@chojs/openapi    # Deno
npx jsr add @chojs/web @chojs/openapi         # Node.js
bunx jsr add @chojs/web @chojs/openapi        # Bun
```

The package has no dependency. The client of the page is loaded by the browser,
from a CDN.

## Usage

Create the application, then give it its documentation:

```ts
import { ChoWeb } from "@chojs/web";
import { serve } from "@chojs/web/serve";
import { openApi } from "@chojs/openapi";

const app = await ChoWeb.create(AppModule);

openApi(app, { info: { title: "Shop", version: "1.0.0" } });

await serve(app.handler);
```

| Route                    | Answers                                 |
| ------------------------ | --------------------------------------- |
| `GET /docs`              | The page: Swagger UI, by default        |
| `GET /docs/openapi.json` | The OpenAPI document of the application |

`openApi` mounts the two routes with `app.mount` of `@chojs/web`. Call it
between `ChoWeb.create` and the start of the server.

A runnable example is in
[`examples/openapi-http.ts`](../../examples/openapi-http.ts).

## What is in the document

Nothing is declared twice: the document is made from the handlers.

```ts
@Controller({ route: "users" })
class UsersController {
  @Put(":id")
  @Args(Param("id"), Body(UpdateUser))
  update(id: string, user: UpdateUser) {}
}
```

| Declared                     | In the document                                                       |
| ---------------------------- | --------------------------------------------------------------------- |
| `@Put(":id")`, under `users` | The operation `put` of the path `/users/{id}`                         |
| The controller               | The tag `Users`, and the `operationId` `UsersController.update`       |
| `Param("id")`                | A parameter `id`, `in: path`, required                                |
| `Body(UpdateUser)`           | The request body, `application/json`, with the schema of `UpdateUser` |

Each argument of a handler (`@Args`) is read:

| Argument               | In the document                                                                                           |
| ---------------------- | --------------------------------------------------------------------------------------------------------- |
| `Param("id", v)`       | A parameter `in: path`, required, with the schema of `v`                                                  |
| `Query("page", v)`     | A parameter `in: query`, with the schema of `v`                                                           |
| `Header("x", v)`       | A parameter `in: header`, with the schema of `v`                                                          |
| `Query(v)`             | One `in: query` parameter for each property of the schema of `v`. The same for `Param(v)` and `Header(v)` |
| `Body(v)`              | The request body, `application/json`, required                                                            |
| `Body("name", v)`      | A property `name` of an `application/json` request body                                                   |
| `Form(v)`              | The request body, `application/x-www-form-urlencoded`                                                     |
| `Form("name", v)`      | A property `name` of a URL-encoded request body                                                           |
| A function of your own | Nothing: it says nothing about what it reads                                                              |

- Without a validator, a parameter is a string, and a body has no schema.
- Every parameter of the path is in the document, also one no argument reads.
- A parameter read by its key is not marked required, except in the path: the
  schema of one value does not say whether the value may be missing. A whole
  source (`Query(v)`) is marked as its schema says.

Some responses are added by themselves:

| Handler                                                        | Response                          |
| -------------------------------------------------------------- | --------------------------------- |
| With no `2xx` response                                         | `200`, `OK`                       |
| An `@Sse` handler, with no `2xx` response                      | `200`, `text/event-stream`        |
| Covered by `validate()`, with an argument that has a validator | `400`, `The request is not valid` |

## Describing what the code cannot tell

`@Doc`, of `@chojs/web`, on a handler, a controller or a feature module:

```ts
@Doc({ tags: ["users"], security: [{ bearer: [] }] })
@Controller({ route: "users" })
class UsersController {
  @Doc({
    summary: "Find a user",
    responses: {
      200: { description: "The user", schema: User },
      404: { description: "No such user" },
    },
  })
  @Get(":id")
  @Args(Param("id"))
  get(id: string) {}

  @Doc({ operationId: "listUsers", security: [] }) // public
  @Get("")
  list() {}
}
```

| Option        | On                                 | In the document                                                                                 |
| ------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------- |
| `summary`     | A handler                          | The summary of the operation                                                                    |
| `description` | A handler                          | Its description                                                                                 |
| `operationId` | A handler                          | Its id. Default: `UsersController.get`. Ids are unique                                          |
| `tags`        | A handler, a controller, a feature | The tags of the operations under it: they add up. Default: the controller, without `Controller` |
| `deprecated`  | A handler, a controller, a feature | `true`: the operations under it are deprecated                                                  |
| `security`    | A handler, a controller, a feature | What they require. The nearest one wins, and `[]` is public                                     |
| `responses`   | A handler                          | By status: a `description`, a `schema` and a `contentType`                                      |
| `hidden`      | A handler, a controller, a feature | `true`: the operations under it are left out                                                    |

A `security` names the schemes of the `securitySchemes` option. A name that is
not there throws, when `openApi` is called.

## Schemas

A validator of `@chojs/web` is a [Standard Schema](https://standardschema.dev/),
or an object with a `parse` method. Its JSON Schema comes from one of two
places:

1. **The validator itself**, when it also implements
   [Standard JSON Schema](https://standardschema.dev/json-schema). A
   [Zod](https://zod.dev) schema does, from Zod 4.2, and so does an
   [ArkType](https://arktype.io) schema, from 2.1.28: nothing to do. The tests
   of this package run both.

   ```ts
   const UpdateUser = z.object({ name: z.string(), email: z.email() });

   @Args(Body(UpdateUser)) // the schema is in the document
   ```

2. **The `toJsonSchema` option**, for a validator that does not, such as a
   [Valibot](https://valibot.dev) schema as it is. It receives the validator,
   and `"input"` or `"output"`, and returns a JSON Schema, or `undefined` when
   it does not know the validator.

   ```ts
   openApi(app, {
     info,
     toJsonSchema: (validator, io) =>
       validator instanceof MySchema ? validator.toJsonSchema(io) : undefined,
   });
   ```

A validator with no schema is not an error: the argument or the response is in
the document without a schema, and a line is logged to the `cho:openapi` debug
context (`CHO_DEBUGLOG=cho:openapi`).

- An argument is asked for its **input**, what a client sends, and a response
  for its **output**, what the handler gives.
- A schema is written where it is used. The definitions of a schema (`$defs`) go
  to `components.schemas`, once, and the references follow.

## Options

`openApi(app, options)`:

| Option            | Default     | What it is                                                                |
| ----------------- | ----------- | ------------------------------------------------------------------------- |
| `info`            | Required    | The Info Object: `title` and `version` are required                       |
| `route`           | `"docs"`    | The base route of the two routes, written like the route of a decorator   |
| `ui`              | `"swagger"` | The client of the page: see [The page](#the-page)                         |
| `assets`          | The CDN     | Where the files of the client are                                         |
| `middlewares`     | None        | Middleware functions for the two routes                                   |
| `servers`         | None        | The servers of the API. Without it, a client calls the origin of the page |
| `tags`            | None        | A description for a tag, by name: `{ users: "The users" }`                |
| `securitySchemes` | None        | The ways to authenticate, by name                                         |
| `security`        | None        | What every operation requires, unless its `@Doc` says otherwise           |
| `externalDocs`    | None        | More documentation                                                        |
| `toJsonSchema`    | None        | See [Schemas](#schemas)                                                   |

An option that is missing, unknown or wrong throws when `openApi` is called. So
does an application whose document cannot be made: the document is made then,
not for the first request.

```ts
const config = await app.injector.resolve(Config);

openApi(app, {
  info: { title: "Shop", version: config.version },
  servers: [{ url: config.publicUrl }],
  route: "internal/docs",
  ui: "scalar",
  securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
  security: [{ bearer: [] }],
});
```

The application is created when `openApi` is called, so its options can come
from its providers, as above.

## The page

| `ui`        | The page shows                                                       |
| ----------- | -------------------------------------------------------------------- |
| `"swagger"` | [Swagger UI](https://swagger.io/tools/swagger-ui/)                   |
| `"scalar"`  | [Scalar](https://scalar.com)                                         |
| `"redoc"`   | [Redoc](https://redocly.com/redoc)                                   |
| A function  | Any other client: `({ url, title }) => string`, the HTML of the page |
| `false`     | No page: the document only, at `<route>/openapi.json`                |

The page is one small HTML file. Its client is loaded by the browser from the
[jsDelivr](https://www.jsdelivr.com) CDN, at an exact version, which
`UI_VERSIONS` exports: a page does not change until the package does.

```ts
openApi(app, {
  info,
  ui: ({ url, title }) =>
    `<!doctype html><title>${title}</title><my-client spec="${url}"></my-client>`,
});
```

**Hosting the files yourself.** `assets` replaces the address of the package on
the CDN. The names of the files stay the same:

| `ui`        | Package                 | Files under `assets`                     |
| ----------- | ----------------------- | ---------------------------------------- |
| `"swagger"` | `swagger-ui-dist`       | `swagger-ui.css`, `swagger-ui-bundle.js` |
| `"scalar"`  | `@scalar/api-reference` | `dist/browser/standalone.js`             |
| `"redoc"`   | `redoc`                 | `bundles/redoc.standalone.js`            |

**With a content security policy.** The page loads a script from
`cdn.jsdelivr.net`, or from `assets`. The pages of Swagger UI and of Scalar also
have a short inline script, and the one of Swagger UI a stylesheet from the same
place. The clients have needs of their own beyond that (inline styles, fonts,
workers): see their documentation.

## Protecting the documentation

The two routes are mounted, not declared: the middlewares of the application do
not run for them. Give them their own:

```ts
import { basicAuth } from "@chojs/vendor-cho";

openApi(app, {
  info,
  middlewares: [basicAuth({ username: "admin", password })],
});
```

A middleware that wraps every request, such as `cors` of `@chojs/vendor-cho` on
the built-in router, runs for them as for the others.

To have no documentation somewhere, do not call `openApi` there:

```ts
if (!production) {
  openApi(app, { info });
}
```

## The document, and the page, by themselves

`openApi` is made of two functions, which are exported:

```ts
import { docsPage, openApiDocument } from "@chojs/openapi";

const document = openApiDocument(app, { info }); // a plain object
const html = docsPage({ url: "/openapi.json", ui: "redoc", title: "Shop" });
```

`openApiDocument` returns a new plain object each time: write it to a file,
change it, or serve it from a controller of your own.

## Behavior

| Topic                          | Behavior                                                                                                                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAPI version                | 3.1.1                                                                                                                                                                             |
| The two routes                 | In `app.routes`, and not in `app.graph`: so they are not in the document                                                                                                          |
| The global prefix              | Not for the two routes: with `prefix: "api"`, the page is still `/docs`                                                                                                           |
| When it is made                | When `openApi` is called, once: the graph of an application does not change                                                                                                       |
| A document that cannot be made | Two operations with one `operationId`, or an unknown security scheme: `openApi` throws, before the server starts, and mounts nothing                                              |
| The URL of the document        | The page finds it: the path of the request for the page, with `/openapi.json`                                                                                                     |
| Matching order                 | The two routes are the last. On the built-in router and on Hono, a declared route that matches `/docs` answers first, such as `@Get(":slug")` at the root: choose another `route` |
| When to call                   | Before the application serves. Later, Hono and Fastify refuse the routes                                                                                                          |
| Twice                          | The same `route` throws. Another `route` gives a second documentation, with its own options                                                                                       |
| Mounted routes                 | A route of `app.mount` is not in the document                                                                                                                                     |
| Logs                           | The `cho:openapi` debug context                                                                                                                                                   |

## Errors

A mistake in the options, or a document that cannot be made, is a `ChoError` of
`@chojs/web`: an `Error` with a stable `code`. `openApi` throws it when it is
called, before the server starts.

```ts
import { isChoError } from "@chojs/web";

try {
  openApi(app, options);
} catch (error) {
  if (isChoError(error, "CHO_OPENAPI_DUPLICATE_OPERATION_ID")) {
    // ...
  }
  throw error;
}
```

| Mistake                                          | Code                                  |
| ------------------------------------------------ | ------------------------------------- |
| An option that is missing or wrong               | `CHO_OPENAPI_INVALID_OPTION`          |
| Two operations with one `operationId`            | `CHO_OPENAPI_DUPLICATE_OPERATION_ID`  |
| A `security` that names a scheme nobody declared | `CHO_OPENAPI_UNKNOWN_SECURITY_SCHEME` |
| A `ui` that is not a client                      | `CHO_OPENAPI_UNKNOWN_UI`              |

An option that does not exist is `CHO_CORE_UNKNOWN_OPTION`, and a route that is
not valid or already taken has the code of `app.mount` (`CHO_WEB_…`). The
messages are in the [specification](./specs.md#8-errors).

## Runtime support

Every runtime `@chojs/web` runs on: Deno, Node.js, Bun, Cloudflare Workers and
other edge runtimes, with every adapter. Making the document and the page uses
the language alone. A tag of the document is the name of a controller: on a
Worker, keep the names when the bundle is minified.

## Documentation

- [The specification](./specs.md): the decisions of the package, with the
  alternatives.
- [`@chojs/web`](../../web/README.md): `@Doc`, `@Args`, validation, and
  `app.mount`.
