# @chojs/vendor-nats

The NATS adapter of `@chojs/message`. `message/specs.md`, section 7, says what
an adapter is and what it decides; this document makes those decisions for NATS.
The guide is the [README](./README.md).

It is the first adapter that sends a reply: what a handler returns
(`message/specs.md`, section 3.3) is the answer to a NATS request.

## 1. What it is

`NatsLinker` implements `Linker` of `@chojs/message/linker`. `link(routes)`
connects nothing, and returns a `NatsLinked`:

| Member     | Does                                                                                    |
| ---------- | --------------------------------------------------------------------------------------- |
| `instance` | the connection of the client library, once `start()` resolved                           |
| `start()`  | calls `connect`, and subscribes to the subject of each route, in the queue group        |
| `stop()`   | receives nothing more, handles and answers what was received, and closes the connection |

`mod.ts` has the public API and the options. `consume.ts` has what is done with
a message (`Pump`): it knows the client library through three small interfaces,
so its tests need no server. `send.ts` has the sender (section 6), and
`stream.ts` what is done with a message of a stream (section 5).

**A route receives its messages in one of two ways.** By default it is a core
subscription: subjects, a queue group, request and reply. Delivery is at most
once, and there is nothing to acknowledge: sections 3 and 4. With the
`jetstream` option, a route whose subject is of a stream of the application is
consumed from that stream, with acknowledgements: delivery is at least once, and
there is nobody to answer: section 5.

## 2. Decisions

`→` marks the choice.

| #  | Question                                 | → Chosen                                                                                                                                                                                            | Alternative                                                    |
| -- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1  | The client library                       | nats.js v3, `@nats-io/nats-core`                                                                                                                                                                    | the older `nats` package, which is Node.js only                |
| 2  | The runtimes                             | Deno, Node.js and Bun: wherever nats.js runs (section 7)                                                                                                                                            | one runtime                                                    |
| 3  | Core NATS, or JetStream                  | both: a core subscription by default, where a request has a reply; a stream for the routes of the `jetstream` option (section 5)                                                                    | one of the two only                                            |
| 4  | Who makes the connection                 | the application: the required `connect` option                                                                                                                                                      | the adapter, which would import one transport for each runtime |
| 5  | Who owns the connection                  | the adapter: `start()` makes it, `stop()` closes it                                                                                                                                                 | the application closes it                                      |
| 6  | How the application is identified        | one queue group, the required `queue` option                                                                                                                                                        | no queue group: every instance gets every message              |
| 7  | How a topic is named                     | as it is: a CHO topic is a subject of NATS, with no wildcard                                                                                                                                        | a mapping of names                                             |
| 8  | The value, the key and the headers       | the payload as bytes; no key; the first value of each header                                                                                                                                        | every value of a header, joined                                |
| 9  | What `ctx.native` is                     | `{ message }`: the `Msg` of the client                                                                                                                                                              | the message alone                                              |
| 10 | What a handler returns, for a request    | sent as the reply, with its headers when it has some                                                                                                                                                | dropped, as an adapter with no replies does                    |
| 11 | A request whose handler returned nothing | answered with an empty reply                                                                                                                                                                        | not answered: the requester waits for its timeout              |
| 12 | A reply nobody asked for                 | dropped; the debug log says so once for a handler                                                                                                                                                   | an error                                                       |
| 13 | A request that failed                    | answered with an error reply, as a NATS service does (`ERROR_HEADERS`)                                                                                                                              | not answered: the requester waits for its timeout              |
| 14 | What an error reply says                 | the code and the description of a `ReplyError` the handler threw; otherwise `500`, `Internal Error` (`400`, `Bad Request` for a message that is not valid), or what the `errorReply` option decides | the message of the error, which can tell a secret              |
| 15 | A failed message that asks for no reply  | logged, and lost: core NATS has no redelivery; a stream has (section 5)                                                                                                                             | tried again in place, which NATS itself would not do           |
| 16 | A reply that cannot be sent              | logged; who asked is told with an error reply; the adapter goes on                                                                                                                                  | the adapter stops                                              |
| 17 | How many messages run at once            | `concurrency` (1) for each subject, in order when it is 1                                                                                                                                           | unbounded; or one pool for every subject                       |
| 18 | A connection that is lost                | the client connects again by itself, as its options say                                                                                                                                             | the adapter connects again                                     |
| 19 | A connection that closes for good        | `onFatal(error)`; by default the error is thrown, uncaught                                                                                                                                          | an event emitter; a rejected promise nobody holds              |
| 20 | A message received before `stop()`       | handled, and answered, before the connection closes                                                                                                                                                 | dropped: only the ones in hand are finished                    |
| 21 | Sending, and asking                      | `linker.sender`, for a `ChoMessageClient`; and the connection, `instance`: `publish`, `request`                                                                                                     | a `publish` API of the adapter itself                          |
| 22 | The type of `instance`                   | the type of what `connect` gives (`NatsLinker<C>`)                                                                                                                                                  | the `NatsConnection` of the copy the adapter was built with    |
| 23 | When the sender can send                 | once `start()` was called: it waits for a start that is not done                                                                                                                                    | at any time, with a connection of its own                      |
| 24 | How long a request waits                 | 1000 ms, as nats.js; the request, or the client, says otherwise                                                                                                                                     | no limit                                                       |
| 25 | A request nobody answers                 | `CHO_MESSAGE_NO_RESPONDERS`, at once, when no subscription listens; `CHO_MESSAGE_REQUEST_TIMEOUT` otherwise                                                                                         | the error of the client library, which another broker has not  |

