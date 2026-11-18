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

The adapter is two files. `mod.ts` has the public API and the options.
`consume.ts` has what is done with a message (`Pump`): it knows the client
library through three small interfaces, so its tests need no server.

**This version is core NATS**: subjects, a queue group, request and reply.
Delivery is at most once, and there is nothing to acknowledge. JetStream is not
in this version (section 8).

## 2. Decisions

`→` marks the choice.

| #  | Question                                 | → Chosen                                                                                                                                                                                            | Alternative                                                    |
| -- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1  | The client library                       | nats.js v3, `@nats-io/nats-core`                                                                                                                                                                    | the older `nats` package, which is Node.js only                |
| 2  | The runtimes                             | Deno, Node.js and Bun: wherever nats.js runs (section 6)                                                                                                                                            | one runtime                                                    |
| 3  | Core NATS, or JetStream                  | core NATS first: it is where a request has a reply                                                                                                                                                  | both at once: they share little                                |
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
| 15 | A failed message that asks for no reply  | logged, and lost: core NATS has no redelivery                                                                                                                                                       | tried again in place, which NATS itself would not do           |
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
  publishers for a long time needs JetStream, not this adapter.
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

## 5. Sending

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

## 6. Runtimes

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

## 7. Errors

Every mistake is a `ChoError` with a `code` (`core/specs.md`, section 2.8). The
code is part of the API; the messages are for people, and can change. The codes
of this package start with `CHO_NATS_` (type `ChoNatsErrorCode`).

| Situation                                                                                       | Code                           | Message                                                                                                  |
| ----------------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------- |
| An option is missing, or wrong                                                                  | `CHO_NATS_INVALID_OPTION`      | `NatsLinker: the "queue" option is required: the queue group of the application, such as "mailer"`       |
| An option is unknown                                                                            | `CHO_CORE_UNKNOWN_OPTION`      | `NatsLinker: unknown option "group". Known options: concurrency, connect, errorReply, onFatal, queue`    |
| `link()` is called twice                                                                        | `CHO_NATS_ALREADY_LINKED`      | `NatsLinker.link() was already called: use one linker for one application`                               |
| `instance` is read before `start()` resolved, or the sender is used before `start()` was called | `CHO_NATS_NOT_STARTED`         | `NatsLinker: there is no connection before start() resolves: read the instance after app.start()`        |
| `connect` gave something else                                                                   | `CHO_NATS_INVALID_CONNECTION`  | `NatsLinker: the "connect" option did not give a connection of NATS: return what connect() of the …`     |
| A reply cannot be sent                                                                          | `CHO_NATS_REPLY_FAILED`        | `NatsLinker: cannot send the reply of OrdersController.created, of 2097152 byte(s), to who asked on "…"` |
| The connection closed for good                                                                  | `CHO_NATS_CONNECTION_CLOSED`   | `NatsLinker: the connection to NATS closed, and the client does not connect again: the application …`    |
| A subscription failed, or ended by itself                                                       | `CHO_NATS_SUBSCRIPTION_FAILED` | `NatsLinker: the subscription of OrdersController.created to "orders.created" failed: the application …` |

The first two are thrown by the constructor, and `CHO_NATS_INVALID_CONNECTION`
rejects `start()`. `CHO_NATS_REPLY_FAILED` is logged and given to `errorReply`,
with the error of the client as `cause`. The last two reach `onFatal`, with the
error of the client as `cause` when there is one. An error of `connect` rejects
`start()` as it is, without a code.

## 8. Not in this version

- **JetStream**: streams, durable consumers, `ack` when a message is handled,
  `nak` when it failed, a limit of deliveries, a dead-letter subject. It is the
  answer to "a failed message must not be lost". A message of a stream cannot be
  replied to, so it shares little with this version.
- **Wildcards** in a subject (`*`, `>`): a CHO topic is a name
  (`message/specs.md`, section 2).
- **A subscription with no queue group**, where every instance gets every
  message.
- **Retries.** Who asked for a reply tries again; who needs redelivery needs
  JetStream.
- **The NATS services framework**: discovery, statistics, and the `$SRV`
  subjects. The adapter only answers errors the way a service does.
- **A limit of the time `stop()` waits** for the messages it received.
