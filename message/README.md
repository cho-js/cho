# @chojs/message

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Applications that handle the messages of a broker, such as Kafka, built with
decorators, on the dependency injection of the [CHO](../README.md) framework.
Controllers declare message handlers; `ChoMessage` gives their topics to a
broker adapter, which subscribes to them.

It is the sibling of [`@chojs/web`](../web/README.md): the same modules,
controllers, middlewares and error handlers, with a topic where `@chojs/web` has
a route.

> **Broker adapters:** [`@chojs/vendor-kafka`](../vendor/kafka/README.md), for
> Apache Kafka, on Node.js. Without an adapter, an application delivers its
> messages [by hand](#delivering-a-message-by-hand), or with a
> [linker of its own](#broker-adapters).

## Contents

- [Highlights](#highlights)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Guide](#guide)
  - [Topics](#topics)
  - [The message context](#the-message-context)
  - [Handled, or failed](#handled-or-failed)
  - [Middlewares](#middlewares)
  - [Error handling](#error-handling)
  - [Starting and stopping](#starting-and-stopping)
  - [Delivering a message by hand](#delivering-a-message-by-hand)
  - [With a web application](#with-a-web-application)
  - [Testing](#testing)
- [Options](#options)
- [Errors](#errors)
- [Broker adapters](#broker-adapters)
- [Runtime support](#runtime-support)
- [Documentation](#documentation)

## Highlights

- **The broker stays outside.** Handlers receive a message as plain data: its
  value, its key and its headers. Nothing in a controller depends on the client
  library of the broker.
- **One handler for a topic.** A topic is a name, with no pattern, so it means
  the same on every broker.
- **Same behavior on every adapter.** Middlewares, error handling and the
  outcome of a message are decided by `@chojs/message` itself. An adapter only
  subscribes, and acknowledges.
- **No message is lost silently.** A message is acknowledged after its handler
  has returned, and an error handler that only logs leaves it failed.
- **Testable with no broker.** `app.handle(topic, message)` gives a message to
  its handler.
- **One set of instances with a web application.** `ChoMessage.from` builds a
  message application on the injector of a `ChoWeb`.
- **Fails early.** A bad topic, a duplicate topic or a missing provider is
  reported when the application is created, not on the first message.

## Installation

```sh
deno add jsr:@chojs/message    # Deno
npx jsr add @chojs/message     # Node.js
bunx jsr add @chojs/message    # Bun
```

## Quick start

```ts
import {
  ChoMessage,
  type ChoMessageContext,
  Controller,
  Injectable,
  Module,
  Subscribe,
} from "@chojs/message";
import { KafkaLinker } from "@chojs/vendor-kafka";

@Injectable()
class Mailer {
  async confirm(order: { id: string; email: string }) {/* ... */}
}

@Controller({ topic: "orders", dependencies: [Mailer] })
class OrdersController {
  constructor(readonly mailer: Mailer) {}

  @Subscribe("created") // the topic orders.created
  async created(ctx: ChoMessageContext) {
    const order = ctx.json<{ id: string; email: string }>();
    await this.mailer.confirm(order);
    // returning without an error: the message is handled
  }

  @Subscribe("cancelled") // the topic orders.cancelled
  cancelled(ctx: ChoMessageContext) {
    console.log(ctx.topic, ctx.key, ctx.text());
  }
}

@Module({ providers: [Mailer], controllers: [OrdersController] })
class App {}

const app = await ChoMessage.create(App, {
  linker: new KafkaLinker({ brokers: ["localhost:9092"], groupId: "mailer" }),
});
await app.start(); // connects, and subscribes to the two topics
```

## Guide

### Topics

A handler is a controller method marked with `@Subscribe(topic)`. Its full topic
joins up to four levels with a `.`, each optional:

| Level         | Declared by                                   |
| ------------- | --------------------------------------------- |
| global prefix | the `prefix` option of `ChoMessage.create`    |
| feature       | the `topic` option of the feature's `@Module` |
| controller    | the `topic` option of `@Controller`           |
| handler       | the argument of `@Subscribe`                  |

```ts
@Controller({ topic: "orders" })
class OrdersController {
  @Subscribe("created") // orders.created
  created() {}

  @Subscribe("") //        orders: the controller's own topic
  all() {}
}

// with ChoMessage.create(App, { prefix: "staging" }): staging.orders.created
```

- A topic is segments of letters, digits, `_` and `-`, separated by `.`. A name
  with another separator is one segment: `@Subscribe("orders-created")`.
- **There is no pattern**: no wildcard (`*`, `>`, `#`) and no parameter.
- **A topic has one handler.** Two handlers with the same full topic are an
  error when the application is created.
- A feature is a module that declares controllers. Importing a module does not
  nest its topics.

What is **not** part of a topic: the consumer group, which is an option of the
adapter, and the partition and offset of a message, which are in `ctx.native`.

### The message context

A handler receives a `ChoMessageContext`:

| Property  | Holds                                                                         |
| --------- | ----------------------------------------------------------------------------- |
| `topic`   | The full topic of the message, global prefix included                         |
| `value`   | The value of the message, as bytes (`Uint8Array`); empty when it has none     |
| `key`     | The key of the message; `undefined` when it has none                          |
| `headers` | The headers of the message, as an object of strings                           |
| `text()`  | The value, decoded as UTF-8                                                   |
| `json()`  | The value, parsed as JSON; `undefined` for an empty value                     |
| `state`   | A `Map` for the message: what a middleware sets, later ones and handlers read |
| `native`  | The adapter's own message, for what only that adapter has                     |

A broker carries bytes, and nothing decodes them before the handler: the handler
says how the value is read.

```ts
@Subscribe("created")
created(ctx: ChoMessageContext) {
  const order = ctx.json<Order>(); // your promise: nothing checks the type
  console.log(ctx.key, order.id, ctx.headers["message-id"]);
}
```

### Handled, or failed

A handler has no response to give. A message has one of two outcomes:

| Outcome     | When                                                       | The adapter                                         |
| ----------- | ---------------------------------------------------------- | --------------------------------------------------- |
| **handled** | The handler returns, or an error handler handles its error | Acknowledges the message: it is not delivered again |
| **failed**  | The handler throws, and no error handler handles the error | Does what its broker does with such a message       |

- What a handler returns is ignored.
- What "failed" leads to is the adapter's decision: delivering the message
  again, moving it to a dead-letter topic, or stopping.
- A message is acknowledged **after** its handler has returned. A process that
  stops in the middle of a handler gets the message again, so a handler should
  be safe to run twice for the same message.

### Middlewares

`@Middlewares(...)` applies to a feature module, a controller or a handler. A
middleware is a function `(ctx, next)`, or a class with a `handle(ctx, next)`
method, created by the injector.

```ts
const timing: ChoMessageMiddlewareFn = async (ctx, next) => {
  const start = Date.now();
  await next();
  console.log(ctx.topic, `${Date.now() - start}ms`);
};

@Injectable([Processed])
class Once {
  constructor(readonly processed: Processed) {}
  async handle(ctx: ChoMessageContext, next: () => Promise<void>) {
    const id = ctx.headers["message-id"];
    if (id && await this.processed.has(id)) {
      return; // handled before: skip the handler
    }
    await next();
    if (id) {
      await this.processed.add(id);
    }
  }
}

@Middlewares(Once) // every handler of the controller
@Controller({ topic: "orders" })
class OrdersController {
  @Middlewares(timing) // this handler only
  @Subscribe("created")
  created(ctx: ChoMessageContext) {/* ... */}
}
```

- `next()` runs the rest of the chain. It resolves when the rest is done, and
  rejects with its error.
- **Returning without calling `next()` skips the handler**, and the message is
  handled. It is how a middleware drops a message.
- **A middleware cannot hide a failure.** When `next()` rejects, the message
  failed, even when the middleware catches the error. Settling a failed message
  is what an error handler does.
- A message runs the feature's middlewares, then the controller's, then the
  handler's, each in declaration order.

### Error handling

`@Catch(handler)` applies to a feature module, a controller or a handler, and
the `onError` option of `ChoMessage.create` covers what no `@Catch` does. An
error goes to the nearest one.

**An error handler that returns nothing has not handled the error**: the message
failed. To settle it as handled, the error handler returns `true`.

```ts
const app = await ChoMessage.create(App, {
  linker,
  // logs, and leaves the message failed: the adapter decides what is next
  onError: (error, ctx) => {
    console.error(ctx.topic, ctx.key, error);
  },
});

@Controller({ topic: "orders" })
class OrdersController {
  // a value that is not JSON will never be: drop it, after keeping a copy
  @Catch(async (error, ctx) => {
    if (error instanceof SyntaxError) {
      await rejected.save(ctx.topic, ctx.value);
      return true; // handled
    }
  })
  @Subscribe("created")
  created(ctx: ChoMessageContext) {
    const order = ctx.json<Order>();
    /* ... */
  }
}
```

So an error handler that only logs never loses a message.

### Starting and stopping

A broker is not called, it is connected to: the application starts and stops
itself.

```ts
import process from "node:process";

const app = await ChoMessage.create(WorkerModule, { linker });
await app.start(); // connects and subscribes; the connection keeps the process running

process.on("SIGTERM", () => app.close());
```

- `ChoMessage.create` creates every instance and checks every topic. It does not
  connect.
- `app.start()` connects and subscribes. It rejects when the broker cannot be
  reached.
- `app.close()` stops receiving, waits for the messages that are being handled,
  disconnects, and disposes the instances, in reverse creation order.

### Delivering a message by hand

`app.handle(topic, message)` gives one message to the handler of a topic. It
needs no linker and no `start()`.

```ts
const app = await ChoMessage.create(App);

await app.handle("orders.created", {
  value: JSON.stringify({ id: "42" }), // a string, or bytes
  key: "42", //                           optional
  headers: { "message-id": "abc" }, //    optional
});
```

It resolves when the message is handled, and rejects, with the error, when it
failed. It is how an application is [tested](#testing), and how messages that
arrive another way are handled: a broker that pushes its messages over HTTP is
served by a web handler that calls `app.handle`.

### With a web application

An application that answers HTTP requests and handles messages should have one
set of instances: one database pool, one cache. `ChoMessage.from` builds the
message application on the injector of the web application:

```ts
import { ChoWeb } from "@chojs/web";
import { serve } from "@chojs/web/serve";
import { ChoMessage } from "@chojs/message";

const web = await ChoWeb.create(App);
const messages = await ChoMessage.from(web.injector, { linker });

const server = await serve(web.handler, { port: 3000, closeTimeout: 10_000 });
await messages.start();

async function shutdown() {
  await server.close(); //   1. no new request
  await messages.close(); // 2. no new message; finish the ones in hand
  await web.close(); //      3. release the instances, once
}
```

- **The web application owns the injector.** `messages.close()` stops, and
  disposes nothing; `web.close()` disposes the instances. Close the message
  application first.
- **Each package sees its own controllers.** `@chojs/web` takes the controllers
  with `@Get`, `@Post`, … handlers, and `@chojs/message` the ones with
  `@Subscribe` handlers. The providers are shared.
- **A controller is of one kind**, declared with the `@Controller` of its
  package. A file imports its decorators from one of the two packages.
- **A module that holds both kinds declares no `@Middlewares` and no `@Catch` of
  its own.** They would apply to both kinds, and a web middleware cannot run for
  a message. Put them on the controllers, or keep the two kinds in two modules.
  Nothing detects the mistake when the application is created.

### Testing

`app.handle` takes a message, so a test needs no broker. The `overrides` option
replaces providers with fakes, anywhere in the module graph:

```ts
const mailer = new FakeMailer();
const app = await ChoMessage.create(App, {
  overrides: [provider({ provide: Mailer, factory: () => mailer })],
});

await app.handle("orders.created", { value: '{"id":"42","email":"a@b.c"}' });
assert.deepEqual(mailer.sent, ["42"]);

// a message that fails rejects, with its error
await assert.rejects(app.handle("orders.created", { value: "not json" }));
```

## Options

`ChoMessage.create(App, options)`:

| Option      | Default | Use                                                                |
| ----------- | ------- | ------------------------------------------------------------------ |
| `linker`    | none    | The broker adapter. Without one, only `handle()` delivers messages |
| `prefix`    | `""`    | A prefix for every topic, such as `"staging"`                      |
| `onError`   | none    | The error handler for what no `@Catch` covers                      |
| `overrides` | none    | Providers that replace declared ones, for tests                    |

`ChoMessage.from(injector, options)` takes the same, without `overrides`.

The application exposes `start()`, `handle()`, `close()`, `routes` (every topic,
with the name of its handler), `graph` (the same topics as a tree), `linked`
(the adapter's own object) and `injector`.

## Errors

A mistake the framework finds is a `ChoError`: an `Error` with a `code`. The
code is stable: it is part of the API, where the message is for people and can
change in any release.

```ts
import { ChoMessage, isChoError } from "@chojs/message";

try {
  await ChoMessage.create(App, { linker });
} catch (error) {
  if (isChoError(error, "CHO_MESSAGE_DUPLICATE_TOPIC")) {
    // ...
  }
  throw error;
}
```

The codes of this package start with `CHO_MESSAGE_` (type
`ChoMessageErrorCode`), and those of the core with `CHO_CORE_` (type
`ChoCoreErrorCode`). Use `isChoError`, and not `instanceof`: two versions of a
package in one process have a class each.

The error a handler throws is the application's: it is given to the error
handler as it is, and a message that fails rejects with it.

Every code is listed with its mistake in the
[specification](./specs.md#9-errors).

## Broker adapters

An adapter is a package of its own, named after its broker:

| Adapter                                            | Broker       | Runs on      |
| -------------------------------------------------- | ------------ | ------------ |
| [`@chojs/vendor-kafka`](../vendor/kafka/README.md) | Apache Kafka | Node.js only |

An adapter implements `Linker`, from `@chojs/message/linker`: it receives the
topics of the application, and returns what connects them to the broker.

```ts
import type { Linked, Linker, Route } from "@chojs/message/linker";

class MyLinker implements Linker<MyClient> {
  link(routes: readonly Route[]): Linked<MyClient> {
    const client = new MyClient();
    return {
      instance: client, // app.linked.instance
      start: async () => {
        await client.connect();
        for (const route of routes) {
          await client.subscribe(route.topic, async (message) => {
            try {
              // the message as plain data, and the adapter's own: ctx.native
              await route.handle(
                { value: message.data, key: message.key },
                message,
              );
              await message.ack(); //        handled
            } catch {
              await message.retryLater(); // failed: the adapter's decision
            }
          });
        }
      },
      stop: () => client.close(),
    };
  }
}
```

`route.handle` runs the middlewares, the handler and the error handler. It
resolves when the message is handled, and rejects, with the error, when it
failed. `link()` does no I/O: `start()` connects.

[`examples/hello-world-message.ts`](../examples/hello-world-message.ts) has a
whole adapter for a broker in memory.

## Runtime support

Deno, Node.js and Bun. `@chojs/message` itself needs nothing of a runtime; an
adapter runs where the client library of its broker does. Deno and Bun run
TypeScript decorators directly; on Node.js, compile the application with
TypeScript 5 or run it with a tool such as `tsx`. Both standard (TC39) and
legacy (`experimentalDecorators`) decorators are supported.

Debug logging is enabled with `CHO_DEBUG=1`, or with `CHO_DEBUGLOG=cho:message`.

## Documentation

- [Specification](./specs.md): topics, the context, the outcome of a message,
  middlewares, error handlers, the application, writing a broker adapter, and
  error messages.
- Example: [`hello-world-message.ts`](../examples/hello-world-message.ts).

## License

[MIT](./LICENSE)
