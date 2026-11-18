# @chojs/message

> **Status: the package is implemented, with one broker adapter.**
> `@chojs/message` does what this document says, and `message/tasks.md` lists
> what was done and what is left. `@chojs/vendor-kafka`, which the examples
> name, is the adapter of Apache Kafka, on Node.js (`vendor/kafka/specs.md`).
> Without an adapter, an application delivers its messages with `app.handle`, or
> with a linker of its own (`examples/hello-world-message.ts`). Section 11 lists
> every decision this document makes, with the alternative that was not chosen,
> and section 12 what it changed in the other packages.

Applications that handle messages from a broker, such as Kafka, built with
decorators: controllers declare message handlers, and `ChoMessage` subscribes
them to their topics through a **broker adapter**. It is built on the dependency
injection of `@chojs/core` (see `core/specs.md`), and is the sibling of
`@chojs/web` (`web/specs.md`): the same modules, controllers, middlewares and
error handlers, with a topic where `@chojs/web` has a route.

## 1. Overview

An application imports everything from `@chojs/message` (the core's
`@Injectable`, `token` and `provider` included, so it never imports
`@chojs/core`). Messages reach their handlers through a **linker**, a broker
adapter such as `@chojs/vendor-kafka` (section 7).

`@chojs/message` does the rest itself, the same way on every adapter: it creates
the context of the message, runs the middlewares, the handler and the error
handler, and tells the adapter whether the message was handled. Application code
never sees the client library of the broker, unless it asks for it
(`ctx.native`).

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

**The broker is the router.** In `@chojs/web` every request reaches the server,
and a router finds the route. Here the routes of the application are its
subscriptions: the broker only delivers the topics that have a handler, so there
is no "no route matches", and nothing like a `404`.

| `@chojs/web`                           | `@chojs/message`                                |
| -------------------------------------- | ----------------------------------------------- |
| a route: an HTTP method and a path     | a topic                                         |
| levels joined with `/`                 | levels joined with `.`                          |
| path parameters (`:id`)                | none                                            |
| `@Get(route)`, `@Post(route)`, …       | `@Subscribe(topic)`                             |
| the `Request`                          | the message: its value, key and headers         |
| the `Response`                         | none: the message is handled, or it failed      |
| a linker gives a `fetch`-style handler | a linker connects to the broker, and subscribes |
| a server runs `app.handler`            | `app.start()`                                   |

## 2. Topics

### 2.1 Features, controllers and handlers

The three are what they are in `@chojs/web` (`web/specs.md`, section 2.1):

- A **feature** is a module that declares controllers. Importing a module does
  not nest its topics.
- A **controller** is a `@Controller` class declared by a feature. It has its
  own handlers and the ones it inherits from a base class.
- A **handler** is a controller method marked with `@Subscribe(topic)`. Other
  methods are not handlers. A handler is a public, non-static method with a
  string name, and has one `@Subscribe`: anything else throws when the class is
  defined.

A handler handles the messages of **one topic**, and a topic has **one
handler**.

Only what handles a topic counts. A controller without a handler is not part of
the message application, and a module left without such a controller is not a
feature: its `topic` option, middlewares and error handler are ignored, and its
middleware and error handler classes are not created. This is what lets one
module graph hold web controllers and message controllers (section 6.5).

`@Module` and `@Controller` come from `@chojs/message`: they are the core's,
with one more option, `topic`. Any other option is rejected, by the types and
when the class is defined.

### 2.2 The four levels

A handler's topic joins up to four levels, each optional, with a `.`:

| Level         | Declared by                                   |
| ------------- | --------------------------------------------- |
| global prefix | the `prefix` option of `ChoMessage.create`    |
| feature       | the `topic` option of the feature's `@Module` |
| controller    | the `topic` option of `@Controller`           |
| handler       | the argument of `@Subscribe`                  |

A level that is missing or `""` adds nothing: `@Subscribe("")` on a controller
with `topic: "orders.created"` is the topic `orders.created`, and so is
`@Subscribe("orders.created")` on a controller without a topic.

The global prefix is where the name of an environment goes: `prefix: "staging"`
makes it `staging.orders.created`.

### 2.3 Topic rules

Topics are trimmed, then checked: a handler's topic when its class is defined,
the others when the application is created.

