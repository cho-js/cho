# @chojs/asyncapi

[![JSR](https://jsr.io/badges/@chojs/asyncapi)](https://jsr.io/@chojs/asyncapi)
[![JSR score](https://jsr.io/badges/@chojs/asyncapi/score)](https://jsr.io/@chojs/asyncapi)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

The documentation of a [`@chojs/message`](../../message/README.md) application,
from what the application already declares: an
[AsyncAPI](https://www.asyncapi.com) document of its topics, and a page that
shows it, served by a [`@chojs/web`](../../web/README.md) application. The page
is made by the package: it loads nothing, and runs no script.

## Contents

- [Installation](#installation)
- [Usage](#usage)
- [What is in the document](#what-is-in-the-document)
- [Describing what the code cannot tell](#describing-what-the-code-cannot-tell)
- [What the application sends](#what-the-application-sends)
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
deno add jsr:@chojs/web jsr:@chojs/message jsr:@chojs/asyncapi    # Deno
npx jsr add @chojs/web @chojs/message @chojs/asyncapi             # Node.js
bunx jsr add @chojs/web @chojs/message @chojs/asyncapi            # Bun
```

The package has no dependency but the CHO packages it reads. The page needs
nothing a browser has to load: it works with no access to the internet.

## Usage

The documentation is served by a web application. Create it, make the consumers
on its injector, then give it their documentation:

```ts
import { ChoWeb } from "@chojs/web";
import { serve } from "@chojs/web/serve";
import { ChoMessage } from "@chojs/message";
import { asyncApi } from "@chojs/asyncapi";

const web = await ChoWeb.create(AppModule);
const app = await ChoMessage.from(web.injector, { linker });

asyncApi(web, app, { info: { title: "Shop", version: "1.0.0" } });

await serve(web.handler);
await app.start();
```

| Route                         | Answers                                  |
| ----------------------------- | ---------------------------------------- |
| `GET /asyncapi`               | The page                                 |
| `GET /asyncapi/asyncapi.json` | The AsyncAPI document of the application |

`asyncApi` mounts the two routes with `web.mount` of `@chojs/web`. Call it once
the two applications are created, and before the server starts. The message
application is only read: the documentation is served with no broker.

`ChoMessage.from` is how an application that answers requests and handles
messages has one set of instances: see
[With a web application](../../message/README.md#with-a-web-application). An
application that only handles messages creates a `ChoWeb` for its documentation.

A runnable example is in
[`examples/asyncapi-message.ts`](../../examples/asyncapi-message.ts).

## What is in the document

Nothing is declared twice: the document is made from the handlers.

```ts
@Middlewares(validate())
@Controller({ topic: "orders" })
class OrdersController {
  @Subscribe("created")
  @Args(Value(Order), Header("tenant"))
  created(order: Order, tenant: string | undefined) {}

  @Subscribe(GetPrice) // a contract: its topic, its request and its reply
  price(order: OrderId) {}
}
```

| Declared                  | In the document                                                            |
| ------------------------- | -------------------------------------------------------------------------- |
| `@Subscribe("created")`   | The channel `orders.created`, and a `receive` operation                    |
| The controller            | The tag `Orders`, and the key of the operation, `OrdersController.created` |
| `Value(Order)`            | The payload of the message, `application/json`, with the schema of `Order` |
| `Header("tenant")`        | A property `tenant` of the headers of the message                          |
| `@Subscribe(GetPrice)`    | The channel of the topic of the contract, with the schema of its request   |
| The `reply` of `GetPrice` | The reply of the operation, with the schema of the reply                   |

Each argument of a handler (`@Args`) is read:

| Argument               | In the document                                         |
| ---------------------- | ------------------------------------------------------- |
| `Value(v)`             | The payload, `application/json`, with the schema of `v` |
| `Value("name", v)`     | A property `name` of an object payload                  |
| `Header("x", v)`       | A property `x` of the headers; a string, with no `v`    |
| `Header(v)`            | The headers: the schema of `v`, when it is an object    |
| `Key()`, `Key(v)`      | The key, as the `x-key` extension of the message        |
| A function of your own | Nothing: it says nothing about what it reads            |

- The topic of a channel is the whole topic of its handler, with the prefix of
  the application.
- A handler with no `Value` argument reads the context itself: its message has
  no payload in the document.
- A property read by its name is not marked required: the schema of one value
  does not say whether the value may be missing.
- AsyncAPI has the key of a message in the bindings of Kafka only. The document
  has no bindings, so the key is an extension, which the page shows.

A reply is a channel of its own, `<topic>/reply`, with no address: who asks says
where the reply goes, with each request.

## Describing what the code cannot tell

`@Doc`, of `@chojs/message`, on a handler, a controller or a feature module:

```ts
@Doc({ tags: ["orders"] })
@Controller({ topic: "orders" })
class OrdersController {
  @Doc({
    summary: "An order was created",
    description: "Sends the confirmation of the order.",
  })
  @Subscribe("created")
  @Args(Value(Order))
  created(order: Order) {}

  @Doc({
    summary: "The price of an order",
    reply: { description: "The price, in cents", schema: Price },
  })
  @Subscribe("price")
  @Args(Value(OrderId))
  price(order: OrderId) {}
}
```

| Option        | On                                 | In the document                                                                                    |
| ------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| `summary`     | A handler                          | The summary of the operation                                                                       |
| `description` | A handler                          | Its description                                                                                    |
| `reply`       | A handler                          | Its reply: a `description`, and a `schema`. A handler of a contract has the schema of the contract |
| `operationId` | A handler                          | Its key. Default: `OrdersController.created`. Keys are unique                                      |
| `tags`        | A handler, a controller, a feature | The tags of the operations under it: they add up. Default: the controller, without `Controller`    |
| `hidden`      | A handler, a controller, a feature | `true`: the operations under it are left out                                                       |

The [`tags` option](#options) describes a tag.

## What the application sends

The graph of an application knows what it handles, and not what it sends. The
`sends` option says it, with the contracts the application sends, by the key of
their operation:

```ts
asyncApi(web, app, {
  info,
  sends: { orderShipped: OrderShipped, getStock: GetStock },
});
```

Each is a `send` operation, on the channel of the topic of the contract, with
the schema of its request, and the schema of its reply when it has one. The
prefix of the application is put before the topic: who sends gives its client
the prefix of who listens.

## Schemas

A validator of `@chojs/message` is a
[Standard Schema](https://standardschema.dev/), or an object with a `parse`
method. Its JSON Schema comes from one of two places:

1. **The validator itself**, when it also implements
   [Standard JSON Schema](https://standardschema.dev/json-schema). A
   [Zod](https://zod.dev) schema does, from Zod 4.2, and so does an
   [ArkType](https://arktype.io) schema, from 2.1.28: nothing to do. The tests
   of this package run both.

2. **The `toJsonSchema` option**, for a validator that does not, such as a
   [Valibot](https://valibot.dev) schema as it is. It receives the validator,
   and `"input"`, and returns a JSON Schema, or `undefined` when it does not
   know the validator.

   ```ts
   asyncApi(web, app, {
     info,
     toJsonSchema: (validator) =>
       validator instanceof MySchema ? validator.toJsonSchema() : undefined,
   });
   ```

A validator with no schema is not an error: what it describes is in the document
without a schema, and a line is logged to the `cho:asyncapi` debug context
(`CHO_DEBUGLOG=cho:asyncapi`).

- The schemas are JSON Schema **draft-07**, the dialect of AsyncAPI 3: a
  validator is asked for it.
- A schema is the **input** of its validator, for a request and for a reply:
  what is on the wire, before who receives it validates it.
- A schema is written where it is used. The definitions of a schema go to
  `components.schemas`, once, and the references follow.

## Options

`asyncApi(web, app, options)`:

| Option         | Default      | What it is                                                               |
| -------------- | ------------ | ------------------------------------------------------------------------ |
| `info`         | Required     | The Info Object: `title` and `version` are required                      |
| `route`        | `"asyncapi"` | The base route of the two routes, written like the route of a decorator  |
| `ui`           | The page     | A function for a page of your own, or `false`: see [The page](#the-page) |
| `middlewares`  | None         | Middleware functions of `@chojs/web`, for the two routes                 |
| `servers`      | None         | The brokers, by name: each has a `host` and a `protocol`                 |
| `tags`         | None         | A description for a tag, by name: `{ orders: "The orders" }`             |
| `sends`        | None         | See [What the application sends](#what-the-application-sends)            |
| `id`           | None         | An identifier of the application: a URI                                  |
| `externalDocs` | None         | More documentation                                                       |
| `toJsonSchema` | None         | See [Schemas](#schemas)                                                  |

An option that is missing, unknown or wrong throws when `asyncApi` is called. So
does an application whose document cannot be made: the document is made then,
not for the first request.

```ts
const config = await web.injector.resolve(Config);

asyncApi(web, app, {
  info: { title: "Shop", version: config.version },
  servers: { production: { host: config.broker, protocol: "kafka" } },
  route: "internal/asyncapi",
});
```

## The page

The page is one HTML file, with its styles in it. It shows the application and
its servers, each operation with its message and its reply, and the schemas the
others refer to. A schema is a table of its properties, with the schema as JSON
under it.

- **It loads nothing**: no script, no stylesheet, no font and no image.
- **Light and dark** follow the browser, and it is readable on a phone.
- **Everything of the document is escaped.**
- A description is shown as it is written: Markdown is not rendered.

| `ui`       | The page                                                             |
| ---------- | -------------------------------------------------------------------- |
| Not given  | The page of the package                                              |
| A function | A page of your own: `({ document, url, title }) => string`, its HTML |
| `false`    | No page: the document only, at `<route>/asyncapi.json`               |

```ts
asyncApi(web, app, {
  info,
  ui: ({ url, title }) =>
    `<!doctype html><title>${title}</title><my-client spec="${url}"></my-client>`,
});
```

**With a content security policy.** The page has no script, and one inline
`<style>` element: allow `style-src 'unsafe-inline'` for it, and nothing else.

## Protecting the documentation

The two routes are mounted, not declared: the middlewares of the application do
not run for them. Give them their own:

```ts
import { basicAuth } from "@chojs/vendor-cho";

asyncApi(web, app, {
  info,
  middlewares: [basicAuth({ username: "admin", password })],
});
```

To have no documentation somewhere, do not call `asyncApi` there:

```ts
if (!production) {
  asyncApi(web, app, { info });
}
```

## The document, and the page, by themselves

`asyncApi` is made of two functions, which are exported:

```ts
import { asyncApiDocument, docsPage } from "@chojs/asyncapi";

const document = asyncApiDocument(app, { info }); // a plain object
const html = docsPage(document, { url: "/asyncapi.json" });
```

`asyncApiDocument` returns a new plain object each time: write it to a file,
change it, or serve it from a controller of your own. `docsPage` shows any
AsyncAPI 3 document that is written as this one is, with its messages in its
channels.

## Behavior

| Topic                          | Behavior                                                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| AsyncAPI version               | 3.0.0                                                                                                        |
| The two routes                 | In `web.routes`, and not in `web.graph`: so they are not in the OpenAPI document of the application          |
| The global prefix of the web   | Not for the two routes: with `prefix: "api"`, the page is still `/asyncapi`                                  |
| The prefix of the messages     | Before every topic of the document                                                                           |
| When it is made                | When `asyncApi` is called, once: the graph of an application does not change                                 |
| A document that cannot be made | Two operations with one key: `asyncApi` throws, before the server starts, and mounts nothing                 |
| The link to the document       | The path of the request for the page, with `/asyncapi.json`                                                  |
| Matching order                 | The two routes are the last. A declared route that matches `/asyncapi` answers first: choose another `route` |
| When to call                   | Before the application serves. Later, Hono and Fastify refuse the routes                                     |
| Twice                          | The same `route` throws. Another `route` gives a second documentation, with its own options                  |
| With `@chojs/openapi`          | The two stand side by side: `openApi(web, …)` for the routes, `asyncApi(web, app, …)` for the topics         |
| Logs                           | The `cho:asyncapi` debug context                                                                             |

## Errors

A mistake in the options, or a document that cannot be made, is a `ChoError`: an
`Error` with a stable `code`. `asyncApi` throws it when it is called, before the
server starts.

```ts
import { isChoError } from "@chojs/web";

try {
  asyncApi(web, app, options);
} catch (error) {
  if (isChoError(error, "CHO_ASYNCAPI_DUPLICATE_OPERATION_ID")) {
    // ...
  }
  throw error;
}
```

| Mistake                            | Code                                  |
| ---------------------------------- | ------------------------------------- |
| An option that is missing or wrong | `CHO_ASYNCAPI_INVALID_OPTION`         |
| Two operations with one key        | `CHO_ASYNCAPI_DUPLICATE_OPERATION_ID` |

An option that does not exist is `CHO_CORE_UNKNOWN_OPTION`, a route that is not
valid or already taken has the code of `web.mount` (`CHO_WEB_…`), and a mistake
in a `@Doc` the code of `@chojs/message` (`CHO_MESSAGE_INVALID_OPTION`). The
messages are in the [specification](./specs.md#8-errors).

## Runtime support

Every runtime both `@chojs/web` and `@chojs/message` run on: Deno, Node.js and
Bun, with every adapter of `@chojs/web`. Making the document and the page uses
the language alone. A tag of the document is the name of a controller: keep the
names when a bundle is minified.

## Documentation

- [The specification](./specs.md): the decisions of the package, with the
  alternatives, and what is left out.
- [`@chojs/message`](../../message/README.md): `@Doc`, `@Args`, contracts, and
  `ChoMessage.from`.
- [`@chojs/openapi`](../openapi/README.md): the same, for the routes of a
  `@chojs/web` application.