Notes:

- **4, 22.** The adapter imports no transport. It imports the types of
  `@nats-io/nats-core`, and one function of it, `headers`, to make the headers
  of an error reply. The connection is known through `NatsConnectionLike`, the
  five methods the adapter calls, so an application whose transport brings
  another copy or another version of nats.js still type-checks, and
  `app.linked.instance` has the type of its own connection.
- **6.** Without a queue group, two instances of an application would each
  handle every message, and each answer every request.
- **13, 14.** The headers are `Nats-Service-Error` (the description) and
  `Nats-Service-Error-Code` (the code), the ones of the NATS services framework:
  a requester reads an error of a CHO application as it reads the error of any
  NATS service. An error handler of `@chojs/message` (`@Catch`) that returns a
  value answers with that value instead: it is a reply, not an error reply.
- **10, 16.** A header of NATS has a name of printable ASCII with no space and
  no `:`, and a value of one line. The client checks them: a reply whose headers
  it refuses cannot be sent, and who asked is told of an error instead. The name
  is sent as it was written.
- **17.** NATS gives the messages as fast as they are published, and the client
  keeps what waits for a free place in memory. A handler that is slower than its
  publishers for a long time needs a stream (section 5), which keeps them on the
  server.
- **18.** nats.js connects again 10 times by default, 2 seconds apart, then
  closes the connection: `maxReconnectAttempts: -1` in the options of `connect`
  never gives up. The subscriptions are restored by the client. What is
  published while the connection is lost is not received: core NATS.

## 3. A message, step by step

1. The subscription of the subject gives a message. It waits for a free place
   when `concurrency` messages of its subject are in hand.
2. `route.handle(delivery, { message })` is called. The delivery has the payload
   as its value, no key, and the first value of each header.
3. The message **asks for a reply** when it has a reply subject (`message.reply`
   is not empty): `request()` of a client sets one.
4. It resolves, and a reply was asked: the reply of the handler is sent with
   `message.respond`, with its headers when the handler gave some (a
   `ChoMessageReply`). When the handler returned nothing, an empty reply is
   sent.
5. It resolves, and no reply was asked: nothing is sent. A reply of the handler
   is dropped, and the debug log says so once for that handler.
