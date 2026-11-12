# CHO

[![Release](https://github.com/cho-js/cho/actions/workflows/release.yml/badge.svg)](https://github.com/cho-js/cho/actions/workflows/release.yml)
[![CI](https://github.com/cho-js/cho/actions/workflows/ci.yml/badge.svg)](https://github.com/cho-js/cho/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

| Package                                               | Version                                                                                     | For                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [`@chojs/web`](./web/README.md)                       | [![JSR](https://jsr.io/badges/@chojs/web)](https://jsr.io/@chojs/web)                       | HTTP applications                                                          |
| [`@chojs/command`](./command/README.md)               | [![JSR](https://jsr.io/badges/@chojs/command)](https://jsr.io/@chojs/command)               | Command-line applications                                                  |
| [`@chojs/vendor-cho`](./vendor/cho/README.md)         | [![JSR](https://jsr.io/badges/@chojs/vendor-cho)](https://jsr.io/@chojs/vendor-cho)         | Running `@chojs/web` on the standard URL Pattern API, with no HTTP library |
| [`@chojs/vendor-hono`](./vendor/hono/README.md)       | [![JSR](https://jsr.io/badges/@chojs/vendor-hono)](https://jsr.io/@chojs/vendor-hono)       | Running `@chojs/web` on [Hono](https://hono.dev)                           |
| [`@chojs/vendor-fastify`](./vendor/fastify/README.md) | [![JSR](https://jsr.io/badges/@chojs/vendor-fastify)](https://jsr.io/@chojs/vendor-fastify) | Running `@chojs/web` on [Fastify](https://fastify.dev) (Node.js only)      |
| [`@chojs/core`](./core/README.md)                     | [![JSR](https://jsr.io/badges/@chojs/core)](https://jsr.io/@chojs/core)                     | The dependency injection engine underneath                                 |

CHO is a tiny decorator-based framework for building modular applications. It
uses modern JavaScript decorators (see
[About JavaScript Decorators](#about-javascript-decorators)) to provide a clean
and efficient way to define the structure of an application.

The concept is inspired by Angular, NestJS and Spring, but with a different
approach (or why this project exists):

### Portability (Cross-Platform/Engine Agnostic)

In the modern software development landscape, the ability to deploy applications
across various environments and platforms is crucial. Developers often face
challenges when trying to ensure that their applications run seamlessly on
different runtimes such as **Node.js**, **Deno**, **Bun**, **Cloudflare
Workers**, **AWS Lambda** and more. Each of these runtimes has its own set of
features, performance characteristics and limitations, making it difficult to
write code that is truly portable.

CHO keeps application code away from all of that. A web handler receives the
standard `Request` and answers with a standard `Response`; the HTTP library
underneath is a small adapter you can swap. The framework itself uses no
runtime-specific API, and every change is tested on Deno, Node.js and Bun. (An
adapter may support fewer runtimes than the framework: each one says which.)

### Standardization

Decorators and reflect metadata are not yet part of the official ECMAScript
standard, leading to inconsistencies in their implementation across different
runtimes (TS experimental vs TC39 proposal, for example). This lack of
standardization can result in compatibility issues and hinder the adoption of
these features in different production environments. This project aims to
provide a consistent and reliable way to use decorators across multiple
JavaScript runtimes, ensuring that developers can leverage these powerful
features without worrying about compatibility issues.

The same CHO application runs with standard (TC39) decorators and with legacy or
Bun decorators. It needs no `reflect-metadata` and no compiler plugin:
dependencies are declared explicitly, and still checked against the constructor
at compile time.

### Build for Performance

Minimalistic and optimized for performance!

There is no reflection at runtime. The whole module graph is validated and
linked once, when the application starts, so creating an instance afterwards
needs no lookup, and a mistake in the wiring never waits for the first request
to show up.

---

## A quick look

An HTTP application:

```ts
import {
  ChoWeb,
  type ChoWebContext,
  Controller,
  Get,
  Injectable,
  Module,
} from "@chojs/web";
import { HonoLinker } from "@chojs/vendor-hono";

@Injectable()
class UserStore {
  find(id: string) {
    return { id, name: "Ada" };
  }
}

@Controller({ route: "users", dependencies: [UserStore] })
class UsersController {
  constructor(readonly store: UserStore) {}

  @Get(":id") // GET /users/42
  get(ctx: ChoWebContext) {
    return this.store.find(ctx.params.id!); // sent as JSON
  }
}

@Module({ providers: [UserStore], controllers: [UsersController] })
class App {}

const app = await ChoWeb.create(App, { linker: new HonoLinker() });
Deno.serve(app.handler); // Bun: Bun.serve({ fetch: app.handler })
```

A command-line application, with the same modules, controllers and providers:

```ts
import {
  Action,
  ChoCommand,
  type ChoCommandContext,
  Controller,
  Help,
  Module,
} from "@chojs/command";

@Controller()
class Greeter {
  @Help("Say hello")
  @Action("hello", { string: ["name"] })
  hello(ctx: ChoCommandContext) {
    console.log(`Hello, ${ctx.args.name ?? "world"}!`);
  }
}

@Module({ controllers: [Greeter] })
class App {}

const app = ChoCommand.create(App, { name: "greet" });
Deno.exit(await app.run(Deno.args)); // greet hello --name you
```

## Getting started

Pick the package for what you are building; it brings everything an application
needs.

```sh
# an HTTP application
deno add jsr:@chojs/web jsr:@chojs/vendor-hono
npx jsr add @chojs/web @chojs/vendor-hono
bunx jsr add @chojs/web @chojs/vendor-hono

# a command-line application
deno add jsr:@chojs/command
npx jsr add @chojs/command
bunx jsr add @chojs/command
```

An HTTP application needs one adapter, the package that matches requests to
routes. Any of them can replace `@chojs/vendor-hono` above:

| Adapter                                               | Runs on                                                 |
| ----------------------------------------------------- | ------------------------------------------------------- |
| [`@chojs/vendor-cho`](./vendor/cho/README.md)         | Runtimes with `URLPattern`: Deno, Node.js 24, Bun 1.3.4 |
| [`@chojs/vendor-hono`](./vendor/hono/README.md)       | Deno, Node.js, Bun and edge runtimes                    |
| [`@chojs/vendor-fastify`](./vendor/fastify/README.md) | Node.js only                                            |

Deno and Bun run TypeScript decorators directly. On Node.js, compile the
application with TypeScript 5 or run it with a tool such as `tsx`.

## Documentation

| Package                 | Guide                                | Specification               |
| ----------------------- | ------------------------------------ | --------------------------- |
| `@chojs/web`            | [README](./web/README.md)            | [specs](./web/specs.md)     |
| `@chojs/command`        | [README](./command/README.md)        | [specs](./command/specs.md) |
| `@chojs/vendor-cho`     | [README](./vendor/cho/README.md)     |                             |
| `@chojs/vendor-hono`    | [README](./vendor/hono/README.md)    |                             |
| `@chojs/vendor-fastify` | [README](./vendor/fastify/README.md) |                             |
| `@chojs/core`           | [README](./core/README.md)           | [specs](./core/specs.md)    |

Runnable examples are in [`examples/`](./examples).

## Contributing

Contributions are welcome: see [CONTRIBUTING.md](./CONTRIBUTING.md) and the
[code of conduct](./CODE_OF_CONDUCT.md).

## License

[MIT](./LICENSE)

## About JavaScript Decorators

This project uses the TC39 stage 3 decorators proposal (JavaScript decorators).

- [TC39 stage 3 proposal](https://github.com/tc39/proposal-decorators)
- [TypeScript Decorators](https://www.typescriptlang.org/docs/handbook/decorators.html)
- [decorators.deno.dev](https://decorators.deno.dev/)

# 蝶
