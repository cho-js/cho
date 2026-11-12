# @chojs/core

The foundation of the CHO framework: an asynchronous dependency injection (DI)
system driven by decorators, plus the helpers CHO modules use to build on it.

This document describes what `@chojs/core` provides and how it behaves. The
source code is the reference: when this document and the code disagree, the code
wins. Known bugs and open questions are tracked in `core/issues.md`.

## 1. Who uses this package

`@chojs/core` is not meant to be consumed directly by application code. It is
consumed by **CHO modules**: packages such as `@chojs/command` (command-line
applications) and `@chojs/web` (HTTP applications) that turn a module graph into
a running application.

- **Applications** import everything from the CHO module they use. The CHO
  modules re-export the core decorators (`@Module`, `@Controller`,
  `@Injectable`, `@Catch`, and `@Middlewares` where it applies), so an
  application never needs `@chojs/core` itself.
- **CHO modules** use the core to:
  - create an `Injector` for the application's root module;
  - walk its controllers and read the metadata their own decorators attached
    (such as `@Action` or `@Get`);
  - resolve the controllers and call their methods.

```ts
// An application only sees the CHO module.
import { ChoCommand, Controller, Main, Module } from "@chojs/command";

// A CHO module builds on the core.
import { add_to_metadata_object, Injector } from "@chojs/core/di";
```

## 2. Dependency injection

### 2.1 Overview: asynchronous by default

An application is a graph of **modules**. Each module declares **providers**
(how to create values), **controllers** (the application's entry points), the
modules it **imports**, and what it **exports** to the modules that import it.

Using it takes two steps:

1. **`new Injector(RootModule)`** reads and validates the whole graph,
   synchronously. Every wiring mistake (a missing provider, a circular
   dependency, a class without its decorator, …) throws here, before anything is
   created.
2. **`init()` / `resolve()`** create the instances, asynchronously.

Every value is created by a factory that can be **async**, classes included: a
factory returns the value or a promise of it, and the injector always awaits it.
A provider can therefore do asynchronous work before its value is ready, such as
opening a connection or reading a file, and everything that depends on it simply
waits for it:

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
      factory: async () => await Database.connect("postgres://…"), // async init
    }),
    UserService,
  ],
})
class App {}

const injector = new Injector(App); // validates the graph, creates nothing
const users = await injector.resolve(UserService); // connects, then constructs
```

Each declaration is created **at most once per injector** and shared by
everything that depends on it. Two injectors share nothing.

### 2.2 Tokens

A token identifies something injectable:

| Token                        | Resolves to       | Example                    |
| ---------------------------- | ----------------- | -------------------------- |
| A class (abstract included)  | an instance of it | `Logger`                   |
| An injection token `token()` | `T`               | `token<string>("API_URL")` |
| A symbol                     | `unknown`         | `Symbol("cache")`          |

- `token<T>(description)` creates a unique token. Two tokens with the same
  description are different tokens. In error messages it reads
  `InjectionToken(<description>)`.
- Strings are not tokens: different packages could pick the same string. The
  decorators reject them.
- `isToken(value)` tells whether a value is a token. It recognizes injection
  tokens created by another copy of the package too.

### 2.3 Providers

A provider says how to create the value of a token. There are two kinds:

- **An `@Injectable` class.** Its token is the class; its value is an instance,
  created with the listed dependencies as constructor arguments, in order.

  ```ts
  @Injectable([Logger, PORT])
  class Server {
    constructor(logger: Logger, port: number) {}
  }
  ```

- **A provider object**, built with `provider()`: a token, the dependencies, and
  a factory (sync or async) that receives their values, in order. The factory's
  argument types are inferred from `deps`, and its result must match the token's
  type.

  ```ts
  const API_URL = token<string>("API_URL");

  provider({
    provide: API_URL,
    deps: [Config],
    factory: async (config) => config.apiUrl, // config: Config
  });
  ```

Every dependency is required: there are no optional dependencies.

**The dependencies are checked against the constructor, at compile time.**
`@Injectable`, `@Module` and `@Controller` only accept a class whose constructor
can be called with the values of the listed dependencies, in order:

```ts
@Injectable([PORT, Logger]) // compile error: the constructor wants (Logger, number)
class Server {
  constructor(logger: Logger, port: number) {}
}
```

- Checked: the value type of each dependency against the parameter at its
  position, and that every required parameter has a dependency. A class may take
  fewer parameters than there are dependencies.
- The check needs the list as written in the decorator. A list typed
  `Dependency[]` (kept in a variable, built elsewhere) is not checked.
- A symbol token has no value type, so it can be received as any type.
- TypeScript compares types by structure: a class with no members accepts any
  value, so the check is only as precise as the types are.

### 2.4 Modules

```ts
@Module({
  imports: [DbModule], // modules whose exports this module can inject
  providers: [UserService], // @Injectable classes and provider objects
  controllers: [UsersController], // @Controller classes
  exports: [UserService], // tokens importers can inject
  dependencies: [Config], // the module class's own constructor arguments
})
class UsersModule {}
```

Every option defaults to `[]`.

**The option types are closed.** An option that is not listed is a compile
error, so a typo (`provider` for `providers`, `deps` for `dependencies`) cannot
pass as an option nobody reads. A CHO module that has options of its own
declares them with the type parameter of `@Module` and `@Controller`, and
exports decorators typed with it; `assert_known_options` gives it the same check
at runtime:

```ts
// in @chojs/web
type RouteOption = { route?: string };