- a topic is one or more **segments** separated by `.`;
- a segment is made of letters, digits, `_` and `-`, and is not empty: no
  leading or trailing `.`, and no `..`;
- there is no pattern: no wildcard (`*`, `>`, `#`) and no parameter. A topic is
  a name, so it means the same on every broker;
- the full topic of a handler is not empty: a handler needs at least one level;
- topics are case-sensitive.

A name with another separator is a single segment:
`@Subscribe("orders-created")` is the topic `orders-created`.

Two handlers with the same full topic are an error, when the application is
created.

### 2.4 What is not part of the topic

- **The consumer group** (the name under which the application reads, and shares
  the messages with its other instances) belongs to the application: it is an
  option of the adapter.
- **The partition and the offset** belong to one message: the adapter gives them
  in `ctx.native`.
- **The key** is part of the message: `ctx.key`.
- **The type of a message**, when one topic carries several, is not part of the
  topic in this version (section 10).

## 3. Handlers and the context

A handler receives the context of the message, a `ChoMessageContext`:

| Property  | Holds                                                                         |
| --------- | ----------------------------------------------------------------------------- |
| `topic`   | the full topic of the message, global prefix included                         |
| `value`   | the value of the message, as bytes (`Uint8Array`); empty when it has none     |
| `key`     | the key of the message, as a string; `undefined` when it has none             |
| `headers` | the headers of the message, as an object of strings; empty when it has none   |
| `text()`  | the value, decoded as UTF-8                                                   |
| `json()`  | the value, parsed as JSON; `undefined` for an empty value                     |
| `state`   | a `Map` for the message: what a middleware sets, later ones and handlers read |
| `native`  | the adapter's own message (section 7); `undefined` if it has none             |

The middlewares, the handler and the error handler of a message share one
context. Code that uses `native` only runs on that adapter.

- A handler can be `async`.
- A handler runs on its controller instance, so `this` works. Controllers are
  created once, with their dependencies, when the application is created.

### 3.1 Reading the value

A broker carries bytes. Nothing decodes them before the handler: the handler
says how the value is read, as it does with `ctx.req.json()` in `@chojs/web`.

```ts
ctx.value; //            the bytes
ctx.text(); //           "hello"
ctx.json<Order>(); //    { id: "42" }: your promise, nothing checks it
```

- `json()` throws the `SyntaxError` of `JSON.parse` for a value that is not
  JSON. It is an error of the handler (section 5).
- `text()` and `json()` can be called more than once: the value is in memory.
- A key and the headers that are not valid UTF-8 are in `ctx.native`, as the
  broker gave them.

### 3.2 The outcome of a message

A handler has no response to give. A message has one of two outcomes:

| Outcome     | When                                                       | What the adapter does                               |
| ----------- | ---------------------------------------------------------- | --------------------------------------------------- |
| **handled** | the handler returns, or an error handler handles its error | acknowledges the message: it is not delivered again |
| **failed**  | the handler throws, and no error handler handles the error | what its broker does with a message that failed     |

- What a handler returns is ignored.
- What "failed" leads to is the adapter's: delivering the message again, moving
  it to a dead-letter topic, or stopping. Each adapter says what it does, and
  takes options for it (section 7). It is the counterpart of the `500` that a
  web adapter answers when a route rejects.
- A message is acknowledged **after** its handler has returned, never before: a
  process that stops in the middle of a handler gets the message again. A
  handler should therefore be safe to run twice for the same message.

## 4. Middlewares

`@Middlewares(...)` (from `@chojs/message`) applies to a feature module, a
controller or a handler. A middleware is either:

- a function `(ctx, next)`; or
- a class with a `handle(ctx, next)` method. It is created by the injector, in
  the feature module's scope, so it must be a provider visible there, and it can
  have dependencies.

A middleware wraps the rest of the chain (the next middlewares, then the
handler):

- `next()` runs the rest of the chain. It resolves when the rest is done, and
  rejects with its error;
- returning **without** calling `next()` skips the handler: the message is
  handled. This is how a middleware drops a message, one that was already
  handled or one that is not for this application;
- what a middleware returns is ignored.

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

A message runs the feature's middlewares, then the controller's, then the
handler's, each in declaration order.

