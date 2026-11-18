# @chojs/vendor-kafka

[![JSR](https://jsr.io/badges/@chojs/vendor-kafka)](https://jsr.io/@chojs/vendor-kafka)
[![JSR score](https://jsr.io/badges/@chojs/vendor-kafka/score)](https://jsr.io/@chojs/vendor-kafka)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

The [Apache Kafka](https://kafka.apache.org) adapter for
[`@chojs/message`](../../message/README.md): it subscribes the topics of a CHO
message application to Kafka, as one consumer group.

## Contents

- [Runtime support](#runtime-support)
- [Installation](#installation)
- [Usage](#usage)
- [Options](#options)
- [A message that failed](#a-message-that-failed)
- [Order and concurrency](#order-and-concurrency)
- [Reaching Kafka from a handler](#reaching-kafka-from-a-handler)
- [Sending messages](#sending-messages)
- [When the consumer stops by itself](#when-the-consumer-stops-by-itself)
- [Behavior](#behavior)
- [Testing](#testing)
- [Documentation](#documentation)

## Runtime support

**Node.js**: 22.22, or 24.6 and later. The client library,
[`@platformatic/kafka`](https://github.com/platformatic/kafka), is written for
Node.js.

**Deno and Bun: tested, not promised.** The tests of the adapter pass on Deno
2.9 and on Bun 1.4, against a broker, with no change: the client library uses
only what the two have of Node.js. It names Node.js alone, though, so a release
of it can change that: run the tests on your runtime before you rely on it. On
Deno, the client library reads a file when it loads: the application needs
`--allow-read`, with `--allow-net` and `--allow-env`.

The tests use a plain connection: TLS, SASL and compression are tested on no
runtime here. The adapter works with Apache Kafka 3.5 to 4.2.

## Installation

```sh
npx jsr add @chojs/message @chojs/vendor-kafka         # Node.js
deno add jsr:@chojs/message jsr:@chojs/vendor-kafka    # Deno
bunx jsr add @chojs/message @chojs/vendor-kafka        # Bun
```

The client library comes with the adapter.

## Usage

Pass a `KafkaLinker` to `ChoMessage.create`, and start the application:

```ts
import {
  ChoMessage,
  type ChoMessageContext,
  Controller,
  Module,
  Subscribe,
} from "@chojs/message";
import { KafkaLinker } from "@chojs/vendor-kafka";

@Controller({ topic: "orders" })
class OrdersController {
  @Subscribe("created") // the Kafka topic "shop.orders.created"
  created(ctx: ChoMessageContext) {
    console.log("order", ctx.key, ctx.json());
  }
}

@Module({ topic: "shop", controllers: [OrdersController] })
class AppModule {}

const app = await ChoMessage.create(AppModule, {
  linker: new KafkaLinker({
    brokers: ["localhost:9092"],
    groupId: "mailer",
    deadLetter: (topic) => `${topic}.dead`,
  }),
});

await app.start(); // connects, joins the group "mailer", and subscribes
```

`ChoMessage.create` connects to nothing: `start()` does, and rejects when Kafka
cannot be reached. To stop:

```ts
await app.close();
```

`close()` stops reading, waits for the messages in hand, leaves the group and
disconnects. A message that did not finish is not committed: Kafka delivers it
again.

## Options

| Option        | Default       | What it is                                                                                 |
| ------------- | ------------- | ------------------------------------------------------------------------------------------ |
| `brokers`     | required      | the brokers to connect first, as `host:port`                                               |
| `groupId`     | required      | the consumer group: the name of the application for Kafka                                  |
| `clientId`    | the `groupId` | the name of this client, in the logs of the brokers                                        |
| `from`        | `"latest"`    | where the group starts in a topic it never read: `"earliest"` or `"latest"`                |
| `retries`     | `3`           | how many times a failed message is tried again                                             |
| `retryDelay`  | `1000`        | the milliseconds before a retry: a number, or a function of the retry (`1` for the first)  |
| `deadLetter`  | none          | the topic of the dead messages: a name, or a function of the topic of the message          |
| `concurrency` | `1`           | how many messages are in hand at once                                                      |
| `onFatal`     | throws        | called when the consumer stopped by itself                                                 |
| `client`      | none          | the connection options of the client library: `tls`, `sasl`, `connectTimeout`, …           |
| `consume`     | none          | more consumer options of the client library: `sessionTimeout`, `maxBytes`, `maxWaitTime`,… |

An option that is missing, unknown or wrong throws from the constructor, with a
message that names it: a `ChoError` with the code `CHO_KAFKA_INVALID_OPTION`
(`CHO_CORE_UNKNOWN_OPTION` for an option that does not exist). Every error of
the adapter has such a [code](./specs.md#5-errors).

```ts
new KafkaLinker({
  brokers: ["kafka-1:9093", "kafka-2:9093"],
  groupId: "mailer",
  from: "earliest",
  retries: 5,
  retryDelay: (retry) => 500 * 2 ** retry, // 1s, 2s, 4s, 8s, 16s
  deadLetter: (topic) => `${topic}.dead`,
  concurrency: 8,
  client: {
    tls: {},
    sasl: { mechanism: "SCRAM-SHA-512", username, password },
  },
  consume: { sessionTimeout: 30_000 },
});
```

Every instance of the application has the same `groupId`: Kafka shares the
partitions between them. With `from: "latest"`, a group that is new does not
read the messages that were sent before it first started.

## A message that failed

A message failed when its handler threw and no error handler settled it (see
[error handling](../../message/README.md#error-handling) in `@chojs/message`).
Kafka cannot refuse one message: a consumer commits a position in a partition,
and everything before it is done. So the adapter decides, in this order:

1. **It tries the message again, in place**: `retries` times, `retryDelay`
   milliseconds apart. The partition waits meanwhile, so its order is kept.
   `ctx.native.attempt` is `1` the first time, `2` on the first retry.
2. **Then the message is dead.** It is sent to the `deadLetter` topic and
   committed, and the partition goes on.
3. **Without `deadLetter`, the consumer stops.** The offset is not committed, so
   no message is lost or passed over: the message is delivered again when the
   application starts again. [`onFatal`](#when-the-consumer-stops-by-itself) is
   called.

**A message that is not valid is not tried again.** When
[`validate()`](../../message/README.md#validation) of `@chojs/message` refuses a
message, it will refuse it the next time too: the adapter skips step 1, and the
message is dead at once.

A dead letter is the message as it was (its key, its value and its headers),
with these headers added:

| Header          | Holds                                       |
| --------------- | ------------------------------------------- |
| `cho-topic`     | the topic the message comes from            |
| `cho-partition` | its partition                               |
| `cho-offset`    | its offset                                  |
| `cho-group`     | the consumer group that could not handle it |
| `cho-attempts`  | how many times it was tried                 |
| `cho-error`     | the message of the last error               |

Their names are exported as `DEAD_LETTER_HEADERS`. The dead-letter topic is not
created by the adapter, and cannot be the topic of the message itself. When the
dead letter cannot be sent, the consumer stops, as in 3.

To drop a message that can never be handled, rather than try it again, settle it
in an error handler of the application:

```ts
@Catch((error) => error instanceof SyntaxError) // handled: committed
@Subscribe("created")
created(ctx: ChoMessageContext) {/* ... */}
```

## Order and concurrency

- The messages of **one partition** are handled one at a time, in the order of
  the partition, whatever `concurrency` is.
- `concurrency` is how many messages, of **different partitions**, are in hand
  at once. With `1`, the default, the application handles one message at a time:
  a message that waits for its retry holds the others back.
- A message is committed when it is settled, each one by itself.

Delivery is **at least once**: a message is handled again when the application
stopped before its commit, or when its partition moved to another instance
meanwhile. Handlers should give the same result when they see a message twice.

## Reaching Kafka from a handler

`ctx.native` is a `KafkaNative`: the message of the client library, and the
number of the attempt.

```ts
import type { KafkaNative } from "@chojs/vendor-kafka";

@Subscribe("created")
created(ctx: ChoMessageContext) {
  const { message, attempt } = ctx.native as KafkaNative;
  message.partition; //     number
  message.offset; //        bigint
  message.timestamp; //     bigint, in milliseconds
  message.key; //           the bytes of the key
  message.headerEntries; // every header, as bytes, repeated ones included
}
```

`ctx.key` and `ctx.headers` are strings. A key or a header that is not valid
UTF-8 is decoded with replacement characters, and when a header is repeated the
last one wins: the bytes, and every header, are in `ctx.native`.

A handler that uses `ctx.native` runs on this adapter only, and not with
`app.handle`, which has no native message.

## Sending messages

**With a contract.** `linker.sender` is the sender of the adapter: give it to a
[`ChoMessageClient`](../../message/README.md#sending-messages) of
`@chojs/message`, and publish the message of a contract, as JSON, with its key
and its headers.

```ts
import { ChoMessageClient } from "@chojs/message";

const linker = new KafkaLinker({ brokers, groupId: "shop" });
const client = new ChoMessageClient(linker.sender);

const app = await ChoMessage.create(AppModule, { linker });

await client.publish(OrderCreated, { id: 42, total: 12 }, { key: "42" });
```

The sender is there as soon as the linker is made, and sends once the
application is created (`CHO_KAFKA_NOT_LINKED` before). **Kafka has no
replies**: `client.request` throws `CHO_MESSAGE_NO_REPLIES` on this adapter.

**With the producer.** The adapter has a producer of the client library, for its
dead letters and for its sender, and the application can use it. It connects on
its first message, and `app.close()` closes it:

```ts
import { Buffer } from "node:buffer";

const { producer } = app.linked.instance;

await producer.send({
  messages: [{
    topic: "shop.orders.created",
    key: Buffer.from("42"),
    value: Buffer.from(JSON.stringify({ id: 42 })),
    headers: new Map([[Buffer.from("message-id"), Buffer.from("abc")]]),
  }],
});
```

It writes bytes: keys, values and headers are `Buffer`s. `app.linked.instance`
also has the `consumer`.

## When the consumer stops by itself

The consumer stops by itself in three cases: a dead message with no `deadLetter`
topic, a dead letter that cannot be sent, and a connection the client library
could not restore. It then finishes the messages in hand, closes its clients,
and calls `onFatal` with the error (its `cause` is the error of the handler, or
of the client). The error of the first two cases, and of a consumer that cannot
read its topics again, is a `ChoError` with a code: `CHO_KAFKA_NO_DEAD_LETTER`,
`CHO_KAFKA_DEAD_LETTER_FAILED`, `CHO_KAFKA_CONSUME_FAILED`.

Without `onFatal`, the error is thrown: an uncaught exception, which ends the
process, so that what runs the application starts it again. Give `onFatal` to do
something else:

```ts
new KafkaLinker({
  brokers,
  groupId: "mailer",
  onFatal: async (error) => {
    logger.fatal(error);
    await app.close(); // the adapter is stopped already: this ends the rest
    process.exit(1);
  },
});
```

## Behavior

- **One consumer group for the application.** Every topic of the application is
  read by the group of `groupId`.
- **Topics keep their names**: the topic `shop.orders.created` of the
  application is the Kafka topic `shop.orders.created`. A topic longer than 249
  characters, the limit of Kafka, is refused when the application is created.
- **Topics are not created by the adapter.** Create them, or let the broker do
  it (`auto.create.topics.enable`).
- **Offsets are committed by the adapter**, one message at a time, after the
  message is settled. A commit that fails is logged, and the consumer goes on:
  the message may be delivered again.
- **A message with no value** (a tombstone) reaches its handler with an empty
  value: `ctx.value` has no bytes, `ctx.text()` is `""` and `ctx.json()` is
  `undefined`.
- **What a handler returns is dropped.** Kafka has no replies: a handler that
  answers another application sends a message, with the
  [producer](#sending-messages). The debug log says once that a handler returned
  a value.
- **A linker serves one application.** `link()` throws the second time.
- **Logs** go to the `cho:kafka` debug context: `CHO_DEBUGLOG=cho:kafka`.

## Testing

Handlers need no broker to be tested: `app.handle(topic, message)` of
`@chojs/message` delivers a message by hand, with no linker.

The tests of the adapter itself are in two parts. `consume_test.ts`,
`send_test.ts` and `mod_test.ts` need no broker. `kafka_test.ts` runs against a
real one, on each runtime, when `KAFKA_BROKERS` is set:

```sh
docker run -d --rm -p 9092:9092 apache/kafka:4.1.0
KAFKA_BROKERS=localhost:9092 npx tsx --test vendor/kafka/kafka_test.ts
KAFKA_BROKERS=localhost:9092 deno test --allow-all vendor/kafka/kafka_test.ts
KAFKA_BROKERS=localhost:9092 bun test --timeout 120000 vendor/kafka/kafka_test.ts
```

## Documentation

- [`@chojs/message`](../../message/README.md): topics, handlers, middlewares and
  error handlers.
- [The specification of the adapter](./specs.md): its decisions, with the
  alternatives.
- [`@platformatic/kafka`](https://github.com/platformatic/kafka): the client
  library, and its options.
