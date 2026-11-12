# @chojs/core

[![JSR](https://jsr.io/badges/@chojs/core)](https://jsr.io/@chojs/core)

The foundation of the [CHO](../README.md) framework: an asynchronous dependency
injection system driven by decorators, plus the helpers CHO modules build on.

> **Building an application?** Use a CHO module instead:
> [`@chojs/command`](../command/README.md) for command-line applications or
> [`@chojs/web`](../web/README.md) for HTTP applications. They re-export the
> decorators you need, so applications never import `@chojs/core` directly. This
> package is for authors of CHO modules.

## Features

- **Async by default.** Every value is created by an async factory, so a
  provider can connect to a database or read a file before it is ready, and
  everything that depends on it waits.
- **Releases what it created.** `injector.dispose()` disposes instances in
  reverse creation order, through the standard `Symbol.asyncDispose` /
  `Symbol.dispose` methods. The injector never decides when: the application, or
  the CHO module that runs it, does.
- **Testable.** `new Injector(App, { overrides })` swaps a provider for a fake,
  anywhere in the module graph.
- **Singletons, by design.** One instance per declaration and injector. Request
  data belongs to the request's context, every dependency is required, and
  modules are not configured: providers are.
- **Fails early.** `new Injector(App)` checks the whole module graph
  synchronously: a missing provider, a circular dependency or a missing
  decorator throws before anything is created.
- **Modules with real boundaries.** A module sees what it declares and what its
  imports export, and nothing else.
- **Every runtime.** Deno, Node.js and Bun, with TC39 decorators as well as
  legacy (`experimentalDecorators`) and Bun decorators.
- **No reflection, still type-checked.** Dependencies are declared explicitly;
  no `reflect-metadata`, no emitted types. The list is checked against the
  constructor at compile time: a wrong order or a missing dependency does not
  compile.

## Install

```sh
deno add jsr:@chojs/core    # Deno
npx jsr add @chojs/core     # Node.js
bunx jsr add @chojs/core    # Bun
```

## Example

```ts
import { Injectable, Injector, Module, provider, token } from "@chojs/core";

const DB = token<Database>("DB");

@Injectable([DB])
class UserService {
  constructor(readonly db: Database) {}
}

@Module({
  providers: [
    provider({
      provide: DB,
      factory: async () => await Database.connect("postgres://…"),
    }),
    UserService,
  ],
  exports: [UserService],
})
class UsersModule {}

@Module({ imports: [UsersModule] })
class App {}

const injector = new Injector(App); // checks the graph, creates nothing
const users = await injector.resolve(UserService); // connects, then constructs
```

## Writing a CHO module

A CHO module attaches its own metadata to controllers with its decorators, then
reads it back through the injector. Use a private `Symbol.for` key, so it can
never collide with user options or other modules:

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

## Entry points

| Entry point                    | For                                                                      |
| ------------------------------ | ------------------------------------------------------------------------ |
| `@chojs/core`                  | the DI essentials: decorators, `Injector`, `token`, `provider`           |
| `@chojs/core/di`               | everything above, plus the metadata helpers for CHO module authors       |
| `@chojs/core/utils`            | runtime helpers: `env`, `set_env`, `engine`, `debuglog`, `describe`, …   |
| `@chojs/core/utils/test_utils` | test helpers for CHO packages: apply decorators without decorator syntax |

## Documentation

- [Specification](./specs.md): modules, scope rules, providers, controllers,
  instance creation, error messages and the public API.
- [Known issues](./issues.md).