**A middleware cannot hide the failure of the rest of the chain.** When `next()`
rejects, the message failed, even when the middleware catches the error: it can
look at it, log it, and throw another one in its place, but not make the message
handled. Settling a failed message as handled is what an error handler does
(section 5), where it is explicit.

A middleware that calls `next()` twice makes the message fail (section 5).

## 5. Error handlers

`@Catch(handler)` applies to a feature module, a controller or a handler. A
handler is a function `(error, ctx)`, or a class with a `handle(error, ctx)`
method created by the injector like a middleware class. It can be `async`.

An error thrown by a handler or by a middleware goes to the nearest one: the
handler's, else the controller's, else the feature's, else the application's,
which is the `onError` option of `ChoMessage.create`. The error is given as it
was thrown: the application's own, or a `ChoError` with a code for a mistake the
framework found (section 9).

**An error handler that returns nothing has not handled the error.** The message
failed, and the adapter is told so. This is the rule of `@chojs/web`
(`web/specs.md`, section 5), for the same reason: an error handler that only
logs must not turn every failed message into a handled one, which would lose
them silently.

To settle the message as **handled**, the error handler returns `true`. It does
so when it has dealt with the message itself: it wrote it somewhere else, or it
decided that the message is to be dropped.

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

| The error handler                 | The message                                              |
| --------------------------------- | -------------------------------------------------------- |
| returns `true`                    | handled                                                  |
| returns anything else, or nothing | failed, with the original error                          |
| throws                            | failed, with the original error; what it threw is logged |
| there is none                     | failed, with the original error                          |

## 6. The application: `ChoMessage`

```ts
const app = await ChoMessage.create(App, {
  linker: new KafkaLinker({/* ... */}), // the broker adapter (section 7)
  prefix: "staging", // optional: the global prefix (section 2.2)
  onError: (error, ctx) => {/* ... */}, // optional: section 5
});
app.routes; //            every topic: topic, name
app.graph; //             the same topics as a tree: features, controllers, handlers
app.linked.instance; //   the adapter's own object (the client of the broker)
app.injector; //          the injector: the instances of the application
await app.start(); //     connect and subscribe
await app.handle("orders.created", { value: "{}" }); // deliver a message by hand
await app.close(); //     stop, and release the instances
```

### 6.1 `ChoMessage.create(app, options?)`

Builds the injector, creates **every** instance of the application up front
(`injector.init()`), builds and checks the topics, and gives them to the linker.
Every wiring, topic, middleware or error handler mistake makes it reject; what
was created until then is disposed.

It does not connect to the broker: `start()` does.

| Option      | Default | Use                                                                |
| ----------- | ------- | ------------------------------------------------------------------ |
| `linker`    | none    | the broker adapter. Without one, only `handle()` delivers messages |
| `prefix`    | `""`    | the global prefix of every topic (section 2.2)                     |
| `onError`   | none    | the application's error handler (section 5)                        |
| `overrides` | none    | providers that replace declared ones, for tests                    |

There is no default linker: there is no broker to choose for an application.
Without one, `app.linked.instance` is `undefined`. An option that is not in the
table is rejected.

### 6.2 `start()` and `close()`

In `@chojs/web`, the application gives a handler and something else runs the
server. A broker is not called: it is connected to. So the application itself
starts and stops.

- **`start()`** connects to the broker and subscribes to every topic. It
  resolves once the application is subscribed, and rejects when the broker
  cannot be reached. Messages can arrive before it resolves. Calling it again
  returns the same start. Without a linker, it rejects.
- **`close()`** stops receiving messages, waits for the ones that are being
  handled, disconnects, and then disposes the instances of the application, in
  reverse creation order. Calling it again returns the same close. It can be
  called without `start()`. `await using` works too.
- Once `close()` is called, `start()` and `handle()` reject. What the linker
  still delivers is handled until the linker has stopped, and refused after
  that: a message is never handled on instances that are being disposed.
- The instances are disposed even when the linker fails to stop; `close()` then
  rejects with its error.

`@chojs/message` knows the messages in hand itself: every route the linker gets
goes through the application. So `close()` waits for them whatever the adapter
does.

How many messages are handled at once, and in what order, is the adapter's and
its broker's. `@chojs/message` keeps no queue of its own.

