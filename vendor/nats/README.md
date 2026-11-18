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
- [Messages that must not be lost](#messages-that-must-not-be-lost)
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

A route is a **core subscription** by default: subjects, a queue group, request
and reply, at most once. With the `jetstream` option, the routes of a stream are
consumed from **JetStream**, at least once: see
[Messages that must not be lost](#messages-that-must-not-be-lost).

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

For [JetStream](#messages-that-must-not-be-lost), add its client the same way:
`jsr:@nats-io/jetstream` on Deno, `@nats-io/jetstream` on Node.js and Bun.

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

| Option        | Default  | What it is                                                                                            |
| ------------- | -------- | ----------------------------------------------------------------------------------------------------- |
| `connect`     | required | a function that connects to NATS: `connect` of the transport, with your options                       |
| `queue`       | required | the queue group: the name of the application for NATS                                                 |
| `concurrency` | `1`      | how many messages of one subject are in hand at once                                                  |
| `errorReply`  | `500`    | what a requester is told when its message failed: `(error, message) => errorReply`                    |
| `onFatal`     | throws   | called when the adapter stopped by itself                                                             |
| `jetstream`   | none     | the streams of the application: see [Messages that must not be lost](#messages-that-must-not-be-lost) |

An option that is missing, unknown or wrong throws from the constructor, with a
message that names it: a `ChoError` with the code `CHO_NATS_INVALID_OPTION`
(`CHO_CORE_UNKNOWN_OPTION` for an option that does not exist). Every error of
the adapter has such a [code](./specs.md#8-errors).

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
core NATS: there is nothing to acknowledge, and nothing is delivered again. A
message that must not be lost goes through a stream:
[JetStream](#messages-that-must-not-be-lost) delivers it again.

## Messages that must not be lost

A core subscription is at most once: a message that is published while nobody
listens is gone, and so is one whose handler failed. **JetStream** keeps
messages: a _stream_ stores the messages of its subjects, and delivers each one
again until it is acknowledged. Give the adapter the streams of the application:

```ts
import { jetstream } from "@nats-io/jetstream";

new NatsLinker({
  connect: () => connect({ servers: "nats:4222" }),
  queue: "shop",
  jetstream: {
    client: (nc) => jetstream(nc),
    streams: ["ORDERS"],
    deadLetter: (topic) => `dead.${topic}`,
  },
});
```

A route whose subject is a subject of one of the streams is consumed from it.
Every other route stays a core subscription, so one application has both: the
handlers that answer requests, and the ones whose messages must arrive.

```ts
@Controller({ topic: "shop.orders" })
class OrdersController {
  @Subscribe("created") // of the stream ORDERS: kept, acknowledged, retried
  created(ctx: ChoMessageContext) {}

  @Subscribe("price") // of no stream: a request, answered with what it returns
  price(ctx: ChoMessageContext) {}
}
```

| Option       | Default  | What it is                                                            |
| ------------ | -------- | --------------------------------------------------------------------- |
| `client`     | required | makes the JetStream client: `(nc) => jetstream(nc)`                   |
| `streams`    | required | the names of the streams of the application                           |
| `retries`    | `3`      | how many times a failed message is delivered again                    |
| `retryDelay` | `1000`   | the milliseconds before a retry: a number, or a function of the retry |
| `deadLetter` | none     | the subject of the dead messages: a name, or a function of the topic  |
| `ackWait`    | `30000`  | the milliseconds a handler has before its message is delivered again  |

What happens to a message of a stream:

1. **Handled: acknowledged.** It is not delivered again. What the handler
   returns is dropped: a message of a stream has nobody to answer.
2. **Failed: delivered again**, after `retryDelay`, `retries` times.
   `ctx.native.attempt` is `1` the first time, `2` on the first retry. A message
   that waits for its retry still counts as one in hand: with `concurrency: 1`
   it holds its route meanwhile, so the order of the route is kept.
3. **Then the message is dead.** It is published to the `deadLetter` subject,
   and ended. Without `deadLetter` it is ended, and logged: it stays in the
   stream, and the route goes on.

A **message that is not valid**, one that
[`validate()`](../../message/README.md#validation) refused, is not delivered
again: it is dead at once.

A dead letter is the message as it was (its payload and its headers), with
headers that say where it comes from:

| Header         | Holds                                  |
| -------------- | -------------------------------------- |
| `cho-topic`    | the topic of the message               |
| `cho-stream`   | its stream                             |
| `cho-sequence` | its sequence in the stream             |
| `cho-consumer` | the consumer of the route              |
| `cho-attempts` | how many times the message was handled |
| `cho-error`    | the message of the last error          |

Their names are exported as `DEAD_LETTER_HEADERS`. The dead-letter subject must
be a subject of a stream, so that the dead letters are kept: when one cannot be
published, the message is not ended, and is tried again after `retryDelay`.

Things to know:

- **The streams are yours.** The adapter creates none: `start()` rejects for a
  stream that does not exist (`CHO_NATS_STREAM_NOT_FOUND`). A subject of a
  stream can have wildcards (`shop.orders.>`).
- **The consumers are the adapter's.** Each route of a stream has one durable
  consumer, named after the queue group and the topic
  (`shop_shop_orders_created`), which every instance of the application shares.
  It is made, or changed to what the options say, on each start.
- **Delivery is at least once.** A message can be handled twice: after a crash,
  or when its handler is slower than `ackWait`. A handler should be safe to run
  twice for the same message.
- **`concurrency`** is, for a route of a stream, how many of its messages are
  not settled yet at once, the ones that wait for a retry included. With 1, the
  messages of a route are handled in order, also when one fails. With more, a
  message is handled while another waits for its retry.
- **`app.close()`** waits for the messages in hand, which are acknowledged. A
  message that was received and not handled yet is left to the stream: it is
  delivered again.
- `ctx.native` is a `NatsStreamNative`, `{ message, attempt }`: the message of
  the JetStream client (`seq`, `info`, `time`).

## Order and concurrency

The messages of one subject are handled one at a time, in the order they came.
`concurrency` is how many messages of one subject are in hand at once: with more
than 1, a subject no longer keeps its order. The subjects do not wait for each
other.

NATS gives the messages as fast as they are published, and the client keeps the
ones that wait in memory. A handler that stays slower than its publishers needs
a [stream](#messages-that-must-not-be-lost), which keeps them on the server.

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
- **Delivery is at most once** for a core subscription: a message that is
  published while no instance listens, or while the connection is lost, is not
  received. It is at least once for a route of a
  [stream](#messages-that-must-not-be-lost).
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

The tests of the adapter itself are in two parts. `consume_test.ts`,
`stream_test.ts`, `send_test.ts` and `mod_test.ts` need no server.
`nats_test.ts` runs against a real one, on each runtime with its own transport,
when `NATS_URL` is set. Its JetStream tests run when the server has JetStream
(`-js`), and are skipped otherwise:

```sh
docker run -d --rm -p 4222:4222 nats:2 -js
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