export function Controller<const D extends readonly Dependency[] = []>(
  options: WithDependencies<Partial<ControllerOptions>, D> & RouteOption = {},
): ChoInjectableDecorator<D> {
  assert_known_options("@Controller()", options, ["dependencies", "route"]);
  return CoreController<RouteOption, D>(options);
}
```

The second type parameter, `D`, carries the dependencies as a tuple, so the
constructor check (section 2.3) still applies through the CHO module's
decorator.

Such extra options are stored as is; the DI system ignores them, whatever their
names, and hands them back apart from its own fields, as `options` (section
4.1). It stores its own data under private keys, so no option can change what a
class is or what it declares.

**Modules are not configured.** A module is a fixed declaration: it takes no
parameters, and it never sees the providers of the modules that import it
(below), so an importer cannot pass it configuration. What needs configuration
is a value, and a value is created by a provider. A reusable package therefore
ships classes, and the application declares the providers that construct them
with its own configuration:

```ts
// a library: a class, no module
export class HttpClient {
  constructor(readonly url: string) {}
}

// the application: one provider per configured client
const USERS = token<HttpClient>("USERS");
const BILLING = token<HttpClient>("BILLING");

@Module({
  providers: [
    Config,
    provider({
      provide: USERS,
      deps: [Config],
      factory: (config) => new HttpClient(config.usersUrl),
    }),
    provider({
      provide: BILLING,
      deps: [Config],
      factory: (config) => new HttpClient(config.billingUrl),
    }),
  ],
  exports: [USERS, BILLING],
})
class ClientsModule {}
```

**Scope rules.** These decide which token a module can inject:

- A module sees what it declares (its providers, its controllers and itself),
  plus what its **direct** imports **export**. What an import does not export
  stays private to it, and an import's own imports are visible only if it
  re-exports their tokens.
- A token a module declares **shadows** the same token exported by an import.
  This is how a module overrides an imported provider.
- Dependencies are always resolved in the scope of the module that **declares**
  the provider, never in an importer's scope. Overriding a token in an importer
  does not change what an imported provider receives.
- A module never sees the providers of the modules that import it.
- A module can export any token in its scope: one it declares (itself and its
  controllers included) or one it imports (a re-export). Exporting a whole
  imported module is not supported: export its tokens instead.
- If two imports export **different** instances of the same token, the token is
  ambiguous. Injecting or exporting it throws, and `resolve()` rejects with the
  same message; declaring the token in the module itself settles it. Two imports
  that re-export the **same** instance are not ambiguous.

```ts
@Module({ providers: [DbConn], exports: [DbConn] })
class Db {}

@Module({ imports: [Db], providers: [UserService], exports: [UserService] })
class Users {} // UserService can inject DbConn

