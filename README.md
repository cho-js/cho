<p align="center">
  <a href="https://chojs.io/" target="_blank"><img src="./assets/cho-logo.svg" width="120" alt="Cho Logo" /></a>
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

### Main features

- **One model for every application.** Modules, controllers and providers are
  the same in an [HTTP application](./web/README.md), a
  [command-line application](./command/README.md) and an application that
  handles the [messages of a broker](./message/README.md).
- **Dependency injection with no reflection.** Dependencies are listed
  explicitly and checked against the constructor at compile time: no
  `reflect-metadata`, no emitted types. A provider can be asynchronous.
- **Fails before it starts.** A missing provider, a circular dependency or a
  duplicate route is reported when the application is created, not on the first
  request.
- **Standard decorators.** TC39 decorators, as TypeScript 5 has them. Legacy
  (`experimentalDecorators`) and Bun decorators work too.
- **Built on web standards.** A handler receives a standard `Request` and
  answers with a standard `Response`. A router is built in, so an HTTP
  application needs no HTTP library, and an adapter runs it on Hono or on
  Fastify.
- **Server-sent events and WebSockets**, with no library: an `async *` method is
  a stream of events, and a controller handles a socket with decorators.
- **Typed, validated arguments.** A handler declares what it receives, and a
  schema of Zod, Valibot, ArkType or any other
  [Standard Schema](https://standardschema.dev/) checks it.
- **Middlewares and error handlers** on a module, a controller or a handler, as
  functions or as injectable classes.
- **Message brokers.** The same handlers run on Apache Kafka and on NATS, and a
  contract gives the two sides of a message their types.
- **OpenAPI.** The [document of an application](./extras/openapi/README.md), and
  its page, are made from its code.
- **Testable with no server.** An application is a function that takes a
  `Request`, and a test replaces any provider with a fake.
- **A command-line tool.** [`cho`](./cli/README.md) creates a workspace, adds
  projects to it, runs them, and generates controllers, services and modules.

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
import { serve } from "@chojs/web/serve";

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
await serve(app, {port: 3000}); // the same file runs on Deno, Node.js and Bun
```

A command-line application, with the same modules, controllers and providers:

```ts
import process from "node:process";
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
const code = await app.run(process.argv.slice(2)); // greet hello --name you
await app.close();
process.exit(code);
```

An application that handles the messages of a broker is made the same way: see
[`@chojs/message`](./message/README.md).

## Getting started

### With `cho`

`cho` is the command-line tool of the framework. Install it once, for the whole
machine:

```sh
npm install --global @chojs/cli   # Node.js
bun add --global @chojs/cli       # Bun

# Deno
deno install --global --allow-env --allow-read --allow-write --allow-run --name cho jsr:@chojs/cli
```

Create a workspace, and run its application:

```sh
cho new shop   # asks what you are building, and writes the workspace
cd shop
cho serve      # runs the application, and again when a file changes
```

`cho new` writes a web application, a command-line tool or a message consumer,
with its tests, and it runs as it is. The workspace is the same on Deno, on Node.js and on Bun: the
runtime you choose is the one `cho` installs and runs with, and another one can
take over later.

Then, in the workspace:

```sh
cho generate controller users   # users.ts and its test, for the application
cho add                         # another application, or a library
```

[`@chojs/cli`](./cli/README.md) has every command, and its options.

### In a project of your own

Pick the package for what you are building, and add it to the project; it
brings everything an application needs:

```sh
# an HTTP application
deno add jsr:@chojs/web
npx jsr add @chojs/web
bunx jsr add @chojs/web

# a command-line application
deno add jsr:@chojs/command
npx jsr add @chojs/command
bunx jsr add @chojs/command

# an application that handles the messages of a broker
deno add jsr:@chojs/message
npx jsr add @chojs/message
bunx jsr add @chojs/message
```

Deno and Bun run TypeScript decorators directly. On Node.js, compile the
application with TypeScript 5 or run it with a tool such as `tsx`.

`@chojs/web` has a router built in, on the standard URL Pattern API, so an HTTP
application needs nothing else. To match requests with another HTTP library,
give `ChoWeb.create` the linker of an adapter:

| Router                                                | Runs on                                                                |
|-------------------------------------------------------|------------------------------------------------------------------------|
| [Built in](./web/README.md#the-built-in-router)       | Deno, Node.js 24, Bun 1.3.4 and Cloudflare Workers: tested on the four |
| [`@chojs/vendor-hono`](./vendor/hono/README.md)       | Deno, Node.js, Bun and edge runtimes                                   |
| [`@chojs/vendor-fastify`](./vendor/fastify/README.md) | Node.js only                                                           |

`@chojs/message` is connected to its broker by an adapter, a package of its
own:

| Broker       | Adapter                                           | Runs on                         |
|--------------|---------------------------------------------------|---------------------------------|
| Apache Kafka | [`@chojs/vendor-kafka`](./vendor/kafka/README.md) | Node.js; tested on Deno and Bun |
| NATS         | [`@chojs/vendor-nats`](./vendor/nats/README.md)   | Deno, Node.js and Bun           |

## Packages

The name of a package links to its guide, and the specification is its full
description.

| Package                                               | Version                                                                                     | For                                                                   | Specification                      |
|-------------------------------------------------------|---------------------------------------------------------------------------------------------|-----------------------------------------------------------------------|------------------------------------|
| [`@chojs/web`](./web/README.md)                       | [![JSR](https://jsr.io/badges/@chojs/web)](https://jsr.io/@chojs/web)                       | HTTP applications                                                     | [specs](./web/specs.md)            |
| [`@chojs/command`](./command/README.md)               | [![JSR](https://jsr.io/badges/@chojs/command)](https://jsr.io/@chojs/command)               | Command-line applications                                             | [specs](./command/specs.md)        |
| [`@chojs/message`](./message/README.md)               | [![JSR](https://jsr.io/badges/@chojs/message)](https://jsr.io/@chojs/message)               | Applications that handle the messages of a broker, such as Kafka      | [specs](./message/specs.md)        |
| [`@chojs/vendor-cho`](./vendor/cho/README.md)         | [![JSR](https://jsr.io/badges/@chojs/vendor-cho)](https://jsr.io/@chojs/vendor-cho)         | Middlewares for the built-in router of `@chojs/web`, such as CORS     | [specs](./vendor/cho/specs.md)     |
| [`@chojs/vendor-hono`](./vendor/hono/README.md)       | [![JSR](https://jsr.io/badges/@chojs/vendor-hono)](https://jsr.io/@chojs/vendor-hono)       | Running `@chojs/web` on [Hono](https://hono.dev)                      | [specs](./vendor/hono/specs.md)    |
| [`@chojs/vendor-fastify`](./vendor/fastify/README.md) | [![JSR](https://jsr.io/badges/@chojs/vendor-fastify)](https://jsr.io/@chojs/vendor-fastify) | Running `@chojs/web` on [Fastify](https://fastify.dev) (Node.js only) | [specs](./vendor/fastify/specs.md) |
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
- [Decorators in TypeScript 5.0](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html#decorators)

# 蝶