### 6.3 `handle(topic, message)`: delivering by hand

`app.handle` gives one message to the handler of a topic, without a broker. It
is the counterpart of calling `app.handler(new Request(…))` in `@chojs/web`.

```ts
await app.handle("orders.created", {
  value: JSON.stringify({ id: "42" }), // a string, or bytes
  key: "42", //                           optional
  headers: { "message-id": "abc" }, //    optional
});
```

- It resolves when the message is handled, and rejects, with the error, when it
  failed.
- It rejects for a topic that has no handler.
- `topic` is the full topic, global prefix included.
- It needs no linker, and no `start()`.

It has two uses. **Tests**: an application is tested end to end with no broker.
**Messages that arrive another way**: a broker that pushes its messages over
HTTP is served by a web handler that calls `app.handle`.

### 6.4 An application that is only `ChoMessage`

A worker: a process that only handles messages. `create` builds its injector,
and `close` disposes it.

```ts
import process from "node:process";
import { ChoMessage } from "@chojs/message";
import { KafkaLinker } from "@chojs/vendor-kafka";

const app = await ChoMessage.create(WorkerModule, {
  linker: new KafkaLinker({ brokers: ["kafka:9092"], groupId: "mailer" }),
});
await app.start();

// The connection to the broker keeps the process running.
let closing = false;
async function shutdown() {
  if (closing) {
    return;
  }
  closing = true;
  await app.close(); // finish the messages in hand, disconnect, release
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
```

### 6.5 With a web application: one injector

An application that answers HTTP requests **and** handles messages has one
module graph, and should have one set of instances: one database pool, one
cache. Two calls to `create` would build two injectors, and everything twice.

`ChoMessage.from(injector, options?)` builds a message application on an
injector that exists, the one of the web application:

```ts
import { ChoWeb } from "@chojs/web";
import { serve } from "@chojs/web/serve";
import { ChoMessage } from "@chojs/message";
import { KafkaLinker } from "@chojs/vendor-kafka";

const web = await ChoWeb.create(App);
const messages = await ChoMessage.from(web.injector, {
  linker: new KafkaLinker({ brokers: ["kafka:9092"], groupId: "shop" }),
});

const server = await serve(web.handler, { port: 3000, closeTimeout: 10_000 });
await messages.start();

async function shutdown() {
  await server.close(); //   1. no new request
  await messages.close(); // 2. no new message; finish the ones in hand
  await web.close(); //      3. release the instances, once
}
```

**What `from` does.** It reads the module graph of the injector, finds the
controllers that have `@Subscribe` handlers, resolves them (they exist already,
so nothing is created twice), creates its middleware and error handler classes,
and builds and checks the topics, as `create` does. It takes the options of
`create`, except `overrides`, which belong to whoever creates the injector.

**Who owns the injector.** The application that created it. A `ChoMessage` made
by `from` does not:

|                            | `ChoMessage.create(App)`           | `ChoMessage.from(injector)`             |
| -------------------------- | ---------------------------------- | --------------------------------------- |
| The injector               | created by the application         | given: the web application's            |
| `close()`                  | stops, then disposes the instances | stops; disposes **nothing**             |
| Who disposes the instances | `close()`                          | the owner: `web.close()`                |
| `overrides`                | an option                          | not an option: given to `ChoWeb.create` |

Close the message application before its owner: a message handled after the
instances are disposed fails.

**One module graph, two kinds of controllers.** Each package only sees its own:
`@chojs/web` takes the controllers that have `@Get`, `@Post`, … handlers, and
`@chojs/message` takes the ones that have `@Subscribe` handlers. The rest of the
graph, the providers, is shared.

```ts
// orders/orders.web.ts
import { Controller, Get } from "@chojs/web";

@Controller({ route: "orders", dependencies: [Orders] })
export class OrdersController {/* @Get(":id") … */}

// orders/orders.messages.ts
import { Controller, Subscribe } from "@chojs/message";

@Controller({ topic: "payments", dependencies: [Orders] })
export class PaymentsController {/* @Subscribe("settled") … */}

// orders/orders.module.ts
import { Module } from "@chojs/web";

@Module({
  providers: [Orders], // one instance, for both
  controllers: [OrdersController, PaymentsController],
})
export class OrdersModule {}
```

