# @chojs/command

Command-line applications built with decorators: classes declare commands, and
`ChoCommand` parses the command line and runs the right one. It is built on the
dependency injection of `@chojs/core` (see `core/specs.md`), and runs on Deno,
Node.js and Bun.

This document describes what an application gets. The source code is the
reference: when this document and the code disagree, the code wins. Known bugs
are tracked in `command/issues.md`.

## 1. Overview

There are two kinds of applications:

- **A single command**, like `ls`: one method runs for every command line
  (`./app [options] [args]`).
- **Multiple actions**, like `git`: the first word names the action to run
  (`./app <command> [options] [args]`).

Everything an application needs comes from `@chojs/command`: the command
decorators, `ChoCommand`, and the DI decorators it re-exports from the core
(`@Module`, `@Controller`, `@Injectable`, `@Catch`).

A single command:

```ts
import {
  type ChoArgs,
  ChoCommand,
  Controller,
  Help,
  Main,
  Module,
} from "@chojs/command";

@Help("List files")
@Controller()
class ListFiles {
  @Help("List the files of a directory")
  @Main()
  main(args: ChoArgs) {
    if (args._.length !== 1) {
      throw new Error("expected one directory");
    }
    console.log(`listing ${args._[0]}`);
    // returning nothing exits with 0
  }
}

@Module({ controllers: [ListFiles] })
class App {}

const app = ChoCommand.create(App, { name: "ls", version: "1.0.0" });
Deno.exit(await app.run(Deno.args));
```

Multiple actions, with a dependency injected into the controller:

```ts
import {
  Action,
  type ChoArgs,
  ChoCommand,
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
  copy(args: ChoArgs) {
    this.disk.copy(String(args._[0]), String(args._[1]));
  }

  @Help("Delete a file")
  @Action("rm")
  remove(args: ChoArgs) {
    return args.force ? 0 : 3; // the exit code
  }
}

@Module({ providers: [Disk], controllers: [FileSystem] })
class App {}

const app = ChoCommand.create(App, { name: "fs", version: "1.0.0" });
Deno.exit(await app.run(Deno.args));
```

```shell
$ ./fs copy src dest
$ ./fs rm path/to/file --force
$ ./fs --version
fs version 1.0.0
```

On Node.js and Bun, pass `process.argv.slice(2)` and use `process.exit`.
`examples/hello-world-cli.ts` and `examples/multi-actions-cli.ts` run the two
modes.

## 2. Declaring commands

### 2.1 Controllers and modules

Commands are methods of **controllers**: classes decorated with `@Controller()`
and listed in the `controllers` of a `@Module`. The usual DI rules apply
(`core/specs.md`, section 2): a controller receives its `dependencies` in its
constructor, resolved in the scope of the module that declares it.

Controllers can be declared in any module of the application, imported ones
included. A controller without command methods is ignored.

### 2.2 `@Main()`

Marks the method that runs for every command line. The application has exactly
one, and no `@Action` (section 2.5).

### 2.3 `@Action(name)`

Marks the method that runs for `./app <name>`.

- The name must be a non-empty string, without whitespace, that does not start
  with `-`: a word the command line can pass as is, and not as a flag. Any other
  character is allowed (`x-y`, `v1.2`, `42`).
- Names share one namespace across the whole application: two actions with the
  same name, in any controllers or modules, are an error. There are no groups or
  nested subcommands.

### 2.4 `@Help(text)`

Help text, printed by `--help` (section 5):

- on a controller, it describes the group of commands the controller holds;
- on a command method, it describes the command.

The text must be a non-empty string. It can span several lines: where only one
line fits (a group heading, the list of commands), the first line is used.

### 2.5 Rules

- A command method must be a public, non-static method with a string name.
  `@Main` / `@Action` on a `#private`, static or symbol-named method, or on
  anything that is not a method, throws when the class is defined.
- A method has at most one `@Main` or `@Action`. `@Help` combines with either,
  in any order.
- The mode follows from the whole application, when `ChoCommand.create` runs:
  exactly one `@Main` and no `@Action` is a single command; one or more
  `@Action` and no `@Main` is multiple actions. No command at all, `@Main` mixed
  with `@Action`, or more than one `@Main` throws.

## 3. The command line

### 3.1 What a command receives: `ChoArgs`

A command method receives the parsed command line: the result of `parseArgs`
from `@std/cli` (minimist style).