@Module({ imports: [Users], providers: [Api] })
class App {} // Api can inject UserService, but not DbConn: Users doesn't export it
```

**Instances are per declaration.** The same class declared in two modules is two
declarations, so two instances. A module imported through several paths is one
module, with one set of instances.

**A module is injectable itself.** Its class is created with its `dependencies`,
resolved in its own scope, so a module can depend on its own providers and run
setup code in its constructor.

### 2.5 Controllers

A controller is an entry point that a CHO module invokes, such as a CLI command
handler or an HTTP route handler. It is declared in `controllers`, not in
`providers`:

```ts
@Controller({ dependencies: [UserService] })
class UsersController {
  constructor(readonly users: UserService) {}
}

@Module({ providers: [UserService], controllers: [UsersController] })
class App {}
```

- It is created like any other declaration, with its `dependencies` resolved in
  the scope of the module that declares it.
- Its only option is `dependencies`; a CHO module can add its own (for example
  `{ route: "users" }` for `@chojs/web`), handed back as `options` (section
  2.4).
- CHO modules attach metadata to the controller's methods with their own
  decorators. The core collects it, for the controller's string-named methods
  that have any, and hands it to the CHO module as `methods`, with each method's
  middlewares and error handler.
- Method metadata follows the method: a controller gets the metadata of the
  methods it **inherits** (parents first; a subclass that decorates a method
  again replaces its parent's metadata for it), and a decorator that replaces
  the method function does not lose it.

### 2.6 Middlewares and error handlers

`@Middlewares(...fns)` and `@Catch(handler)` decorate a class or a method. They
can be combined with the DI decorators. The core only stores them, and hands
them to the CHO module as the `middlewares` and `errorHandler` fields of the
module, controller or method metadata. The CHO module that runs the class or
method decides how and when to call them.

- `@Middlewares` can be applied several times. The middlewares are kept in
  source order: top decorator first, and within one decorator, argument order.
  Each one must be a function (a middleware function or a class).
- `@Catch` takes a function or a class. A class or method has at most one. By
  convention, a handler is called **error first**: a function as
  `(error, ctx?)`, a class through its `handle(error, ctx?)` method, where `ctx`
  is whatever the CHO module passes (the parsed args for `@chojs/command`, the
  request context for `@chojs/web`).
- The core types, `ChoMiddleware` and `ChoErrorHandler`, are "any function or
  class": each CHO module declares the precise type of what it runs
  (`ChoWebMiddleware` and `ChoWebErrorHandler` in `@chojs/web`) and exports
  decorators typed with it.

```ts
@Middlewares(auth)
@Catch((error) => 2)
@Controller()
class Files {
  @Middlewares(timing)
  @Action("copy")
  copy() {}
}
```

### 2.7 Creating instances

```ts
const injector = new Injector(App);
await injector.init(); // optional: create everything now
const users = await injector.resolve(UserService); // from the root module's scope
const cli = await injector.resolve(Cli, CliModule); // from CliModule's scope
```

- **`resolve(token, module?)`** returns the value of a token, as the given
  module sees it (the root module by default). It creates only what the token
  needs: the declaration and its dependencies. The value type is inferred from
  the token.
- **`init()`** creates every declaration of every module, used or not. A module
  is created after the modules it imports; independent work runs in parallel.
  Calling `init()` at startup surfaces every factory error early. It is not
  required before `resolve()`, and calling it again creates nothing twice.
- Concurrent and repeated requests for the same declaration share one creation
  and one instance.

**Failures.** When a factory or constructor throws or rejects, the request
rejects with `Failed to create X in module M`, with the original error as
`cause`. Everything that depends on it rejects with that same error, which names
the declaration that actually failed. **There is no retry:** the failure is
remembered, and every later request gets the same error. An application that
must not run half-created calls `init()` at startup and stops if it rejects
(`@chojs/web` does).

**Releasing instances.** `dispose()` releases what the injector created:

```ts
@Injectable()
class Db {
  async [Symbol.asyncDispose]() {
    await this.connection.close();
  }
}