The rules that keep the two apart:

- **A controller is of one kind.** It is declared with the `@Controller` of its
  package, which takes that package's level option (`route`, or `topic`). A file
  imports its decorators from one of the two packages.
- **A module that holds both kinds declares no middleware and no error handler
  of its own.** `@Middlewares` and `@Catch` on a module apply to every
  controller of the module that a package takes: a web middleware on such a
  module would also be run for its messages, with a context it does not know.
  Put them on the controllers, or keep the two kinds in two modules. Neither
  package can detect the mistake when the application is created.
- **A module takes the level option of the `@Module` it is declared with.** A
  module declared with the `@Module` of `@chojs/web` can have a `route`, not a
  `topic`: its message controllers have no feature level.

**The other way around** is the same: the injector of a `ChoMessage` made by
`create` could be given to a web application. `@chojs/web` has no `from` in this
version (section 12).

## 7. Broker adapters

An adapter is a package of its own, named after its broker:
`@chojs/vendor-kafka` is the first planned. `@chojs/message` never imports an
adapter: applications pass one to `ChoMessage.create`. An adapter can run on
some runtimes only, when the client library of its broker does; it says which.

An adapter implements `Linker` (`@chojs/message/linker`): it receives the topics
of the application and returns a `Linked`.

```ts
interface Linker<T> {
  link(routes: readonly Route[]): Linked<T>;
}

interface Linked<T> {
  readonly instance: T; //     the adapter's own object
  start(): Promise<void>; //   connect, and subscribe to the topic of each route
  stop(): Promise<void>; //    stop receiving, wait for what is handled, disconnect
}
```

`link()` does no I/O: it is called by `create`, which must not need a broker.

An adapter does no plumbing. Each `Route` is ready to call:

| Property | Holds                                                                    |
| -------- | ------------------------------------------------------------------------ |
| `topic`  | the full topic, global prefix included (`"staging.orders.created"`)      |
| `name`   | where it is declared, for logs (`"OrdersController.created"`)            |
| `handle` | `(delivery, native?) => Promise<void>`: handles one message of the topic |

A `Delivery` is one message, as plain data:

| Property  | Holds                                                    |
| --------- | -------------------------------------------------------- |
| `value`   | the bytes of the value, or a string; optional, or `null` |
| `key`     | the key, as a string; optional                           |
| `headers` | the headers, as an object of strings; optional           |

`handle` runs the route's middlewares, its handler and its error handler. It
**resolves** when the message is handled, and the adapter acknowledges it. It
**rejects**, with the error, when the message failed, and the adapter does what
its broker does. The adapter's second argument, its own message, is what
handlers see as `ctx.native`.

```ts
class MyLinker implements Linker<MyClient> {
  link(routes: readonly Route[]): Linked<MyClient> {
    const client = new MyClient();
    return {
      instance: client,
      start: async () => {
        await client.connect();
        for (const route of routes) {
          await client.subscribe(route.topic, async (message) => {
            try {
              await route.handle(
                { value: message.data, key: message.key },
                message,
              );
              await message.ack();
            } catch {
              await message.retryLater();
            }
          });
        }
      },
      stop: () => client.close(),
    };
  }
}
```

**What each adapter decides, and documents:**

| Question                          | Example of an answer                                         |
| --------------------------------- | ------------------------------------------------------------ |
| How the application is identified | the consumer group: a required option                        |
| What a failed message leads to    | delivered again, at most `n` times, then a dead-letter topic |
| How many messages run at once     | one at a time for each partition                             |
| What `ctx.native` is              | the message of the client library: partition, offset, …      |
| How a topic is named              | as it is; or mapped to the names its broker allows           |
| Which runtimes it runs on         | Node.js only                                                 |

`@chojs/vendor-kafka` has a spec of its own, `vendor/kafka/specs.md`. Two of its
decisions were hard: the client library, which is `@platformatic/kafka`, and
what a failed message leads to, since Kafka cannot refuse one message without
holding back the ones after it in its partition. It is tried again in place,
then sent to a dead-letter topic.

The tree behind the topics is on `app.graph` (`@chojs/message/graph`), with
every instance, middleware and error handler already created: `AppRef`,
`FeatureRef`, `ControllerRef` and `MethodRef`, as in `@chojs/web`, with `topic`
in place of `route`.

