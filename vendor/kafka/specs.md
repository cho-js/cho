# @chojs/vendor-kafka

The Apache Kafka adapter of `@chojs/message`. `message/specs.md`, section 7,
says what an adapter is and what it decides; this document makes those decisions
for Kafka. The guide is the [README](./README.md).

## 1. What it is

`KafkaLinker` implements `Linker` of `@chojs/message/linker`. `link(routes)`
creates a consumer and a producer of the client library, connects nothing, and
returns a `KafkaLinked`:

| Member     | Does                                                                         |
| ---------- | ---------------------------------------------------------------------------- |
| `instance` | `{ consumer, producer }`: the clients of the client library                  |
| `start()`  | joins the consumer group, and reads the topic of each route                  |
| `stop()`   | stops reading, waits for the messages in hand, leaves the group, disconnects |

The adapter is two files. `mod.ts` has the public API and the options.
`consume.ts` has what is done with a message (`Pump`): it knows the client
library through three small interfaces, so its tests need no broker.

## 2. Decisions

`→` marks the choice.

| #  | Question                             | → Chosen                                                                                                              | Alternative                                                                                 |
| -- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 1  | The client library                   | `@platformatic/kafka`: JavaScript only, typed, maintained                                                             | `@confluentinc/kafka-javascript` (native), `kafkajs`                                        |
| 2  | The runtimes                         | Node.js (22.22, 24.6 and later), as the client library; tested on Deno and Bun too, and not promised there            | a client of its own for Deno and Bun: months of work, for what the tests show is not needed |
| 3  | How the application is identified    | one consumer group, the required `groupId` option                                                                     | a group for each controller or topic                                                        |
| 4  | How a topic is named                 | as it is: the syntax of a CHO topic is one of Kafka                                                                   | a mapping of names                                                                          |
| 5  | Who creates the topics               | not the adapter                                                                                                       | the adapter creates what is missing                                                         |
| 6  | Where a new group starts             | `from: "latest"`, the default of Kafka                                                                                | `"earliest"` by default                                                                     |
| 7  | When an offset is committed          | after the message is settled, each message by itself                                                                  | autocommit on a timer                                                                       |
| 8  | A failed message, first              | tried again in place: `retries` (3), `retryDelay` (1000 ms)                                                           | a retry topic, which loses the order of the partition                                       |
| 9  | A failed message, after the retries  | sent to the `deadLetter` topic, and committed                                                                         | logged and passed over                                                                      |
| 10 | The same, with no `deadLetter`       | the consumer stops, the offset is not committed, `onFatal`                                                            | passed over: a message would be lost silently                                               |
| 11 | A dead letter that cannot be sent    | the consumer stops, as in 10                                                                                          | passed over                                                                                 |
| 12 | How the application learns of a stop | `onFatal(error)`; by default the error is thrown, uncaught                                                            | an event emitter; a rejected promise nobody holds                                           |
| 13 | How many messages run at once        | one for each partition, `concurrency` (1) partitions together                                                         | unbounded; or a pool that ignores the partitions                                            |
| 14 | What `ctx.native` is                 | `{ message, attempt }`: the message of the client, and the attempt                                                    | the message alone                                                                           |
| 15 | The value, the key and the headers   | the value as bytes; the key and the headers decoded as UTF-8                                                          | deserializers chosen by the application                                                     |
| 16 | A commit that fails                  | logged; the consumer goes on (at least once)                                                                          | the consumer stops                                                                          |
| 17 | A stream of messages that fails      | read again after `retryDelay`; if that fails, the consumer stops                                                      | the consumer stops at once                                                                  |
| 18 | A message in hand at `stop()`        | awaited; one that waits for a retry is left uncommitted                                                               | every retry is finished first                                                               |
| 19 | Sending messages                     | `linker.sender`, for a `ChoMessageClient`: it publishes with the producer of the adapter, which is also on `instance` | a producer of its own for the sender                                                        |
| 20 | What a handler returns               | dropped: Kafka has no replies                                                                                         | sent to a reply topic named by a header of the message                                      |
| 21 | A message that is not valid          | not tried again: dead at once                                                                                         | tried again as any failed message, which waits for what cannot work                         |
| 22 | A request                            | none: the sender has no `request`, and `ChoMessageClient.request` throws                                              | a reply topic named by a header, which each organization has its own of                     |

## 3. A message, step by step

1. The stream gives a message. It waits for the message before it in its
   partition, and for a free place when `concurrency` messages are in hand.
