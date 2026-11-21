<p align="center">
  <a href="https://nestjs.com/" target="_blank"><img src="./assets/butterfly.svg" width="120" alt="Nest Logo" /></a>
</p>

<p align="center">
The only cross-platform, cross-runtime, decorator-based framework for building modular applications in TypeScript.
</p>


[![Release](https://github.com/cho-js/cho/actions/workflows/release.yml/badge.svg)](https://github.com/cho-js/cho/actions/workflows/release.yml)
[![CI](https://github.com/cho-js/cho/actions/workflows/ci.yml/badge.svg)](https://github.com/cho-js/cho/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

# CHO

CHO is an enterprise ready decorator-based framework for building modular applications. It
uses modern JavaScript decorators to provide a clean
and efficient way to define the structure of an application.

### Portability

CHO applications can run on multiple JavaScript runtimes, including **Node.js**, **Deno**, **Bun**, and **Cloudflare Workers**. This allows developers to write code once and deploy it anywhere, without worrying about runtime-specific issues.

<p align="center">
  <img src="./assets/node.png" height="50"  alt="Node.js Logo" />
  <img src="./assets/deno.png" height="50" alt="Deno Logo" />
  <img src="./assets/bun.png" height="50" alt="Bun Logo" />
  <img src="./assets/cf.png"  height="50" alt="Cloudflare Workers Logo" />
</p>


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

@Injectable()
class UserStore {
    find(id: string) {
        return {id, name: "Ada"};
    }
}

@Controller({route: "users", dependencies: [UserStore]})
class UsersController {
    constructor(readonly store: UserStore) {
    }

    @Get(":id") // GET /users/42
    get(ctx: ChoWebContext) {
        return this.store.find(ctx.params.id!); // sent as JSON
    }
}

@Module({providers: [UserStore], controllers: [UsersController]})
class App {
}

const app = await ChoWeb.create(App);
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
    @Action("hello", {string: ["name"]})
    hello(ctx: ChoCommandContext) {
        console.log(`Hello, ${ctx.args.name ?? "world"}!`);
    }
}

@Module({controllers: [Greeter]})
class App {
}

const app = ChoCommand.create(App, {name: "greet"});
Deno.exit(await app.run(Deno.args)); // greet hello --name you
```

## Getting started

Pick the package for what you are building; it brings everything an application
needs.

```shell
npm install --global @chojs/cli
```

Or add it to your project with:

```sh
# an HTTP application
deno add jsr:@chojs/web
npx jsr add @chojs/web
bunx jsr add @chojs/web

# a command-line application
deno add jsr:@chojs/command
npx jsr add @chojs/command
bunx jsr add @chojs/command
```

`@chojs/web` has a router built in, on the standard URL Pattern API, so an HTTP
application needs nothing else. To match requests with another HTTP library,
give `ChoWeb.create` the linker of an adapter:

| Router                                                | Runs on                                                                |
|-------------------------------------------------------|------------------------------------------------------------------------|
| [Built in](./web/README.md#the-built-in-router)       | Deno, Node.js 24, Bun 1.3.4 and Cloudflare Workers: tested on the four |
| [`@chojs/vendor-hono`](./vendor/hono/README.md)       | Deno, Node.js, Bun and edge runtimes                                   |
| [`@chojs/vendor-fastify`](./vendor/fastify/README.md) | Node.js only                                                           |

Deno and Bun run TypeScript decorators directly. On Node.js, compile the
application with TypeScript 5 or run it with a tool such as `tsx`.



## Packages

The name of a package links to its guide, and the specification is its full
description.

| Package                                               | Version                                                                                     | For                                                                   | Specification                      |
|-------------------------------------------------------|---------------------------------------------------------------------------------------------|-----------------------------------------------------------------------|------------------------------------|
| [`@chojs/web`](./web/README.md)                       | [![JSR](https://jsr.io/badges/@chojs/web)](https://jsr.io/@chojs/web)                       | HTTP applications                                                     | [specs](./web/specs.md)            |
| [`@chojs/command`](./command/README.md)               | [![JSR](https://jsr.io/badges/@chojs/command)](https://jsr.io/@chojs/command)               | Command-line applications                                             | [specs](./command/specs.md)        |
| [`@chojs/message`](./message/README.md)               | [![JSR](https://jsr.io/badges/@chojs/message)](https://jsr.io/@chojs/message)               | Applications that handle the messages of a broker, such as Kafka      | [specs](./message/specs.md)        |
| [`@chojs/vendor-cho`](./vendor/cho/README.md)         | [![JSR](https://jsr.io/badges/@chojs/vendor-cho)](https://jsr.io/@chojs/vendor-cho)         | Middlewares for the built-in router of `@chojs/web`, such as CORS     |                                    |
| [`@chojs/vendor-hono`](./vendor/hono/README.md)       | [![JSR](https://jsr.io/badges/@chojs/vendor-hono)](https://jsr.io/@chojs/vendor-hono)       | Running `@chojs/web` on [Hono](https://hono.dev)                      |                                    |
| [`@chojs/vendor-fastify`](./vendor/fastify/README.md) | [![JSR](https://jsr.io/badges/@chojs/vendor-fastify)](https://jsr.io/@chojs/vendor-fastify) | Running `@chojs/web` on [Fastify](https://fastify.dev) (Node.js only) |                                    |
| [`@chojs/vendor-kafka`](./vendor/kafka/README.md)     | [![JSR](https://jsr.io/badges/@chojs/vendor-kafka)](https://jsr.io/@chojs/vendor-kafka)     | Running `@chojs/message` on Apache Kafka (tested on Deno and Bun too) | [specs](./vendor/kafka/specs.md)   |
| [`@chojs/vendor-nats`](./vendor/nats/README.md)       | [![JSR](https://jsr.io/badges/@chojs/vendor-nats)](https://jsr.io/@chojs/vendor-nats)       | Running `@chojs/message` on [NATS](https://nats.io), with replies     | [specs](./vendor/nats/specs.md)    |
| [`@chojs/openapi`](./extras/openapi/README.md)        | [![JSR](https://jsr.io/badges/@chojs/openapi)](https://jsr.io/@chojs/openapi)               | The OpenAPI document of a `@chojs/web` application, and its page      | [specs](./extras/openapi/specs.md) |
| [`@chojs/dev`](./extras/dev/README.md)                | [![JSR](https://jsr.io/badges/@chojs/dev)](https://jsr.io/@chojs/dev)                       | Development tools: the endpoints of an application, and its graph     | [specs](./extras/dev/specs.md)     |
| [`@chojs/prompt`](./extras/prompt/README.md)          | [![JSR](https://jsr.io/badges/@chojs/prompt)](https://jsr.io/@chojs/prompt)                 | Questions in a terminal: a text, a yes or no, a choice of a list      | [specs](./extras/prompt/specs.md)  |
| [`@chojs/cli`](./cli/README.md)                       | [![JSR](https://jsr.io/badges/@chojs/cli)](https://jsr.io/@chojs/cli)                       | `cho`, the command-line tool of the framework                         | [specs](./cli/specs.md)            |
| [`@chojs/core`](./core/README.md)                     | [![JSR](https://jsr.io/badges/@chojs/core)](https://jsr.io/@chojs/core)                     | The dependency injection engine underneath                            | [specs](./core/specs.md)           |

Runnable examples are in [`examples/`](./examples).

## Contributing

Contributions are welcome: see [CONTRIBUTING.md](./CONTRIBUTING.md) and the
[code of conduct](./CODE_OF_CONDUCT.md).

## License

[MIT](./LICENSE)

---

This project uses the TC39 stage 3 decorators proposal (JavaScript decorators).

- [TC39 stage 3 proposal](https://github.com/tc39/proposal-decorators)
- [TypeScript Decorators](https://www.typescriptlang.org/docs/handbook/decorators.html)
- [decorators.deno.dev](https://decorators.deno.dev/)

# 蝶