## 8. Public API

| Entry point             | Exports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@chojs/message`        | `ChoMessage`, `ChoMessageOptions`, `ChoMessageFromOptions`, `Subscribe`, `Middlewares`, `Catch`, `ChoError`, `isChoError` (the core's), `ChoMessageErrorCode`, `ChoCoreErrorCode`, the types `ChoMessageContext`, `ChoMessageHandler`, `ChoMessageNext`, `ChoMessageMiddlewareFn`, `ChoMessageMiddleware`, `ChoMessageErrorHandlerFn`, `ChoMessageErrorHandler`, `Module`, `Controller` (the core's, with the `topic` option), `MessageModuleOptions`, `MessageControllerOptions`, `TopicOption`, the types of the two other entry points, and from the core `Injectable`, `token`, `provider`, `InjectionToken`, `Provider` and the option types |
| `@chojs/message/linker` | `Linker`, `Linked`, `Route`, `Delivery`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `@chojs/message/graph`  | `AppRef`, `FeatureRef`, `ControllerRef`, `MethodRef`, `NodeRef`, `ErrorHandlerRef`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `@chojs/vendor-kafka`   | `KafkaLinker`, `KafkaLinked`, and their types (`vendor/kafka/specs.md`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

`@Middlewares` and `@Catch` are the core's decorators, typed for
`@chojs/message`.

Debug logging uses the name `cho:message` (`CHO_DEBUGLOG=cho:message`): each
topic and its handler when the application is created, and each message that
failed.

## 9. Errors

Every mistake the framework finds is a `ChoError` with a `code`
(`core/specs.md`, section 2.8). The code is part of the API. The messages below
are the current wording, for people to read: they are not part of the API and
can change in any release. Do not match on their text.

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
`ChoMessageErrorCode`). A mistake the core finds has a code of the core,
`CHO_CORE_…` (type `ChoCoreErrorCode`): it is named below where a message
application meets it.

**Thrown by the decorators**, when the class is defined:

| Mistake                                        | Code                              | Message                                                                                                       |
| ---------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| A handler's topic is invalid                   | `CHO_MESSAGE_INVALID_TOPIC`       | `Invalid topic "<topic>" of @Subscribe() on method <name>: <reason>`                                          |
| A second `@Subscribe` on a method              | `CHO_MESSAGE_DUPLICATE_DECORATOR` | `Cannot add @Subscribe() to method <name>: it already handles "<topic>". A method can have one @Subscribe().` |
| An unknown option of `@Module` / `@Controller` | `CHO_CORE_UNKNOWN_OPTION`         | `@Controller(): unknown option "route". Known options: dependencies, topic`                                   |
| A static, private or symbol-named handler      | `CHO_MESSAGE_INVALID_TARGET`      | `@Subscribe() cannot decorate static method <name>: a handler must not be static`                             |

**Rejected by `ChoMessage.create` and `ChoMessage.from`**: any module graph
error of the core (`core/specs.md`, section 2.8), and:

| Mistake                                                     | Code                             | Message                                                                                                                                                                  |
| ----------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A topic is not a string                                     | `CHO_MESSAGE_INVALID_TOPIC`      | `Invalid topic of <where>: expected a string, got <v>`                                                                                                                   |
| A topic breaks a rule (section 2.3)                         | `CHO_MESSAGE_INVALID_TOPIC`      | `Invalid topic "<topic>" of <where>: <reason>`                                                                                                                           |
| A wildcard in a topic (`*`, `>`, `#`)                       | `CHO_MESSAGE_INVALID_TOPIC`      | `Invalid topic "<topic>" of <where>: "<segment>" has a "*": wildcards are not part of the topic syntax`                                                                  |
| A segment with another character                            | `CHO_MESSAGE_INVALID_TOPIC`      | `Invalid topic "<topic>" of <where>: "<segment>" is not a valid segment: write letters, digits, "_" and "-"`                                                             |
| A leading or trailing `.`, or an empty segment              | `CHO_MESSAGE_INVALID_TOPIC`      | `Invalid topic "<topic>" of <where>: it must not start or end with "."` (and `… it must not contain an empty segment ("..")`)                                            |
| A handler with no level at all                              | `CHO_MESSAGE_INVALID_TOPIC`      | `Invalid topic of <Controller.method>: it is empty. Give @Subscribe(), its controller or its module a topic`                                                             |
| Two handlers with the same topic                            | `CHO_MESSAGE_DUPLICATE_TOPIC`    | `Duplicate topic "<topic>": declared by <Controller.method> and <Controller.method>`                                                                                     |
| `onError` is not a function or a class                      | `CHO_CORE_INVALID_ERROR_HANDLER` | `Invalid error handler <v>: must be a function or a class with a 'handle' method.`                                                                                       |
| A middleware class has no `handle` method                   | `CHO_CORE_INVALID_MIDDLEWARE`    | `Middleware class <Name> must implement 'handle' method.`                                                                                                                |
| A middleware class cannot be created                        | `CHO_MESSAGE_CREATE_FAILED`      | `Failed to create middleware <Name> in module <Module>`, with the injector's error as cause                                                                              |
| An error handler class cannot be created                    | `CHO_MESSAGE_CREATE_FAILED`      | `Failed to create error handler <Name> in module <Module>`, with `cause`                                                                                                 |
| `overrides` given to `from`, or any unknown option          | `CHO_CORE_UNKNOWN_OPTION`        | `ChoMessage.from(): unknown option "overrides". Known options: linker, onError, prefix` (and `ChoMessage.create(): … Known options: linker, onError, overrides, prefix`) |
| What `from` is given is not an injector                     | `CHO_MESSAGE_INVALID_INJECTOR`   | `ChoMessage.from(): expected an injector, got <v>`                                                                                                                       |
| `from` on a disposed injector, with a controller to resolve | `CHO_CORE_DISPOSED`              | `The injector is disposed`                                                                                                                                               |

