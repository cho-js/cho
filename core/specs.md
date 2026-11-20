# @chojs/core

The foundation of the CHO framework: an asynchronous dependency injection (DI)
system driven by decorators, plus the helpers CHO modules use to build on it.

This document describes what `@chojs/core` provides and how it behaves. The
source code is the reference: when this document and the code disagree, the code
wins.

## 1. Who uses this package

`@chojs/core` is not meant to be consumed directly by application code. It is
consumed by **CHO modules**: packages such as `@chojs/command` (command-line
applications) and `@chojs/web` (HTTP applications) that turn a module graph into
a running application.

- **Applications** import everything from the CHO module they use. Each CHO
  module exports the DI decorators (`@Module`, `@Controller`, `@Injectable`),
  its own typed `@Middlewares` and `@Catch`, and `token` and `provider`, so an
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
- `is_token(value)` tells whether a value is a token. It recognizes injection
  tokens created by another copy of the package too.

### 2.3 Providers

A provider says how to create the value of a token. There are two kinds:

- **An `@Injectable` class.** Its token is the class; its value is an instance,
  created with the listed dependencies as constructor arguments, in order. A
  `@Controller` or a `@Module` class is not a provider: it goes in `controllers`
  or `imports`, and is rejected in `providers`.

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

**A module is a fixed declaration.** It takes no parameters, and it never sees
the providers of the modules that import it (below): an importer cannot reach
into it. What needs configuration is a value, and a value is created by a
provider. There are two ways to give a module of a library what it needs.

**Without a module.** A reusable package that needs nothing else ships classes,
and the application declares the providers that construct them with its own
configuration:

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

**With `configure`.** A package that ships a module (it has controllers, or
providers of its own that an application should not have to list) leaves a
placeholder for what it needs, and the application makes its own module from it:

```ts
// a library: a module with a placeholder for its settings
export const MAIL_OPTIONS = token<MailOptions>("MAIL_OPTIONS");

@Module({
  providers: [
    provider({
      provide: MAIL_OPTIONS,
      factory: (): MailOptions => {
        throw new Error("give MAIL_OPTIONS to MailModule, with configure()");
      },
    }),
    Mailer,
  ],
  controllers: [MailController],
  exports: [Mailer],
})
export class MailModule {}

// the application: one constant, imported everywhere
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

`configure(module, { imports?, providers?, name? })` returns a **new module**: a
class that extends the one it is given, with a record of its own. The module
that is given does not change.

- **The new module has everything the module has**: its providers, controllers
  and exports, its `dependencies`, its extra options (a `route`, a `topic`), its
  middlewares and its error handler. What is given comes after: the imports
  after its imports, the providers after its providers. An import the module
  already has is not added again.
- **A provider given for a token the module already provides replaces it**: the
  provider of the module is left out of the new one, so a placeholder never
  runs. Two providers given for one token are still a mistake
  (`CHO_CORE_DUPLICATE_TOKEN`).
- **The providers given are declared by the new module**: their dependencies
  resolve in its scope, so they see what the module declares and what it
  imports, the imports given included. They are private to the module, unless it
  exports their token.
- **Only imports and providers.** Not controllers, not exports, and not the
  extra options: `configure` is for what a module needs to be given, and the
  imports are there to supply what the providers given depend on.
- **`name`** is the name of the new class, for logs and errors. By default it is
  the name of the module it is made from. An application that configures one
  module twice names each, so that an error tells them apart.

**Each call makes one more module, with instances of its own.** This follows
from "instances are per declaration" (below), and it is the thing to know about
`configure`:

- two calls are two modules, also with the same settings;
- the new module and the one it is made from are two modules: a module that
  imports the original does not get the configured one, and one that imports
  both has two sets of instances, and an ambiguous token
  (`CHO_CORE_AMBIGUOUS_TOKEN`) for what both export.

So the result of `configure` is kept in a constant, and that constant is what
every module imports. A module that others must import as it is, such as one
whose service they register themselves with, is not one to configure: it takes
its settings another way, or needs none.

**`configure` and `overrides`.** Both put a provider in the place of another
one. `overrides` (section 2.7) replaces a provider of an application that is
already declared, wherever it is, and its dependencies resolve where the
provider was declared: it is for tests. `configure` makes a module, in the
declaration of the application, and its providers depend on what the application
gives it: it is for settings.

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
  methods it **inherits** (parents first), and a decorator that replaces the
  method function does not lose it.
- A subclass that decorates a method it inherits **adds to** its parent's
  metadata: lists (the middlewares) are concatenated, the parent's first, and
  any other value of the subclass replaces the parent's. An override that only
  adds a middleware keeps the route or the command its parent declared; one that
  declares it again replaces it; one without a decorator inherits everything.

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
  is whatever the CHO module passes: the context of the run for `@chojs/command`
  (`ChoCommandContext`), the context of the request for `@chojs/web`
  (`ChoWebContext`).
- Both decorate a class, or a method whose metadata is read: a public,
  non-static method with a string name. On any other method they throw, since
  nothing would ever run them.
- A middleware or an error handler given as a **class** is a class with a
  `handle` method, created by the injector so that it can have dependencies. The
  core has the helpers CHO modules share for them (`assert_handle`,
  `resolve_handle`), so every CHO module accepts the same values and reports the
  same mistakes.
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
- Disposal is final. Afterwards `resolve()` and `init()` reject with
  `The injector is disposed`, and an `init()` that was still running creates
  nothing more: what it had not started is not started. Calling `dispose()`
  again returns the same disposal. `await using` works too.

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
- **A module is a fixed declaration** (section 2.4). It has no parameters, and
  nothing writes to it from outside: `configure` makes another module from it.

### 2.8 Errors

**An error of the framework is a `ChoError`: an `Error` with a `code`.** The
code says which mistake it is, and it is part of the API:

- a code is not renamed, and not used again for another mistake;
- removing a code is a breaking change; adding one is not;
- **one code is one mistake**, not one `throw`: the same mistake found in two
  places has one code, and two messages with one fix can share one.

```ts
import { isChoError } from "@chojs/core";