6. It rejects, and a reply was asked: an error reply is sent. For a `ReplyError`
   (`message/specs.md`, section 5.1), it has the code and the description of the
   error, and `errorReply` is not asked. For any other error, `errorReply`
   chooses its code, description and payload; when there is none, when it
   returns nothing, when it throws or returns something else, they are `500`,
   `Internal Error` and empty. For a message that is not valid, one that rejects
   with the code `CHO_MESSAGE_INVALID_MESSAGE` (`message/specs.md`, section
   3.5), they are `400` and `Bad Request`: the mistake is of who asked.
7. It rejects, and no reply was asked: the error is logged, and the message is
   lost.
8. A reply that cannot be sent (it is larger than the server accepts, or one of
   its headers is not a header of NATS) is logged as `CHO_NATS_REPLY_FAILED`,
   and who asked is sent an error reply for it, as in 6. A message is never a
   reason for the adapter to stop.

## 4. Starting and stopping

`start()`, which `app.start()` calls, calls `connect`, subscribes to the subject
of each route with the queue group, and resolves when the server has the
subscriptions (a `flush`). It rejects with the error of `connect` when NATS
cannot be reached, and gives the same promise every time. An application with no
route still connects: the connection is its client.

`stop()`, which `app.close()` calls:

1. drains each subscription: the server sends nothing more;
2. waits until every message that was already received is handled, and answered;
3. drains the connection, which sends what is left and closes it.

It returns the same promise every time, never rejects for a message, and rejects
when a subscription or the connection fails to end. Before `start()` it does
nothing, and a later `start()` then connects nothing. A connection that is made
while it stops is closed.

**The adapter stops by itself** when the connection closes and the client does
not connect again (`CHO_NATS_CONNECTION_CLOSED`), or when a subscription fails
or ends, as one the server refuses does (`CHO_NATS_SUBSCRIPTION_FAILED`). It
then waits for the messages in hand, closes what is still open, and calls
`onFatal` once. After it, `stop()` resolves.

## 5. JetStream

JetStream is what NATS keeps messages with: a **stream** stores the messages of
its subjects, and a **consumer** is the bookmark of who reads them. The
`jetstream` option gives the adapter the streams of the application. A route
whose subject is a subject of one of them is consumed from it, and each of its
messages is acknowledged: delivery is **at least once**. Every other route is a
core subscription, as in sections 3 and 4.

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

| Option       | Default  | What it is                                                                        |
| ------------ | -------- | --------------------------------------------------------------------------------- |
| `client`     | required | makes the JetStream client of the connection: `jetstream` of `@nats-io/jetstream` |
| `streams`    | required | the names of the streams of the application; at least one                         |
| `retries`    | `3`      | how many times a failed message is delivered again                                |
| `retryDelay` | `1000`   | the milliseconds before a retry: a number, or a function of the retry             |
| `deadLetter` | none     | the subject of the dead messages: a name, or a function of the topic              |
| `ackWait`    | `30000`  | the milliseconds a handler has before its message is delivered again              |

`stream.ts` has what is done with a message of a stream (`StreamReader`). It
knows the JetStream client through small interfaces, as `consume.ts` knows the
connection, so its tests need no server.

### 5.1 Decisions