`<where>` names the declaration: `the global prefix`, `feature <Module>`,
`controller <Controller>` or `method <name> of controller <Controller>`.

**Rejected by `start()` and `handle()`:**

| Mistake                                          | Code                        | Message                                                                                                                      |
| ------------------------------------------------ | --------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `start()` without a linker                       | `CHO_MESSAGE_NO_LINKER`     | `ChoMessage.start(): the application has no linker. Give ChoMessage.create or ChoMessage.from a linker, such as KafkaLinker` |
| `handle()` for a topic with no handler           | `CHO_MESSAGE_UNKNOWN_TOPIC` | `ChoMessage.handle(): no handler for the topic "<topic>"`                                                                    |
| `start()` or `handle()` once `close()` is called | `CHO_MESSAGE_CLOSED`        | `The application is closed`                                                                                                  |
| A value that is neither bytes nor a string       | `CHO_MESSAGE_INVALID_VALUE` | `Invalid value of a message: expected bytes (a Uint8Array) or a string, got <v>`                                             |

**Failing a message** (given to the handler's error handler, section 5):

| Mistake                           | Code                         | Message                                           |
| --------------------------------- | ---------------------------- | ------------------------------------------------- |
| A middleware calls `next()` twice | `CHO_CORE_NEXT_CALLED_TWICE` | `middleware <name>: next() called more than once` |

**What has no code**: what a handler or a middleware throws is the application's
error: it is given to the error handler as it is, and a message that fails
rejects with it. There is no `HttpError` here: a message has no status to answer
with, and rejecting is the contract (section 5).

## 10. Not in the first version

Each of these was considered, and left out so that the first version stays
small. The design leaves room for them.

- **Several types of messages on one topic.** A topic that carries several types
  (`orders`, with `created` and `cancelled` told apart by a header) is handled
  by one handler, which looks at the message itself. A route of a topic **and**
  a type (`@Subscribe("orders", { type: "created" })`) needs a rule for where
  the type is read from, which depends on the convention of each organization.
  `@Subscribe` takes no options in this version, and a second argument is kept
  for them.
- **Declared arguments and validation**, the `@Args` of `@chojs/web`
  (`Value(schema)`, `Key()`, `Header("x")`). A handler reads the context.
- **Wildcards and parameters** in a topic (the `orders.*` of NATS).
- **Sending messages.** An application sends with the client of its broker,
  provided like any dependency.
- **Request and reply.** What a handler returns is ignored.
- **A timeout for `close()`**, the `closeTimeout` of `serve`. `close()` waits
  for the messages in hand, however long they take.
- **A signal on the context** that is aborted when the application closes, the
  `ctx.req.signal` of `@chojs/web`.
- **`ChoWeb.from(injector)`**, the other direction of section 6.5.

## 11. Decisions

Every choice this document makes, with the alternative. `→` marks the choice,
which is what the package does.

| #  | Question                                  | → Chosen                                                       | Alternative                                                               | Section |
| -- | ----------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------- | ------- |
| 1  | The name of the package and of the class  | `@chojs/message`, `ChoMessage`                                 | `@chojs/messaging`, `ChoMessaging`                                        | 1       |
| 2  | The decorator of a handler                | `@Subscribe(topic)`                                            | `@On(topic)`                                                              | 2.1     |
| 3  | What a route is                           | a topic, and nothing else                                      | a topic and a type of message                                             | 2.1, 10 |
| 4  | How the levels are joined                 | with `.`                                                       | not joined: every handler writes its full topic                           | 2.2     |
| 5  | Patterns in a topic                       | none: a topic is a name                                        | the wildcards of the broker, where it has them                            | 2.3     |
| 6  | Two handlers on one topic                 | an error when the application is created                       | both get every message                                                    | 2.3     |
| 7  | Where the consumer group is declared      | an option of the adapter                                       | an option of `@Controller` or `@Subscribe`                                | 2.4     |
| 8  | Who decodes the value                     | the handler: `ctx.json()`, `ctx.text()`                        | the adapter: `ctx.value` is already an object                             | 3.1     |
| 9  | A message without a value                 | an empty `value`; `json()` gives `undefined`                   | `value` is `null`                                                         | 3       |
| 10 | What a handler returns                    | ignored                                                        | an error, unless it returns nothing                                       | 3.2     |
| 11 | When a message is acknowledged            | after its handler has returned                                 | when it is received                                                       | 3.2     |
| 12 | A middleware that does not call `next()`  | the handler is skipped, and the message is handled             | an error, as in `@chojs/web`                                              | 4       |
| 13 | An error handler that returns nothing     | the message failed; `true` settles it as handled               | any return settles it as handled                                          | 5       |
| 14 | What a failed message leads to            | the adapter decides, and documents it                          | `@chojs/message` retries by itself                                        | 3.2, 7  |
| 15 | Who starts listening                      | the application: `app.start()`, `app.close()`                  | a function of the adapter, like `serve`                                   | 6.2     |
| 16 | Delivering a message by hand              | `app.handle(topic, message)`, with no linker needed            | only through a linker written for tests                                   | 6.3     |
| 17 | A default linker                          | none                                                           | an in-memory broker                                                       | 6.1     |
| 18 | Sharing instances with a web application  | `ChoMessage.from(web.injector, options)`                       | `ChoMessage.from(web, options)`; or both made from an injector you create | 6.5     |
| 19 | Who disposes a shared injector            | the application that created it                                | the last one that is closed                                               | 6.5     |
| 20 | Web and message controllers in one module | allowed; the rules of section 6.5 are documented, not enforced | rejected: a module is of one kind                                         | 6.5     |
| 21 | The name of the adapters                  | `@chojs/vendor-<broker>`, a `<Broker>Linker` class             | `@chojs/message-<broker>`                                                 | 7       |

## 12. What changed in the other packages

- **`@chojs/web`: `ChoWeb` exposes its injector**, as a read-only `injector`
  property. It was private. Section 6.5 needs it, and nothing else changed
  there.
- **The workspace**: `./message` is in the `workspace` of the root `deno.json`,
  in the paths of `tsconfig.json`, and in the release configuration, with the
  linked versions. `./vendor/kafka` joins them with the adapter. The package has
  to exist on JSR before the next release: the release workflow publishes every
  package of the workspace.
- **`@chojs/core`: `compose` runs a chain that has no result**, when it is given
  no `kind` (`core/specs.md`, section 3.3). It is the chain of section 4: what a
  middleware returns is ignored, and one that returns without calling `next()`
  ends the chain. Nothing else changed in the core: the records, the injector
  and the helpers for a CHO module's own `@Module` and `@Controller` are the
  ones `@chojs/web` uses.