```ts
// ./fs copy a.txt 42 --force --mode=644 -v
copy(args: ChoArgs) {
  args._;     // ["a.txt", 42]  positionals; numbers are parsed as numbers
  args.force; // true
  args.mode;  // 644
  args.v;     // true
}
```

- In multiple-action mode, `_` does not include the action name.
- `--help` and `--version` are never in it (section 3.2).
- Flags are not declared, so their types come from the command line alone: a
  flag that is followed by a word that is not a flag takes it as its value
  (`--out dir` gives `out: "dir"`). Declare flags with `parseOptions` (section
  3.3) to change that.

### 3.2 Reserved flags: `--help` and `--version`

Only these two long flags are reserved. They never take a value (`--help copy`
is the help of `copy`), `--no-help` and `--help=false` turn them off, and they
are never passed to commands. Short flags (`-h`, `-v`) are left to the commands.

### 3.3 Declaring flags: `parseOptions`

The `parseOptions` option of `ChoCommand.create` takes `parseArgs` options (type
`ParserOptions`): `boolean`, `string`, `collect`, `negatable`, `alias`,
`default`, `stopEarly`, `"--"` and `unknown`.

```ts
const app = ChoCommand.create(App, {
  parseOptions: { boolean: ["force"], string: ["out"], alias: { f: "force" } },
});
// ./fs --force copy a b   now runs `copy`: --force no longer takes "copy"
```

Whatever they say, `--help` and `--version` keep the behavior of section 3.2.

## 4. Running the application

### 4.1 `ChoCommand.create(app, options?)`

Builds the application from its root module: it reads and checks the module
graph and the commands, and throws on any mistake (sections 2.5 and 7). It
creates no instance.

| Option         | Default   | Use                                                       |
| -------------- | --------- | --------------------------------------------------------- |
| `name`         | `"chojs"` | the program name, in `--version` and the help usage lines |
| `version`      | `"1.0.0"` | printed by `--version`                                    |
| `parseOptions` | none      | flag declarations (section 3.3)                           |

To run setup code before a command (open a connection, read a configuration
file, …), put it in a provider, an async factory if needed, and make the
controller depend on it: the injector creates it before the controller, once per
application.

### 4.2 `run(argv)`

Runs one command line and resolves to the exit code. It never exits the process:
pass the result to `Deno.exit` or `process.exit`.

1. `--help` prints the help (section 5) and resolves to `0`.
2. `--version` prints `<name> version <version>` and resolves to `0`.
3. In multiple-action mode, a command line without an action prints the help and
   resolves to `0`.
4. Otherwise the command's controller is created (with its dependencies, the
   first time only: later runs reuse it), and the method is called with the
   parsed arguments and awaited. Only what that command needs is created.

| Situation                                                 | Exit code                 |
| --------------------------------------------------------- | ------------------------- |
| the command returns a non-negative integer `n`            | `n`                       |
| the command returns anything else, or nothing             | `0`                       |
| `--help`, `--version`, or no action (multiple actions)    | `0`                       |
| the command fails, and its `@Catch` handler returns `n`   | `n` (a non-negative int.) |
| the command fails, and its `@Catch` handler returns other | `1`                       |
| the command fails, without a `@Catch` handler             | `1`                       |
| an unknown action                                         | `1`                       |

### 4.3 Errors and `@Catch`

An error thrown by a command, or while creating its controller, goes to the
command's `@Catch` handler: the method's, or else the controller's.

```ts
@Injectable([Logger])
class ReportError {
  constructor(readonly logger: Logger) {}
  handle(error: unknown, args: ChoArgs) {
    this.logger.error(error, args);
    return 3;
  }
}

@Catch((error) => 2) // for every command of the controller
@Controller()
class FileSystem {
  @Catch((error) => (error instanceof NotFound ? 4 : 1)) // for `rm` only
  @Action("rm")
  remove(args: ChoArgs) {/* ... */}

  @Catch(ReportError) // a class, created by the injector
  @Action("sync")
  sync(args: ChoArgs) {/* ... */}
}
```

A handler is called with the error, as thrown, and the parsed arguments, and
awaited. Its result gives the exit code (section 4.2).

- **A function** is called as `(error, args)`. If it throws, `run()` rejects
  with that error.
- **A class** is created by the injector, in the scope of the module that
  declares the controller (so it must be a provider visible there, and can have
  dependencies), and its `handle(error, args)` method is called. If the class
  cannot be created, or `handle` throws, `run()` prints the original error and
  resolves to `2`.
- Without a handler, `run()` prints `Error: <message>` to stderr and resolves to
  `1`. An unknown action is reported the same way.