| #  | Question                                       | → Chosen                                                                              | Alternative                                                         |
| -- | ---------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 26 | Where JetStream is                             | an option of `NatsLinker`: one application has both kinds of routes                   | another linker, and so another application                          |
| 27 | Who makes the JetStream client                 | the application: the `client` option, as `connect` for the connection                 | the adapter, which would import `@nats-io/jetstream` at runtime     |
| 28 | Which routes are of a stream                   | the ones whose subject a named stream holds; the server says                          | every route that some stream holds, with no option                  |
| 29 | A stream that does not exist                   | `start()` rejects: the adapter creates no stream                                      | a core subscription in its place, which is "at most once", silently |
| 30 | Who makes the consumer                         | the adapter: one durable consumer for each route, named after the queue and the topic | the operator, before the application starts                         |
| 31 | A handled message                              | `ack`                                                                                 | acknowledged by the client before the handler                       |
| 32 | A failed message                               | `nak`, delivered again by the server after `retryDelay`, `retries` times              | tried again by the adapter, in place, with a timer of its own       |
| 33 | Who counts the deliveries                      | the adapter, from the count of the message; the consumer has no limit                 | `max_deliver` of the consumer, which stops with nothing done        |
| 34 | A dead message                                 | published to `deadLetter` with its headers, then `term`                               | acknowledged and logged                                             |
| 35 | The same, with no `deadLetter`                 | `term`, and logged: it stays in the stream, and the consumer goes on                  | the adapter stops, as Kafka's, which cannot refuse one message      |
| 36 | A dead letter that cannot be sent              | logged; the message is delivered again after `retryDelay`, and tried again            | the adapter stops; or the message is ended, and lost                |
| 37 | A message that is not valid                    | dead at once: no retry                                                                | retried as any failed message                                       |
| 38 | What a handler returns                         | dropped; the debug log says so once for a handler                                     | published somewhere                                                 |
| 39 | What `ctx.native` is                           | `{ message, attempt }`: the `JsMsg` of the client, and the number of the delivery     | the message alone                                                   |
| 40 | How many messages run at once                  | `concurrency` for each route: also its `max_ack_pending`                              | a limit of the client alone                                         |
| 41 | A message received and not handled at `stop()` | left unacknowledged: delivered again                                                  | handled before the application closes                               |
| 42 | A slow handler                                 | has `ackWait`; the adapter does not extend it                                         | the adapter tells the server that it still works                    |

Notes:

- **27.** The adapter imports the types of `@nats-io/jetstream` only. The
  application gives the client of the copy that goes with its transport, so
  there is no second copy of the client library.
- **28.** A subject of a stream can have the wildcards of NATS (`orders.>`,
  `orders.*`): the adapter matches the topic of a route against them. When two
  streams hold a topic, the first one of the option has it. A stream that holds
  no topic of the application is named in the debug log.
- **30.** The name is the queue group, a `_`, and the topic, with every `.` as a
  `_` (`shop_orders_created`): the instances of an application share the
  consumer, and a message goes to one of them. The consumer is made, or changed
  to what the options say, on each start: `ack_policy: explicit`,
  `filter_subject`, `ack_wait`, `max_ack_pending`, and no `max_deliver`. Two
  topics of one application that give the same name (`a.b_c` and `a_b.c`) are
  refused (`CHO_NATS_DUPLICATE_CONSUMER`).
- **32, 40.** A message that waits for its retry is still one the consumer has
  not settled: it counts in `max_ack_pending`. With `concurrency: 1` it holds
  its route until it is handled or dead, so a route keeps the order of its
  messages, also when one fails. With more, the other messages are handled
  meanwhile, and the order is not kept. Both are tested against a server.
- **36.** The dead-letter subject must be a subject of a stream: the adapter
  publishes to it with the JetStream client, which waits until a stream has the
  message. Until it can, the message is neither ended nor lost.
- **41.** This is the other way round from a core subscription (section 4),
  where what was received is handled before the connection closes: a message of
  a stream is kept by the server, so nothing is lost by leaving it.

### 5.2 A message of a stream, step by step

1. The consumer gives a message. It waits for a free place when `concurrency`
   messages of its route are in hand.
2. `route.handle(delivery, { message, attempt })` is called. `attempt` is the
   count of deliveries of the message: `1` the first time.
3. It resolves: `ack`. What it resolves with, the reply of the handler, is
   dropped: the debug log says so once for a handler that returns one.
4. It rejects, and `attempt <= retries`: `nak`, with `retryDelay(attempt)`. The
   server delivers the message again after it.
5. It rejects, and the retries are used, or the message is not valid
   (`CHO_MESSAGE_INVALID_MESSAGE`): the message is dead.
   - With `deadLetter`: the message is published to that subject, with its own
     headers and the headers `DEAD_LETTER_HEADERS` (the topic, the stream, the
     sequence, the consumer, the attempts, the error), then `term`.
   - Without: `term`, and the error is logged.
   - When the dead letter cannot be published: the error is logged
     (`CHO_NATS_DEAD_LETTER_FAILED`), and the message is delivered again after
     `retryDelay`.

