# @chojs/openapi: tasks

What was done for `specs.md`, and what is left.

The order is: `@chojs/web`, then every adapter (`web/tasks.md`, groups 1 to 6),
then this package. Groups 2 to 6 below read the graph alone, and can be done
before; group 7 needs `app.mount`.

## 0. Decisions

- [x] Where the files of the client come from: a CDN, with Swagger UI, Scalar
      and Redoc ready, and a function for any other
- [x] Who turns a validator into a JSON Schema: the validator (Standard JSON
      Schema), then the `toJsonSchema` option
- [x] What the graph does not know: `@Doc` of `@chojs/web` gains options
- [x] How an application adds the routes: `openApi(app, options)` mounts them,
      after the application is created
- [x] The two routes are in `app.routes`, not in the graph, and not under the
      global prefix
- [ ] Read the decisions that were made while writing the spec (`specs.md`,
      section 10, numbers 1, 7 to 16 and 21), and say which to change. The three
      options `@Doc` gains (section 3) are among them

## 1. `@chojs/web`, and the adapters

Done first: `web/tasks.md`.

- [x] `app.mount()`, and `mount()` of every adapter (groups 1, 2, 4, 5 and 6)
- [x] The options `@Doc` gains (group 3)

## 2. The package

- [x] `extras/openapi`: `deno.json` (`@chojs/openapi`, the version of the
      others, no dependency), `mod.ts`, `LICENSE`
- [x] `./extras/openapi` in the `workspace` of the root `deno.json`
- [x] `tsconfig.json`: nothing to add, unless a test imports the package by its
      name
- [x] The types of an OpenAPI 3.1 document, as far as the package writes it:
      `OpenApiDocument`, and `JsonSchema`

## 3. The document: operations

`specs.md`, sections 2.1 and 2.2.

- [x] `openApiDocument(app, options)`: the options are checked; `info` is
      required
- [x] One operation for each handler: the path, with `{id}`; the method
- [x] `hidden`, on the three levels
- [x] `operationId`, and the error of a duplicate
- [x] `tags`: added up, each once; the default tag; the `tags` option
- [x] `summary`, `description`, `deprecated` on the three levels
- [x] `security`: the nearest `@Doc`; `[]`; the error of an unknown scheme;
      `securitySchemes` and `security` of the document
- [x] `servers`, `externalDocs`
- [x] A test compares every path of the document with `app.routes`: the join of
      the levels is written twice, here and in `@chojs/web`

## 4. The document: parameters, bodies and responses

`specs.md`, sections 2.3 and 2.4.

- [x] `Param`, `Query` and `Header`, with a key: a parameter
- [x] The same with no key: one parameter for each property of the schema
- [x] A parameter of the path that no argument reads
- [x] `Body` and `Form`: whole, by key, several keys, both on one handler
- [x] An argument of the application's own is left out
- [x] Responses of `@Doc`: the description, its default, the schema, the
      `contentType`
- [x] The responses that are added: `200`, the event stream of `@Sse`, the `400`
      of `validate()`

## 5. The schemas

`specs.md`, section 2.5.

- [x] Standard JSON Schema: read `~standard.jsonSchema`, with the target
      `draft-2020-12`, `input` and `output`
- [x] Zod implements it, from 4.2: checked in its source, and said in the README
- [ ] ArkType and Valibot: one source says ArkType 2.1.28 does, and that Valibot
      needs `toStandardJsonSchema()` of `@valibot/to-json-schema`. Not checked
      against their documentation, so not in the README
- [x] `toJsonSchema` of the options
- [x] No schema: `{}`, and a line in `cho:openapi`; a conversion that throws
- [x] One conversion for each validator and direction
- [x] `$schema` removed; `$defs` moved to `components.schemas`, with the
      references rewritten; two schemas with one name
- [ ] A test with a real Zod schema, as a development dependency only. It needs
      an approval: it installs a package. The tests use validators written by
      hand, with the interface of Standard JSON Schema

## 6. The page

`specs.md`, section 4.

- [x] `docsPage(options)`: Swagger UI, Scalar, Redoc, and a function
- [x] Choose the exact version of each client, and export `UI_VERSIONS`
- [x] `assets`
- [x] The `title` and the `url` are escaped
- [x] Open each of the three pages in a browser, with a real document: the
      operations show, and "try it out" calls the application
- [ ] What a content security policy has to allow, for each client. The README
      says what the page itself loads; what each client then needs was not tried
      in a browser. `secureHeaders` of `@chojs/vendor-cho` sets no policy by
      default

## 7. Mounting the routes

`specs.md`, sections 5 and 6. Needs `app.mount` of `@chojs/web`.

- [x] `openApi(app, options)`: the options are checked when it is called
- [x] It mounts `GET <route>` and `GET <route>/openapi.json`
- [x] `route`: its default; not under the global prefix
- [x] `ui`: `"swagger"`, `"scalar"`, `"redoc"`, a function, and `false`, which
      mounts the document only
- [x] `assets`; the title of the page is the `title` of `info`
- [x] `middlewares`: they run for the two routes
- [x] The document is made once, when `openApi` is called: a document that
      cannot be made throws there, and nothing is mounted
- [x] The page finds the document: with no prefix, with a global prefix
- [x] The two routes are in `app.routes`, and not in the document
- [x] `openApi` twice: the same route throws; two routes give two documentations
- [x] On each adapter: the built-in router, `@chojs/vendor-hono`,
      `@chojs/vendor-fastify`, served the way each one is served
- [x] A declared route that matches `/docs` answers first, on the built-in
      router and on Hono: say so in the README

## 8. The runtimes

- [x] The tests pass on Deno, Node.js and Bun
- [x] `deno check`, `deno lint`, `deno fmt`, and `deno publish --dry-run`
- [x] No API of Node.js is used: the document and the page are made with the
      language alone. Not run on an edge runtime

## 9. The documentation

- [x] `extras/openapi/README.md`
- [x] An example: `examples/openapi-http.ts`
- [x] `extras/README.md`: the table of packages
- [x] The root `README.md`: the tables of packages; `CONTRIBUTING.md`
- [x] `specs.md`: the status at its top, and what the implementation settled
- [ ] The documentation site, in its own repository: a page for the package, and
      `web/api-docs.md`, which says today that `@Doc` publishes no endpoint

## 10. The release

- [x] `release-please-config.json`, with the linked versions, and
      `.release-please-manifest.json`
- [ ] `@chojs/openapi` is created on JSR, in the `@chojs` scope, and linked to
      the repository. Until then `deno publish` fails for it