const injector = new Injector(App);
try {
  await injector.init();
  // … run the application
} finally {
  await injector.dispose();
}
```

- It waits for the creations in flight, then goes through the created values in
  **reverse creation order**: a value is disposed before what it depends on.
- A value is disposed by its own `[Symbol.asyncDispose]()` or, without one,
  `[Symbol.dispose]()`: the standard methods of explicit resource management
  (`using`), so there is no CHO interface to implement. It applies to every
  created value: classes, modules, controllers, and what provider factories
  return. A value with neither method is skipped, and a value provided under
  several tokens is disposed once.
- One failure does not stop the others: `dispose()` then rejects with an
  `AggregateError` holding one `Failed to dispose X in module M` per failure.
- Afterwards `resolve()` and `init()` reject with `The injector is disposed`.
  Calling `dispose()` again returns the same disposal. `await using` works too.

**The injector never disposes on its own.** When an application ends is not its
decision: whatever runs the application calls `dispose()`. The CHO modules do it
in their `close()` (`ChoWeb.close()`, `ChoCommand.close()`).

**Overrides, for tests.** `new Injector(App, { overrides })` replaces declared
providers, wherever they are in the module graph, without changing any module:

```ts
const injector = new Injector(App, {
  overrides: [provider({ provide: Db, factory: () => new FakeDb() })],
});
```

- An override replaces the `providers` entries of its token (a class or a
  provider object), in every module that declares one. Controllers and modules
  cannot be overridden.
- Its `deps` resolve in the scope of the module that declares the provider it
  replaces, like any provider.
- An override that replaces nothing is an error, so a stale test fails loudly.

**Design positions.** These are decisions, not gaps:

- **Singletons only.** A declaration has one instance per injector. Data that
  belongs to a request lives in the request's context (the `state` of
  `@chojs/web`'s context), not in the DI. A value that must be new each time is
  made by a factory function: provide the function, and call it.
- **Every dependency is required.** An application does not start with a missing
  dependency: it is a wiring error, thrown by `new Injector()`. For something
  that may be absent, provide a default.
- **A failed creation stops the application.** It is not retried. Create
  everything at startup with `init()` and stop if it rejects, unless creating
  lazily is the point (a command-line application, where `--help` must not need
  the database).
- **Modules are not configured** (section 2.4).

### 2.8 Errors

Values are named in messages by class name (`<anonymous>` for an anonymous
class), quoted string, `InjectionToken(<description>)` or
`Symbol(<description>)`. `<v>` below is a short description of the bad value
(`array(3)`, `{ a, b }`, …).

**Thrown by the decorators**, when the class is defined:

| Mistake                                | Message                                                                                                                |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| A second DI decorator on a class       | `class is already decorated with @Injectable, @Module or @Controller`                                                  |
| A list option is not an array          | `<option> must be an array, got <v>` (`dependencies`, `imports`, `controllers`, `exports`, `providers`, `middlewares`) |
| A dependency is not a token            | `all dependencies must be classes, symbols or injection tokens: <v>`                                                   |
| An import is not a class               | `all imports must be classes: <v>`                                                                                     |
| A controller is not a class            | `all controllers must be classes: <v>`                                                                                 |
| An export is not a token               | `all exports must be classes, symbols or injection tokens: <v>`                                                        |
| A provider object is malformed         | `provider <name> …` (see below)                                                                                        |
| A middleware is not a function         | `all middlewares must be functions: <v>`                                                                               |
| An error handler is not a function     | `the error handler must be a function or a class: <v>`                                                                 |
| A second `@Catch` on a class or method | `an error handler is already set (one @Catch per target)`                                                              |

A malformed provider object gives one of these messages, checked in this order.
`<name>` is `for X` once `provide` is a valid token, otherwise `<v>`:

- `provider <name> is not an object`
- `provider <name> is missing the "provide" property`
- `provider <name>: "provide" must be a class, symbol or injection token, got <v>`
- `provider <name> is missing the "factory" property`
- `provider <name>: "factory" must be a function, got <v>`
- `provider <name>: "deps" must be an array, got <v>`
- `provider <name>: all deps must be classes, symbols or injection tokens: <v>`

**Thrown by `new Injector()`**, before anything is created:

| Mistake                             | Message                                                                                                               |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| The root is not a class             | `TypeError: Expected a module class, got <typeof>`                                                                    |
| Circular imports                    | `Circular dependency detected: A → B → A`                                                                             |
| An import is not a `@Module`        | `Class X is not a module. Did you forget @Module?`                                                                    |
| A provider is not `@Injectable`     | `Class X is not injectable. Did you forget @Injectable?`                                                              |
| A controller is not a `@Controller` | `Class X is not a controller. Did you forget @Controller?`                                                            |
| A token declared twice              | `X is declared more than once in module M (as <kind> and as <kind>). Declare each token once.`                        |
| An ambiguous token is used          | `X is ambiguous in module M: A, B export different instances of it. Provide X in M to choose which one to use.`       |
| A module re-exported                | `Module M exports the imported module X. Re-exporting a module is not supported; export the tokens you need instead.` |
| An export not in scope              | `Module M exports X, which it neither provides nor imports.`                                                          |
| A missing dependency                | `Cannot resolve X (argument #i) of Y in module M. Provide it there or import a module that exports it.`               |
| Circular dependencies               | `Circular dependency detected in module M: A → B → A`                                                                 |

`<kind>` is `a provider`, `a controller` or `the module itself`; `#i` counts
from zero.

**Rejected by `resolve()` and `init()`:**

| Problem                            | Message                                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| The module is not in the graph     | `M is not part of this application`                                                                             |
| The token is not in module's scope | `X is not visible in module M`                                                                                  |
| The token is ambiguous there       | `X is ambiguous in module M: A, B export different instances of it. Provide X in M to choose which one to use.` |
| A factory or constructor failed    | `Failed to create X in module M`, with `cause`                                                                  |
| The injector is disposed           | `The injector is disposed`                                                                                      |

**Thrown by `new Injector(root, { overrides })`:**

- `An override must be a provider object, built with provider()`
- `X is overridden more than once`
- `Cannot override X: no module of the application provides it`

**Rejected by `dispose()`:** an `AggregateError`,
`Failed to dispose N of the injector's instances`, whose `errors` are
`Failed to dispose X in module M`, each with its `cause`.

### 2.9 Debug logging

The injector logs what it does to the `cho:di` debug context, on stderr. It is
off by default; enable it with `CHO_DEBUG=1` (every context),
`CHO_DEBUGLOG=cho:di` or `CHO_DEBUGLOG=cho:*`:

```
12:00:00.001 cho:di module Db: 3 declarations
12:00:00.001 cho:di module App: 3 declarations, imports Db
12:00:00.002 cho:di graph of App built: 2 modules +1ms
12:00:00.002 cho:di resolve Users in module App
12:00:00.003 cho:di created Logger in module Db +0ms
12:00:00.003 cho:di created Users in module App +1ms
12:00:00.004 cho:di ERROR failed to create Broken in module App: Error: no config
```

It logs the modules of the graph once it is built (or the error when it is
invalid), each `resolve()` call and each failed lookup, each declaration it
creates with the time its factory took, each module `init()` finishes, and each
failing factory with the original error. Each injector reads the environment
when it is created, so `set_env` (section 3.3) must be called before.

## 3. Public API

`@chojs/core` has four entry points. Applications use none of them directly
(section 1).

### 3.1 `@chojs/core`

The DI essentials:

- decorators: `Injectable`, `Module`, `Controller`, `Middlewares`, `Catch`;
- `Injector`, `token`, `provider`;
- types: `ModuleOptions`, `ControllerOptions`, `Dependency`, `Ctr`, `Target`,
  `Any`, and the graph types `MetadataGraph`, `DependencyGraph`,
  `DependencyNode`, `ModuleScope`.

### 3.2 `@chojs/core/di`

Everything in `@chojs/core`, plus what CHO module authors need to write their
own decorators and read them back:

| Export                                                                                     | Use                                                                                                                                                   |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read_metadata_object`, `write_metadata_object`, `add_to_metadata_object`                  | Read and write the CHO record of a class or a method (section 4.1).                                                                                   |
| `method_metadata`, `read_method_metadata`, `method_records`                                | Where a method's record is stored, and reading the records of a class's methods (section 4.1).                                                        |
| `assert_known_options`, `ExtraOptions`, `NoExtraOptions`                                   | For a CHO module's own `@Module` / `@Controller`: its extra options, and rejecting unknown ones (section 2.4).                                        |
| `decorated_method`, `decorated_target`                                                     | Find what a decorator was applied to, in both decorator call shapes (TC39 and legacy/Bun).                                                            |
| `set_injectable`, `set_module`, `set_controller`, `set_middlewares`, `set_error_handler`   | What the core decorators do, for decorators that wrap them.                                                                                           |
| `isToken`                                                                                  | Whether a value is a token.                                                                                                                           |
| `ChoClassDecorator`, `ChoMethodDecorator`, `ChoClassOrMethodDecorator`                     | Decorator types that accept both call shapes.                                                                                                         |
| `ChoInjectableDecorator`, `InjectedArgs`, `WithDependencies`                               | The type of the DI decorators, which checks the dependencies against the constructor; for a CHO module's own `@Module` / `@Controller` (section 2.4). |
| `Token`, `InjectionToken`, `Provider`, `Factory`, `Resolved`, `ResolvedAll`, `AbstractCtr` | Token and provider types.                                                                                                                             |
| `ChoMiddleware`, `ChoErrorHandler`                                                         | What `@Middlewares` and `@Catch` store: any function or class.                                                                                        |
| `InjectableOptions`, `DecoratedMethod`, `MetaTarget`, the `*Metadata` types                | Option, record and graph types.                                                                                                                       |

Every decorator must accept both call shapes: TC39 `(value, context)`, and
legacy / Bun `(prototype, name, descriptor)`. A typical method decorator of a
CHO module, and how the CHO module reads it back:

```ts
import {
  add_to_metadata_object,
  type ChoMethodDecorator,
  decorated_method,
  Injector,
} from "@chojs/core/di";

// The CHO module's own, private key (see section 4.1).
const ACTION: unique symbol = Symbol.for("chojs.my-module.action");

export function Action(name: string): ChoMethodDecorator {
  return (target, context, descriptor) => {
    const method = decorated_method("@Action()", target, context, descriptor);
    add_to_metadata_object(method.meta, { [ACTION]: name });
  };
}

// later, in the CHO module
const injector = new Injector(App);
for (const node of injector.controllers()) {
  for (const { name, meta, middlewares, errorHandler } of node.meta.methods) {
    if (meta[ACTION]) {
      const ctrl = await injector.resolve(node.token, node.owner);
      // … run the middlewares, call ctrl[name], hand errors to errorHandler
    }
  }
}
```

For this, the `Injector` also exposes:

- `controllers()`: every controller of the application, once each: its class
  (`token`), the module that declares it (`owner`), and its metadata (`meta`):
  its options, its `middlewares` and `errorHandler`, and its `methods`;
- `modules()`: every module, once each, imported modules before the modules that
  import them, the root last;
- `graph` and `meta`: the dependency graph and the metadata graph (section 4);
- `dispose()`: releases the instances; a CHO module calls it from its own
  `close()` (section 2.7).

### 3.3 `@chojs/core/utils`

Runtime helpers that work on every runtime:

- `env(key)`, `env_bool(key)`, `env_num(key)`: read an environment variable
  (`undefined`, `false` or `NaN` when it is missing or cannot be read).
  `env_bool` accepts `1`, `true`, `yes` and `on`, in any case. Variables come
  from the source given to `set_env`, then from `process.env`.
- `set_env(source)`: give the environment to read first, as a record (such as a
  Cloudflare Workers `env`) or a function; only string values count. It applies
  to the whole program, and is needed on runtimes without `process`. Call it at
  startup: `debuglog()` reads the environment when a logger is created.
- `engine()`: the runtime the code runs on: `"deno"`, `"node"`, `"bun"`,
  `"workerd"` (Cloudflare Workers), `"edge"` (edge runtimes, such as Vercel Edge
  Functions) or `"unknown"` (type `EngineType`).
- `debuglog(context)`: a logger to stderr for one context, enabled by
  `CHO_DEBUG=1` (every context) or `CHO_DEBUGLOG=ctx1,prefix*`. When disabled it
  does nothing. It has `.error()`, `.start()` (returns a logger that adds the
  elapsed time) and `.enabled`.
- `describe(value)`: a readable name for error messages.
- `isClass(value)`, `isClassImplement(value, method)`: whether a value is a
  class, and whether its prototype has a given method.

### 3.4 `@chojs/core/utils/test_utils`

Helpers for the tests of CHO packages, which must not use decorator syntax so
that they run on Node: `legacy()` and `tc39()` apply a method decorator in each
call shape, `method_context()` builds a TC39 method context, `capture()` records
what a function writes to `console.log` and `console.error`, and `loose()`
bypasses parameter types.

## 4. Internals

### 4.1 Metadata

Decorators only declare: each writes one record on the class (or the method) and
creates nothing.

- The record is stored on the class's own `Symbol.metadata` object (the TC39
  decorator metadata; `Symbol.for("Symbol.metadata")` where the runtime has
  none), under the key `Symbol.for("chojs.meta")`, so every copy of the package
  shares it. With TC39 decorators it is written to `context.metadata`; with
  legacy or Bun decorators, to the class itself.
- Class records are **own-only**: a subclass never sees its parent's record, and
  can be decorated on its own.
- **Method records are stored with the class**, by method name, in a method
  table next to the class's record (`Symbol.for("chojs.meta.methods")`), not on
  the method function. `decorated_method` gives a decorator where to write
  (`.meta`). Reading a class's methods (`method_records`) walks its prototype
  chain, parents first, so inherited methods keep their records. Where a
  decorator cannot reach the class (a static or private method, or TC39
  decorators compiled for a runtime without `Symbol.metadata`), the record is
  written on the function, and read from there too.
- **Records are versioned.** Every copy of the package in an application shares
  the records, so each record is stamped with the format it was written in
  (`METADATA_FORMAT`, under `Symbol.for("chojs.meta.format")`). Reading or
  extending a record of another format throws
  `The CHO metadata of X was written in format N, but this copy of @chojs/core
  reads format M. Two incompatible versions of @chojs/core are loaded: use one
  version.`
  The format number increases with any change another version would misread.
- Records are frozen and replaced on every write, never mutated.
  `add_to_metadata_object` merges into the existing record: arrays are
  concatenated, any other value replaces the previous one.
- **Keys.** Everything the framework writes is stored under symbol keys,
  `Symbol.for("chojs.<package>.<key>")`, private to the package that writes them
  (core's are in `di/keys.ts`; command and web have their own). User options are
  stored next to them under their own string keys, so the two can never collide.
  `Symbol.for` keeps the keys shared across copies of a package, like the record
  itself.
- The DI decorators validate their own arguments and write the injectable flag
  and the dependencies, plus the module flag and lists, or the controller flag,
  and any extra options.
- CHO modules never read core's keys: the metadata graph (section 4.2) exposes
  the same data as plain, typed fields. Every other key of a class's record (the
  extra options, and CHO modules' own keys) is passed on as it is, apart from
  those fields, as `options`; every other key of a method's record, as the
  method's `meta`.

### 4.2 Dependency graph

`new Injector(root)` builds two graphs, synchronously:

1. **The metadata graph** (`injector.meta`). Starting from the root, it reads
   every module's record, following imports, and checks that each class has the
   right decorator. Every declaration becomes a provider: a provider object as
   is, a class as a provider whose factory constructs it. Controller method
   metadata is collected here. Modules are listed imported-first, the root last;
   a module imported through several paths appears once.
2. **The dependency graph** (`injector.graph`). One `ModuleScope` per module,
   with a `visible` table of every token the module can inject (section 2.4) and
   an `ambiguous` table of the tokens two imports export as different instances,
   and one `DependencyNode` per declaration, holding its token, its owner module
   and the nodes of its dependencies, in argument order. Modules are linked
   imported-first, so the checks of section 2.8 run module by module.

After this step, every dependency is linked to the node that provides it:
creating an instance needs no lookup.

### 4.3 Injector

- Each node's creation is a promise, stored per injector **before** anything is
  awaited. This is what makes concurrent requests share one instance, and what
  makes a failure permanent.
- A node first awaits its dependencies (in parallel), then calls its factory
  with their values.
- `init()` initializes a module after its imports (sibling imports in parallel),
  then creates the nodes the module owns, in parallel. Each module's
  initialization is stored too, so it runs once.
- A failing factory is wrapped once, where it fails; dependents pass that error
  on unchanged.
- Each created value is recorded with its node when its factory returns, so the
  record is in dependency order; `dispose()` walks it backwards.
- Overrides are applied when the metadata graph is read: a `providers` entry
  whose token has an override is normalized from the override instead.
