# @chojs/command

[![JSR](https://jsr.io/badges/@chojs/command)](https://jsr.io/@chojs/command)
[![JSR score](https://jsr.io/badges/@chojs/command/score)](https://jsr.io/@chojs/command)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Command-line applications built with decorators, on the dependency injection of
the [CHO](../README.md) framework. Classes declare commands; `ChoCommand` parses
the command line, runs the right one and returns the exit code.

## Contents

- [Highlights](#highlights)
- [Installation](#installation)
- [Quick start](#quick-start)
- [Guide](#guide)
  - [A single command](#a-single-command)
  - [Flags](#flags)
  - [The command context](#the-command-context)
  - [Middlewares](#middlewares)
  - [Errors and exit codes](#errors-and-exit-codes)
  - [Dependency injection and cleanup](#dependency-injection-and-cleanup)
  - [Testing](#testing)
- [Options](#options)
- [Runtime support](#runtime-support)
- [Documentation](#documentation)

## Highlights

- **Two shapes of application.** A single command, like `ls`, or multiple
  actions, like `git`.
- **Help for free.** `--help` and `--version` are built in, generated from
  `@Help` texts and the flags each command declares.
- **Declared flags.** A command says which flags it takes and of which type;
  positionals always arrive as typed.
- **Middlewares and error handlers** on a module, a controller or a command, as
  functions or injectable classes.
- **Dependency injection.** Commands live in controllers that receive their
  dependencies, asynchronous ones included.
- **Nothing is created to print help.** A command's dependencies are created
  when it first runs.
- **Exit codes, not `process.exit`.** `run()` resolves to the exit code and
  never exits the process itself.

## Installation

```sh
deno add jsr:@chojs/command    # Deno
npx jsr add @chojs/command     # Node.js
bunx jsr add @chojs/command    # Bun
```

## Quick start

```ts
import {
  Action,
  ChoCommand,
  type ChoCommandContext,
  Controller,
  Help,
  Injectable,
  Module,
} from "@chojs/command";

@Injectable()
class Disk {
  copy(from: string, to: string) {/* ... */}
  remove(path: string) {/* ... */}
}

@Help("File system commands")
@Controller({ dependencies: [Disk] })
class FileSystem {
  constructor(readonly disk: Disk) {}

  @Help("Copy a file")
  @Action("copy")
  copy(ctx: ChoCommandContext) {
    const [from, to] = ctx.args._;
    this.disk.copy(String(from), String(to));
  }

  @Help("Delete a file")
  @Action("rm", { boolean: ["force"], alias: { f: "force" } })
  remove(ctx: ChoCommandContext) {
    if (!ctx.args.force) return 3; // the exit code
    this.disk.remove(String(ctx.args._[0]));
  }
}

@Module({ providers: [Disk], controllers: [FileSystem] })
class App {}

const app = ChoCommand.create(App, { name: "fs", version: "1.0.0" });
const code = await app.run(Deno.args); // Node.js, Bun: process.argv.slice(2)
await app.close();
Deno.exit(code); // Node.js, Bun: process.exit(code)
```

```console
$ fs copy src dest
$ fs rm path/to/file --force
$ fs --help
Usage: fs <command> [options] [args]

File system commands:
  copy  Copy a file
  rm    Delete a file

Options:
  --help     Show this help
  --version  Show the version

Run 'fs <command> --help' for help on a command.
```

## Guide

### A single command

Mark one method with `@Main()` instead of `@Action`. It runs for every command
line.

```ts
@Controller()
class Greet {
  @Main({ string: ["name"] })
  main(ctx: ChoCommandContext) {
    console.log(`Hello, ${ctx.args.name ?? "world"}!`);
  }
}
```

An application has either one `@Main` or one or more `@Action`, never both.

### Flags

A command declares the flags it accepts. They are parsed with the declared type,
and listed in the command's `--help`.

```ts
@Action("copy", {
  boolean: ["force"], //          --force          never takes the next word
  string: ["mode"], //            --mode 0755      kept as typed: "0755"
  collect: ["exclude"], //        --exclude a --exclude b   ["a", "b"]
  negatable: ["color"], //        --no-color
  alias: { f: "force" }, //       -f
  default: { mode: "644" },
  describe: { force: "Overwrite existing files" },
})
copy(ctx: ChoCommandContext) {}
```

- Positionals (`ctx.args._`) are always strings, exactly as typed.
- A flag that is not declared is typed from the command line alone: `--n=42`
  gives the number `42`.
- Flags shared by every command go in the `parseOptions` option of
  `ChoCommand.create`.

### The command context

Every command, middleware and error handler of a run receives the same
`ChoCommandContext`:

| Property  | Holds                                                                        |
| --------- | ---------------------------------------------------------------------------- |
| `args`    | The parsed command line: the positionals in `_`, and the flags               |
| `argv`    | The command line as it was given to `run()`                                  |
| `command` | The command that runs: `"main"`, or the name of the action                   |
| `state`   | A `Map` for the run: what a middleware sets, later ones and the command read |

### Middlewares

`@Middlewares` applies to a module, a controller or a command. A middleware
wraps what comes after it, and can stop the command, change its exit code or
prepare its context.

```ts
const confirm: ChoCommandMiddlewareFn = (ctx, next) =>
  ctx.args.yes ? next() : 1; // stops here, with exit code 1

const timing: ChoCommandMiddlewareFn = async (ctx, next) => {
  const start = performance.now();
  await next();
  console.error(`${ctx.command}: ${Math.round(performance.now() - start)}ms`);
};

@Middlewares(timing) // every command of the controller
@Controller()
class FileSystem {
  @Middlewares(confirm) // this command only
  @Action("rm")
  remove(ctx: ChoCommandContext) {}
}
```

A middleware can also be a class with a `handle(ctx, next)` method. It is
created by the injector, so it can have dependencies; list it in the module's
`providers`.

### Errors and exit codes

| Situation                                                | Exit code |
| -------------------------------------------------------- | --------- |
| The command returns a non-negative integer `n`           | `n`       |
| The command returns anything else, or nothing            | `0`       |
| `--help`, `--version`, or no action given                | `0`       |
| The command throws, and an error handler returns `n`     | `n`       |
| The command throws, and an error handler returns no code | `1`       |
| The command throws, and nothing handles it               | `1`       |
| An unknown action                                        | `1`       |

An error goes to the nearest `@Catch` handler (the command's, the controller's,
then the module's), then to the application's `onError`. Without any, it is
printed as `Error: <message>`.

```ts
@Catch((error, ctx) => {
  console.error(`${ctx.command} failed: ${error}`);
  return 2;
})
@Controller()
class FileSystem {}
```

### Dependency injection and cleanup

`@Module`, `@Controller`, `@Injectable`, `token` and `provider` come from the
CHO core and are exported by this package, so an application imports everything
from `@chojs/command`.

```ts
const CONFIG = token<Config>("CONFIG");

@Module({
  providers: [
    provider({ provide: CONFIG, factory: () => Config.load("./fs.json") }),
    Disk,
  ],
  controllers: [FileSystem],
})
class App {}
```

`app.close()` releases what the application created, in reverse creation order:
every instance with a `[Symbol.asyncDispose]()` or `[Symbol.dispose]()` method
is disposed. Call it once, after the last `run()`.

### Testing

Run the application with any command line and assert on the exit code. The
`overrides` option replaces providers with fakes, anywhere in the module graph:

```ts
const app = ChoCommand.create(App, {
  overrides: [provider({ provide: Disk, factory: () => new FakeDisk() })],
});
assert.equal(await app.run(["rm", "a.txt", "--force"]), 0);
```

## Options

`ChoCommand.create(App, options)`:

| Option         | Default   | Use                                              |
| -------------- | --------- | ------------------------------------------------ |
| `name`         | `"chojs"` | The program name, in `--version` and in the help |
| `version`      | none      | Printed by `--version`                           |
| `parseOptions` | none      | Flags declared for every command                 |
| `onError`      | none      | The error handler for what no `@Catch` covers    |
| `overrides`    | none      | Providers that replace declared ones, for tests  |

## Runtime support

Deno, Node.js and Bun. Deno and Bun run TypeScript decorators directly; on
Node.js, compile the application with TypeScript 5 or run it with a tool such as
`tsx`. Both standard (TC39) and legacy (`experimentalDecorators`) decorators are
supported.

Debug logging is enabled with `CHO_DEBUG=1`, or with `CHO_DEBUGLOG=cho:command`.

## Documentation

- [Specification](./specs.md): declaring commands, parsing, the command context,
  middlewares, exit codes, error handling, help output and error messages.
- Examples: [`hello-world-cli.ts`](../examples/hello-world-cli.ts),
  [`multi-actions-cli.ts`](../examples/multi-actions-cli.ts).

## License

[MIT](./LICENSE)
