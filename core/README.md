# @chojs/core

[![JSR](https://jsr.io/badges/@chojs/core)](https://jsr.io/@chojs/core)
[![JSR score](https://jsr.io/badges/@chojs/core/score)](https://jsr.io/@chojs/core)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

The dependency injection engine of the [CHO](../README.md) framework:
asynchronous, decorator-driven, and free of reflection.

> **Building an application?** You do not need this package. Use
> [`@chojs/web`](../web/README.md) for HTTP applications,
> [`@chojs/command`](../command/README.md) for command-line applications or
> [`@chojs/message`](../message/README.md) for the messages of a broker: they
> re-export everything an application needs from the core.
>
> **This package is internal.** It is the foundation the CHO modules are built
> on. Its functions are named in `snake_case`, which in CHO marks an internal
> API: they can change between versions without a major release.

## Contents

- [Highlights](#highlights)
- [Installation](#installation)
- [At a glance](#at-a-glance)
- [Concepts](#concepts)
- [Lifecycle](#lifecycle)
- [Configuring a module](#configuring-a-module)
- [Validators](#validators)
- [Testing with overrides](#testing-with-overrides)
- [Writing a CHO module](#writing-a-cho-module)
- [Errors](#errors)
- [Entry points](#entry-points)
- [Runtime support](#runtime-support)
- [Documentation](#documentation)

## Highlights

- **Asynchronous by design.** A provider can await a connection or a file before
  its value is ready; everything that depends on it waits.
- **Fails before it starts.** `new Injector(App)` validates the whole module
  graph synchronously. A missing provider, a circular dependency or a missing
  decorator throws before a single instance is created.
- **No reflection, still type-checked.** Dependencies are listed explicitly: no
  `reflect-metadata`, no emitted types. The list is checked against the
  constructor at compile time, so a wrong order does not compile.
- **Modules with real boundaries.** A module sees what it declares and what its
  imports export, and nothing else.
- **Deterministic teardown.** `injector.dispose()` releases instances in reverse
  creation order through the standard `Symbol.asyncDispose` and
  `Symbol.dispose`.
- **Standard decorators.** Works with TC39 decorators, and with legacy
  (`experimentalDecorators`) and Bun decorators.

## Installation

```sh
deno add jsr:@chojs/core    # Deno
npx jsr add @chojs/core     # Node.js
bunx jsr add @chojs/core    # Bun
```

## At a glance

```ts
import { Injectable, Injector, Module, provider, token } from "@chojs/core";

const DB = token<Database>("DB");

@Injectable([DB])
class UserService {
  constructor(readonly db: Database) {}
}

@Module({
  providers: [
    provider({ provide: DB, factory: () => Database.connect("postgres://…") }),
    UserService,
  ],
  exports: [UserService],
})
class UsersModule {}

@Module({ imports: [UsersModule] })
class App {}

const injector = new Injector(App); // validates the graph, creates nothing
const users = await injector.resolve(UserService); // connects, then constructs
await injector.dispose(); // releases what was created
```

## Concepts

| Concept        | What it is                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| **Token**      | What identifies something injectable: a class, a `token<T>()`, or a symbol. Strings are not tokens.   |
| **Provider**   | How a token's value is created: an `@Injectable` class, or a `provider()` object with a factory.      |
| **Module**     | A group of providers and controllers. It injects what it declares and what its imports export.        |
| **Controller** | An entry point a CHO module invokes, such as a route handler or a command. Declared in `controllers`. |
| **Injector**   | Validates the graph of a root module, creates instances on demand, and disposes them.                 |

Three rules shape every application:

- **Singletons.** One instance per declaration and injector. Data that belongs
  to a request lives in the request's context, not in the container.
- **Every dependency is required.** A missing one is a wiring error, reported by
  `new Injector()`.
- **A module is a fixed declaration.** Configuration belongs to the creation of
  a value: a library ships classes, and the application declares the providers
  that construct them. A library that ships a module is given what it needs with
  [`configure`](#configuring-a-module), which makes a module of your own from
  it.

## Lifecycle

```ts
const injector = new Injector(App); // 1. validate, synchronously

await injector.init(); //               2. create everything now (optional)
const api = await injector.resolve(Api); // or create only what is asked for

await injector.dispose(); //            3. release, in reverse creation order
```

A class or a factory value takes part in teardown by implementing the standard
dispose methods; there is no CHO interface:

```ts
@Injectable()
class Db {
  async [Symbol.asyncDispose]() {
    await this.connection.close();
  }
}
```

The injector never disposes on its own. Whatever runs the application decides
when: `ChoWeb.close()`, `ChoCommand.close()` and `ChoMessage.close()` call it.

## Configuring a module

A module is a fixed declaration: it takes no parameters. A library that ships a
module leaves a placeholder for what it needs, and `configure` makes a module of
your own from it, with more imports and more providers:

```ts
import { configure, provider } from "@chojs/core";
import { MAIL_OPTIONS, MailModule } from "some-library";

export const Mail = configure(MailModule, {
  imports: [ConfigModule],
  providers: [
    provider({
      provide: MAIL_OPTIONS,
      deps: [Config],
      factory: (config) => ({ from: config.mailFrom }),
    }),
  ],
});

@Module({ imports: [Mail] })
class App {}
```

- **The module of the library does not change.** `configure` returns a new
  module, a class that extends it, with everything it has.
- **A provider you give for a token the module already provides replaces it.**
  That is the placeholder: a provider of the library that throws, or a default.
- **Your providers depend on what you give them**: on the imports you add, and
  on what the module declares.
- **Keep the result in a constant, and import that constant everywhere.** Each
  call makes one more module, with instances of its own, and the new module is
  not the one it was made from: a module that imports the original does not get
  yours.
- Only imports and providers: not controllers, exports or a route.

To write such a library, declare the placeholder as a provider whose factory
throws, with a message that says what to give:

```ts
provider({
  provide: MAIL_OPTIONS,
  factory: (): MailOptions => {
    throw new Error("give MAIL_OPTIONS to MailModule, with configure()");
  },
});
```

An application that forgot it does not start: creating the module fails, with
that message as the cause.

## Validators

A validator checks a value, and gives the value the application works with.
`@chojs/web` and `@chojs/message` take one for an argument of a handler, and
`@chojs/core` says what one is: a
[Standard Schema](https://standardschema.dev/), so the schemas of Zod, Valibot,
ArkType and many other libraries are validators as they are. An object with a
`parse` method that returns, or throws, is one too.

```ts
import { z } from "zod";
import type { ChoInput, ChoOutput, ChoValidator } from "@chojs/core";

const NewUser = z.object({ name: z.string(), age: z.number().default(18) });

const validator: ChoValidator = NewUser; // nothing to wrap
type User = ChoOutput<typeof NewUser>; // { name: string; age: number }
type Sent = ChoInput<typeof NewUser>; // { name: string; age?: number }
```

- **No library is depended on.** The interfaces of the specification are copied
  into the package, as the specification allows.
- **One shape for what is not valid.** Whatever the library, an issue is a
  `message` and a `path`.
- **A schema that throws is not a value that is not valid.** A Standard Schema
  reports issues in its result; what it throws is an error, like any other.

The [specification](./specs.md#5-validators) has the rules.

## Testing with overrides

Replace a provider anywhere in the module graph, without changing a module:

```ts
const injector = new Injector(App, {
  overrides: [provider({ provide: Db, factory: () => new FakeDb() })],
});
```

An override that replaces nothing is an error, so a stale test fails loudly.

## Writing a CHO module

A CHO module attaches metadata to controllers with its own decorators, then
reads it back through the injector. Keys are private `Symbol.for` symbols, so
they never collide with user options or other modules:

```ts
import {
  add_to_metadata_object,
  type ChoMethodDecorator,
  decorated_method,
  Injector,
} from "@chojs/core/di";

const ACTION: unique symbol = Symbol.for("chojs.my-module.action");

export function Action(name: string): ChoMethodDecorator {
  return (target, context, descriptor) => {
    const method = decorated_method("@Action()", target, context, descriptor);
    add_to_metadata_object(method.meta, { [ACTION]: name });
  };
}

const injector = new Injector(App);
for (const node of injector.controllers()) {
  for (const { name, meta, middlewares, errorHandler } of node.meta.methods) {
    if (meta[ACTION]) {
      const controller = await injector.resolve(node.token, node.owner);
      // … run the middlewares, call controller[name], handle errors
    }
  }
}
```

The core also provides what every CHO module needs around that loop: `compose`
runs a chain of middlewares, and `assert_handle` / `resolve_handle` accept
middlewares and error handlers written as injectable classes.

## Errors

Every mistake the framework finds is a `ChoError`: an `Error` with a `code`. The
code is stable: it is part of the API, where the message is for people and can
change in any release.

```ts
import { Injector, isChoError } from "@chojs/core";

try {
  new Injector(App);
} catch (error) {
  if (isChoError(error, "CHO_CORE_CIRCULAR_DEPENDENCY")) {
    // ...
  }
  throw error;
}
```

- Use `isChoError(error)` or `isChoError(error, code)`, and not `instanceof`:
  two versions of the package in one process have a class each.
- The codes of this package start with `CHO_CORE_` (type `ChoCoreErrorCode`).
  Each CHO module has codes of its own (`CHO_WEB_`, `CHO_COMMAND_`, …) and gives
  `ChoError` and `isChoError` again.
- An error that is not the framework's own (what a factory or a handler throws)
  is passed on as it is, or kept as the `cause` of a `ChoError`.

Every code is listed with its mistake in the
[specification](./specs.md#28-errors).

## Entry points

| Entry point                    | Contents                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------- |
| `@chojs/core`                  | The decorators, `Injector`, `token`, `provider`, `configure`; `ChoError`; the validator types     |
| `@chojs/core/di`               | Everything above, plus the metadata and decorator helpers for CHO modules, and the graph builders |
| `@chojs/core/utils`            | Runtime helpers: `env`, `set_env`, `engine`, `debuglog`, `compose`, `describe`                    |
| `@chojs/core/utils/test_utils` | Test helpers: apply decorators as function calls, capture console output                          |

## Runtime support

Deno, Node.js, Bun and Cloudflare Workers: the tests run on the four. The
package itself contains no decorator syntax and no runtime-specific API. On a
Worker, which has no `process`, give the environment with `set_env()` of
`@chojs/core/utils`. Debug logging is enabled with `CHO_DEBUG=1`, or per context
with `CHO_DEBUGLOG=cho:di`.

## Documentation

- [Specification](./specs.md): tokens, providers, module scope rules,
  controllers, instance creation and disposal, error messages, the public API
  and the internals.
- [Contributing](../CONTRIBUTING.md): the naming convention.

## License

[MIT](./LICENSE)