A message whose handler is still running after `ackWait` is delivered again, to
this instance or another: a handler should be safe to run twice for the same
message.

### 5.3 Starting and stopping

`start()` connects, then, before any subscription:

1. makes the JetStream client with `client(connection)`
   (`CHO_NATS_INVALID_JETSTREAM` when what it gives is not one);
2. reads each stream of `streams` (`CHO_NATS_STREAM_NOT_FOUND` for one that does
   not exist, or when JetStream cannot be reached);
3. makes the consumer of each route of a stream (`CHO_NATS_CONSUMER_FAILED`);
4. starts reading the consumers, and subscribes to the other routes.

A start that fails has handled nothing: reading starts once every consumer is
made.

`stop()` asks the consumers for no more messages, waits for the messages in
hand, which are acknowledged, then drains the connection as in section 4, which
sends the acknowledgements. A consumer that fails or ends by itself (it was
deleted, or its stream was) stops the adapter, as a subscription does
(`CHO_NATS_SUBSCRIPTION_FAILED`).

## 6. Sending

`linker.sender` is the `Sender` of the adapter (`message/specs.md`, section 7):
what a `ChoMessageClient` is built on. It is made with the linker, before the
application is created, and uses the connection of the application.

| Member    | Does                                                                         |
| --------- | ---------------------------------------------------------------------------- |
| `publish` | `connection.publish`: the value as bytes, and the headers                    |
| `request` | `connection.request`, with the time to wait (1000 ms); resolves with a reply |

- **Before `start()` was called** it rejects with `CHO_NATS_NOT_STARTED`. While
  `start()` runs it waits for the connection, and it rejects with the error of a
  `connect` that failed.
- **NATS has no key**: the key of a delivery is not sent. A header NATS does not
  accept rejects, with the error of the client.
- **The reply** is the payload, and the first value of each header when it has
  some.
- **An error reply** is a reply with one of the headers `ERROR_HEADERS`, as a
  NATS service and this adapter answer: `request` rejects with a `ReplyError` of
  its code (`500` when it has none, or one that is not a number) and its
  description (`Error` when it has none).
- **Nobody listens**: `CHO_MESSAGE_NO_RESPONDERS`. **No reply in time**:
  `CHO_MESSAGE_REQUEST_TIMEOUT`. Both have the error of the client as `cause`,
  and are recognized by its name, so that the error of another copy of nats.js
  is one too. Any other error of the client rejects as it is.

## 7. Runtimes

The adapter runs wherever nats.js does. The application imports `connect` from
the transport of its runtime:

| Runtime | Transport                                               |
| ------- | ------------------------------------------------------- |
| Node.js | `@nats-io/transport-node`, on npm                       |
| Bun     | `@nats-io/transport-node`, on npm                       |
| Deno    | `@nats-io/transport-deno`, on JSR                       |
| any     | `wsconnect` of `@nats-io/nats-core`, through WebSockets |

The tests against a server (`nats_test.ts`) run on the first three, each with
its own transport, when `NATS_URL` is set. `wsconnect` is not tested here.

## 8. Errors

Every mistake is a `ChoError` with a `code` (`core/specs.md`, section 2.8). The
code is part of the API; the messages are for people, and can change. The codes
of this package start with `CHO_NATS_` (type `ChoNatsErrorCode`).

