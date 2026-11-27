# @chojs/asyncapi

> **Status: implemented.** Section 10 lists every decision this document makes,
> with the alternative that was not chosen, section 11 what is left out, and
> section 12 what it changed in the other packages.

The documentation of a message application, from what the application already
declares. `@chojs/asyncapi` reads the graph of a `@chojs/message` application,
makes an
[AsyncAPI](https://www.asyncapi.com/docs/reference/specification/v3.0.0)
document of its topics, and serves it on a web application, with a page that
shows it. It is to `@chojs/message` what `@chojs/openapi` is to `@chojs/web`
(`extras/openapi/specs.md`).

It is an extra (`extras/README.md`): it reads the graph, so it lives next to the
framework.

## 1. Overview

The documentation is on a web server. An application that handles messages and
wants its documentation has a `ChoWeb`, and its consumers are made on the
injector of that web application (`message/specs.md`, section 6.5):

```ts
import { ChoWeb } from "@chojs/web";
import { serve } from "@chojs/web/serve";
import { ChoMessage } from "@chojs/message";
import { asyncApi } from "@chojs/asyncapi";

const web = await ChoWeb.create(AppModule);
const app = await ChoMessage.from(web.injector, { linker });

asyncApi(web, app, { info: { title: "Shop", version: "1.0.0" } });
// GET /asyncapi               the page
// GET /asyncapi/asyncapi.json the document

await serve(web.handler);
await app.start();
```

The package has three parts. Each one is usable without the next.

| Part             | What it is                                                                 | Section |
| ---------------- | -------------------------------------------------------------------------- | ------- |
| **The document** | `asyncApiDocument(app, options)`: the AsyncAPI document, as a plain object | 2       |
| **The page**     | `docsPage(document, options?)`: the HTML of a page that shows a document   | 4       |
| **The routes**   | `asyncApi(web, app, options)`: mounts the two routes that answer with them | 5, 6    |

Nothing is declared twice. The topics, the arguments and their schemas, and the
contracts are those of the handlers. What the code cannot tell is given with
`@Doc`, of `@chojs/message`.

```ts
export const GetPrice = contract({
  topic: "shop.orders.price",
  request: OrderId,
  reply: Price,
});

@Doc({ tags: ["orders"] })
@Middlewares(validate())
@Controller({ topic: "shop.orders" })
class OrdersController {
  @Doc({ summary: "An order was created" })
  @Subscribe("created")
  @Args(Value(Order), Header("tenant"))
  created(order: Order, tenant: string | undefined) {}

  @Subscribe(GetPrice)
  price(order: OrderId) {}
}
```

| Declared                               | In the document                                               |
| -------------------------------------- | ------------------------------------------------------------- |
| `@Subscribe("created")`, under its two | the channel `shop.orders.created`, and a `receive` operation  |
| `Value(Order)`                         | the `payload` of its message, `application/json`              |
| `Header("tenant")`                     | a property `tenant` of the `headers` of its message           |
| `@Doc({ summary })`                    | the `summary` of the operation                                |
| `@Doc({ tags })`                       | the tag `orders`                                              |
| `@Subscribe(GetPrice)`                 | the channel `shop.orders.price`, with the schema of `OrderId` |
| the `reply` of `GetPrice`              | the `reply` of the operation, with the schema of `Price`      |

## 2. The document

```ts
function asyncApiDocument(
  app: ChoMessage<unknown>,
  options: AsyncApiDocumentOptions,
): AsyncApiDocument;
```

`asyncApiDocument` reads `app.graph`. It does no I/O, calls no handler and no
middleware, and returns a new plain object each time: the application can change
it before it is served. The document is AsyncAPI **3.0.0**. The application need
not be started.

### 2.1 The options

| Option         | Default  | In the document                                                          |
| -------------- | -------- | ------------------------------------------------------------------------ |
| `info`         | required | `info`: `title` and `version` are required; any field of the Info Object |
| `id`           | none     | `id`: an identifier of the application, a URI                            |
| `servers`      | none     | `servers`: the brokers, by a name; each needs a `host` and a `protocol`  |
| `tags`         | none     | `info.tags`: a `description` for a tag, by name: `{ orders: "…" }`       |
| `externalDocs` | none     | `info.externalDocs`                                                      |
| `sends`        | none     | what the application sends: its contracts, by name (section 2.5)         |
| `toJsonSchema` | none     | not in the document: turns a validator into a JSON Schema (section 2.6)  |

An unknown option throws, and names the known ones. A server is written as it is
given: what the package does not read (`security`, `variables`, `bindings`) is
the application's.

```ts
asyncApiDocument(app, {
  info: { title: "Shop", version: "1.0.0", description: "The consumers" },
  servers: {
    production: { host: "kafka.example.com:9092", protocol: "kafka" },
  },
  tags: { orders: "The orders of the shop" },
  sends: { orderShipped: OrderShipped },
});
```

### 2.2 The channels and the operations

Every handler of the graph is one channel and one operation, unless it is
hidden: `hidden: true` in the `@Doc` of the handler, of its controller or of its
feature.

| In the document          | From                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------- |
| the key of the channel   | the whole topic of the handler: the four levels, joined with `.`, the prefix included |
| `address` of the channel | the same topic                                                                        |
| the key of the operation | `operationId` of the `@Doc` of the handler; default: `OrdersController.created`       |
| `action`                 | `receive`                                                                             |
| `channel`, `messages`    | references to the channel, and to its message                                         |
| `summary`, `description` | those of the `@Doc` of the handler                                                    |
| `tags`                   | the `tags` of the feature, of the controller and of the handler, added up, each once  |
| `reply`                  | the reply of the handler, when it has one (section 2.4)                               |

- **A channel has one message**, under the key `message`: a topic of
  `@chojs/message` has one handler, and one kind of message (`message/specs.md`,
  section 2.1).
- **A handler with no tag** has the name of its controller, without a
  `Controller` suffix: `OrdersController` gives `Orders`.
- **Two operations with one key** throw: two controllers with one name and one
  method name, an `operationId` that another handler has, or a name of `sends`
  that a handler has. An `operationId` tells them apart.
- The `tags` option describes a tag: there is no description of a controller or
  of a feature.
- The channels and the operations are in the order of the graph, then those of
  `sends`.

### 2.3 The message

From the arguments of the handler (`@Args`). An argument made by `Value`, `Key`
or `Header` carries what it reads; a function of the application's own carries
nothing, and is not in the document.

| Argument           | In the document                                                   |
| ------------------ | ----------------------------------------------------------------- |
| `Value(v)`         | the `payload`: the schema of `v`; `contentType: application/json` |
| `Value()`          | `contentType: application/json`, and no `payload`                 |
| `Value("name", v)` | a property `name` of an object `payload`; `application/json`      |
| `Header("x", v)`   | a property `x` of the `headers`, with the schema of `v`           |
| `Header("x")`      | a property `x` of the `headers`, a string                         |
| `Header(v)`        | the `headers`: the schema of `v`, when it is an object            |
| `Key(v)`, `Key()`  | `x-key`: the schema of `v`, or a string                           |
| `@Subscribe(c)`    | as `Value(c.request)`: the handler of a contract                  |

- **The `name` of a message is its topic.**
- **A handler with no `Value` argument** has a message with no `contentType` and
  no `payload`: it reads the context itself, and nothing says how.
- **Several `Value("name", v)`** are the properties of one object. None is
  marked required: the schema of one property does not say whether it may be
  missing. A whole `Value(v)` on the same handler wins.
- **`Header(v)` and `Header("x", v)` on one handler**: the properties read one
  by one are added to those of the whole schema, which says more of its own.
  `Header()`, and a `Header(v)` whose schema is not an object, give nothing.
- **The key is an extension**, `x-key`. AsyncAPI has the key of a message in the
  bindings of a broker only (Kafka), and the document has no bindings (section
  11). An extension is valid on a Message Object, and the page shows it.
- **A handler that `validate()` does not cover is documented the same**: the
  document says what the handler expects.

### 2.4 The reply

A handler has a reply in the document when something declares it:

| Declared                                   | The reply                                                  |
| ------------------------------------------ | ---------------------------------------------------------- |
| a contract with a `reply`                  | the schema of its `reply`; `contentType: application/json` |
| `@Doc({ reply: { description, schema } })` | the `description`, and the schema of `schema`              |
| both                                       | the schema of the contract, the description of `@Doc`      |
| neither                                    | none                                                       |

- **The reply is a channel of its own**, `<topic>/reply`, with one message,
  under the key `reply`, named `<topic>.reply`. A `/` is not a character of a
  topic, so the key is never the one of another channel. In a reference it is
  written `~1`: `#/channels/shop.orders.price~1reply`.
- **Its `address` is `null`**: who asks says where the reply goes, with each
  request. That is what AsyncAPI writes for an address that is not known before.
- **The reply of a handler with no contract has no `contentType`**: such a
  handler replies with bytes, with a text or with JSON (`message/specs.md`,
  section 3.3), and nothing says which. A contract speaks JSON both ways.
- A `reply.schema` on a handler whose contract has a `reply` is refused by
  `@chojs/message`, when the application is created (`message/specs.md`, section
  3.7).
- A broker with no replies (Kafka) drops a reply. The document says what the
  handler returns, whatever the broker is.

### 2.5 What the application sends

The graph of an application knows what it handles, and not what it sends: a
`ChoMessageClient` is called from anywhere. The `sends` option says it, with the
contracts the application sends, by the key of their operation:

```ts
asyncApiDocument(app, {
  info,
  sends: { orderShipped: OrderShipped, getStock: GetStock },
});
```

| In the document          | From                                                             |
| ------------------------ | ---------------------------------------------------------------- |
| the key of the operation | the name in `sends`                                              |
| `action`                 | `send`                                                           |
| the channel              | the topic of the contract, after the prefix of the application   |
| the message              | the schema of the `request` of the contract; `application/json`  |
| `reply`                  | the schema of the `reply` of the contract, when it has one (2.4) |

- **The prefix of the application is put before the topic**: who sends gives its
  client the prefix of who listens, and one environment has one prefix
  (`message/specs.md`, section 3.6).
- **A topic that is handled and sent** has one channel, with the message of the
  handler, and two operations.
- An operation of `sends` has no tag, no summary and no description.
- An entry that is not a contract, made by `contract()`, throws.

### 2.6 The schemas

A validator is a [Standard Schema](https://standardschema.dev/), or an object
with a `parse` method (`core/specs.md`, section 5). Its JSON Schema is found by
`Schemas` of `@chojs/core/utils` (`core/specs.md`, section 3.3), as in
`@chojs/openapi` (`extras/openapi/specs.md`, section 2.5):

1. **The validator gives it**, when it implements
   [Standard JSON Schema](https://standardschema.dev/json-schema). It is asked
   for the target `draft-07`: the schemas of AsyncAPI 3 are a superset of JSON
   Schema draft-07. Zod and ArkType do: the tests run a schema of each.
2. **The application gives it**: `toJsonSchema(validator, io)` of the options.
3. **There is none**: what the validator describes is in the document with no
   schema, and a line is logged to the `cho:asyncapi` debug context.

- **Every schema is the input of its validator**: what is on the wire. A request
  is validated by who handles it, and a reply by who asked (`message/specs.md`,
  section 3.6), so what is sent is what goes into the validator, on both sides.
  `toJsonSchema` is called with `"input"`.
- **A validator is converted once**, however many handlers use it, and each use
  has a copy of its own.
- `$schema` is removed from a schema: the document has one dialect.
- **Schemas are inlined**, and the definitions of a schema (`definitions`,
  `$defs`) are moved to `components.schemas`, with the references rewritten. A
  schema that refers to itself becomes a component, `Schema`.

## 3. What `@chojs/message` gains: `@Doc`

`@Doc` of `@chojs/message` is where an application says what its code cannot
tell about a consumer. It is specified in `message/specs.md`, section 3.7:

| Option        | On                                 | In the document                                    |
| ------------- | ---------------------------------- | -------------------------------------------------- |
| `summary`     | a handler                          | the `summary` of the operation                     |
| `description` | a handler                          | the `description` of the operation                 |
| `reply`       | a handler                          | the reply of the operation (section 2.4)           |
| `operationId` | a handler                          | the key of the operation                           |
| `tags`        | a handler, a controller, a feature | the `tags` of the operations under it              |
| `hidden`      | a handler, a controller, a feature | the handlers under it are left out of the document |

## 4. The page

```ts
function docsPage(
  document: AsyncApiDocument,
  options?: DocsPageOptions,
): string;
```

`docsPage` returns the HTML of a page that shows a document. The page is one
file: its markup, and its styles in a `<style>` element. **It loads nothing**:
no script, no stylesheet, no font and no image, from a CDN or from the
application. The package has no dependency for it, and an application with no
access to the internet shows the same page.

| Option  | Default               | What it is                                        |
| ------- | --------------------- | ------------------------------------------------- |
| `title` | the `title` of `info` | the title of the page                             |
| `url`   | none                  | where the document is, as JSON: the page links it |

What the page shows, from the document alone:

- **The head**: the title, the version and the description of `info`, the
  version of AsyncAPI, and links: the document, `externalDocs`, the terms of
  service, the license and the contact.
- **The servers**, in a table: the name, the host, the protocol and the
  description of each.
- **The navigation**: the operations, by tag, with what `info.tags` says of the
  tag, then the operations with no tag.
- **Each operation**: whether the application receives or sends, the address of
  its channel, its key, its summary, its description and its tags; then its
  message (the content type, the payload, the headers and the key), and its
  reply.
- **The schemas of `components.schemas`**, at the end: a reference to one of
  them is a link to it. So a schema that refers to itself is written once.

A schema is shown as a table of its properties:

- **A row for a property**: its name, whether it is required, its type
  (`string (date-time)`, `array of number`, `string | null`, `enum`, `one of`),
  and what the schema says of it: the description, the values of an `enum`, the
  default, and the limits (`minimum`, `maxLength`, `pattern`, …).
- **What is inside a property is under it**: the properties of an object, the
  items of a list, each alternative of a `oneOf`, an `anyOf` or an `allOf`, and
  what an object takes besides its properties (`additionalProperties`).
- **The schema as JSON** is under the table, in a `<details>`: it has what the
  table has no place for. Deeper than 12 levels, a schema is only there.

How the page is made:

- **No script.** What opens and closes is a `<details>` element. A content
  security policy has one thing to allow: the inline style of the page
  (`style-src 'unsafe-inline'`).
- **Light and dark** follow the browser (`prefers-color-scheme`), and the page
  is readable at the width of a phone.
- **Everything that comes from the document is escaped.** A URL of the document
  is a link only when it is `http`, `https` or `mailto`, or has no scheme.
- **A description is shown as it is written**, with its line breaks. AsyncAPI
  lets a description be Markdown: it is not rendered.
- **Any document is shown**, also one the application changed: a reference that
  points to nothing is written as it is.

## 5. The routes

Two routes answer, under one base route, `asyncapi` by default:

| Route                       | Answers                              |
| --------------------------- | ------------------------------------ |
| `GET <route>`               | the page: `text/html; charset=utf-8` |
| `GET <route>/asyncapi.json` | the document: `application/json`     |

They are the routes of `@chojs/openapi`, for another document
(`extras/openapi/specs.md`, section 5):

- **They are mounted** on the web application, with `web.mount` (`web/specs.md`,
  section 6): they are in `web.routes`, they run on every adapter, and they are
  not in `web.graph`. So they are not in the OpenAPI document of the application
  either.
- **They are not under the global prefix** of the web application. The `route`
  option says the whole path.
- **The document is made once, when `asyncApi` is called**, and kept: the graph
  of an application does not change after it is created. A document that cannot
  be made (section 8) throws there, before the server starts, and nothing is
  mounted.
- **The page is made once too**, for each path it is asked at: it is the same
  for every request, apart from its link to the document, which is the path of
  the request for the page, with `/asyncapi.json`. Behind a proxy that changes
  the paths, the link still follows what the browser asked.
- **The page is mounted first**, then the document. They are named
  `asyncApi page` and `asyncApi document`, in `web.routes` and in the logs.

## 6. Mounting them: `asyncApi`

```ts
function asyncApi(
  web: ChoWeb<unknown>,
  app: ChoMessage<unknown>,
  options: AsyncApiOptions,
): void;
```

`asyncApi` mounts the two routes of section 5. It takes the two applications:
the web application gets the routes, and the message application has the graph
that is documented. It is called once both are created, and before the server
starts.

```ts
const web = await ChoWeb.create(AppModule, { prefix: "api" });
const app = await ChoMessage.from(web.injector, { linker, prefix: "staging" });

openApi(web, { info }); //        GET /docs, GET /docs/openapi.json
asyncApi(web, app, { //            GET /internal/asyncapi, and its document
  info,
  route: "internal/asyncapi",
  middlewares: [onlyAdmins],
});

const server = await serve(web.handler);
await app.start();
```

### 6.1 The options

Those of the document (section 2.1), and:

| Option        | Default                 | What it is                                                              |
| ------------- | ----------------------- | ----------------------------------------------------------------------- |
| `route`       | `"asyncapi"`            | the base route of the two routes, written like the route of a decorator |
| `ui`          | the page of the package | a function for another page, or `false` for no page (below)             |
| `middlewares` | none                    | middleware functions of `@chojs/web`, for the two routes                |

| `ui`       | The page                                                                |
| ---------- | ----------------------------------------------------------------------- |
| not given  | the page of the package (section 4)                                     |
| a function | a page of the application's own: `({ document, url, title }) => string` |
| `false`    | no page: the document only, at `<route>/asyncapi.json`                  |

The title of the page is the `title` of `info`. A `ui` function is called once
for each path the page is asked at, and what it returns is kept.

### 6.2 What follows from mounting

- **The consumers are made on the injector of the web application**, with
  `ChoMessage.from(web.injector, options)` (`message/specs.md`, section 6.5):
  one module graph, one set of instances. `asyncApi` does not require it: it
  reads the graph of the message application it is given, wherever its injector
  comes from.
- **An application that is only a `ChoMessage`** (a worker) creates a `ChoWeb`
  for its documentation. The package has no server of its own.
- **The message application is only read.** It is not started, and need not be:
  the documentation is served with no broker.
- **The middlewares are functions**, and no middleware of the web application
  runs for a mounted route (`web/specs.md`, section 6).
- **Mount before the application serves.**
- **`asyncApi` twice**, with one `route`, throws: the routes exist. With two
  routes, there are two documentations, of one message application or of two.
- **Turning the documentation off** somewhere is the application's: it does not
  call `asyncApi` there.

`asyncApiDocument` and `docsPage` are public by themselves: an application that
wants the document somewhere else, in a file or on a controller of its own,
calls them.

## 7. Public API

| Export                    | What it is                                                        |
| ------------------------- | ----------------------------------------------------------------- |
| `asyncApi`                | `(web, app, options) => void`: mounts the two routes (section 6)  |
| `asyncApiDocument`        | `(app, options) => AsyncApiDocument` (section 2)                  |
| `docsPage`                | `(document, options?) => string` (section 4)                      |
| `AsyncApiOptions`         | the options of `asyncApi`: those of the document, and its own     |
| `AsyncApiDocumentOptions` | the options of the document                                       |
| `AsyncApiDocument`        | an AsyncAPI 3.0 document: its own types, written in the package   |
| `DocsPageOptions`         | the options of the page                                           |
| `DocsUi`                  | a function that returns the HTML of a page                        |
| `DocsPage`                | `{ document, url, title }`: what a `ui` function receives         |
| `ToJsonSchema`            | `(validator, io: "input" \| "output") => JsonSchema \| undefined` |
| `SchemaIo`                | `"input" \| "output"`                                             |
| `AsyncApiOperation`, …    | the types of the parts of a document                              |
| `JsonSchema`              | a JSON Schema, as a plain object                                  |
| `ChoAsyncApiErrorCode`    | the codes of the errors of the package                            |

## 8. Errors

Every mistake is a `ChoError` with a `code` (`core/specs.md`, section 2.8). The
code is part of the API; the messages are for people, and can change. The codes
of this package start with `CHO_ASYNCAPI_` (type `ChoAsyncApiErrorCode`); a
mistake the core, `@chojs/web` or `@chojs/message` finds has a code of theirs.

Thrown by `asyncApiDocument`, and so by `asyncApi`, which makes the document
when it is called. The message starts with the function that was called:

| Mistake                                  | Code                                  | Message                                                                                                                                   |
| ---------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| What is given is no message application  | `CHO_ASYNCAPI_INVALID_OPTION`         | `asyncApiDocument(): expected a message application, made by ChoMessage.create or ChoMessage.from, got <v>`                               |
| No options                               | `CHO_ASYNCAPI_INVALID_OPTION`         | `asyncApiDocument(): expected options, such as { info: { title: "My application", version: "1.0.0" } }`                                   |
| No `info`, or no title or version        | `CHO_ASYNCAPI_INVALID_OPTION`         | `asyncApiDocument(): the "info" option is required: { title: "My application", version: "1.0.0" }`                                        |
| `servers` is not an object of servers    | `CHO_ASYNCAPI_INVALID_OPTION`         | `asyncApiDocument(): the "servers" option is an object of servers, by name, such as { production: { host: …, protocol: … } }, got <v>`    |
| A server with no `host` or no `protocol` | `CHO_ASYNCAPI_INVALID_OPTION`         | `asyncApiDocument(): the server "<name>" needs a host and a protocol: { host: "kafka:9092", protocol: "kafka" }`                          |
| `sends` is not an object of contracts    | `CHO_ASYNCAPI_INVALID_OPTION`         | `asyncApiDocument(): the "sends" option is an object of contracts, by the id of the operation, such as { orderShipped: OrderShipped }, …` |
| An entry of `sends` is not a contract    | `CHO_ASYNCAPI_INVALID_OPTION`         | `asyncApiDocument(): "<name>" of the "sends" option must be a contract, made by contract(), got <v>`                                      |
| An unknown option                        | `CHO_CORE_UNKNOWN_OPTION`             | `asyncApiDocument(): unknown option "<name>". Known options: externalDocs, id, info, sends, servers, tags, toJsonSchema`                  |
| Two operations with one key              | `CHO_ASYNCAPI_DUPLICATE_OPERATION_ID` | `asyncApiDocument(): the operation id "<id>" is used by <Controller.method> and <Controller.method>`                                      |

Thrown by `asyncApi`, when it is called:

| Mistake                                        | Code                          | Message                                                                                                                                  |
| ---------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| The first argument is no web application       | `CHO_ASYNCAPI_INVALID_OPTION` | `asyncApi(): expected a web application, made by ChoWeb.create, then the message application, got <v>`                                   |
| A `ui` that is not a function, and not `false` | `CHO_ASYNCAPI_INVALID_OPTION` | `asyncApi(): the "ui" option is a function that returns the HTML of a page, or false for no page, got <v>`                               |
| An unknown option                              | `CHO_CORE_UNKNOWN_OPTION`     | `asyncApi(): unknown option "<name>". Known options: externalDocs, id, info, middlewares, route, sends, servers, tags, toJsonSchema, ui` |
| A route that is not valid, or taken            | the one of `web.mount`        | the error of `web.mount` (`web/specs.md`, section 9): `CHO_WEB_INVALID_ROUTE`, `CHO_WEB_DUPLICATE_ROUTE`                                 |
| A middleware that is not a function            | the one of `web.mount`        | the error of `web.mount`: `CHO_WEB_INVALID_MIDDLEWARE`                                                                                   |

Thrown by `docsPage`:

| Mistake                                   | Code                          | Message                                                                                        |
| ----------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| What is given is no document              | `CHO_ASYNCAPI_INVALID_OPTION` | `docsPage(): expected an AsyncAPI document, such as the one asyncApiDocument() makes, got <v>` |
| Options that are not an object            | `CHO_ASYNCAPI_INVALID_OPTION` | `docsPage(): expected options, such as { url: "/asyncapi/asyncapi.json" }, got <v>`            |
| A `title` or a `url` that is not a string | `CHO_ASYNCAPI_INVALID_OPTION` | `docsPage(): the "url" option is a string, got <v>`                                            |
| An unknown option                         | `CHO_CORE_UNKNOWN_OPTION`     | `docsPage(): unknown option "<name>". Known options: title, url`                               |

A mistake in a `@Doc` is found by `@chojs/message`, when the class is defined or
when the application is created (`message/specs.md`, section 9):
`CHO_MESSAGE_INVALID_OPTION`. A validator that cannot be converted is not an
error (section 2.6).

## 9. Runtime support

Every runtime both `@chojs/web` and `@chojs/message` run on: Deno, Node.js and
Bun. Making the document and the page uses the language alone. The package
depends on `@chojs/core`, `@chojs/message` and `@chojs/web`, and on nothing
else.

The page needs a browser, and nothing it has to reach.

## 10. Decisions

`→` marks the choice.

| #  | Question                                 | → Chosen                                                                       | Alternative                                                                | Section |
| -- | ---------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ------- |
| 1  | Where the page comes from                | made by the package: HTML and CSS, with no dependency                          | the React component of AsyncAPI, from a CDN                                | 4       |
| 2  | How the page is made                     | on the server, from the document, with no script                               | a page with a script, that reads the JSON document in the browser          | 4       |
| 3  | Where the documentation is served        | on a web application: `asyncApi(web, app, options)`                            | a server of its own, for an application with no `ChoWeb`                   | 6       |
| 4  | What the code cannot tell                | `@Doc` of `@chojs/message`, with what a consumer has                           | options of the document, far from the handler                              | 3       |
| 5  | Where the code of the schemas is         | in `@chojs/core/utils`, for the two packages that document an application      | a copy of it in each                                                       | 2.6     |
| 6  | The version of AsyncAPI                  | 3.0.0: every tool reads it. 3.1.0 only adds the bindings of ROS 2              | 3.1.0                                                                      | 2       |
| 7  | The dialect of the schemas               | JSON Schema draft-07, the one of AsyncAPI 3: the validator is asked for it     | draft 2020-12, with a `schemaFormat` on every schema                       | 2.6     |
| 8  | The direction of a schema                | the input of the validator, for a request and for a reply: what is on the wire | the output, which is what a handler reads after its validator              | 2.6     |
| 9  | The key of a channel                     | the whole topic, prefix included: a topic has one handler                      | the controller and the method                                              | 2.2     |
| 10 | The key of an operation                  | `OrdersController.created`, as a route is named, or `operationId` of `@Doc`    | made from the topic                                                        | 2.2     |
| 11 | Where a reply is                         | a channel of its own, `<topic>/reply`, with no address                         | no reply in the document; a channel named by the handler                   | 2.4     |
| 12 | The reply of a handler with no contract  | the `reply` of its `@Doc`                                                      | not in the document: only a contract says a reply                          | 2.4     |
| 13 | What the application sends               | the `sends` option: its contracts, by the key of their operation               | not in the document: the graph only knows what is handled                  | 2.5     |
| 14 | The key of a message                     | an extension of the message, `x-key`                                           | a binding of Kafka; not in the document                                    | 2.3     |
| 15 | A handler with no `Value` argument       | a message with no payload: nothing says what it reads                          | left out of the document                                                   | 2.3     |
| 16 | A validator with no schema               | in the document without a schema, and logged                                   | an error                                                                   | 2.6     |
| 17 | When the document and the page are made  | when `asyncApi` is called: a mistake stops the application before it serves    | on the first request; on every request                                     | 5       |
| 18 | Another page than the one of the package | `ui`: a function that returns the HTML, or `false` for no page                 | no option                                                                  | 6.1     |
| 19 | The default route                        | `asyncapi`                                                                     | under `docs`, next to the page of `@chojs/openapi`                         | 5       |
| 20 | The names                                | `asyncApi`, `asyncApiDocument`, `docsPage`: those of `@chojs/openapi`          | `asyncApiPage`, so that an application imports both pages with no new name | 7       |
| 21 | The types of the document                | written in the package                                                         | a dependency                                                               | 7       |
| 22 | A description, on the page               | shown as it is written                                                         | rendered as Markdown, with a parser written or installed                   | 4       |

## 11. Not in this version

- **A server for an application with no `ChoWeb`.**
- **Bindings**: of a server, a channel, an operation, a message. So the consumer
  group and the partitions of Kafka are not in the document, and the key of a
  message is an extension (section 2.3).
- **Security**: `components.securitySchemes`, and the `security` of an
  operation. A server of the `servers` option is written as it is given, with
  its own `security`.
- **Examples** of a message, **correlation ids**, **traits**, and the
  **parameters** of a channel: a topic of `@chojs/message` has none.
- **A named component for a message**: each is written in its channel.
- **The errors a `ReplyError` answers with** (`message/specs.md`, section 5.1).
- **A value that is not JSON**: Avro, Protobuf, a schema registry.
- **A tag, a summary or a description for what is sent**: an entry of `sends` is
  a contract, and nothing else.
- **`deprecated`**: an operation, a channel and a message of AsyncAPI have no
  such field.
- **YAML.** The document is JSON.
- **On the page**: a search, sending a message from the page, a sample of a
  message made from its schema, and Markdown. The first two need a script.
- **A page of its own for `@chojs/openapi`**: it loads its client from a CDN
  (`extras/openapi/specs.md`, section 4).
- **`cho`**: no command writes the document, and the template of a message
  consumer does not change.

## 12. What this changes in the other packages

- **`@chojs/message`: `@Doc`** (`message/specs.md`, section 3.7), with the types
  `ChoMessageDoc` and `ChoMessageDocReply`, and a new code,
  `CHO_MESSAGE_INVALID_OPTION`. The graph has what it declares: `doc` of a
  `FeatureRef`, a `ControllerRef` and a `MethodRef`.
- **`@chojs/message/graph`: `is_contract`**: whether a value is a contract. The
  `sends` option is checked with it.
- **`@chojs/core/utils`: `Schemas`**, with `JsonSchema`, `SchemaIo`,
  `SchemaTarget` and `ToJsonSchema` (`core/specs.md`, section 3.3). The code was
  in `@chojs/openapi`; it now takes the dialect of the document as an argument.
  `@chojs/core/utils/test_utils` gains the validators the two packages are
  tested with.
- **`@chojs/openapi`**: it imports the schemas from the core, and exports the
  same types. Nothing changed in what it does.
- **`@chojs/web`: nothing.** The routes are mounted with `web.mount`, which
  `@chojs/openapi` already needed.
- **The workspace**: `./extras/asyncapi` joins the `workspace` of the root
  `deno.json`, the release configuration with the linked versions, and the
  tables of the root `README.md` and of `extras/README.md`. The package has to
  exist on JSR before the next release.
- **The documentation site** has no page for the package yet.