2. `route.handle(delivery, { message, attempt })` is called.
3. It resolves: the offset is committed. What it resolves with, the reply of the
   handler, is dropped: Kafka has no replies. The debug log says so once for a
   handler that returns one.
4. It rejects, and `attempt <= retries`: the adapter waits `retryDelay(attempt)`
   and goes to 2. A message that is not valid, one that rejects with the code
   `CHO_MESSAGE_INVALID_MESSAGE` (`message/specs.md`, section 3.5), skips this
   step: it goes to 5 at once.
5. It rejects, and the retries are used: with `deadLetter`, the dead letter is
   sent, then the offset is committed. Without, or when sending fails, the
   adapter stops (section 4).

A message of a topic that has no route is committed and skipped. It can only
happen for a topic the group read before.

## 4. Stopping

`stop()`, which `app.close()` calls, closes the stream, ends the waits between
retries, waits for the messages in hand, then closes the consumer and the
producer. It returns the same promise every time, and rejects when a client
fails to close, after it tried to close the other.

A fatal error does the same by itself, then calls `onFatal` once. The messages
that are in hand then are not committed. After it, `stop()` resolves.

## 5. Errors

Every mistake is a `ChoError` with a `code` (`core/specs.md`, section 2.8). The
code is part of the API; the messages are for people, and can change. The codes
of this package start with `CHO_KAFKA_` (type `ChoKafkaErrorCode`).

| Situation                                            | Code                            | Message                                                                                                      |
| ---------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| An option is missing, or wrong                       | `CHO_KAFKA_INVALID_OPTION`      | `KafkaLinker: the "brokers" option is required: a list of "host:port", such as ["localhost:9092"]`           |
| An option is unknown                                 | `CHO_CORE_UNKNOWN_OPTION`       | `KafkaLinker: unknown option "group". Known options: brokers, client, clientId, …`                           |
| `link()` is called twice                             | `CHO_KAFKA_ALREADY_LINKED`      | `KafkaLinker.link() was already called: use one linker for one application`                                  |
| A topic is too long                                  | `CHO_KAFKA_INVALID_TOPIC`       | `KafkaLinker: the topic of OrdersController.created has 250 characters: Kafka accepts 249 ("…")`             |
| The dead-letter topic is the topic itself            | `CHO_KAFKA_INVALID_DEAD_LETTER` | `KafkaLinker: the dead-letter topic of "orders" is "orders" itself: a dead message would be handled …`       |
| A dead message, and no dead-letter topic             | `CHO_KAFKA_NO_DEAD_LETTER`      | `KafkaLinker: OrdersController.created failed 4 time(s) for orders[0]@42, and there is no dead-letter …`     |
| A dead letter cannot be sent                         | `CHO_KAFKA_DEAD_LETTER_FAILED`  | `KafkaLinker: cannot send orders[0]@42 to the dead-letter topic "orders.dead": the consumer stopped, …`      |
| The topics cannot be read again                      | `CHO_KAFKA_CONSUME_FAILED`      | `KafkaLinker: cannot read the topics again`                                                                  |
| The sender is used before the application is created | `CHO_KAFKA_NOT_LINKED`          | `KafkaLinker: there is no producer before the application is created: send after ChoMessage.create resolved` |

The first two are thrown by the constructor. The last three reach `onFatal`,
with the original error as `cause`. An error of the client library that is not
one of these reaches `onFatal` as it is, without a code.

## 6. Not in this version

- **A retry topic**, or a delay that does not hold the partition.
- **Batches**: a handler that receives several messages.
- **Transactions**, and exactly-once delivery.
- **Asking.** The sender publishes (`message/specs.md`, section 7): it sends the
  value, the key and the headers of a delivery as bytes, with the producer of
  the adapter. It has no `request`.
- **Replies.** `@chojs/message` gives the reply of a handler to its adapter
  (`message/specs.md`, section 3.3), and this one drops it. A reply topic, named
  by a header of the message, is a convention each organization has its own of.
- **The schema registry** of the client library.
- **Static membership and the new group protocol**, except through `consume`.
- **A promise for Deno and Bun.** The tests of the adapter pass on them, against
  a broker (Deno 2.9, Bun 1.4): the client library uses only what they have of
  Node.js. It names Node.js alone, so the adapter says "tested", not
  "supported". On Deno it needs `--allow-read`: the client library reads a file
  when it loads.
- **Tests of TLS, SASL and compression**, on any runtime.
