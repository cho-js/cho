# @chojs/command

[![JSR](https://jsr.io/badges/@chojs/command)](https://jsr.io/@chojs/command)

Command-line applications built with decorators, on top of the
[CHO](../README.md) dependency injection. Classes declare commands; `ChoCommand`
parses the command line, runs the right one and returns the exit code.

## Features

- **Two modes.** A single command, like `ls`, or multiple actions, like `git`.
- **Dependency injection.** Commands live in controllers, which receive their
  dependencies (async ones included) from the module graph.
- **Built-in `--help` and `--version`**, generated from `@Help` texts.
- **Middlewares.** `@Middlewares` on a module, a controller or a command, as
  functions or injectable classes, the way `@chojs/web` has them: a middleware
  can stop a command, change its exit code, or prepare its context.
- **Exit codes.** A command returns its exit code; errors go to `@Catch`
  handlers (or the application's `onError`), or are printed and exit `1`.
- **Every runtime.** Deno, Node.js and Bun. `run()` never exits the process
  itself.

## Install

```sh
deno add jsr:@chojs/command    # Deno
npx jsr add @chojs/command     # Node.js
bunx jsr add @chojs/command    # Bun
```

## Example

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
}

@Help("File system commands")
@Controller({ dependencies: [Disk] })
class FileSystem {
  constructor(readonly disk: Disk) {}

  @Help("Copy a file")
  @Action("copy")
  copy(ctx: ChoCommandContext) {
    this.disk.copy(String(ctx.args._[0]), String(ctx.args._[1]));
  }

  @Help("Delete a file")
  @Action("rm")
  remove(ctx: ChoCommandContext) {
    return ctx.args.force ? 0 : 3; // the exit code
  }
}

@Module({ providers: [Disk], controllers: [FileSystem] })
class App {}

const app = ChoCommand.create(App, { name: "fs", version: "1.0.0" });
Deno.exit(await app.run(Deno.args)); // Node.js / Bun: process.exit(await app.run(process.argv.slice(2)))
```

```shell
$ ./fs copy src dest
$ ./fs rm path/to/file --force
$ ./fs --help
Usage: fs <command> [options] [args]

File system commands:
  copy  Copy a file
  rm    Delete a file

Options:
  --help     Show this help
  --version  Show the version

Run 'fs <command> --help' for help on a command.
```

For a single command, mark one method with `@Main()` instead of `@Action`. A
command declares the flags it accepts, which are also listed in its `--help`:

```ts
@Action("copy", {
  boolean: ["force"],
  string: ["mode"],
  alias: { f: "force" },
  describe: { force: "Overwrite existing files" },
})
copy(ctx: ChoCommandContext) {/* ./fs copy a b -f --mode 0755 */}
```

Positionals are always strings, as typed. Flags for every command go in the
`parseOptions` option of `ChoCommand.create`.

More examples: [`examples/hello-world-cli.ts`](../examples/hello-world-cli.ts),
[`examples/multi-actions-cli.ts`](../examples/multi-actions-cli.ts).

## Documentation

- [Specification](./specs.md): declaring commands, parsing, exit codes, error
  handling, help output and error messages.
- [Known issues](./issues.md).