try {
  new Injector(App);
} catch (error) {
  if (isChoError(error, "CHO_CORE_CIRCULAR_DEPENDENCY")) {
    // ...
  }
  throw error;
}
```

**Error messages are for people, not for code.** The messages listed here
describe the current wording: they are not part of the API, and can be reworded
in any release. Do not match on their text. What is stable is the code, when an
error happens (which mistake, at which step) and, where it is documented, its
`cause`.

A code starts with the package that throws: `CHO_CORE_` here. A mistake the core
finds for another package has a code of the core: an unknown option of
`@Controller()` is `CHO_CORE_UNKNOWN_OPTION` in a `@chojs/web` application too.

**What has no code.** An error that is not the framework's own is never turned
into a `ChoError`: what a factory, a handler, a middleware or a validator throws
is passed on as it is, or kept as the `cause` of a `ChoError`. `dispose()`
rejects with a native `AggregateError`, whose `errors` are `ChoError`s.

**A `ChoError` is recognized with `isChoError`, not with `instanceof`.** Two
versions of `@chojs/core` in one process have a class each, and `instanceof` is
false for the error of the other one (section 4.4).

Values are named in messages by class name (`<anonymous>` for an anonymous
class), quoted string, `InjectionToken(<description>)` or
`Symbol(<description>)`. `<v>` below is a short description of the bad value
(`array(3)`, `{ a, b }`, …).

**Thrown by the decorators**, when the class is defined:

| Mistake                                                                                         | Code                             | Message                                                                                                                 |
| ----------------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| A second DI decorator on a class                                                                | `CHO_CORE_ALREADY_DECORATED`     | `class X is already decorated with @Injectable, @Module or @Controller`                                                 |
| An unknown option                                                                               | `CHO_CORE_UNKNOWN_OPTION`        | `@Controller(): unknown option "deps". Known options: dependencies, route`                                              |
| A list option is not an array                                                                   | `CHO_CORE_INVALID_OPTION`        | `<option> must be an array, got <v>` (`dependencies`, `imports`, `controllers`, `exports`, `providers`, `middlewares`)  |
| A dependency is not a token                                                                     | `CHO_CORE_INVALID_OPTION`        | `all dependencies must be classes, symbols or injection tokens: <v>`                                                    |
| An import is not a class                                                                        | `CHO_CORE_INVALID_OPTION`        | `all imports must be classes: <v>`                                                                                      |
| A controller is not a class                                                                     | `CHO_CORE_INVALID_OPTION`        | `all controllers must be classes: <v>`                                                                                  |
| An export is not a token                                                                        | `CHO_CORE_INVALID_OPTION`        | `all exports must be classes, symbols or injection tokens: <v>`                                                         |
| `configure` is given what is not a module                                                       | `CHO_CORE_NOT_A_MODULE`          | `configure(): X is not a module. Give it a @Module class.`                                                              |
| `configure` is given options that are not an object, or a `name` that is not a non-empty string | `CHO_CORE_INVALID_OPTION`        | `configure(): "name" is a non-empty string, got <v>`                                                                    |
| An unknown option of `configure`                                                                | `CHO_CORE_UNKNOWN_OPTION`        | `configure(): unknown option "controllers". Known options: imports, name, providers`                                    |
| A provider object is malformed                                                                  | `CHO_CORE_INVALID_PROVIDER`      | `provider <name> …` (see below)                                                                                         |
| A middleware is not a function                                                                  | `CHO_CORE_INVALID_MIDDLEWARE`    | `all middlewares must be functions: <v>`                                                                                |
| An error handler is not a function                                                              | `CHO_CORE_INVALID_ERROR_HANDLER` | `the error handler must be a function or a class: <v>`                                                                  |
| A second `@Catch` on a class or method                                                          | `CHO_CORE_DUPLICATE_CATCH`       | `an error handler is already set (one @Catch per target)`                                                               |
| `@Middlewares` / `@Catch` on a static, private or symbol-named method                           | `CHO_CORE_INVALID_TARGET`        | `@Middlewares() cannot decorate static method <name>: only public, non-static methods with a string name are supported` |
| A decorator on something it cannot decorate                                                     | `CHO_CORE_INVALID_TARGET`        | `<decorator> can only decorate a class or a method` (or `… a method`)                                                   |

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

| Mistake                                 | Code                             | Message                                                                                                                                        |
| --------------------------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| The root is not a class                 | `CHO_CORE_NOT_A_CLASS`           | `Expected a module class, got <typeof>` (and `Expected a controller class, …` for an entry of `controllers`)                                   |
| Circular imports                        | `CHO_CORE_CIRCULAR_DEPENDENCY`   | `Circular dependency detected: A → B → A`                                                                                                      |
| An import is not a `@Module`            | `CHO_CORE_NOT_A_MODULE`          | `Class X is not a module. Did you forget @Module?`                                                                                             |
| A provider is not `@Injectable`         | `CHO_CORE_NOT_INJECTABLE`        | `Class X is not injectable. Did you forget @Injectable?`                                                                                       |
| A controller is not a `@Controller`     | `CHO_CORE_NOT_A_CONTROLLER`      | `Class X is not a controller. Did you forget @Controller?`                                                                                     |
| A controller or a module in `providers` | `CHO_CORE_MISPLACED_PROVIDER`    | `Class X is a controller: declare it in "controllers", not in "providers".` / `Class X is a module: list it in "imports", not in "providers".` |
| A token declared twice                  | `CHO_CORE_DUPLICATE_TOKEN`       | `X is declared more than once in module M (as <kind> and as <kind>). Declare each token once.`                                                 |
| An ambiguous token is used              | `CHO_CORE_AMBIGUOUS_TOKEN`       | `X is ambiguous in module M: A, B export different instances of it. Provide X in M to choose which one to use.`                                |
| A module re-exported                    | `CHO_CORE_INVALID_EXPORT`        | `Module M exports the imported module X. Re-exporting a module is not supported; export the tokens you need instead.`                          |
| An export not in scope                  | `CHO_CORE_INVALID_EXPORT`        | `Module M exports X, which it neither provides nor imports.`                                                                                   |
| A missing dependency                    | `CHO_CORE_UNRESOLVED_DEPENDENCY` | `Cannot resolve X (argument #i) of Y in module M. Provide it there or import a module that exports it.`                                        |
| Circular dependencies                   | `CHO_CORE_CIRCULAR_DEPENDENCY`   | `Circular dependency detected in module M: A → B → A`                                                                                          |
| Metadata of another version of the core | `CHO_CORE_METADATA_FORMAT`       | `The CHO metadata of X was written in format <n>, but this copy of @chojs/core reads format <m>. …`                                            |

`<kind>` is `a provider`, `a controller` or `the module itself`; `#i` counts
from zero. `CHO_CORE_METADATA_FORMAT` is thrown wherever a record is read or
written: by a decorator too.

**Rejected by `resolve()` and `init()`:**

| Problem                            | Code                       | Message                                                                                                         |
| ---------------------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------- |
| The module is not in the graph     | `CHO_CORE_UNKNOWN_MODULE`  | `M is not part of this application`                                                                             |
| The token is not in module's scope | `CHO_CORE_NOT_VISIBLE`     | `X is not visible in module M`                                                                                  |
| The token is ambiguous there       | `CHO_CORE_AMBIGUOUS_TOKEN` | `X is ambiguous in module M: A, B export different instances of it. Provide X in M to choose which one to use.` |
| A factory or constructor failed    | `CHO_CORE_CREATE_FAILED`   | `Failed to create X in module M`, with `cause`                                                                  |
| The injector is disposed           | `CHO_CORE_DISPOSED`        | `The injector is disposed`                                                                                      |

**Thrown by `new Injector(root, { overrides })`:**

| Mistake                              | Code                          | Message                                                        |
| ------------------------------------ | ----------------------------- | -------------------------------------------------------------- |
| An override is not a provider object | `CHO_CORE_INVALID_OVERRIDE`   | `An override must be a provider object, built with provider()` |
| Two overrides of one token           | `CHO_CORE_DUPLICATE_OVERRIDE` | `X is overridden more than once`                               |
| An override nothing provides         | `CHO_CORE_UNKNOWN_OVERRIDE`   | `Cannot override X: no module of the application provides it`  |

**Rejected by `dispose()`:** an `AggregateError`,
`Failed to dispose N of the injector's instances`, whose `errors` are
`Failed to dispose X in module M` (`CHO_CORE_DISPOSE_FAILED`), each with its
`cause`.

**Thrown for the CHO modules**, by what they share (sections 3.2 and 3.3):

| Mistake                                               | Code                                 | Message                                                                            |
| ----------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------- |
| A middleware class without a `handle` method          | `CHO_CORE_INVALID_MIDDLEWARE`        | `Middleware class X must implement 'handle' method.`                               |
| A middleware that is not a function or a class        | `CHO_CORE_INVALID_MIDDLEWARE`        | `Invalid middleware <v>: must be a function or a class with a 'handle' method.`    |
| An error handler class without a `handle` method      | `CHO_CORE_INVALID_ERROR_HANDLER`     | `Error handler class X must implement 'handle' method.`                            |
| An error handler that is not a function or a class    | `CHO_CORE_INVALID_ERROR_HANDLER`     | `Invalid error handler <v>: must be a function or a class with a 'handle' method.` |
| A middleware calls `next()` twice                     | `CHO_CORE_NEXT_CALLED_TWICE`         | `middleware <name>: next() called more than once`                                  |
| A middleware returns nothing without calling `next()` | `CHO_CORE_MISSING_MIDDLEWARE_RESULT` | `middleware <name> returned no <result>: return <a result> or call next()`         |
| A middleware returns something else                   | `CHO_CORE_INVALID_MIDDLEWARE_RESULT` | `middleware <name> must return <a result> or nothing, got <typeof>`                |

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

**Naming.** `@chojs/core` is internal, and its names say so: every function and
method is `snake_case` (`is_token`, `set_env`,
`DependencyNode.is_controller()`), which in CHO marks an API with no
compatibility promise. The public API of the CHO modules is `camelCase` for
functions and methods and `PascalCase` for classes. Decorators are `PascalCase`
everywhere; a single-word name (`provider`, `token`, `compose`) fits both.
Properties, option keys, types and constants are outside the rule
(`errorHandler`, `InjectionToken`, `METADATA_FORMAT`).

### 3.1 `@chojs/core`

The DI essentials:

- decorators: `Injectable`, `Module`, `Controller`, `Middlewares`, `Catch`;
- `Injector`, `token`, `provider`, `configure`;
- errors: `ChoError`, `isChoError`, and the type `ChoCoreErrorCode` (section
  2.8). These three are for applications: their names are those of a public API,
  and each CHO module gives them again;
- types: `ModuleOptions`, `ControllerOptions`, `ConfigureOptions`, `Dependency`,
  `Ctr`, `Target`, `Any`, and the graph types `MetadataGraph`,
  `DependencyGraph`, `DependencyNode`, `ModuleScope`;
- the types of a validator (section 5): `ChoValidator`, `ChoParseValidator`,
  `ChoIssue`, `ChoInput`, `ChoOutput`, and the interfaces of the specification,
  `StandardSchemaV1`, `StandardJSONSchemaV1` and `StandardTypedV1`. These are
  for applications too, and each CHO module that takes validators gives them
  again.

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
| `is_token`                                                                                 | Whether a value is a token.                                                                                                                           |
| `assert_handle`, `is_handle_class`, `resolve_handle`                                       | Middlewares and error handlers given as classes with a `handle` method: checking them, and creating them with the injector (section 2.6).             |
| `ChoMethodDecorator`, `ChoClassOrMethodDecorator`                                          | Decorator types that accept both call shapes.                                                                                                         |
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

The two graphs can be built without an injector, for a tool that reads an
application and does not create it (`@chojs/dev` draws one):

- `build_meta_graph(root, overrides?)`: the metadata graph of a root module;
- `build_dependency_graph(meta)`: the dependency graph of a metadata graph.

Both are synchronous, create nothing, and throw what `new Injector(root)` throws
(section 2.8). The first reads the declarations; the second links them, so it is
the one that fails on a missing, ambiguous or circular dependency.

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
- `compose(middlewares, endpoint, kind)`: runs a chain of middlewares around an
  endpoint (the onion model), for any context and result. Each middleware is
  `(ctx, next)`; `next()` resolves to the result of the rest of the chain, and a
  middleware returns a result (to end or replace it) or nothing (to pass it on).
  `kind` says what a result is and how to name it in error messages.
  `@chojs/web` uses it with a `Response`, `@chojs/command` with an exit code.
  Without a `kind`, `compose(middlewares, endpoint)` runs a chain that has **no
  result**: what a middleware returns is ignored, and one that returns without
  calling `next()` ends the chain there, which is not a mistake. A middleware
  cannot hide the failure of the rest of the chain: when `next()` rejects, the
  chain rejects, even when the middleware catches the error. `@chojs/message`
  uses it: a message is handled, or it fails.
- `describe(value)`: a readable name for error messages.
- `make_error(code, message, options, above)`: a `ChoError` whose stack starts
  where the mistake was found. Each package has a function of its own that calls
  it with its codes (section 4.4).
- `is_class(value)`, `is_class_implement(value, method)`: whether a value is a
  class, and whether its prototype has a given method.
- `is_validator(value)`, `run_validator(validator, value)`, `to_issues(issues)`
  and `error_issues(error)`: what a CHO module does with a validator (section
  5.4).

### 3.4 `@chojs/core/utils/test_utils`

Helpers for the tests of CHO packages. Most tests apply decorators as plain
function calls, in each of the two call shapes, whatever the runtime's own
decorator implementation is (each package also has one test file that uses the
decorator syntax itself):

- `legacy()` and `tc39()` apply a method decorator in each call shape;
  `tc39_record()` reads back the record a `tc39()` call wrote;
- `method_context()` builds a TC39 method context;
- `capture()` records what a function writes to `console.log` and
  `console.error`;
- `with_env()` runs a function with environment variables set;
- `loose()` bypasses parameter types;
- `standard_schema()` makes a Standard Schema by hand, with no library;
- `check_codes()` compares the error codes of a package with the table of its
  document and with its tests (section 4.4).

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
  can be decorated on its own. `configure` (section 2.4) relies on it: the
  module it makes is a subclass, with a record that is a copy of its parent's
  with other imports and providers, written as a decorator writes one.
- **Method records are stored with the class**, by method name, in a method
  table next to the class's record (`Symbol.for("chojs.meta.methods")`), not on
  the method function. `decorated_method` gives a decorator where to write
  (`.meta`). Reading a class's methods (`method_records`) walks its prototype
  chain, parents first, so inherited methods keep their records; a subclass's
  record is merged over its parent's by the rules of `add_to_metadata_object`
  (arrays concatenated, other values replaced). Where a decorator cannot reach
  the class (a static or private method, or TC39 decorators compiled for a
  runtime without `Symbol.metadata`), the record is written on the function, and
  read from there too.
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

### 4.4 Errors

- **One class.** `ChoError` is the only error class of the framework: a
  `TypeError` says less than a code does. Its `name` is on the prototype, as the
  name of a native error is, so `code` is its only own property (besides
  `cause`).
- **Recognized by a registered symbol.** The prototype has a property keyed by
  `Symbol.for("cho.error")`. Two copies of the package share the symbol, where
  each has a class of its own: `isChoError` checks the symbol and that `code` is
  a string, and never uses `instanceof`.
- **A function for each package.** `core_error(code, message, options)` makes
  the errors of the core; `web_error`, `command_error`, … are the same in the
  other packages. Each one takes the union of the codes of its package, so a
  code that is not in the union does not compile, and calls `make_error` with
  itself, which leaves it out of the stack.
- **The codes are checked.** A test of each package (`errors_test.ts`) holds the
  codes as the keys of a `Record` of the union, so that the compiler wants all
  of them and no other, and gives them to `check_codes`: every code is in a
  table of the document, the document has no other code of the package, and
  every code is named by a test. The check reads files: it is skipped where that
  is not permitted (Deno without `--allow-read`). The test task of the
  repository gives the permission, so it runs on the three runtimes.

## 5. Validators

A **validator** says whether a value is what is expected, and gives the value
the application works with. `@chojs/web` takes one for an argument of a handler
(`Body(schema)`), `@chojs/message` for an argument and for the two values of a
contract, and `@chojs/openapi` reads it to document a route. What a validator is
is defined here, once, so that it is the same in every CHO module.

`@chojs/core` runs no validation of its own: it has the types, and the functions
the CHO modules run a validator with.

### 5.1 The two shapes

A validator is a [Standard Schema](https://standardschema.dev/), or an object
with a `parse` method:

```ts
type ChoValidator<Output = unknown, Input = unknown> =
  | StandardSchemaV1<Input, Output>
  | { parse(value: unknown): Output | Promise<Output> };
```

- **A Standard Schema** is an object, or a function, with a `~standard` key. The
  schemas of Zod, Valibot, ArkType and many other libraries are: the
  [specification](https://standardschema.dev/schema) lists them. This is the
  shape to use.
- **An object with a `parse` method** that returns the value, or throws. It is
  the older shape, and it stays accepted.

`@chojs/core` depends on no schema library, and not on the package of the
specification either: `StandardSchemaV1`, `StandardJSONSchemaV1` and
`StandardTypedV1` are the interfaces of the specification, copied as it allows.
The schema of any library that implements it fits them.

A validator written by hand, in each shape:

```ts
const positive: ChoValidator<number> = {
  "~standard": {
    version: 1,
    vendor: "app",
    validate(value) {
      const n = Number(value);
      return n > 0
        ? { value: n }
        : { issues: [{ message: "expected a positive number" }] };
    },
  },
};

const positive: ChoValidator<number> = {
  parse(value) {
    const n = Number(value);
    if (!(n > 0)) throw new Error("expected a positive number");
    return n;
  },
};
```

### 5.2 How a validator is run

| Shape             | Valid                   | Not valid            | When it throws                  |
| ----------------- | ----------------------- | -------------------- | ------------------------------- |
| A Standard Schema | a result with a `value` | a result with issues | an error of the validator       |
| A `parse` method  | what it returns         | it throws            | that is how it says "not valid" |

- **What a validator gives is what the application receives.** A validator can
  convert a value, give it defaults, or remove what it does not know.
- **Both shapes can give a promise.** It is awaited: a schema with an
  asynchronous check needs no wrapper.
- **A Standard Schema that throws has a bug, or a dependency that is down.** The
  value is not reported as not valid: what was thrown is thrown on, unchanged,
  and each CHO module treats it as any error of a handler.
- **For an object with both shapes, the Standard Schema is used**, and `parse`
  is not called. A Zod schema is such an object. `parse` is used when the
  `~standard` key has no `validate` function.

### 5.3 Issues

What is not valid is a list of issues, of one shape for every validator:

```ts
type ChoIssue = {
  readonly message: string;
  readonly path?: readonly (string | number)[];
};
```

- `path` leads to what is wrong: `["items", 0, "price"]`. It is not there when
  the whole value is what is wrong.
- **From a Standard Schema**, each issue of the result gives its `message` and
  its `path`. A segment of a path given as `{ key }` becomes its key, and a
  symbol becomes its description.
- **From what a `parse` method threw**: its `issues` when it has a list of them,
  as the error of a Zod schema does, read the same way; otherwise one issue,
  with the message of the error.
- **Nothing else of the library is kept.** A library adds fields of its own to
  an issue (`code`, `expected`, and for some the value that was refused). They
  are left out, so that what an application answers with is the same for every
  library, and says nothing the library did not mean for a client.
- There is always one issue at least.

### 5.4 The types of a validator, and the functions

`ChoOutput<V>` and `ChoInput<V>` give the two types of a validator. They differ
when the validator converts:

```ts
const NewUser = z.object({ name: z.string(), age: z.number().default(18) });

type User = ChoOutput<typeof NewUser>; // { name: string; age: number }
type Sent = ChoInput<typeof NewUser>; // { name: string; age?: number }
```

A `parse` method does not say what it takes: its input is its output.

For the CHO modules, in `@chojs/core/utils`:

- `is_validator(value)`: whether a value has one of the two shapes;
- `run_validator(validator, value)`: resolves with `{ value }`, or with
  `{ issues }` (and `error`, when a `parse` method threw). It rejects with what
  a Standard Schema throws;
- `to_issues(issues)` and `error_issues(error)`: the issues of section 5.3, from
  a list a library gave and from something that was thrown.
