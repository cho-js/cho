# @chojs/message

> **Status: the package is implemented, with two broker adapters.**
> `@chojs/message` does what this document says, and section 10 lists what is
> left out. `@chojs/vendor-kafka`, which the examples name, is the adapter of
> Apache Kafka, written for Node.js and tested on Deno and Bun too
> (`vendor/kafka/specs.md`). `@chojs/vendor-nats` is the adapter of NATS, on
> Deno, Node.js and Bun, and the one that sends replies
> (`vendor/nats/specs.md`). Without an adapter, an application delivers its
> messages with `app.handle`, or with a linker of its own
> (`examples/hello-world-message.ts`). Section 11 lists every decision this
> document makes, with the alternative that was not chosen, and section 12 what
> it changed in the other packages.

Applications that handle messages from a broker, such as Kafka, built with
decorators: controllers declare message handlers, and `ChoMessage` subscribes
them to their topics through a **broker adapter**. It is built on the dependency
injection of `@chojs/core` (see `core/specs.md`), and is the sibling of
`@chojs/web` (`web/specs.md`): the same modules, controllers, middlewares and
error handlers, with a topic where `@chojs/web` has a route.

## 1. Overview

An application imports everything from `@chojs/message` (the core's
`@Injectable`, `token`, `provider` and `configure` included, so it never imports
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

A message has one of two outcomes:

| Outcome     | When                                                       | What the adapter does                               |
| ----------- | ---------------------------------------------------------- | --------------------------------------------------- |
| **handled** | the handler returns, or an error handler handles its error | acknowledges the message: it is not delivered again |
| **failed**  | the handler throws, and no error handler handles the error | what its broker does with a message that failed     |

- What a handler returns is the reply of the message (section 3.3). A reply is
  more than "handled", not a third outcome: an adapter acknowledges the message
  the same way, with or without one.
- What "failed" leads to is the adapter's: delivering the message again, moving
  it to a dead-letter topic, or stopping. Each adapter says what it does, and
  takes options for it (section 7). It is the counterpart of the `500` that a
  web adapter answers when a route rejects.
- **A message that is not valid is a failed message of its own kind**: its error
  is a `ChoError` of the code `CHO_MESSAGE_INVALID_MESSAGE` (section 3.5). It
  will not be valid the next time, so an adapter does not try it again.
- A message is acknowledged **after** its handler has returned, never before: a
  process that stops in the middle of a handler gets the message again. A
  handler should therefore be safe to run twice for the same message.

### 3.3 Replies

**What a handler returns is the reply of the message.** There is no decorator
for it, and nothing to call: the same handler answers a message that asks for a
reply and one that does not.

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

`@chojs/message` makes the reply, so that every adapter sends the same bytes:

| The handler returns                                          | The reply                 |
| ------------------------------------------------------------ | ------------------------- |
| nothing (`undefined`)                                        | none                      |
| bytes: a `Uint8Array`, another typed array, an `ArrayBuffer` | the bytes, as they are    |
| a string                                                     | its UTF-8 bytes           |
| anything else: an object, an array, a number, `null`, …      | its JSON, in UTF-8        |
| what JSON has no text for                                    | the message fails (below) |

- **`undefined` is the only "no reply".** `null`, `0`, `false` and `""` are
  replies: `null`, `0`, `false`, and an empty one.
- **A value that cannot be a reply fails the message**: a function or a symbol,
  and what `JSON.stringify` throws for (a `bigint`, a cycle). The error is a
  `ChoError`, `CHO_MESSAGE_INVALID_REPLY`, with the error of `JSON.stringify` as
  its `cause` when there is one. It is an error of the handler: it goes to the
  nearest error handler (section 5).
- **When a reply is sent is the adapter's** (section 7). An adapter whose broker
  has replies sends it to who asked for it; when nobody asked, or when the
  broker has none (Kafka), it is dropped. So a handler should not depend on its
  reply being read: what must happen happens in the handler.
- **A reply is a `Reply`**: `{ value: Uint8Array, headers? }`, a `Delivery` in
  the other direction. It is what `route.handle` and `app.handle` resolve with.

**A reply with headers** is a `ChoMessageReply`: a handler returns one when the
reply needs more than its value, as a handler of `@chojs/web` returns a
`Response`.

```ts
@Subscribe("price")
async price(ctx: ChoMessageContext) {
  const { id } = ctx.json<{ id: string }>();
  return new ChoMessageReply({ id, total: await this.prices.of(id) }, {
    headers: { "content-type": "application/json" },
  });
}
```

- **Its value is converted as a returned value is**: bytes and strings as they
  are, anything else as JSON. With no value, the reply is empty: a
  `ChoMessageReply` is always a reply, so `new ChoMessageReply()` is the way to
  answer with nothing.
- **Its headers are names and values, as strings.** They are checked when the
  reply is made: options that are not an object, headers that are not an object
  of strings, a header with no name, and another `ChoMessageReply` as the value
  throw `CHO_MESSAGE_INVALID_REPLY`; an option that does not exist throws
  `CHO_CORE_UNKNOWN_OPTION`. In a handler, that is an error of the handler.
- **`Reply.headers` is there only when there are some.** A reply that was
  returned as a plain value, or a `ChoMessageReply` with no header, has none.
- **Which headers a broker accepts is the adapter's.** One whose broker has no
  headers for a reply ignores them; one that cannot send a header says what it
  does then (`vendor/nats/specs.md`).
- A `ChoMessageReply` is recognized by a mark on its prototype, under
  `Symbol.for("cho.message.reply")`, not with `instanceof`: one made by another
  copy of the package is still a reply.
- An error handler returns one too (section 5).
- It is the counterpart of what a handler of `@chojs/web` returns, and
  `to_reply` is what `to_response` is there.

### 3.4 Handler arguments: `@Args`

Standard decorators cannot decorate a parameter, so a handler declares what it
receives with one decorator on the method: `@Args`, with the list of its
arguments, in the order of the parameters. It is the `@Args` of `@chojs/web`
(`web/specs.md`, section 3.1), for a message.

```ts
@Middlewares(validate())
@Controller({ topic: "orders" })
class OrdersController {
  @Subscribe("created")
  @Args(Value(Order), Key(), Header("tenant"))
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

**The call.** With `@Args`, the handler is called with the value of each
argument, in order, and then with the context: `handler(...values, ctx)`. The
context is always the last argument, so a handler that declares arguments can
still reach it; a handler can also leave it out of its parameters. Without
`@Args`, a handler is called with the context alone, as before.

**The arguments.** Three functions make an argument. Each reads one part of the
message:

| Function | Source                             | Without a key                    | With a key                     |
| -------- | ---------------------------------- | -------------------------------- | ------------------------------ |
| `Value`  | the value, read and parsed as JSON | the parsed value                 | that property of the value     |
| `Header` | the headers of the message         | all of them, as an object        | that header, or `undefined`    |
| `Key`    | the key of the message             | the key: a string or `undefined` | (a key has no keys of its own) |

`Value` and `Header` have four signatures, and `Key` the first two:

| Call                       | Gives                                   |
| -------------------------- | --------------------------------------- |
| `Value()`                  | the whole source                        |
| `Value(validator)`         | the whole source, with a validator      |
| `Value("name")`            | one key of the source                   |
| `Value("name", validator)` | one key of the source, with a validator |

A string is a key, and a Standard Schema or an object with a `parse` method is a
validator (section 3.5); anything else throws when the function is called. A
validator is the last argument.

- **`Value()`** is `undefined` for a message with no value, and `Value("name")`
  is `undefined` when the value has no such property, or is not an object. The
  value is parsed once for a message, whatever the number of `Value` arguments.
  A value that is not JSON fails the message (section 3.5 says how).
- **There is no argument for the text or the bytes** of the value: `ctx.text()`
  and `ctx.value` give them.
- **`Header("name")`** looks the name up as the broker gave it, in the same
  case. The headers of a broker, unlike those of HTTP, tell `Tenant` from
  `tenant`.
- **`Key()`** is `undefined` on a broker that has no keys, as NATS.

**Your own arguments.** An argument is also any function `(ctx) => value`, which
can be `async`: it is what the three functions return. It is the way to declare
an argument of your own, such as what a middleware put in `ctx.state`:

```ts
const Tenant = (ctx: ChoMessageContext) => ctx.state.get("tenant") as Tenant;

@Subscribe("created")
@Args(Tenant, Value(Order))
created(tenant: Tenant, order: Order) {}
```

**Types.** The parameters of the handler are checked against the arguments at
compile time, as the parameters of a constructor are against its `dependencies`:
each parameter must accept the value of its argument, and the parameter after
them the context. Without a validator the types are what the source gives:
strings for `Key` and `Header`, and `unknown` for `Value`. A type can be given
by hand, `Value<Order>()`; it is a promise of the caller, and nothing checks it.
With a validator, the type is what the validator gives.

**Rules.**

- `@Args` goes on a handler, above or below `@Subscribe`. On a method that is
  not a handler it has no effect.
- A method has one `@Args`: a second one throws when the class is defined.
- A handler inherited from a base class keeps its arguments. An override that
  declares `@Args` replaces them; one that does not keeps them.
- The arguments are evaluated in order, after the middlewares of the route and
  just before the handler: a middleware that skips the handler never parses the
  value. An argument that throws stops there; the ones after it are not
  evaluated, and its error is an error of the handler (section 5).
- Middlewares and error handlers are not handlers: they always receive the
  context.

### 3.5 Validation

**Validators.** A validator is a [Standard Schema](https://standardschema.dev/):
an object with a `~standard` key. The schemas of [Zod](https://zod.dev),
[Valibot](https://valibot.dev), [ArkType](https://arktype.io) and many other
libraries are, so they are validators as they are, and `@chojs/message` depends
on none of them. An object with a `parse(value)` method that returns the value,
or throws, is a validator too.

```ts
type ChoValidator<Output = unknown, Input = unknown> =
  | StandardSchemaV1<Input, Output>
  | { parse(value: unknown): Output | Promise<Output> };
```

The type, and the rules of the two shapes, are those of `@chojs/core`
(`core/specs.md`, section 5); `@chojs/message` exports the types again. What
matters to a message:

| Shape             | Not valid                                         | When it throws                  |
| ----------------- | ------------------------------------------------- | ------------------------------- |
| A Standard Schema | its result has `issues`: the message is not valid | an error, as from a handler     |
| A `parse` method  | it throws: the message is not valid               | that is how it says "not valid" |

For an object with both shapes, as a Zod schema is, the Standard Schema is used.

A validator given to an argument does two things: it describes the argument
(section 6.6), and it validates it **when the validation middleware is on the
route**.

**The validation middleware.** `validate()` is declared like any middleware,
with `@Middlewares`, on a handler, on a controller or on a feature module, and
covers the handlers under it. There is no application-wide setting.

```ts
const Order = z.object({ id: z.string(), total: z.number() });

@Middlewares(validate()) // every handler of the controller is validated
@Controller({ topic: "orders" })
class OrdersController {
  @Subscribe("created")
  @Args(Value(Order), Header("attempt", z.coerce.number()))
  created(order: z.infer<typeof Order>, attempt: number) {
    // …
  }
}
```

With the middleware on the route:

- Every argument that has a validator goes through it before the handler is
  called. What the validator gives is what the handler receives, so a validator
  can also convert: `Header("attempt", z.coerce.number())` gives a number.
- A validator can give a promise: it is awaited. A schema with asynchronous
  checks needs no wrapper.
- Wherever the middleware is declared, validation happens at the same moment:
  after every middleware of the route, just before the handler.
- **When an argument is not valid, the handler is not called, and the message
  fails**, with a `ChoError` of the code `CHO_MESSAGE_INVALID_MESSAGE`. Its
  message says what is not valid (`the value`, `the property "id" of the value`,
  `the key`, `the header "attempt"`) and the issues, the first three of them:
  `Invalid message of orders: the value is not valid: Required (at id)`. Its
  `cause` is what a `parse` method threw; a Standard Schema throws nothing, and
  the error has no `cause`. A value that is not JSON, for a `Value` argument, is
  the same error, with the error of `JSON.parse` as its `cause`.
- **What the `validate` function of a Standard Schema throws is not a message
  that is not valid.** It is an error of the handler like any other, with no
  code of its own: `onInvalid` is not called, and an adapter treats the message
  as any message that failed, so it can be tried again.
- That error is an error of the handler: it goes to the nearest error handler
  (section 5), then to the adapter.
- **An adapter does not try such a message again** (section 7): it will not be
  valid the second time.

`onInvalid` decides otherwise. It receives what failed and the context, and what
it returns settles the message, by the rule of an error handler (section 5):

| `onInvalid` returns | The message                                          |
| ------------------- | ---------------------------------------------------- |
| nothing, or `false` | fails, with `CHO_MESSAGE_INVALID_MESSAGE`            |
| `true`              | is handled, with no reply: it is skipped             |
| any other value     | is handled, and the value is its reply (section 3.3) |

```ts
validate({
  onInvalid: ({ source, key, issues }, ctx) => {
    logger.warn(ctx.topic, source, key, issues);
    return true; // skipped, and not delivered again
  },
});
```

What failed is a `ChoMessageInvalid`:

| Property | Holds                                                                                       |
| -------- | ------------------------------------------------------------------------------------------- |
| `source` | `value`, `key` or `header`                                                                  |
| `key`    | the key of the argument, when it has one                                                    |
| `issues` | what is not valid: one issue at least, each a `message`, and a `path` for a part of a value |
| `error`  | what was thrown, when something was: by a `parse` method, or by a value that is not JSON    |

The issues are the same for every library: the other fields a library writes in
an issue are left out (`core/specs.md`, section 5.3). What `onInvalid` throws is
an error of the handler. When several `validate()` cover a handler, the nearest
one decides: the handler's, then the controller's, then the feature's.

**The middleware only marks its place.** A chain of `@chojs/message` has no
result, so a middleware cannot turn a failed message into a handled one (section
4): the arguments are evaluated, and validated, at the end of the chain, by the
handler of the route. `validate()` runs the rest of the chain and does nothing
else.

**Without the middleware** on the route, there is no validation:

- validators are not run: the handler receives each value as its source gives
  it, not converted;
- a value that is not JSON is the error of `JSON.parse`, as from any handler,
  and an adapter treats the message as any message that failed.

The type of a parameter still comes from the validator, so it is only true for a
handler the middleware covers. When the application is created, each handler
that has a validator and no validation middleware is logged to the `cho:message`
debug context:
`<Controller.method> has an argument with a validator and no validate() middleware: it is not validated`.

### 3.6 Contracts

A contract is one object that says the topic of a message, what it holds, and
what is replied. The handler takes its topic, its argument and its types from
it, and so does who sends (section 6.7): the two sides cannot disagree, and they
share it as a file or as a package, since it imports nothing of an application.

```ts
export const GetPrice = contract({
  topic: "shop.orders.price",
  request: z.object({ id: z.number() }),
  reply: z.object({ id: z.number(), price: z.number() }),
});

// the service that answers
@Middlewares(validate())
@Controller({ topic: "shop.orders" })
class OrdersController {
  @Subscribe(GetPrice)
  price(request: { id: number }, ctx: ChoMessageContext) {
    return { id: request.id, price: 42 };
  }
}

// the service that asks
const { price } = await client.request(GetPrice, { id: 7 });
```

**`contract(options)`** makes one. It is plain data, frozen:

| Option    | Holds                                                                       |
| --------- | --------------------------------------------------------------------------- |
| `topic`   | the whole topic of the message, without the prefix of an application        |
| `request` | the validator of the value of the message; optional                         |
| `reply`   | the validator of the reply; optional: a message that asks for none has none |

- The types of a contract come from its validators. Without one, a type can be
  given by hand: `contract<Order>({ topic })`,
  `contract<Order, Price>({ topic })`. It is a promise of the caller, and
  nothing checks it. Without a `reply`, and with no type for it, the reply is
  `undefined`: nothing.
- The topic follows the rules of section 2.3, and is not empty.

**A validator that converts gives a value two types**: what goes into it, and
what comes out of it. A message is validated by who handles it, and a reply by
who asked, so each side of a contract has its own:

|           | Who asks                              | Who handles                           |
| --------- | ------------------------------------- | ------------------------------------- |
| `request` | sends what the validator **takes**    | receives what the validator **gives** |
| `reply`   | receives what the validator **gives** | returns what the validator **takes**  |

```ts
export const PlaceOrder = contract({
  topic: "shop.orders.place",
  // the note has a default: who asks can leave it out
  request: z.object({ id: z.number(), note: z.string().default("none") }),
  // cents are sent, and who asks receives an amount
  reply: z.object({ cents: z.number() })
    .transform(({ cents }) => ({ amount: cents / 100 })),
});

// the service that answers: the note is always there, and it returns cents
@Subscribe(PlaceOrder)
place(order: { id: number; note: string }) {
  return { cents: order.id * 150 };
}

// the service that asks: no note, and an amount comes back
const { amount } = await client.request(PlaceOrder, { id: 3 });
```

- The four types are those of the type
  `Contract<Request, Reply, Sent,
  Returned>`: the handler receives `Request`
  and returns `Returned`; who asks sends `Sent` and receives `Reply`. For a
  validator that does not convert, and for types given by hand, `Sent` is
  `Request` and `Returned` is `Reply`.
- **A validator that takes `unknown` does not say what is sent.** A `parse`
  method, a schema written by hand, and a schema that converts anything
  (`z.coerce.number()`) are such validators. What they give is used for both
  sides, so that a client is still held to a type.
- The handler receives what the validator gives **when `validate()` is on its
  route**. Without it the validator is not run, and the handler receives what
  was sent (section 3.5).

**`@Subscribe(contract)`** is `@Subscribe(topic)` and `@Args(Value(request))` in
one. The handler is called with the value of the message, then the context:
`handler(request, ctx)`.

- **The parameter and what is returned are checked at compile time** against the
  contract: a handler that expects another request, or returns another reply,
  does not compile. A contract with no reply lets the handler return nothing;
  any handler can return a `ChoMessageReply`, for a reply with headers.
- **The request is validated as an argument is** (section 3.5): when
  `validate()` is on the route. A request that is not valid fails the message,
  with `CHO_MESSAGE_INVALID_MESSAGE`.
- **The reply is not validated where it is made**: the compiler checked it. It
  is validated where it is received (section 6.7).
- A handler of a contract has no `@Args` of its own: the two together throw when
  the class is defined. It reads anything else from the context.

**The topic of a contract is the whole topic of its handler**, without the
prefix of the application. The topics of the module and of the controller are
not added to it: they must be the start of it, so that a controller still says
where its handlers are.

```ts
@Controller({ topic: "shop.orders" }) // the start of "shop.orders.price"
class OrdersController {
  @Subscribe(GetPrice)
  price() {}
}
```

A module or a controller whose topic is not the start of the topic of the
contract is a mistake in the wiring: `ChoMessage.create` rejects it
(`CHO_MESSAGE_INVALID_TOPIC`). The prefix of the application (section 2.2) is
put before it, on both sides: who sends gives the same prefix to its client.

**A contract speaks JSON, both ways.** The value of the message is sent as JSON,
and what the handler returns is sent as JSON too, a string included (`"pong"`,
with its quotes), where a handler of a topic sends the text of a string (section
3.3). So a client reads every reply the same way. Bytes are not for a contract:
a handler of a topic handles them.

What an error handler, or `onInvalid`, returns for a handler of a contract is a
reply like any other (section 3.3), not made into JSON again: to tell who asked
that something went wrong, throw a `ReplyError` (section 5.1).

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
  handled, and has no reply. This is how a middleware drops a message, one that
  was already handled or one that is not for this application;
- what a middleware returns is ignored;
- **a middleware does not see the reply**: `next()` resolves with nothing, and
  the reply is the handler's (section 3.3).

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

**The middlewares of the application.** The `middlewares` option of
`ChoMessage.create`, and of `ChoMessage.from`, takes what `@Middlewares` takes,
for the whole application: they run for every message, in order, before the
feature's.

- **They are the first of the chain of every handler**, and middlewares like the
  others: they share the context of the message, one that returns without
  calling `next()` skips the handler, and an error one throws goes to the error
  handlers (section 5). There is no answer to wrap, as in `@chojs/web`: nothing
  runs outside the chain.
- **A class is created by the injector, in the scope of the root module.**
- **`@chojs/message` runs them itself**: an adapter knows nothing of them, and
  `app.handle` (section 6.3) runs them too.
- **`validate()` is not one of them.** It covers the handlers under it (section
  3.5), and is declared with `@Middlewares`. Given here, it would be taken and
  validate nothing: `create` rejects it (`CHO_MESSAGE_INVALID_ARGUMENT`).
- They are on the graph: `app.graph.middlewares`, created and in order.

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
decided that the message is to be dropped. The message then has no reply.

**Any other value an error handler returns is the reply of the message**
(section 3.3), and the message is handled. This is how who asked is told what
went wrong:

```ts
@Catch((error) => ({
  error: error instanceof NotFound ? "not found" : "failed",
}))
@Subscribe("price")
price(ctx: ChoMessageContext) {/* ... */}
```

`false` is not a reply here: like nothing, it leaves the message failed, so that
an error handler can return whether it handled the error
(`return error instanceof SyntaxError`).

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

| The error handler              | The message                                              |
| ------------------------------ | -------------------------------------------------------- |
| returns `true`                 | handled, with no reply                                   |
| returns any other value        | handled, and the value is its reply                      |
| returns nothing, or `false`    | failed, with the original error                          |
| returns what cannot be a reply | failed, with the original error; the mistake is logged   |
| throws                         | failed, with the original error; what it threw is logged |
| there is none                  | failed, with the original error                          |

An error handler is called once for a message: not again for what it returned.

### 5.1 Telling who asked: `ReplyError`

`ReplyError` is an error with a code and a description, for who asked. It is to
a message what `HttpError` is to a request of `@chojs/web` (`web/specs.md`,
section 5.1).

```ts
@Subscribe(GetPrice)
price(request: { id: number }) {
  const order = this.orders.find(request.id);
  if (!order) {
    throw new ReplyError(404, "Not Found");
  }
  return { id: order.id, price: order.price };
}
```

```ts
new ReplyError(code, description, { cause });
isReplyError(error); //       whether an error is one
isReplyError(error, 404); //  and has this code
```

- **`code`** is a whole number, 1 or more. The codes of HTTP are the ones a
  requester expects (`400`, `404`, `409`, `500`), and nothing forces them.
- **`description`** is a string of one line, not empty: it is sent. It is the
  `message` of the error. A `cause` is logged, and never sent.
- Anything else throws when the error is made
  (`CHO_MESSAGE_INVALID_REPLY_ERROR`).

**It is an error like any other for `@chojs/message`**: it goes to the nearest
error handler first, which can settle the message as it does for any error, and
a message that fails with it rejects with it. What changes is what the adapter
does:

| The adapter                         | For a `ReplyError`                                               |
| ----------------------------------- | ---------------------------------------------------------------- |
| has replies, and a reply was asked  | answers with its code and its description, and asks nothing else |
| has replies, and no reply was asked | a message that failed, as any other                              |
| has no replies (Kafka)              | a message that failed, as any other                              |

**Who asked gets the same error**: `ChoMessageClient.request` rejects with a
`ReplyError` of the code and the description the other side answered with
(section 6.7). An error of the other side that is not a `ReplyError` arrives as
one too, with what its adapter tells by default (`500`, `Internal Error`; `400`,
`Bad Request` for a request that is not valid).

It is recognized by a mark on its prototype, under
`Symbol.for("cho.message.reply_error")`, not with `instanceof`: one made by
another copy of the package is still a `ReplyError`.

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

| Option        | Default | Use                                                                |
| ------------- | ------- | ------------------------------------------------------------------ |
| `linker`      | none    | the broker adapter. Without one, only `handle()` delivers messages |
| `prefix`      | `""`    | the global prefix of every topic (section 2.2)                     |
| `onError`     | none    | the application's error handler (section 5)                        |
| `middlewares` | none    | the middlewares of the application (section 4)                     |
| `overrides`   | none    | providers that replace declared ones, for tests                    |

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
- It resolves with the reply of the message (section 3.3), or with `undefined`
  when the handler returned nothing:

  ```ts
  const reply = await app.handle("orders.price", { value: '{"id":"42"}' });
  JSON.parse(new TextDecoder().decode(reply?.value)); // { id: "42", total: 12 }
  ```

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

### 6.6 What is known about a handler

Everything declared about a handler is kept, and exposed on the graph of the
application (`app.graph`, `@chojs/message/graph`), so that tools can use it: a
document of the topics of an application needs it.

| On a `MethodRef` | Holds                                                                               |
| ---------------- | ----------------------------------------------------------------------------------- |
| `args`           | the arguments of the handler, in order; empty with no `@Args`                       |
| `validated`      | whether `validate()` is among the middlewares of the feature, controller, handler   |
| `contract`       | the contract of the handler, when `@Subscribe` was given one; `undefined` otherwise |

An argument made by `Value`, `Key` or `Header` has an `info`: its `source`, its
`key` when it has one, and its `validator`, which is its schema. An argument of
your own has none. `handler` on a `MethodRef` is still called with the context
alone: it evaluates the arguments itself, and validates them when `validated` is
`true`.

### 6.7 Sending: `ChoMessageClient`

`ChoMessageClient` sends the message of a contract, and gives back its typed
reply. It is built on a `Sender`, which each adapter makes of the client of its
broker (section 7).

```ts
const client = new ChoMessageClient(linker.sender, { prefix: "staging" });

await client.publish(OrderCreated, { id: 7, total: 12 });
const { price } = await client.request(GetPrice, { id: 7 });
```

| Option    | Default      | What it is                                                        |
| --------- | ------------ | ----------------------------------------------------------------- |
| `prefix`  | none         | the prefix of the application that listens; put before each topic |
| `timeout` | the sender's | the milliseconds a request waits, when the request does not say   |

**`publish(contract, value, options?)`** sends a message that asks for no reply.
It resolves when the message is given to the broker.
**`request(contract, value, options?)`** sends one that asks for a reply, and
resolves with it. `options` has the `key` and the `headers` of the message, and
`timeout` for a request. The value can be left out when the contract lets it be
`undefined`.

- **The value is sent as JSON**, a string included; `undefined` sends a message
  with no value. A value that has no JSON throws (`CHO_MESSAGE_INVALID_VALUE`).
  It is not validated before it is sent: the types of the contract are what the
  sender is held to, and the handler validates what it receives.
- **The reply is read as JSON**, then goes through the `reply` validator of the
  contract, when it has one: what the validator gives is what `request` resolves
  with. An empty reply is `undefined`. A reply that is not valid rejects with
  `CHO_MESSAGE_UNEXPECTED_REPLY`, whose message has the issues; what the
  `validate` function of a Standard Schema throws rejects the request as it is.
- **What is sent is typed by what the `request` validator takes**, and the reply
  by what the `reply` validator gives (section 3.6).
- **A request rejects** with:

  | What happened                                      | The error                                 |
  | -------------------------------------------------- | ----------------------------------------- |
  | the other side answered with an error              | a `ReplyError`: its code, its description |
  | nobody listens to the topic                        | `CHO_MESSAGE_NO_RESPONDERS`               |
  | no answer came in time                             | `CHO_MESSAGE_REQUEST_TIMEOUT`             |
  | the reply is not JSON, or its validator refused it | `CHO_MESSAGE_UNEXPECTED_REPLY`            |
  | the broker of the sender has no replies (Kafka)    | `CHO_MESSAGE_NO_REPLIES`                  |

**How an application reaches its client.** The sender of a linker is there as
soon as the linker is made, before the application is created, so the client is
provided like any dependency:

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

A sender sends once its adapter is ready (for NATS, once `app.start()` was
called), and rejects before: a handler, which runs after the start, always finds
it ready. An application that only sends has no handler: it still creates a
`ChoMessage` with the linker, and starts it.

**With no broker.** `localSender(app)` is a sender that delivers to an
application in the same process, with `app.handle` (section 6.3): a client and
the application it talks to, end to end, in a test. `publish` resolves when the
message is handled, and `request` with the reply of the handler; both reject
with what a failed message rejects with, a `ReplyError` as it is.

```ts
const app = await ChoMessage.create(AppModule);
const client = new ChoMessageClient(localSender(app));
assert.deepEqual(await client.request(GetPrice, { id: 7 }), {
  id: 7,
  price: 42,
});
```

## 7. Broker adapters

An adapter is a package of its own, named after its broker:
`@chojs/vendor-kafka` and `@chojs/vendor-nats`. `@chojs/message` never imports
an adapter: applications pass one to `ChoMessage.create`. An adapter can run on
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

| Property | Holds                                                                                  |
| -------- | -------------------------------------------------------------------------------------- |
| `topic`  | the full topic, global prefix included (`"staging.orders.created"`)                    |
| `name`   | where it is declared, for logs (`"OrdersController.created"`)                          |
| `handle` | `(delivery, native?) => Promise<Reply \| undefined>`: handles one message of the topic |

A `Delivery` is one message, as plain data:

| Property  | Holds                                                    |
| --------- | -------------------------------------------------------- |
| `value`   | the bytes of the value, or a string; optional, or `null` |
| `key`     | the key, as a string; optional                           |
| `headers` | the headers, as an object of strings; optional           |

A `Reply` is the reply of a message, as plain data: a `Delivery` in the other
direction.

| Property  | Holds                                                                |
| --------- | -------------------------------------------------------------------- |
| `value`   | the bytes of the reply                                               |
| `headers` | the headers, as an object of strings; absent when the reply has none |

`handle` runs the route's middlewares, its handler and its error handler. It
**resolves** when the message is handled, and the adapter acknowledges it. It
**rejects**, with the error, when the message failed, and the adapter does what
its broker does. The adapter's second argument, its own message, is what
handlers see as `ctx.native`.

**It resolves with the reply of the message**, when its handler returned one
(section 3.3), and with `undefined` when it did not. What an adapter does with
it depends on its broker:

- **a broker that has no replies** (Kafka): the adapter ignores it. Nothing in
  such an adapter changes for replies;
- **a broker that has them** (NATS): the adapter sends the reply to who asked
  for one, and drops it when nobody asked. What it answers when the message
  failed, and when the handler returned nothing to someone who waits, is its own
  decision.

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
              const reply = await route.handle(
                { value: message.data, key: message.key },
                message,
              );
              await message.ack();
              // only for a broker that has replies
              if (reply && message.replyTo) {
                await client.publish(message.replyTo, reply.value, {
                  headers: reply.headers ?? {},
                });
              }
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

| Question                            | Example of an answer                                         |
| ----------------------------------- | ------------------------------------------------------------ |
| How the application is identified   | the consumer group: a required option                        |
| What a failed message leads to      | delivered again, at most `n` times, then a dead-letter topic |
| The same, for one that is not valid | never tried again: the dead-letter topic at once; or a `400` |
| What is done with a reply           | ignored: the broker has none; or sent to who asked for one   |
| How many messages run at once       | one at a time for each partition                             |
| What `ctx.native` is                | the message of the client library: partition, offset, …      |
| How a topic is named                | as it is; or mapped to the names its broker allows           |
| Which runtimes it runs on           | Node.js only                                                 |

`@chojs/vendor-kafka` has a spec of its own, `vendor/kafka/specs.md`. Two of its
decisions were hard: the client library, which is `@platformatic/kafka`, and
what a failed message leads to, since Kafka cannot refuse one message without
holding back the ones after it in its partition. It is tried again in place,
then sent to a dead-letter topic.

**What an adapter implements to send.** A `Sender` is what a `ChoMessageClient`
is built on:

```ts
interface Sender {
  publish(topic: string, delivery: Delivery): Promise<void>;
  request?(
    topic: string,
    delivery: Delivery,
    options?: { timeout?: number },
  ): Promise<Reply | undefined>;
}
```

- A `Delivery` is the message to send: its value, as a string or as bytes, its
  key and its headers. A sender ignores what its broker has not (a key, on
  NATS).
- **An adapter whose broker has no replies has no `request`**, and
  `ChoMessageClient.request` throws for it.
- `request` resolves with the `Reply` of the other side. It rejects with a
  `ReplyError` when the other side answered with an error, and with the error
  `request_error` makes (`@chojs/message/linker`) when nobody listens
  (`CHO_MESSAGE_NO_RESPONDERS`) or no answer came in time
  (`CHO_MESSAGE_REQUEST_TIMEOUT`), so that who asks reads the same errors on
  every broker.
- The linker of an adapter has its sender as `sender`, from the moment it is
  made.

**A message that is not valid.** An adapter recognizes it by the code of the
error `route.handle` rejects with,
`isChoError(error,
"CHO_MESSAGE_INVALID_MESSAGE")`, and does not deliver it
again. What it does in place is its own decision: Kafka sends it to the
dead-letter topic at once, and NATS tells who asked `400`, `Bad Request`.

`@chojs/vendor-nats` has one too, `vendor/nats/specs.md`. By default a route is
a core subscription, where a message can ask for a reply: the reply of a handler
is sent to who asked, a request whose handler returned nothing is answered with
an empty reply, and one that failed with an error reply. With its `jetstream`
option, a route whose subject is of a stream is consumed from JetStream: each
message is acknowledged, a failed one is delivered again, then sent to a
dead-letter subject. The application gives the connection, so the adapter
imports no transport and runs on Deno, Node.js and Bun.

The tree behind the topics is on `app.graph` (`@chojs/message/graph`), with
every instance, middleware and error handler already created: `AppRef`,
`FeatureRef`, `ControllerRef` and `MethodRef`, as in `@chojs/web`, with `topic`
in place of `route`.

## 8. Public API

| Entry point             | Exports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@chojs/message`        | `ChoMessage`, `ChoMessageOptions`, `ChoMessageFromOptions`, `ChoMessageReply`, `ChoMessageReplyOptions`, `contract`, `Contract`, `ChoMessageClient`, `ChoMessageClientOptions`, `ChoMessageSendOptions`, `ChoMessageRequestOptions`, `ChoMessageSent`, `localSender`, `LocalApplication`, `ReplyError`, `isReplyError`, `ReplyErrorOptions`, `Subscribe`, `Args`, `Value`, `Key`, `Header`, `validate`, `Middlewares`, `Catch`, `ChoError`, `isChoError` (the core's), `ChoMessageErrorCode`, `ChoCoreErrorCode`, the types `Reply`, `ChoMessageContext`, `ChoMessageHandler`, `ChoMessageNext`, `ChoMessageMiddlewareFn`, `ChoMessageMiddleware`, `ChoMessageErrorHandlerFn`, `ChoMessageErrorHandler`, `ChoMessageArg`, `ChoMessageArgInfo`, `ChoMessageArgSource`, `ChoMessageInvalid`, `ContractOptions`, `ChoValidator`, `ChoParseValidator`, `ChoIssue`, `ChoInput`, `ChoOutput`, `StandardSchemaV1`, `StandardJSONSchemaV1`, `StandardTypedV1` (the core's), `ChoMessageValidateOptions`, `Module`, `Controller` (the core's, with the `topic` option), `MessageModuleOptions`, `MessageControllerOptions`, `TopicOption`, the types of the two other entry points, and from the core `Injectable`, `token`, `provider`, `configure`, `InjectionToken`, `Provider` and the option types, and `env`, `envNum`, `envBool`, `setEnv`, `engine`, `EnvSource`, `EngineType` |
| `@chojs/message/linker` | `Linker`, `Linked`, `Route`, `Delivery`, `Reply`, `Sender`, `RequestOptions`, `ReplyError`, `isReplyError`, `request_error`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `@chojs/message/graph`  | `AppRef`, `FeatureRef`, `ControllerRef`, `MethodRef`, `NodeRef`, `ErrorHandlerRef`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `@chojs/vendor-kafka`   | `KafkaLinker`, `KafkaLinked`, and their types (`vendor/kafka/specs.md`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `@chojs/vendor-nats`    | `NatsLinker`, `NatsLinked`, and their types (`vendor/nats/specs.md`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

`@Middlewares` and `@Catch` are the core's decorators, typed for
`@chojs/message`.

**The environment.** `@chojs/message` gives an application what it reads its
environment with: `env`, `envNum`, `envBool`, `setEnv` and `engine`. They are
the core's (`core/specs.md`, section 3.3), under the names of a public API, and
the same in every CHO module. Variables are read from the source given to
`setEnv`, then from `process.env`.

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

| Mistake                                                                                                        | Code                              | Message                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A handler's topic is invalid                                                                                   | `CHO_MESSAGE_INVALID_TOPIC`       | `Invalid topic "<topic>" of @Subscribe() on method <name>: <reason>`                                                                                                           |
| A second `@Subscribe` on a method                                                                              | `CHO_MESSAGE_DUPLICATE_DECORATOR` | `Cannot add @Subscribe() to method <name>: it already handles "<topic>". A method can have one @Subscribe().`                                                                  |
| An unknown option of `@Module` / `@Controller`                                                                 | `CHO_CORE_UNKNOWN_OPTION`         | `@Controller(): unknown option "route". Known options: dependencies, topic`                                                                                                    |
| A static, private or symbol-named handler                                                                      | `CHO_MESSAGE_INVALID_TARGET`      | `@Subscribe() cannot decorate static method <name>: a handler must not be static`                                                                                              |
| An argument of `@Args` that is not a function                                                                  | `CHO_MESSAGE_INVALID_ARGUMENT`    | `@Args() on method <name>: argument 2 must be made with Value, Key or Header, or be a function, got <v>`                                                                       |
| A second `@Args` on a method                                                                                   | `CHO_MESSAGE_DUPLICATE_DECORATOR` | `Cannot add @Args() to method <name>: it already has one.`                                                                                                                     |
| `@Args` on a static, private or symbol-named method                                                            | `CHO_CORE_INVALID_TARGET`         | `@Args() cannot decorate static method <name>: only public, non-static methods with a string name are supported`                                                               |
| `Value`, `Key` or `Header` is given what it does not take                                                      | `CHO_MESSAGE_INVALID_ARGUMENT`    | `Value(): expected a key (a string) or a validator (a Standard Schema, or an object with a parse method), got <v>` (or `… a validator is the last argument, got <v> after it`) |
| `validate()` is given options that are not an object, or an `onInvalid` that is not a function                 | `CHO_MESSAGE_INVALID_ARGUMENT`    | `validate(): "onInvalid" is a function, got <v>`                                                                                                                               |
| The `middlewares` of `ChoMessage.create` or `from` are not an array, or hold a `validate()`                    | `CHO_MESSAGE_INVALID_ARGUMENT`    | `ChoMessage: validate() is not a middleware of an application: it covers the handlers under it. …` (or `ChoMessage: "middlewares" must be an array, got <v>`)                  |
| An unknown option of `validate()`                                                                              | `CHO_CORE_UNKNOWN_OPTION`         | `validate(): unknown option "invalid". Known options: onInvalid`                                                                                                               |
| `contract()` is given options that are not an object, or what is not a validator                               | `CHO_MESSAGE_INVALID_CONTRACT`    | `contract(): "reply" is a validator (a Standard Schema, or an object with a parse method), got <v>`                                                                            |
| The topic of a contract is missing, empty or not valid                                                         | `CHO_MESSAGE_INVALID_TOPIC`       | `Invalid topic of contract(): it is empty. A contract has the whole topic of its message`                                                                                      |
| `@Subscribe(contract)` on a method that has `@Args`, or `@Args` on such a handler                              | `CHO_MESSAGE_DUPLICATE_DECORATOR` | `Cannot add @Args() to method <name>: it is the handler of a contract, and receives its request, then the context.`                                                            |
| A `ReplyError` is made with a code, a description or options that are not ones                                 | `CHO_MESSAGE_INVALID_REPLY_ERROR` | `ReplyError: the code must be a whole number, 1 or more, got <v>`                                                                                                              |
| `ChoMessageClient` is given what is not a sender, or a wrong option; `localSender`, what is not an application | `CHO_MESSAGE_INVALID_CLIENT`      | `new ChoMessageClient(): expected a sender, such as the sender of a linker, got <v>`                                                                                           |

**Rejected by `ChoMessage.create` and `ChoMessage.from`**: any module graph
error of the core (`core/specs.md`, section 2.8), and:

| Mistake                                                     | Code                             | Message                                                                                                                                                                               |
| ----------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A topic is not a string                                     | `CHO_MESSAGE_INVALID_TOPIC`      | `Invalid topic of <where>: expected a string, got <v>`                                                                                                                                |
| A topic breaks a rule (section 2.3)                         | `CHO_MESSAGE_INVALID_TOPIC`      | `Invalid topic "<topic>" of <where>: <reason>`                                                                                                                                        |
| A wildcard in a topic (`*`, `>`, `#`)                       | `CHO_MESSAGE_INVALID_TOPIC`      | `Invalid topic "<topic>" of <where>: "<segment>" has a "*": wildcards are not part of the topic syntax`                                                                               |
| A segment with another character                            | `CHO_MESSAGE_INVALID_TOPIC`      | `Invalid topic "<topic>" of <where>: "<segment>" is not a valid segment: write letters, digits, "_" and "-"`                                                                          |
| A leading or trailing `.`, or an empty segment              | `CHO_MESSAGE_INVALID_TOPIC`      | `Invalid topic "<topic>" of <where>: it must not start or end with "."` (and `… it must not contain an empty segment ("..")`)                                                         |
| A handler with no level at all                              | `CHO_MESSAGE_INVALID_TOPIC`      | `Invalid topic of <Controller.method>: it is empty. Give @Subscribe(), its controller or its module a topic`                                                                          |
| Two handlers with the same topic                            | `CHO_MESSAGE_DUPLICATE_TOPIC`    | `Duplicate topic "<topic>": declared by <Controller.method> and <Controller.method>`                                                                                                  |
| `onError` is not a function or a class                      | `CHO_CORE_INVALID_ERROR_HANDLER` | `Invalid error handler <v>: must be a function or a class with a 'handle' method.`                                                                                                    |
| A middleware class has no `handle` method                   | `CHO_CORE_INVALID_MIDDLEWARE`    | `Middleware class <Name> must implement 'handle' method.`                                                                                                                             |
| A middleware class cannot be created                        | `CHO_MESSAGE_CREATE_FAILED`      | `Failed to create middleware <Name> in module <Module>`, with the injector's error as cause                                                                                           |
| An error handler class cannot be created                    | `CHO_MESSAGE_CREATE_FAILED`      | `Failed to create error handler <Name> in module <Module>`, with `cause`                                                                                                              |
| `overrides` given to `from`, or any unknown option          | `CHO_CORE_UNKNOWN_OPTION`        | `ChoMessage.from(): unknown option "overrides". Known options: linker, middlewares, onError, prefix` (and `ChoMessage.create(): … Known options: linker, onError, overrides, prefix`) |
| What `from` is given is not an injector                     | `CHO_MESSAGE_INVALID_INJECTOR`   | `ChoMessage.from(): expected an injector, got <v>`                                                                                                                                    |
| `from` on a disposed injector, with a controller to resolve | `CHO_CORE_DISPOSED`              | `The injector is disposed`                                                                                                                                                            |

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

| Mistake                                                                   | Code                          | Message                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A middleware calls `next()` twice                                         | `CHO_CORE_NEXT_CALLED_TWICE`  | `middleware <name>: next() called more than once`                                                                                                                                                                                  |
| What a handler returned cannot be a reply                                 | `CHO_MESSAGE_INVALID_REPLY`   | `Invalid reply of <Controller.method>: <v> cannot be serialized as JSON`, with the error of `JSON.stringify` as `cause` (or `… expected bytes, a string or a value JSON can hold, got <v>`)                                        |
| A `ChoMessageReply` is made with what it cannot hold                      | `CHO_MESSAGE_INVALID_REPLY`   | `new ChoMessageReply(): the header "status" is a string, got 404` (or `… "headers" is an object of strings, got <v>`, `… a header has no name`, `… expected options, such as …`, `… the value of a reply cannot be another reply`) |
| An argument of a validated handler is not valid, or its value is not JSON | `CHO_MESSAGE_INVALID_MESSAGE` | `Invalid message of <topic>: the property "id" of the value is not valid: <issues>`, with what a `parse` method threw as `cause`                                                                                                   |

**Rejecting a `publish` or a `request` of `ChoMessageClient`** (section 6.7):

| Mistake                                            | Code                           | Message                                                                                                                                         |
| -------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| What is given is not a contract                    | `CHO_MESSAGE_INVALID_CONTRACT` | `ChoMessageClient.request(): expected a contract, made by contract(), got <v>`                                                                  |
| The value has no JSON                              | `CHO_MESSAGE_INVALID_VALUE`    | `Invalid value of a message to "<topic>": <v> cannot be serialized as JSON`                                                                     |
| A request on a sender whose broker has no replies  | `CHO_MESSAGE_NO_REPLIES`       | `ChoMessageClient.request(): the sender cannot ask "<topic>": its broker has no replies. …`                                                     |
| Nobody listens to the topic of a request           | `CHO_MESSAGE_NO_RESPONDERS`    | `No answer to the request of "<topic>": nobody listens to it`                                                                                   |
| No answer came in time                             | `CHO_MESSAGE_REQUEST_TIMEOUT`  | `No answer to the request of "<topic>": the time to wait is over`                                                                               |
| The reply is not JSON, or its validator refused it | `CHO_MESSAGE_UNEXPECTED_REPLY` | `Unexpected reply to the request of "<topic>": the validator of its contract refused it: <issues>`, with what a `parse` method threw as `cause` |

**What has no code**: what a handler or a middleware throws is the application's
error: it is given to the error handler as it is, and a message that fails
rejects with it. A `ReplyError` is such an error: it has a code of its own, the
one who asked is told, and it is not a `ChoError` (section 5.1).

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
- **An argument for the text or the bytes of the value**, and a value that is
  not JSON (a schema registry, Avro, Protobuf). A handler reads `ctx.value`.
- **Wildcards and parameters** in a topic (the `orders.*` of NATS).
- **A middleware that reads or replaces the reply.** The reply is the handler's.
- **A contract of bytes**, or of anything that is not JSON, and a `ReplyError`
  with a payload. A handler of a topic sends bytes; a `ReplyError` has a code
  and a description.
- **Sending without a contract**, to a topic given as a string. The connection
  of the adapter (`app.linked.instance`) sends anything.
- **Knowing in a handler whether a reply is asked for.** The handler returns its
  value either way; an adapter that knows has it in `ctx.native`.
- **A timeout for `close()`**, the `closeTimeout` of `serve`. `close()` waits
  for the messages in hand, however long they take.
- **A signal on the context** that is aborted when the application closes, the
  `ctx.req.signal` of `@chojs/web`.
- **`ChoWeb.from(injector)`**, the other direction of section 6.5.

## 11. Decisions

Every choice this document makes, with the alternative. `→` marks the choice,
which is what the package does.

| #  | Question                                   | → Chosen                                                                  | Alternative                                                                                     | Section  |
| -- | ------------------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------- |
| 1  | The name of the package and of the class   | `@chojs/message`, `ChoMessage`                                            | `@chojs/messaging`, `ChoMessaging`                                                              | 1        |
| 2  | The decorator of a handler                 | `@Subscribe(topic)`                                                       | `@On(topic)`                                                                                    | 2.1      |
| 3  | What a route is                            | a topic, and nothing else                                                 | a topic and a type of message                                                                   | 2.1, 10  |
| 4  | How the levels are joined                  | with `.`                                                                  | not joined: every handler writes its full topic                                                 | 2.2      |
| 5  | Patterns in a topic                        | none: a topic is a name                                                   | the wildcards of the broker, where it has them                                                  | 2.3      |
| 6  | Two handlers on one topic                  | an error when the application is created                                  | both get every message                                                                          | 2.3      |
| 7  | Where the consumer group is declared       | an option of the adapter                                                  | an option of `@Controller` or `@Subscribe`                                                      | 2.4      |
| 8  | Who decodes the value                      | the handler: `ctx.json()`, `ctx.text()`                                   | the adapter: `ctx.value` is already an object                                                   | 3.1      |
| 9  | A message without a value                  | an empty `value`; `json()` gives `undefined`                              | `value` is `null`                                                                               | 3        |
| 10 | What a handler returns                     | the reply of the message                                                  | ignored; or a decorator that says a handler replies                                             | 3.3      |
| 11 | When a message is acknowledged             | after its handler has returned                                            | when it is received                                                                             | 3.2      |
| 12 | A middleware that does not call `next()`   | the handler is skipped, and the message is handled                        | an error, as in `@chojs/web`                                                                    | 4        |
| 13 | An error handler that returns nothing      | the message failed; `true` settles it as handled                          | any return settles it as handled                                                                | 5        |
| 14 | What a failed message leads to             | the adapter decides, and documents it                                     | `@chojs/message` retries by itself                                                              | 3.2, 7   |
| 15 | Who starts listening                       | the application: `app.start()`, `app.close()`                             | a function of the adapter, like `serve`                                                         | 6.2      |
| 16 | Delivering a message by hand               | `app.handle(topic, message)`, with no linker needed                       | only through a linker written for tests                                                         | 6.3      |
| 17 | A default linker                           | none                                                                      | an in-memory broker                                                                             | 6.1      |
| 18 | Sharing instances with a web application   | `ChoMessage.from(web.injector, options)`                                  | `ChoMessage.from(web, options)`; or both made from an injector you create                       | 6.5      |
| 19 | Who disposes a shared injector             | the application that created it                                           | the last one that is closed                                                                     | 6.5      |
| 20 | Web and message controllers in one module  | allowed; the rules of section 6.5 are documented, not enforced            | rejected: a module is of one kind                                                               | 6.5      |
| 21 | The name of the adapters                   | `@chojs/vendor-<broker>`, a `<Broker>Linker` class                        | `@chojs/message-<broker>`                                                                       | 7        |
| 22 | Who makes the bytes of a reply             | `@chojs/message`: bytes, strings, and JSON for the rest                   | each adapter; or the handler, which returns bytes only                                          | 3.3      |
| 23 | What "no reply" is                         | `undefined`, and nothing else: `null` is the reply `null`                 | every value that is not truthy                                                                  | 3.3      |
| 24 | What an adapter is given                   | a `Reply` object, `{ value, headers? }`                                   | the bytes alone, which leaves no room for headers                                               | 3.3, 7   |
| 25 | A reply nobody asked for                   | dropped by the adapter                                                    | an error                                                                                        | 3.3, 7   |
| 26 | What an error handler returns              | `true`: handled, no reply; a value: its reply; `false`: failed            | any value handles the message                                                                   | 5        |
| 27 | Whether a middleware sees the reply        | no                                                                        | `next()` resolves with it, and a middleware can replace it                                      | 4        |
| 28 | How a handler gives the headers of a reply | it returns a `ChoMessageReply`, as a web handler returns a `Response`     | a method of the context; or a plain `{ value, headers }`, which is also a value to send as JSON | 3.3      |
| 29 | How a handler declares what it receives    | `@Args(Value(schema), Key(), Header("x"))`, as in `@chojs/web`            | a handler reads the context, and nothing is checked                                             | 3.4      |
| 30 | When a validator runs                      | when `validate()` is on the route, as in `@chojs/web`                     | always; the two packages would then read differently                                            | 3.5      |
| 31 | What a message that is not valid is        | a failed message, with a code of its own                                  | a handled message, which hides a mistake of the sender                                          | 3.5      |
| 32 | Whether it is tried again                  | never: an adapter recognizes the code                                     | as any failed message, which retries what cannot work                                           | 3.5, 7   |
| 33 | Where `onInvalid` runs                     | at the end of the chain, with the arguments                               | in the middleware, which cannot settle a message                                                | 3.5      |
| 34 | Where the code of arguments is             | in `@chojs/message`, next to that of `@chojs/web`                         | shared through the core, for two packages only                                                  | 3.4      |
| 35 | What two services share                    | a contract: the topic, and the validators of the request and of the reply | types written twice, which drift apart                                                          | 3.6      |
| 36 | Where the topic of a contract is           | in the contract, whole; its module and controller must be the start of it | a contract with no topic, and a topic who sends has to know from elsewhere                      | 3.6      |
| 37 | How a contract is encoded                  | JSON both ways, a string included                                         | as a reply is, where the text of a string is not JSON                                           | 3.6      |
| 38 | Where a request and a reply are validated  | where each is received                                                    | where each is made too, twice the work for what the types hold                                  | 3.6, 6.7 |
| 39 | How who asked is told of an error          | the handler throws a `ReplyError`, and the client rejects with it         | an option of each adapter alone, which the handler cannot reach                                 | 5.1      |
| 40 | What sends                                 | a `ChoMessageClient`, on the `Sender` of an adapter                       | the client of each broker, with no types and no shared errors                                   | 6.7, 7   |
| 41 | How an application reaches its client      | the `sender` of the linker is there before the application is created     | the connection of `start()`, which a provider cannot wait for                                   | 6.7      |
| 42 | A request on a broker with no replies      | throws: its sender has no `request`                                       | a reply topic invented by the adapter                                                           | 6.7, 7   |

## 12. What changed in the other packages

- **`@chojs/web`: `ChoWeb` exposes its injector**, as a read-only `injector`
  property. It was private. Section 6.5 needs it, and nothing else changed
  there.
- **The workspace**: `./message` is in the `workspace` of the root `deno.json`,
  in the paths of `tsconfig.json`, and in the release configuration, with the
  linked versions. `./vendor/kafka` joins them with the adapter. The package has
  to exist on JSR before the next release: the release workflow publishes every
  package of the workspace.
- **`@chojs/vendor-kafka`: a reply is dropped.** Kafka has none. The adapter did
  not change for replies, apart from a line of its debug log that says so, once
  for each handler that returns one.
- **The adapters have a sender.** `linker.sender` of `@chojs/vendor-nats`
  publishes and requests with the connection of the application, and the one of
  `@chojs/vendor-kafka` publishes with its producer. `@chojs/vendor-nats`
  answers a `ReplyError` of a handler with its code and its description.
- **The adapters: a message that is not valid is not tried again.**
  `@chojs/vendor-kafka` sends it to the dead-letter topic at once, and
  `@chojs/vendor-nats` answers `400`, `Bad Request`, in place of `500`.
- **`@chojs/vendor-nats`: a reply is sent.** It is the first adapter that uses
  what `route.handle` resolves with. `./vendor/nats` is in the `workspace` and
  in the release configuration, with the linked versions.
- **`@chojs/core`: `compose` runs a chain that has no result**, when it is given
  no `kind` (`core/specs.md`, section 3.3). It is the chain of section 4: what a
  middleware returns is ignored, and one that returns without calling `next()`
  ends the chain. Nothing else changed in the core: the records, the injector
  and the helpers for a CHO module's own `@Module` and `@Controller` are the
  ones `@chojs/web` uses.
