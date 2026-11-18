# @chojs/vendor-nats

[![JSR](https://jsr.io/badges/@chojs/vendor-nats)](https://jsr.io/@chojs/vendor-nats)
[![JSR score](https://jsr.io/badges/@chojs/vendor-nats/score)](https://jsr.io/@chojs/vendor-nats)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

The [NATS](https://nats.io) adapter for
[`@chojs/message`](../../message/README.md): it subscribes the topics of a CHO
message application to NATS, as one queue group, and answers a request with what
its handler returns.

## Contents

- [Runtime support](#runtime-support)
- [Installation](#installation)
- [Usage](#usage)
- [Options](#options)
- [Replying](#replying)
- [A message that failed](#a-message-that-failed)
- [Order and concurrency](#order-and-concurrency)
- [Reaching NATS from a handler](#reaching-nats-from-a-handler)
- [Sending and asking](#sending-and-asking)
- [Stopping](#stopping)
- [When the adapter stops by itself](#when-the-adapter-stops-by-itself)
- [Behavior](#behavior)
- [Testing](#testing)
- [Documentation](#documentation)

## Runtime support

**Deno, Node.js and Bun.** The client library is
[nats.js](https://github.com/nats-io/nats.js), version 3. The adapter imports no
transport: the application gives the connection, made by the transport of its
runtime.

| Runtime | Transport                                               |
| ------- | ------------------------------------------------------- |
| Node.js | `@nats-io/transport-node`, on npm                       |
| Bun     | `@nats-io/transport-node`, on npm                       |
| Deno    | `@nats-io/transport-deno`, on JSR                       |
| any     | `wsconnect` of `@nats-io/nats-core`, through WebSockets |

This version is **core NATS**: subjects, a queue group, request and reply.
Delivery is at most once. JetStream is
[not in it](./specs.md#8-not-in-this-version).

## Installation

```sh
# Deno
deno add jsr:@chojs/message jsr:@chojs/vendor-nats jsr:@nats-io/transport-deno

# Node.js
npx jsr add @chojs/message @chojs/vendor-nats
npm install @nats-io/transport-node

# Bun
bunx jsr add @chojs/message @chojs/vendor-nats
bun add @nats-io/transport-node
```

## Usage

Pass a `NatsLinker` to `ChoMessage.create`, and start the application:

```ts
import { connect } from "@nats-io/transport-node"; // Deno: "@nats-io/transport-deno"
import {
  ChoMessage,
  type ChoMessageContext,
  Controller,
  Module,
  Subscribe,
} from "@chojs/message";
import { NatsLinker } from "@chojs/vendor-nats";

@Controller({ topic: "orders" })
class OrdersController {
  @Subscribe("created") // the NATS subject "shop.orders.created"
  created(ctx: ChoMessageContext) {
    console.log("order", ctx.json());
  }

  @Subscribe("price") // the NATS subject "shop.orders.price"
  price(ctx: ChoMessageContext) {
    const { id } = ctx.json<{ id: number }>();
    return { id, price: 42 }; // the reply, for who asked
  }
}

@Module({ topic: "shop", controllers: [OrdersController] })
class AppModule {}

const app = await ChoMessage.create(AppModule, {
  linker: new NatsLinker({
    connect: () => connect({ servers: "localhost:4222" }),
    queue: "shop",
  }),
});

await app.start(); // connects, and subscribes in the queue group "shop"
```

`ChoMessage.create` connects to nothing: `start()` calls `connect`, and rejects
with its error when NATS cannot be reached. It resolves when the server has the
subscriptions. To stop:

```ts
await app.close();
```

## Options

| Option        | Default  | What it is                                                                         |
| ------------- | -------- | ---------------------------------------------------------------------------------- |
| `connect`     | required | a function that connects to NATS: `connect` of the transport, with your options    |
| `queue`       | required | the queue group: the name of the application for NATS                              |
| `concurrency` | `1`      | how many messages of one subject are in hand at once                               |
| `errorReply`  | `500`    | what a requester is told when its message failed: `(error, message) => errorReply` |
| `onFatal`     | throws   | called when the adapter stopped by itself                                          |

An option that is missing, unknown or wrong throws from the constructor, with a
message that names it: a `ChoError` with the code `CHO_NATS_INVALID_OPTION`
(`CHO_CORE_UNKNOWN_OPTION` for an option that does not exist). Every error of
the adapter has such a [code](./specs.md#7-errors).

**`connect`** is yours, so every option of nats.js is: the servers, the
credentials, TLS, the name of the client, how many times it connects again.

```ts
new NatsLinker({
  connect: () =>
    connect({
      servers: ["nats-1:4222", "nats-2:4222"],
      name: "shop-1",
      authenticator: credsAuthenticator(creds),
      maxReconnectAttempts: -1, // never give up
    }),
  queue: "shop",
  concurrency: 8,
});
```

The adapter calls it once, on `start()`, and closes the connection on `stop()`.

**`queue`** is the same for every instance of the application: NATS gives each
message to one of them, and one of them answers a request.

## Replying

What a handler returns is the reply of its message, as
[`@chojs/message` says](../../message/README.md#replying): bytes and strings as
they are, anything else as JSON. A message asks for a reply when it was sent
with `request()`:

```ts
// another application, or a NATS client in any language
const reply = await nc.request("shop.orders.price", JSON.stringify({ id: 7 }));
reply.json(); // { id: 7, price: 42 }
```

| The handler               | The message asks for a reply | The message asks for none   |
| ------------------------- | ---------------------------- | --------------------------- |
| returns a value           | the value is sent            | the value is dropped        |
| returns nothing           | an empty reply is sent       | nothing                     |
| throws, or its middleware | an error reply is sent       | logged; the message is lost |

- A handler does not know whether a reply was asked, and does not need to: the
  same handler serves `publish()` and `request()`.
- A handler that returns nothing still answers a request, with an empty reply,
  so that who asked does not wait for its timeout.
- A reply that nobody asked for is dropped. The debug log says so once for that
  handler.

**A reply with headers** is a `ChoMessageReply` of `@chojs/message`: its headers
are the headers of the NATS message.

```ts
import { ChoMessageReply } from "@chojs/message";

@Subscribe("price")
price(ctx: ChoMessageContext) {
  const { id } = ctx.json<{ id: number }>();
  return new ChoMessageReply({ id, price: 42 }, {
    headers: { "Content-Type": "application/json" },
  });
}

// who asked
const reply = await nc.request("shop.orders.price", payload);
reply.headers?.get("Content-Type"); // "application/json"
```

A name is sent as it is written. NATS accepts a name of printable ASCII with no
space and no `:`, and a value of one line: a reply with another header cannot be
sent, and who asked is told of an [error](#a-message-that-failed) instead.

## A message that failed

A message failed when its handler, or a middleware, threw and no error handler
(`@Catch`) handled it.

**A request that failed is answered with an error reply**: an empty payload and
two headers, the ones a NATS service answers with.

| Header                    | By default       |
| ------------------------- | ---------------- |
| `Nats-Service-Error`      | `Internal Error` |
| `Nats-Service-Error-Code` | `500`            |

**A handler says what is told** by throwing a
[`ReplyError`](../../message/README.md#telling-who-asked) of `@chojs/message`:
`throw new ReplyError(404, "Not Found")` answers with that code and that
description, and `errorReply` is not asked. `errorReply` is for every other
error.

A request that is not valid, one that
[`validate()`](../../message/README.md#validation) of `@chojs/message` refused,
is told `400` and `Bad Request` in their place: the mistake is its own.

The message of the error is logged, not sent: it can tell what a requester
should not know. `errorReply` decides what is told. It receives the error and
the message of the client, and returns a code, a description and, if you want
one, a payload. When it returns nothing, the default is told.

```ts
new NatsLinker({
  connect,
  queue: "shop",
  errorReply: (error) =>
    error instanceof OrderNotFound
      ? {
        code: 404,
        description: "Not Found",
        value: JSON.stringify({ id: error.id }),
      }
      : undefined, // 500, Internal Error
});
```

Who asked reads it from the headers of the reply:

```ts
import { ERROR_HEADERS } from "@chojs/vendor-nats";

const reply = await nc.request("shop.orders.price", payload);
if (reply.headers?.has(ERROR_HEADERS.description)) {
  const code = reply.headers.get(ERROR_HEADERS.code); // "404"
}
```

An error handler that returns a value answers with that value: it is a reply
like any other, with no error headers.

**A message that failed and asks for no reply is lost**, and logged. This is
core NATS: there is nothing to acknowledge, and nothing is delivered again. The
adapter does not try a message again. A message that must not be lost needs
JetStream, which is not in this version.

## Order and concurrency

The messages of one subject are handled one at a time, in the order they came.
`concurrency` is how many messages of one subject are in hand at once: with more
than 1, a subject no longer keeps its order. The subjects do not wait for each
other.

NATS gives the messages as fast as they are published, and the client keeps the
ones that wait in memory. A handler that stays slower than its publishers needs
JetStream.

## Reaching NATS from a handler

`ctx.native` is the message of the client library, in a `NatsNative`:

```ts
import type { NatsNative } from "@chojs/vendor-nats";

@Subscribe("created")
created(ctx: ChoMessageContext) {
  const { message } = ctx.native as NatsNative;
  message.subject; // "shop.orders.created"
  message.reply; //   where a reply goes, when one was asked
  message.headers?.values("Trace"); // every value of a header
}
```

`ctx.headers` has the first value of each header, and `ctx.key` is `undefined`:
NATS has no key. Code that reads `ctx.native` runs on this adapter only.

## Sending and asking

**With a contract.** `linker.sender` is the sender of the adapter: give it to a
[`ChoMessageClient`](../../message/README.md#sending-messages) of
`@chojs/message`. A request has a typed reply, and an error reply rejects with a
[`ReplyError`](../../message/README.md#telling-who-asked) of its code and its
description.

```ts
import { ChoMessageClient } from "@chojs/message";

const linker = new NatsLinker({ connect, queue: "shop" });
const client = new ChoMessageClient(linker.sender);

const app = await ChoMessage.create(AppModule, { linker });
await app.start();

await client.publish(OrderCreated, { id: 7, total: 12 });
const { price } = await client.request(GetPrice, { id: 7 });
```

- The sender is there as soon as the linker is made, so the client can be
  [provided to the application](../../message/README.md#sending-messages). It
  sends once `app.start()` was called, and rejects before
  (`CHO_NATS_NOT_STARTED`).
- A request waits 1000 milliseconds by default, as nats.js does: give `timeout`
  to the request, or to the client.
- No subscription on the subject rejects at once with
  `CHO_MESSAGE_NO_RESPONDERS`, and no reply in time with
  `CHO_MESSAGE_REQUEST_TIMEOUT`.
- NATS has no key: the `key` of a message is not sent.

**With the connection.** `app.linked.instance` is the connection of the
application, once `start()` resolved. Publish and request anything with it:

```ts
await app.start();
const nc = app.linked.instance;

nc.publish("shop.orders.created", JSON.stringify(order));
const reply = await nc.request(
  "billing.invoices.total",
  JSON.stringify({ id }),
);
```

It has the type of what your `connect` gives. Reading it before `start()`
resolved throws (`CHO_NATS_NOT_STARTED`): there is no connection yet.

## Stopping

`app.close()` stops the adapter:

1. the server sends nothing more;
2. every message that was already received is handled, and answered;
3. what is left is sent, and the connection is closed.

So a request that reached the application is answered, also when the application
closes meanwhile. A request that is sent after is answered by another instance
of the queue group or, when there is none, fails at once: NATS tells who asked
that nobody listens.

## When the adapter stops by itself

The adapter stops by itself in two cases: the connection closed and the client
does not connect again (`CHO_NATS_CONNECTION_CLOSED`), or a subscription failed,
as one the server refuses does (`CHO_NATS_SUBSCRIPTION_FAILED`). It then
finishes the messages in hand, closes what is still open, and calls `onFatal`
with the error (its `cause` is the error of the client).

nats.js connects again by itself: 10 times by default, 2 seconds apart. Give
`maxReconnectAttempts: -1` to `connect` for a client that never gives up.

Without `onFatal`, the error is thrown: an uncaught exception, which ends the
process, so that what runs the application starts it again. Give `onFatal` to do
something else:

```ts
new NatsLinker({
  connect,
  queue: "shop",
  onFatal: async (error) => {
    logger.fatal(error);
    await app.close(); // the adapter is stopped already: this ends the rest
    process.exit(1);
  },
});
```

## Behavior

- **One queue group for the application.** Every subject of the application is
  subscribed in the group of `queue`.
- **Topics keep their names**: the topic `shop.orders.created` of the
  application is the NATS subject `shop.orders.created`. A topic has no
  wildcard.
- **Delivery is at most once.** A message that is published while no instance
  listens, or while the connection is lost, is not received.
- **A message with no payload** reaches its handler with an empty value:
  `ctx.text()` is `""` and `ctx.json()` is `undefined`.
- **The adapter owns the connection**: it makes it on `start()`, and closes it
  on `stop()`.
- **A reply that cannot be sent**, as one larger than the server accepts or with
  a header NATS refuses, is logged (`CHO_NATS_REPLY_FAILED`), and who asked is
  told with an error reply. The adapter goes on.
- **A linker serves one application.** `link()` throws the second time.
- **Logs** go to the `cho:nats` debug context: `CHO_DEBUGLOG=cho:nats`.

## Testing

Handlers need no server to be tested: `app.handle(topic, message)` of
`@chojs/message` delivers a message by hand, with no linker, and resolves with
the reply.

The tests of the adapter itself are in two parts. `consume_test.ts` and
`mod_test.ts` need no server. `nats_test.ts` runs against a real one, on each
runtime with its own transport, when `NATS_URL` is set:

```sh
docker run -d --rm -p 4222:4222 nats:2
NATS_URL=localhost:4222 deno test --allow-env --allow-net vendor/nats/nats_test.ts
NATS_URL=localhost:4222 npx tsx --test vendor/nats/nats_test.ts
NATS_URL=localhost:4222 bun test vendor/nats/nats_test.ts
```

## Documentation

- [`@chojs/message`](../../message/README.md): topics, handlers, replies,
  middlewares and error handlers.
- [The specification of the adapter](./specs.md): its decisions, with the
  alternatives.
- [`examples/nats-reply.ts`](../../examples/nats-reply.ts): a service that
  answers, and a request to it.
- [nats.js](https://github.com/nats-io/nats.js): the client library, its
  transports and its options.