`@Middlewares` is accepted on controllers and methods, but the command module
does not run middlewares.

## 5. Help

`--help` prints to stdout, built from the `@Help` texts. The options listed are
always the two reserved flags.

A single command (`./ls --help`): the usage, the controller's help, the method's
help, then the options.

```
Usage: ls [options] [args]

List files

List the files of a directory

Options:
  --help     Show this help
  --version  Show the version
```

Multiple actions, one action (`./fs copy --help`): the usage, the method's help,
then the options.

```
Usage: fs copy [options] [args]

Copy a file

Options:
  --help     Show this help
  --version  Show the version
```

Multiple actions, without an action (`./fs`, `./fs --help`), or with an unknown
one and `--help` (`./fs nope --help`): every action, grouped under the first
line of its controller's `@Help` (`Commands` for controllers without one), in
declaration order, each with the first line of its own help.

```
Usage: fs <command> [options] [args]

File system commands:
  copy  Copy a file
  rm    Delete a file

Commands:
  get

Options:
  --help     Show this help
  --version  Show the version

Run 'fs <command> --help' for help on a command.
```

## 6. Public API

| Export                                                                            | Kind     | Section |
| --------------------------------------------------------------------------------- | -------- | ------- |
| `ChoCommand`, `ChoCommandOptions`                                                 | class    | 4       |
| `Main`, `Action`, `Help`                                                          | function | 2       |
| `ChoArgs`, `ParserOptions`                                                        | type     | 3       |
| `Controller`, `Module`, `Injectable`, `Catch` (re-exported from `@chojs/core`)    | function | 2.1     |
| `ControllerOptions`, `ModuleOptions`, `InjectableOptions` (re-exported, see core) | type     | 2.1     |

## 7. Errors

**When a class is defined** (the decorators):

| Mistake                                      | Message                                                                                                                 |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `@Action` name is empty or not a string      | `TypeError: Action must be a non-empty string`                                                                          |
| `@Action` name has whitespace                | `TypeError: @Action("<name>"): the name must not contain whitespace`                                                    |
| `@Action` name starts with `-`               | `TypeError: @Action("<name>"): the name must not start with "-"`                                                        |
| `@Main` / `@Action` on a symbol-named method | `TypeError: <decorator> cannot decorate method Symbol(...): a command method must have a string name`                   |
| `@Main` / `@Action` on a `#private` method   | `TypeError: <decorator> cannot decorate private method '#<name>': a command method must be public`                      |
| `@Main` / `@Action` on a static method       | `TypeError: <decorator> cannot decorate static method '<name>': a command method must not be static`                    |
| `@Main` / `@Action` on anything but a method | `TypeError: <decorator> can only decorate a method`                                                                     |
| A second `@Main` / `@Action` on a method     | `Cannot add <decorator> to method '<name>': it already has <existing>. A method can have at most one @Main or @Action.` |
| `@Help` text is empty or not a string        | `TypeError: Help must be a non-empty string`                                                                            |
| `@Help` on anything but a class or a method  | `TypeError: @Help() can only decorate a class or a method`                                                              |

**By `ChoCommand.create`:** any module graph error of the core (`core/specs.md`,
section 2.8), and:

- `No @Main or @Action methods found in the application`
- `Mixing @Main and @Action methods in the same application is not allowed`
- `Multiple @Main methods in the same application is not allowed`
- `Duplicate @Action("<name>"): declared on <Controller>.<method> and <Controller>.<method>`

**Printed by `run()`** (exit code `1`), besides the command's own errors:

- `Error: Action '<name>' not found. Use --help for usage information.`
- `Error: Method '<name>' is not a function on controller '<Controller>'.`

## 8. Internals

- **Records.** The decorators write their data on the method or class under
  private symbol keys (`command/keys.ts`, `Symbol.for("chojs.command.*")`), next
  to the core's own keys, so nothing an application writes can collide with
  them.
- **Finding commands.** `ChoCommand.create` creates an `Injector` for the root
  module and walks `injector.controllers()` (imported modules first, the root
  last; controllers and methods in declaration order). That order is the order
  of the actions in the help.
- **Running.** `run()` resolves the controller with the injector, in the scope
  of the module that declares it, so it is created once per application and only
  when one of its commands runs. Error handlers come from the core's metadata
  (`errorHandler` of the method, then of the controller).
- **Parsing.** `parseArgs` is a vendored copy of `@std/cli/parse-args`
  (`command/lib/parse-args.ts`), so the package has no dependency besides
  `@chojs/core`.
