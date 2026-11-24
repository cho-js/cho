# @chojs/message

[![JSR](https://jsr.io/badges/@chojs/message)](https://jsr.io/@chojs/message)
[![JSR score](https://jsr.io/badges/@chojs/message/score)](https://jsr.io/@chojs/message)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Applications that handle the messages of a broker, such as Kafka, built with
decorators, on the dependency injection of the [CHO](../README.md) framework.
Controllers declare message handlers; `ChoMessage` gives their topics to a
broker adapter, which subscribes to them.

It is the sibling of [`@chojs/web`](../web/README.md): the same modules,
controllers, middlewares and error handlers, with a topic where `@chojs/web` has
a route.

> **Broker adapters:** [`@chojs/vendor-kafka`](../vendor/kafka/README.md), for
> Apache Kafka, and [`@chojs/vendor-nats`](../vendor/nats/README.md), for NATS,
> which sends [replies](#replying). Without an adapter, an application delivers
> its messages [by hand](#delivering-a-message-by-hand), or with a
> [linker of its own](#broker-adapters).

## Contents

- [Highlights](#highlights)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Guide](#guide)
  - [Topics](#topics)
  - [The message context](#the-message-context)
  - [Handled, or failed](#handled-or-failed)
  - [Replying](#replying)
  - [Handler arguments](#handler-arguments)
  - [Validation](#validation)
  - [Contracts](#contracts)
  - [Sending messages](#sending-messages)
  - [Telling who asked](#telling-who-asked)
  - [Middlewares](#middlewares)
  - [Error handling](#error-handling)
  - [Starting and stopping](#starting-and-stopping)
  - [Delivering a message by hand](#delivering-a-message-by-hand)
  - [The environment](#the-environment)
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
- **A reply is what a handler returns.** An adapter whose broker has replies
  sends it to who asked; the handler is the same either way.
- **Typed, validated arguments.** A handler declares what it receives with
  `@Args`, a schema of Zod, Valibot, ArkType or any other
  [Standard Schema](https://standardschema.dev/) checks it, and a message that
  is not valid is never tried again.
- **One contract for the two sides.** The topic, the request and the reply of a
  message are declared once: the handler and who sends take their types from it,
  and a request has a typed reply.
- **Testable with no broker.** `app.handle(topic, message)` gives a message to
  its handler, and resolves with its reply.
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

A feature module of a library is given its settings with
[`configure`](../core/README.md#configuring-a-module), which `@chojs/message`
exports: the module it makes keeps the topic, the controllers and the
middlewares of the one it is made from.

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

A message has one of two outcomes:

| Outcome     | When                                                       | The adapter                                         |
| ----------- | ---------------------------------------------------------- | --------------------------------------------------- |
| **handled** | The handler returns, or an error handler handles its error | Acknowledges the message: it is not delivered again |
| **failed**  | The handler throws, and no error handler handles the error | Does what its broker does with such a message       |

- What a handler returns is the [reply](#replying) of the message. A reply is
  more than "handled", not a third outcome.
- What "failed" leads to is the adapter's decision: delivering the message
  again, moving it to a dead-letter topic, or stopping.
- A message is acknowledged **after** its handler has returned. A process that
  stops in the middle of a handler gets the message again, so a handler should
  be safe to run twice for the same message.

### Replying

What a handler returns is the reply of the message. There is no decorator for
it: the same handler answers a message that asks for a reply and one that does
not.

```ts
@Controller({ topic: "orders" })
class OrdersController {
  @Subscribe("price")
  async price(ctx: ChoMessageContext) {
    const { id } = ctx.json<{ id: string }>();
    return { id, total: await this.prices.of(id) }; // the reply, as JSON
  }

  @Subscribe("created")
  created(ctx: ChoMessageContext) {
    this.mailer.confirm(ctx.json<Order>()); // nothing returned: no reply
  }
}
```

| The handler returns                                     | The reply              |
| ------------------------------------------------------- | ---------------------- |
| Nothing                                                 | None                   |
| Bytes (a `Uint8Array`, a typed array, an `ArrayBuffer`) | The bytes, as they are |
| A string                                                | Its UTF-8 bytes        |
| Anything else: an object, an array, a number, `null`    | Its JSON               |

- **Only `undefined` is "no reply".** `null`, `0`, `false` and `""` are replies.
- **The adapter sends it** to who asked for one, when its broker has replies.
  When nobody asked, or when the broker has none (Kafka), it is dropped. So do
  what must be done in the handler, and do not depend on the reply being read.
- **A value that cannot be a reply fails the message**: a function, a `bigint`,
  an object with a cycle. The error has the code `CHO_MESSAGE_INVALID_REPLY`,
  and goes to the [error handler](#error-handling) like an error of the handler.
- **A middleware does not see the reply**, and cannot replace it. One that skips
  the handler gives no reply.

**A reply with headers** is a `ChoMessageReply`: return one when the reply needs
more than its value.

```ts
import { ChoMessageReply } from "@chojs/message";

@Subscribe("price")
async price(ctx: ChoMessageContext) {
  const { id } = ctx.json<{ id: string }>();
  return new ChoMessageReply({ id, total: await this.prices.of(id) }, {
    headers: { "content-type": "application/json" },
  });
}
```

- Its value becomes the bytes of the reply by the rules of the table. With no
  value (`new ChoMessageReply()`), the reply is empty: it is still a reply.
- Its headers are names and values, as strings. Anything else throws when the
  reply is made, with the code `CHO_MESSAGE_INVALID_REPLY`.
- The adapter sends them when its broker has headers for a reply, as
  [NATS](../vendor/nats/README.md#replying) does. Which names and values a
  broker accepts is its own.
- An error handler returns one too.

### Handler arguments

A handler declares what it receives with `@Args`: the list of its arguments, in
the order of its parameters. It is then called with their values, and with the
context last.

```ts
import { Args, Header, Key, Value } from "@chojs/message";

@Controller({ topic: "orders" })
class OrdersController {
  @Subscribe("created")
  @Args(Value<Order>(), Key(), Header("tenant"))
  created(
    order: Order,
    key: string | undefined,
    tenant: string | undefined,
    ctx: ChoMessageContext,
  ) {
    // …
  }
}
```

| Argument         | Gives                                                          |
| ---------------- | -------------------------------------------------------------- |
| `Value()`        | The value, parsed as JSON; `undefined` for a message with none |
| `Value("name")`  | One property of the value                                      |
| `Key()`          | The key, or `undefined` when the message has none              |
| `Header()`       | All the headers, as an object of strings                       |
| `Header("name")` | One header, by its exact name, or `undefined`                  |
| `(ctx) => value` | An argument of your own; it can be `async`                     |

- **The parameters are checked at compile time** against the arguments: a
  handler that expects another type, or another order, does not compile.
- **The context is always last**, and a handler can leave it out.
- **Without `@Args`, a handler receives the context alone.** A method has one
  `@Args`, above or below `@Subscribe`.
- **The arguments are evaluated after the middlewares**, just before the
  handler: a middleware that skips the handler never parses the value.
- For the text or the bytes of the value, read `ctx.text()` and `ctx.value`.

### Validation

A validator is a [Standard Schema](https://standardschema.dev/): the schemas of
[Zod](https://zod.dev), [Valibot](https://valibot.dev),
[ArkType](https://arktype.io) and many other libraries are, and `@chojs/message`
depends on none of them. An object with a `parse(value)` method that returns the
value, or throws, is one too. Give it to an argument, last, and put `validate()`
on the route:

```ts
import { z } from "zod";
import { Args, Header, Middlewares, validate, Value } from "@chojs/message";

const Order = z.object({ id: z.string(), total: z.number() });

@Middlewares(validate()) // every handler of the controller is validated
@Controller({ topic: "orders" })
class OrdersController {
  @Subscribe("created")
  @Args(Value(Order), Header("attempt", z.coerce.number()))
  created(order: z.infer<typeof Order>, attempt: number) {
    // order is checked, and attempt is a number
  }
}
```

- **What the validator gives is what the handler receives**, so a validator can
  convert too. A validator that gives a promise is awaited.
- **The type of the parameter comes from the validator.**
- **`validate()` covers the handlers under it**: on a handler, on a controller
  or on a feature module. Without it on the route, validators are not run, and
  the debug log names each such handler when the application is created.

**A message that is not valid fails**, and its handler is not called. The error
is a `ChoError` with the code `CHO_MESSAGE_INVALID_MESSAGE`: its message says
what is not valid, with the issues of the validator. A value that is not JSON is
the same error. It goes to the [error handler](#error-handling), then to the
adapter, which **does not try it again**: Kafka sends it to the dead-letter
topic at once, and NATS answers a request with `400`.

**A schema that throws is not a message that is not valid.** A Standard Schema
says what is not valid in its result. What it throws (a database that is down,
in an asynchronous check) is an error like any other, and the adapter can try
the message again.

`onInvalid` decides otherwise, as an error handler does:

```ts
validate({
  onInvalid: ({ source, key, issues }, ctx) => {
    logger.warn(ctx.topic, source, key, issues);
    return true; // handled: skipped, and not delivered again
  },
});
```

| `onInvalid` returns | The message                               |
| ------------------- | ----------------------------------------- |
| Nothing, or `false` | Fails, with `CHO_MESSAGE_INVALID_MESSAGE` |
| `true`              | Is handled, with no reply                 |
| Any other value     | Is handled, and the value is its reply    |

`issues` is the same for every library: each issue is a `message`, and a `path`
when it is about a part of the value.

### Contracts

A contract is one object that says the topic of a message, what it holds and
what is replied. The handler and who sends both take their types, and their
validators, from it. It imports nothing of an application: two services share it
as a file or as a package.

```ts
import { contract } from "@chojs/message";

export const GetPrice = contract({
  topic: "shop.orders.price",
  request: z.object({ id: z.number() }),
  reply: z.object({ id: z.number(), price: z.number() }),
});

export const OrderCreated = contract({
  topic: "shop.orders.created",
  request: z.object({ id: z.number(), total: z.number() }),
}); // no reply
```

A handler takes the contract in place of a topic. It is called with the value of
the message, then the context:

```ts
@Middlewares(validate())
@Controller({ topic: "shop.orders" })
class OrdersController {
  @Subscribe(GetPrice) // the topic shop.orders.price
  price(request: { id: number }, ctx: ChoMessageContext) {
    return { id: request.id, price: 42 };
  }

  @Subscribe(OrderCreated)
  created(order: { id: number; total: number }) {
    // …
  }
}
```

- **The parameter and what is returned are checked at compile time**: a handler
  that expects another request, or returns another reply, does not compile.
- **The request is validated** by its validator when [`validate()`](#validation)
  is on the route.
- **A validator that converts gives each side its own type.** Who asks sends
  what the `request` validator takes and receives what the `reply` validator
  gives; the handler receives what `request` gives and returns what `reply`
  takes. With `note: z.string().default("none")` in the request, who asks can
  leave the note out, and the handler always has it.
- **The topic of a contract is the whole topic**, without the prefix of the
  application. The topics of the module and of the controller are not added to
  it: they must be the start of it, or the application is not created.
- **A contract speaks JSON, both ways**: the value and the reply are sent as
  JSON, a string included.
- Without a validator, give the types by hand:
  `contract<Order, Price>({ topic })`.

### Sending messages

`ChoMessageClient` sends the message of a contract, and gives back its typed
reply. It is built on the `sender` of the linker of an adapter:

```ts
import { ChoMessageClient } from "@chojs/message";

const client = new ChoMessageClient(linker.sender);

await client.publish(OrderCreated, { id: 7, total: 12 }); // asks for no reply
const { price } = await client.request(GetPrice, { id: 7 }); // price: number
```

| Call                                 | Does                                                   |
| ------------------------------------ | ------------------------------------------------------ |
| `publish(contract, value, options?)` | Sends the message; resolves when the broker has it     |
| `request(contract, value, options?)` | Sends it, and resolves with the reply, through `reply` |

`options` has the `key` and the `headers` of the message, and `timeout`, in
milliseconds, for a request. The client itself takes `prefix`, the prefix of the
application that listens, and a default `timeout`.

The sender of a linker is there before the application is created, so the client
is provided like any dependency, and a handler sends with it:

```ts
const linker = new NatsLinker({ connect, queue: "shop" });

@Module({
  providers: [
    provider({
      provide: ChoMessageClient,
      factory: () => new ChoMessageClient(linker.sender),
    }),
  ],
  controllers: [OrdersController],
})
class AppModule {}

const app = await ChoMessage.create(AppModule, { linker });
await app.start();
```

A request rejects when it has no good answer:

| What happened                                      | The error                            |
| -------------------------------------------------- | ------------------------------------ |
| The other side answered with an error              | A [`ReplyError`](#telling-who-asked) |
| Nobody listens to the topic                        | `CHO_MESSAGE_NO_RESPONDERS`          |
| No answer came in time                             | `CHO_MESSAGE_REQUEST_TIMEOUT`        |
| The reply is not JSON, or its validator refused it | `CHO_MESSAGE_UNEXPECTED_REPLY`       |
| The broker has no replies (Kafka)                  | `CHO_MESSAGE_NO_REPLIES`             |

### Telling who asked

A handler throws a `ReplyError` to say what a requester is told: a code, and a
description. It is to a message what `HttpError` is to a request of
`@chojs/web`.

```ts
import { isReplyError, ReplyError } from "@chojs/message";

@Subscribe(GetPrice)
price(request: { id: number }) {
  const order = this.orders.find(request.id);
  if (!order) {
    throw new ReplyError(404, "Not Found");
  }
  return { id: order.id, price: order.price };
}

// who asked
try {
  await client.request(GetPrice, { id: 7 });
} catch (error) {
  if (isReplyError(error, 404)) {
    // no such order
  }
}
```

- An adapter whose broker has replies answers with the code and the description,
  and who asked gets the same `ReplyError` from `client.request`.
- Any other error of a handler reaches who asked as a `ReplyError` too, with
  what the adapter tells by default: `500`, and `400` for a request that is not
  valid. Its message is not sent.
- It is an error like any other for the rest: it goes to the
  [error handler](#error-handling) first, and a message that asks for no reply
  fails with it.

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

Any other value an error handler returns is the [reply](#replying) of the
message, which is then handled. It is how who asked is told what went wrong:

```ts
@Catch((error) => ({
  error: error instanceof NotFound ? "not found" : "failed",
}))
@Subscribe("price")
price(ctx: ChoMessageContext) {/* ... */}
```

| The error handler returns | The message                         |
| ------------------------- | ----------------------------------- |
| Nothing, or `false`       | Failed, with the original error     |
| `true`                    | Handled, with no reply              |
| Any other value           | Handled, and the value is its reply |

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

It resolves when the message is handled, with its [reply](#replying) when the
handler returned one, and rejects, with the error, when it failed. It is how an
application is [tested](#testing), and how messages that arrive another way are
handled: a broker that pushes its messages over HTTP is served by a web handler
that calls `app.handle`.

### The environment

An application reads its environment with `env`, and not with `process.env`: it
reads the same way on every runtime.

```ts
import { env, envBool, envNum, Injectable } from "@chojs/message";

@Injectable()
class Config {
  readonly databaseUrl = env("DATABASE_URL") ?? "postgres://localhost/shop";
  readonly retries = env("RETRIES") ? envNum("RETRIES") : 3;
  readonly verbose = envBool("VERBOSE");
}
```

| Function         | Gives                                                                        |
| ---------------- | ---------------------------------------------------------------------------- |
| `env(key)`       | The variable, or `undefined` when it is not set                              |
| `envNum(key)`    | The variable as a number: `NaN` when it is not set, or is not a number       |
| `envBool(key)`   | `true` for `1`, `true`, `yes` and `on`, in any case; `false` otherwise       |
| `setEnv(source)` | Says where to read from first: a record of variables, or a function          |
| `engine()`       | The runtime: `"deno"`, `"node"`, `"bun"`, `"workerd"`, `"edge"`, `"unknown"` |

Variables are read from `process.env`. A runtime without `process`, such as
Cloudflare Workers, gives its environment with `setEnv`, before the application
is created.

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

// the reply of a handler: its bytes are in `value`
const reply = await app.handle("orders.price", { value: '{"id":"42"}' });
assert.deepEqual(JSON.parse(new TextDecoder().decode(reply?.value)), {
  id: "42",
  total: 12,
});
```

A client and the application it talks to are tested together, with no broker:
`localSender(app)` is a sender that delivers to the application itself.

```ts
import { ChoMessageClient, localSender } from "@chojs/message";

const app = await ChoMessage.create(App);
const client = new ChoMessageClient(localSender(app));

assert.deepEqual(await client.request(GetPrice, { id: 7 }), {
  id: 7,
  price: 42,
});
await assert.rejects(client.request(GetPrice, { id: 0 }), { code: 404 });
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

A [`ReplyError`](#telling-who-asked) is not a `ChoError`: it is what a handler
throws for who asked, and what `client.request` rejects with. Use
`isReplyError`.

Every code is listed with its mistake in the
[specification](./specs.md#9-errors).

## Broker adapters

An adapter is a package of its own, named after its broker:

| Adapter                                            | Broker       | Runs on                         | What a handler returns                                          |
| -------------------------------------------------- | ------------ | ------------------------------- | --------------------------------------------------------------- |
| [`@chojs/vendor-kafka`](../vendor/kafka/README.md) | Apache Kafka | Node.js; tested on Deno and Bun | dropped                                                         |
| [`@chojs/vendor-nats`](../vendor/nats/README.md)   | NATS         | Deno, Node.js and Bun           | sent, as the reply; dropped for a message of a JetStream stream |

An adapter implements `Linker`, from `@chojs/message/linker`: it receives the
topics of the application, and returns what connects them to the broker.

```ts
import type { Linked, Linker, Reply, Route } from "@chojs/message/linker";

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
              const reply = await route.handle(
                { value: message.data, key: message.key },
                message,
              );
              await message.ack(); //        handled
              // only for a broker that has replies
              if (reply && message.replyTo) {
                await client.publish(message.replyTo, reply.value, {
                  headers: reply.headers ?? {},
                });
              }
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
resolves when the message is handled, with the reply of the handler (a `Reply`,
`{ value }`) or with `undefined`, and rejects, with the error, when it failed.
An adapter whose broker has no replies ignores what it resolves with. `link()`
does no I/O: `start()` connects.

[`examples/hello-world-message.ts`](../examples/hello-world-message.ts) has a
whole adapter for a broker in memory.

## Runtime support

Deno, Node.js and Bun. `@chojs/message` itself needs nothing of a runtime, and
its tests run on Cloudflare Workers too, where an application delivers its
messages with `app.handle`: no adapter runs there. An adapter runs where the
client library of its broker does. Deno and Bun run TypeScript decorators
directly; on Node.js, compile the application with TypeScript 5 or run it with a
tool such as `tsx`. Both standard (TC39) and legacy (`experimentalDecorators`)
decorators are supported.

Debug logging is enabled with `CHO_DEBUG=1`, or with `CHO_DEBUGLOG=cho:message`.

## Documentation

- [Specification](./specs.md): topics, the context, the outcome of a message,
  middlewares, error handlers, the application, writing a broker adapter, and
  error messages.
- Example: [`hello-world-message.ts`](../examples/hello-world-message.ts).

## License

[MIT](./LICENSE)
