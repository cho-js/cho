# @chojs/openapi

> **Status: implemented.** `../../tmp/tasks.md` lists what was done and what is
> left. Section 10 lists every decision this document makes, with the
> alternative that was not chosen, and section 12 what it changed in the other
> packages.

The documentation of an HTTP application, from what the application already
declares. `@chojs/openapi` reads the graph of a `@chojs/web` application, makes
an [OpenAPI](https://spec.openapis.org/oas/v3.1.1.html) document of its routes,
and serves it with a page that shows it: Swagger UI, Scalar, Redoc, or any other
client of OpenAPI.

It is an extra (`extras/README.md`): it reads the graph, so it lives next to the
framework.

## 1. Overview

An application is created, then given its documentation:

```ts
import { ChoWeb } from "@chojs/web";
import { serve } from "@chojs/web/serve";
import { openApi } from "@chojs/openapi";

const app = await ChoWeb.create(AppModule);

openApi(app, { info: { title: "Shop", version: "1.0.0" } });
// GET /docs              the page: Swagger UI
// GET /docs/openapi.json the document

await serve(app.handler);
```

The package has three parts. Each one is usable without the next.

| Part             | What it is                                                               | Section |
| ---------------- | ------------------------------------------------------------------------ | ------- |
| **The document** | `openApiDocument(app, options)`: the OpenAPI document, as a plain object | 2       |
| **The page**     | `docsPage(options)`: the HTML of a page that shows a document            | 4       |
| **The routes**   | `openApi(app, options)`: mounts the two routes that answer with them     | 5, 6    |

```ts
import { docsPage, openApiDocument } from "@chojs/openapi";

const document = openApiDocument(app, {
  info: { title: "Shop", version: "1.0.0" },
});
const html = docsPage({ ui: "swagger", url: "/docs/openapi.json" });
```

Nothing is declared twice. The methods, the paths, the arguments and their
schemas are those of the handlers. What the code cannot tell is given with
`@Doc`, of `@chojs/web`.

```ts
@Doc({ tags: ["users"] })
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

| Declared                     | In the document                                                        |
| ---------------------------- | ---------------------------------------------------------------------- |
| `@Put(":id")`, under `users` | the operation `put` of the path `/users/{id}`                          |
| `Param("id")`                | a parameter `id`, `in: path`, required                                 |
| `Body(UpdateUser)`           | the `requestBody`, `application/json`, with the schema of `UpdateUser` |
| `@Doc({ tags })`             | the tag `users`                                                        |
| `@Doc({ responses })`        | the responses `200`, with the schema of `User`, and `404`              |

## 2. The document

```ts
function openApiDocument(
  app: ChoWeb<unknown>,
  options: OpenApiDocumentOptions,
): OpenApiDocument;
```

`openApiDocument` reads `app.graph`. It does no I/O, calls no handler and no
middleware, and returns a new plain object each time: the application can change
it before it is served. The document is OpenAPI **3.1.1**.

### 2.1 The options

| Option            | Default  | In the document                                                          |
| ----------------- | -------- | ------------------------------------------------------------------------ |
| `info`            | required | `info`: `title` and `version` are required; any field of the Info Object |
| `servers`         | none     | `servers`. Without it, a client calls the origin of the page             |
| `tags`            | none     | `tags`: a `description` for a tag, by name: `{ users: "The users" }`     |
| `securitySchemes` | none     | `components.securitySchemes`, by name                                    |
| `security`        | none     | `security`: what every operation requires, unless it says otherwise      |
| `externalDocs`    | none     | `externalDocs`                                                           |
| `toJsonSchema`    | none     | not in the document: turns a validator into a JSON Schema (section 2.5)  |

An unknown option throws, and names the known ones.

```ts
openApiDocument(app, {
  info: { title: "Shop", version: "1.0.0", description: "The API of the shop" },
  servers: [{ url: "https://api.example.com" }],
  tags: { users: "The users of the shop" },
  securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
  security: [{ bearer: [] }],
});
```

### 2.2 The operations

Every handler of the graph is one operation, unless it is hidden: `hidden:
true`
in the `@Doc` of the handler, of its controller or of its feature.

| In the document | From                                                                                          |
| --------------- | --------------------------------------------------------------------------------------------- |
| the path        | the four route levels, joined as `@chojs/web` joins them; a parameter `:id` is written `{id}` |
| the operation   | the HTTP method, lower case: `get`, `post`, `put`, `patch`, `delete`, `head`, `options`       |
| `operationId`   | `operationId` of the `@Doc` of the handler; default: `UsersController.update`                 |
| `tags`          | the `tags` of the feature, of the controller and of the handler, added up, each one once      |
| `summary`       | `summary` of the `@Doc` of the handler                                                        |
| `description`   | `description` of the `@Doc` of the handler                                                    |
| `deprecated`    | `true` when the handler, its controller or its feature is deprecated                          |
| `security`      | `security` of the nearest `@Doc`: the handler, then the controller, then the feature          |

- **A handler with no tag** has the name of its controller, without a
  `Controller` suffix: `UsersController` gives `Users`.
- **Two operations with one `operationId`** throw: OpenAPI requires them to be
  unique.
- **`security: []`** on a `@Doc` says that the operation is public, whatever the
  document requires. Without any `security`, the operation has none of its own:
  the one of the document applies.
- **A `security` that names a scheme** the `securitySchemes` option does not
  have throws: the one of a `@Doc`, and the `security` option of the document.
- The `description` of a controller or of a feature is not in the document: the
  `tags` option describes a tag.
- The paths are in the order of the graph, and so are the operations of a path.

### 2.3 The parameters and the request body

From the arguments of the handler (`@Args`). An argument made by `Param`,
`Query`, `Header`, `Body` or `Form` carries what it reads; a function of the
application's own carries nothing, and is not in the document.

| Argument           | In the document                                                         |
| ------------------ | ----------------------------------------------------------------------- |
| `Param("id", v)`   | a parameter `id`, `in: path`, `required: true`, with the schema of `v`  |
| `Param(v)`         | one `in: path` parameter for each property of the schema of `v`         |
| `Query("page", v)` | a parameter `page`, `in: query`, with the schema of `v`                 |
| `Query(v)`         | one `in: query` parameter for each property of the schema of `v`        |
| `Header("x", v)`   | a parameter `x`, `in: header`, with the schema of `v`                   |
| `Header(v)`        | one `in: header` parameter for each property of the schema of `v`       |
| `Body(v)`          | the `requestBody`, `application/json`, required, with the schema of `v` |
| `Body("name", v)`  | a property `name` of an `application/json` request body                 |
| `Form(v)`          | the `requestBody`, `application/x-www-form-urlencoded`                  |
| `Form("name", v)`  | a property `name` of an `application/x-www-form-urlencoded` body        |

- **Without a validator**, a parameter is a string (`{ type: "string" }`), and a
  body has no schema (`{}`).
- **Every parameter of the path is in the document**, as OpenAPI requires: one
  that no `Param` argument reads is a required string.
- **A parameter read by its key is not marked required**, except in the path: a
  JSON Schema of one value does not say whether the value may be missing.
- **An argument that reads a whole source** (`Query(v)`) gives a parameter for
  each property of the schema, required when the schema requires it. A schema
  that is not an object with properties gives none. `Query()`, `Param()` and
  `Header()`, with no validator, give none.
- **Several `Body("name", v)`** are the properties of one object. None is marked
  required, and neither is the request body: only a whole `Body(v)` or `Form(v)`
  makes it required.
- **The parameters of the path come first**, in the order of the path, then the
  others in the order of the arguments.
- **`Body` and `Form` on one handler** give a request body with both media
  types.
- A parameter that two arguments read is in the document once: the first one
  that has a schema.

### 2.4 The responses

From `responses` of the `@Doc` of the handler, by status:

| `@Doc`        | In the document                                                         |
| ------------- | ----------------------------------------------------------------------- |
| `description` | `description`; default: the reason phrase of the status (`"Not Found"`) |
| `schema`      | `content`, with the schema of the validator                             |
| `contentType` | the media type of the `content`; default: `application/json`            |

A `contentType` with no `schema` gives the media type alone: what an image or a
file is. So does a `schema` whose validator has no schema.

What is added when the handler does not declare it:

| Handler                                                        | Response                                                         |
| -------------------------------------------------------------- | ---------------------------------------------------------------- |
| with no `2xx` response                                         | `200`, `"OK"`                                                    |
| an `@Sse` handler, with no `2xx` response                      | `200`, `text/event-stream`, with the schema `{ type: "string" }` |
| covered by `validate()`, with an argument that has a validator | `400`, `"The request is not valid"`                              |

The `400` has no schema: `onInvalid` of `validate()` decides its body, and the
graph does not hold it.

### 2.5 The schemas

A validator is a [Standard Schema](https://standardschema.dev/), or an object
with a `parse` method (`core/specs.md`, section 5): `@chojs/web` does not know
its schema. `@chojs/openapi` finds it, in this order:

1. **The validator gives it.** A validator that implements
   [Standard JSON Schema](https://standardschema.dev/json-schema)
   (`validator["~standard"].jsonSchema`) is asked, with the target
   `draft-2020-12`. Zod 4.2 and later does, and ArkType 2.1.28 and later: the
   tests run a schema of each. The two interfaces share the `~standard` key, so
   one object validates a request and documents it. A validator that has only
   one of the two is fine: a schema of Valibot validates and gives no JSON
   Schema by itself, and an object with a `parse` method can have a `~standard`
   key that only documents.
2. **The application gives it.** `toJsonSchema(validator, io)` of the options is
   called with the validator and `"input"` or `"output"`. It returns a JSON
   Schema, or `undefined`.
3. **There is none.** The argument or the response is in the document with no
   schema (`{}`), and a line is logged to the `cho:openapi` debug context.

```ts
import { z } from "zod";

// only needed for a validator that does not give its own schema
openApiDocument(app, {
  info,
  toJsonSchema: (validator, io) =>
    validator instanceof z.ZodType
      ? z.toJSONSchema(validator, { io })
      : undefined,
});
```

- **Arguments are asked for the input** of the validator, what a client sends,
  and **responses for the output**, what the handler gives.
- **A conversion that throws** is logged, and the next source is asked: the
  application after the validator, then none. The document is still made.
- **A validator is converted once** for each direction, however many handlers
  use it.
- `$schema` is removed from a schema: the document has one dialect.
- **Schemas are inlined**, where they are used. A schema that has `$defs` cannot
  be: in a document, `#/$defs/User` points to the root. So its `$defs` are moved
  to `components.schemas`, and its references are rewritten
  (`#/components/schemas/User`). Two different schemas with one name keep both:
  the second is `User2`. The `definitions` of an older draft are read the same
  way. A schema that refers to itself (`$ref: "#"`) becomes a component,
  `Schema`, and is referred to.

## 3. What `@Doc` gains

`@Doc` of `@chojs/web` is where an application says what its code cannot tell.
Three things an OpenAPI document needs were not in it:

| Option        | On                                 | Holds                                                                   |
| ------------- | ---------------------------------- | ----------------------------------------------------------------------- |
| `operationId` | a handler                          | the id of the operation; default: `UsersController.update`              |
| `security`    | a handler, a controller, a feature | what it requires: a list of `{ scheme: scopes }`. The nearest one wins  |
| `contentType` | a response                         | the media type of the body of the response; default: `application/json` |

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

They are options of `@chojs/web`, checked like the others: an unknown option
throws, `operationId` on a class throws, and a `security` that is not a list of
objects of lists of strings throws. `@chojs/web` does not know the schemes:
`openApiDocument` checks their names (section 2.2). They change nothing in how a
request is handled: `security` documents what a middleware enforces.

## 4. The page

```ts
function docsPage(options: DocsPageOptions): string;
```

`docsPage` returns the HTML of a page that loads a client of OpenAPI, and gives
it the URL of a document. The page is one small HTML file. The client comes from
a CDN, at an exact version: the package has no dependency, and carries no file
of a client.

| Option   | Default     | What it is                                                                   |
| -------- | ----------- | ---------------------------------------------------------------------------- |
| `url`    | required    | where the document is                                                        |
| `ui`     | `"swagger"` | the client: `"swagger"`, `"scalar"`, `"redoc"`, or a function (see below)    |
| `title`  | `"API"`     | the title of the page; the routes give the `title` of `info`                 |
| `assets` | the CDN     | where the files of the client are: for an application that hosts them itself |

| `ui`        | Client                                             | Package on the CDN      |
| ----------- | -------------------------------------------------- | ----------------------- |
| `"swagger"` | [Swagger UI](https://swagger.io/tools/swagger-ui/) | `swagger-ui-dist`       |
| `"scalar"`  | [Scalar](https://scalar.com)                       | `@scalar/api-reference` |
| `"redoc"`   | [Redoc](https://redocly.com/redoc)                 | `redoc`                 |

- **The versions are exact**, and written in the package: a page does not change
  until the package does. They are exported, as `UI_VERSIONS`: Swagger UI
  5.34.1, Scalar 1.76.4 and Redoc 2.5.4. Redoc 3 is loaded as a module, and is
  not the one the page loads.
- **`assets`** replaces the base URL of the files of the chosen client:
  `assets: "/static/swagger-ui"`. The names of the files stay the same.
- **Any other client**: `ui` is a function that receives `{ url, title }` and
  returns the HTML.

  ```ts
  docsPage({
    url: "/docs/openapi.json",
    ui: ({ url, title }) => `<!doctype html><title>${title}</title>…`,
  });
  ```

- The `title` and the `url` are escaped in the HTML of the three clients. A
  function of the application's own escapes what it writes.
- **A content security policy** of the application has to allow the CDN, and the
  inline script of the page. The README says what to allow for each client.

## 5. The routes

Two routes answer, under one base route, `docs` by default:

| Route                      | Answers                              |
| -------------------------- | ------------------------------------ |
| `GET <route>`              | the page: `text/html; charset=utf-8` |
| `GET <route>/openapi.json` | the document: `application/json`     |

- **They are mounted** on the application, with `app.mount` of `@chojs/web`
  (`web/specs.md`, section 6): they are in `app.routes`, they run on every
  adapter, and they are not in `app.graph`.
- **So they are not in the document**, with nothing to hide: the document is
  made from the graph.
- **They are not under the global prefix.** The prefix is the application's:
  with `prefix: "api"`, the page is still `/docs`. The `route` option says the
  whole path.
- **The document is made once, when `openApi` is called**, and kept: the graph
  of an application does not change after it is created. A document that cannot
  be made (section 8) throws there, before the server starts, and nothing is
  mounted.
- **The page is mounted first**, then the document. They are named
  `openApi page` and `openApi document`, in `app.routes` and in the logs.
- **The page finds the document by itself**: its URL is the path of the request
  for the page, with `/openapi.json`. Behind a proxy that changes the paths, the
  `servers` option says where the application is.

## 6. Mounting them: `openApi`

```ts
function openApi(app: ChoWeb<unknown>, options: OpenApiOptions): void;
```

`openApi` mounts the two routes of section 5 on an application that is created.
It is called between `ChoWeb.create` and the start of the server.

```ts
const app = await ChoWeb.create(AppModule, { prefix: "api" });
const config = await app.injector.resolve(Config);

openApi(app, {
  info: { title: "Shop", version: config.version },
  servers: [{ url: config.publicUrl }],
  route: "internal/docs",
  ui: "scalar",
  securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
  security: [{ bearer: [] }],
  middlewares: [onlyAdmins],
});

await serve(app.handler);
```

### 6.1 The options

Those of the document (section 2.1), and:

| Option        | Default     | What it is                                                                    |
| ------------- | ----------- | ----------------------------------------------------------------------------- |
| `route`       | `"docs"`    | the base route of the two routes, written like the route of a decorator       |
| `ui`          | `"swagger"` | the client of the page, below                                                 |
| `assets`      | the CDN     | where the files of the client are (section 4)                                 |
| `middlewares` | none        | middleware functions of `@chojs/web`, for the two routes: authentication, say |

| `ui`        | The page shows                                                       |
| ----------- | -------------------------------------------------------------------- |
| `"swagger"` | [Swagger UI](https://swagger.io/tools/swagger-ui/)                   |
| `"scalar"`  | [Scalar](https://scalar.com)                                         |
| `"redoc"`   | [Redoc](https://redocly.com/redoc)                                   |
| a function  | any other client: `({ url, title }) => string`, the HTML of the page |
| `false`     | no page: the document only, at `<route>/openapi.json`                |

The title of the page is the `title` of `info`.

### 6.2 What follows from mounting

- **The application has a graph when `openApi` is called.** So everything is
  known at once: the options are checked, the document is made, and a mistake
  throws from `openApi`, before the server starts.
- **The options can come from the application**: its injector is created, so
  what a provider knows (the version, the public URL) is there to read, as
  above.
- **The middlewares are functions.** A mounted route is not declared, so no
  middleware of a feature or of a controller runs for it, and no `@Catch`
  handler: it has the `middlewares` it is given. A middleware of the adapter
  that wraps every request, such as `cors` of `@chojs/vendor-cho`, runs for it
  as for the others.
- **Mount before the application serves.** Later, the adapter decides: Hono and
  Fastify throw.
- **`openApi` twice** on one application, with one `route`, throws: the routes
  exist. With two routes, the application has two documentations, each with its
  own options.
- **They are the last routes.** Where the first declared route wins (the
  built-in router, Hono), a route of the application that matches `/docs`
  answers first: a `@Get(":slug")` at the root does. Choose a `route` no
  declared route matches.
- **Turning the documentation off** somewhere, in production say, is the
  application's: it does not call `openApi` there.

  ```ts
  if (!production) {
    openApi(app, { info });
  }
  ```

`openApiDocument` and `docsPage` are public by themselves: an application that
wants the document somewhere else, in a file or on a controller of its own,
calls them.

## 7. Public API

| Export                   | What it is                                                        |
| ------------------------ | ----------------------------------------------------------------- |
| `openApi`                | `(app, options) => void`: mounts the two routes (section 6)       |
| `openApiDocument`        | `(app, options) => OpenApiDocument` (section 2)                   |
| `docsPage`               | `(options) => string` (section 4)                                 |
| `UI_VERSIONS`            | the version of each client the page loads                         |
| `OpenApiOptions`         | the options of `openApi`: those of the document, and its own      |
| `OpenApiDocumentOptions` | the options of the document                                       |
| `OpenApiDocument`        | an OpenAPI 3.1 document: its own types, written in the package    |
| `DocsPageOptions`        | the options of the page                                           |
| `DocsUi`                 | `"swagger" \| "scalar" \| "redoc"`, or a function                 |
| `ToJsonSchema`           | `(validator, io: "input" \| "output") => JsonSchema \| undefined` |
| `SchemaIo`               | `"input" \| "output"`                                             |
| `DocsPage`               | `{ url, title }`: what a `ui` function receives                   |
| `OpenApiOperation`, …    | the types of the parts of a document                              |
| `JsonSchema`             | a JSON Schema, as a plain object                                  |

## 8. Errors

Every mistake is a `ChoError` with a `code` (`core/specs.md`, section 2.8). The
code is part of the API; the messages are for people, and can change. The codes
of this package start with `CHO_OPENAPI_` (type `ChoOpenApiErrorCode`); a
mistake the core or `@chojs/web` finds has a code of theirs.

Thrown by `openApiDocument`, and so by `openApi`, which makes the document when
it is called:

| Mistake                               | Code                                  | Message                                                                                                                                 |
| ------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| No `info`, or no title or version     | `CHO_OPENAPI_INVALID_OPTION`          | `openApiDocument(): the "info" option is required: { title: "My API", version: "1.0.0" }`                                               |
| An unknown option                     | `CHO_CORE_UNKNOWN_OPTION`             | `openApiDocument(): unknown option "<name>". Known options: externalDocs, info, security, securitySchemes, servers, tags, toJsonSchema` |
| Two operations with one `operationId` | `CHO_OPENAPI_DUPLICATE_OPERATION_ID`  | `openApiDocument(): the operationId "<id>" is used by <Controller.method> and <Controller.method>`                                      |
| A `security` with an unknown scheme   | `CHO_OPENAPI_UNKNOWN_SECURITY_SCHEME` | `openApiDocument(): <Controller.method> requires the security scheme "<name>", which is not in the "securitySchemes" option`            |
| The same, for the `security` option   | `CHO_OPENAPI_UNKNOWN_SECURITY_SCHEME` | `openApiDocument(): the "security" option requires the security scheme "<name>", which is not in the "securitySchemes" option`          |
| No options                            | `CHO_OPENAPI_INVALID_OPTION`          | `openApiDocument(): expected options, such as { info: { title: "My API", version: "1.0.0" } }`                                          |

Thrown by `openApi`, when it is called:

| Mistake                             | Code                         | Message                                                                                                                                                         |
| ----------------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No `info`, or no title or version   | `CHO_OPENAPI_INVALID_OPTION` | `openApi(): the "info" option is required: { title: "My API", version: "1.0.0" }`                                                                               |
| An unknown option                   | `CHO_CORE_UNKNOWN_OPTION`    | `openApi(): unknown option "<name>". Known options: assets, externalDocs, info, middlewares, route, security, securitySchemes, servers, tags, toJsonSchema, ui` |
| An unknown client                   | `CHO_OPENAPI_UNKNOWN_UI`     | `openApi(): unknown ui "<name>". Known: redoc, scalar, swagger, false, or a function that returns the HTML`                                                     |
| A route that is not valid, or taken | the one of `app.mount`       | the error of `app.mount` (`web/specs.md`, section 9): `CHO_WEB_INVALID_ROUTE`, `CHO_WEB_DUPLICATE_ROUTE`                                                        |
| A middleware that is not a function | the one of `app.mount`       | the error of `app.mount`: `CHO_WEB_INVALID_MIDDLEWARE`                                                                                                          |

Thrown by `docsPage`:

| Mistake           | Code                         | Message                                                                                               |
| ----------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| No `url`          | `CHO_OPENAPI_INVALID_OPTION` | `docsPage(): the "url" option is required: where the OpenAPI document is`                             |
| An unknown client | `CHO_OPENAPI_UNKNOWN_UI`     | `docsPage(): unknown ui "<name>". Known: redoc, scalar, swagger, or a function that returns the HTML` |

A validator that cannot be converted is not an error (section 2.5).

## 9. Runtime support

Every runtime `@chojs/web` runs on: Deno, Node.js, Bun and edge runtimes. Making
the document and the page uses the language alone. The package has no
dependency.

The page needs a browser that can reach the CDN, or the `assets` option.

## 10. Decisions

`→` marks the choice.

| #  | Question                                 | → Chosen                                                                         | Alternative                                                                                                             | Section |
| -- | ---------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------- |
| 1  | The version of OpenAPI                   | 3.1.1: every client reads it, and its schemas are JSON Schema                    | 3.2, new in the clients; 3.0, with its own schema dialect                                                               | 2       |
| 2  | Where the files of the client come from  | a CDN, at an exact version                                                       | files in the package                                                                                                    | 4       |
| 3  | Which clients are ready                  | Swagger UI, Scalar and Redoc, and a function for any other                       | Swagger UI alone                                                                                                        | 4       |
| 4  | Who turns a validator into a schema      | the validator (Standard JSON Schema), then `toJsonSchema`                        | `toJsonSchema` alone                                                                                                    | 2.5     |
| 5  | A validator with no schema               | in the document without a schema, and logged                                     | an error                                                                                                                | 2.5     |
| 6  | What the graph does not know             | `@Doc` gains `operationId`, `security` and `contentType`                         | options of the document, and a function that changes it                                                                 | 3       |
| 7  | Where a schema is written                | inlined; `$defs` moved to `components.schemas`                                   | a named component for every validator                                                                                   | 2.5     |
| 8  | The default tag                          | the controller, without `Controller`                                             | no tag; the feature                                                                                                     | 2.2     |
| 9  | The default `operationId`                | `UsersController.update`, as `@chojs/web` names a route                          | made from the method and the path                                                                                       | 2.2     |
| 10 | A parameter read by its key              | not marked required, except in the path                                          | calling `parse(undefined)` to find out                                                                                  | 2.3     |
| 11 | The response of a handler that says none | `200`, `"OK"`                                                                    | a `default` response                                                                                                    | 2.4     |
| 12 | The `400` of `validate()`                | added, with no schema                                                            | not added; added with the default body                                                                                  | 2.4     |
| 13 | When the document is made                | when `openApi` is called, once: a mistake stops the application before it serves | on the first request; on every request                                                                                  | 5       |
| 14 | Where the page finds the document        | the path of the request for the page, with `/openapi.json`                       | an option                                                                                                               | 5       |
| 15 | Whether the documentation is on          | the application calls `openApi`, or does not                                     | an `enabled` option                                                                                                     | 5       |
| 16 | The types of the document                | written in the package                                                           | a dependency (`openapi-types`)                                                                                          | 7       |
| 17 | How the routes are added                 | mounted on the application, after it is created: `openApi(app, options)`         | a function that makes a module, for `imports`; a controller the application extends; a handler around the application's | 6       |
| 18 | How the routes reach the graph           | they are mounted when it exists: `openApi` has the application                   | the context of a request; a provider of `@chojs/web`                                                                    | 6       |
| 19 | Whether the two routes are in the graph  | no: nothing to hide from the document                                            | declared routes, hidden with `@Doc`                                                                                     | 5       |
| 20 | The global prefix                        | not for the two routes: the prefix is the application's                          | under the prefix                                                                                                        | 5       |
| 21 | The names                                | `openApi` mounts, `openApiDocument` makes the document                           | one function for both                                                                                                   | 7       |

## 11. Not in this version

- **OpenAPI 3.2**, and with it the schema of the events of an `@Sse` handler.
- **A named component for a validator**: every use is inlined (section 2.5).
- **Examples** of a request or a response.
- **Multipart bodies**, and files: `Form` reads URL-encoded forms.
- **Response headers**, links, callbacks and webhooks.
- **The responses of an `HttpError`.** A handler that throws
  `new HttpError(404, …)` (`web/specs.md`, section 5.1) answers `404`, and the
  document does not know: `@Doc` declares the response, as for any other.
- **A function that changes the document** before it is served.
  `openApiDocument` returns a plain object: an application that serves it from a
  controller of its own can change it.
- **A middleware class**, an error handler of their own, and `@Args` for the two
  routes: a mounted route takes functions (`web/specs.md`, section 6).
- **YAML.** The document is JSON.
- **Subresource integrity** of the files of the CDN. The versions are exact.
- **The files of a client in the package**, for an application with no access to
  a CDN: it hosts them, and gives `assets`.
- **`@chojs/message`**: an AsyncAPI document of the topics would be another
  extra.

## 12. What this changes in the other packages

- **`@chojs/web`: `@Doc` gains three options** (section 3): `operationId` and
  `security` in `ChoWebDoc`, and `contentType` in `ChoWebDocResponse`. Section
  3.3 of `web/specs.md` lists them, and no longer says that generating the
  document is not specified.
- **`@chojs/web`: `app.mount()`**, and `mount()` of a linked application
  (`web/specs.md`, sections 6 and 7): a route can be added to an application
  that is created. It is the only way the two routes are added.
- **Every adapter gains `mount()`**: the built-in router, `@chojs/vendor-hono`
  and `@chojs/vendor-fastify`. It is a required member of `Linked`.
- **`@chojs/core`: nothing.** Modules are still not configured (`core/specs.md`,
  section 2.4): the package declares no module.
- **The workspace**: `./extras/openapi` joins the `workspace` of the root
  `deno.json`, the release configuration with the linked versions, and the
  tables of the root `README.md` and of `extras/README.md`. The package has to
  exist on JSR before the next release.
- **The documentation site**: the page `web/api-docs.md` says that `@Doc`
  publishes no documentation endpoint, and shows how to read the graph by hand.
  It gains the package.