| Situation                                                                                       | Code                           | Message                                                                                                                              |
| ----------------------------------------------------------------------------------------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| An option is missing, or wrong                                                                  | `CHO_NATS_INVALID_OPTION`      | `NatsLinker: the "queue" option is required: the queue group of the application, such as "mailer"`                                   |
| An option is unknown                                                                            | `CHO_CORE_UNKNOWN_OPTION`      | `NatsLinker: unknown option "group". Known options: concurrency, connect, errorReply, onFatal, queue`                                |
| `link()` is called twice                                                                        | `CHO_NATS_ALREADY_LINKED`      | `NatsLinker.link() was already called: use one linker for one application`                                                           |
| `instance` is read before `start()` resolved, or the sender is used before `start()` was called | `CHO_NATS_NOT_STARTED`         | `NatsLinker: there is no connection before start() resolves: read the instance after app.start()`                                    |
| `connect` gave something else                                                                   | `CHO_NATS_INVALID_CONNECTION`  | `NatsLinker: the "connect" option did not give a connection of NATS: return what connect() of the …`                                 |
| A reply cannot be sent                                                                          | `CHO_NATS_REPLY_FAILED`        | `NatsLinker: cannot send the reply of OrdersController.created, of 2097152 byte(s), to who asked on "…"`                             |
| The connection closed for good                                                                  | `CHO_NATS_CONNECTION_CLOSED`   | `NatsLinker: the connection to NATS closed, and the client does not connect again: the application …`                                |
| A subscription failed, or ended by itself                                                       | `CHO_NATS_SUBSCRIPTION_FAILED` | `NatsLinker: the subscription of OrdersController.created to "orders.created" failed: the application …`                             |
| `client` of `jetstream` gave something else                                                     | `CHO_NATS_INVALID_JETSTREAM`   | `NatsLinker: the "client" option of "jetstream" did not give a JetStream client: return what jetstream(connection) …`                |
| A stream does not exist, or JetStream cannot be reached                                         | `CHO_NATS_STREAM_NOT_FOUND`    | `NatsLinker: the stream "ORDERS" cannot be read: create it before the application starts, the adapter does not`                      |
| A consumer cannot be made                                                                       | `CHO_NATS_CONSUMER_FAILED`     | `NatsLinker: cannot make the consumer "shop_orders_created" of OrdersController.created, on "orders.created" of the stream "ORDERS"` |
| Two topics have the same consumer name                                                          | `CHO_NATS_DUPLICATE_CONSUMER`  | `NatsLinker: the topics "a.b_c" and "a_b.c" have the same consumer name, "shop_a_b_c": a "." of a topic is a "_" of the name. …`     |
| The dead-letter subject is the topic itself                                                     | `CHO_NATS_INVALID_DEAD_LETTER` | `NatsLinker: the dead-letter subject of "orders" is "orders" itself: a dead message would be handled again, for ever`                |
| A dead letter cannot be sent                                                                    | `CHO_NATS_DEAD_LETTER_FAILED`  | `NatsLinker: cannot send orders.created@42 to the dead-letter subject "dead.orders.created": is it a subject of a stream? …`         |

The first two are thrown by the constructor, `CHO_NATS_INVALID_DEAD_LETTER` by
`link()`, and `CHO_NATS_INVALID_CONNECTION` rejects `start()`, as do
`CHO_NATS_INVALID_JETSTREAM`, `CHO_NATS_STREAM_NOT_FOUND`,
`CHO_NATS_CONSUMER_FAILED` and `CHO_NATS_DUPLICATE_CONSUMER`.
`CHO_NATS_DEAD_LETTER_FAILED` is logged, and stops nothing.
`CHO_NATS_REPLY_FAILED` is logged and given to `errorReply`, with the error of
the client as `cause`. The last two reach `onFatal`, with the error of the
client as `cause` when there is one. An error of `connect` rejects `start()` as
it is, without a code.

## 9. Not in this version

- **A stream made by the adapter**, and its settings: who operates NATS creates
  the streams.
- **Other consumers of JetStream**: ordered and push consumers, and the
  key-value and object stores.
- **Exactly once**: a message can be handled twice, after a crash, or when its
  handler is slower than `ackWait`.
- **Extending the time of a slow handler** (`working`), and a limit of the time
  a message is kept before its retry is given up.
- **Wildcards** in a subject (`*`, `>`): a CHO topic is a name
  (`message/specs.md`, section 2).
- **A subscription with no queue group**, where every instance gets every
  message.
- **Retries of a core subscription.** Who asked for a reply tries again; a
  message that must not be lost goes through a stream (section 5).
- **The NATS services framework**: discovery, statistics, and the `$SRV`
  subjects. The adapter only answers errors the way a service does.
- **A limit of the time `stop()` waits** for the messages it received.
