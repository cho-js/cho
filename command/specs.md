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
decorators, `ChoCommand`, and the DI decorators (`@Module`, `@Controller`,
`@Injectable`, `@Catch`). `@Module` and `@Controller` are the core's, and accept
only the core's options: any other option is rejected, by the types and when the
class is defined.

A single command:

```ts
import {
  ChoCommand,
  type ChoCommandContext,
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
  main(ctx: ChoCommandContext) {
    if (ctx.args._.length !== 1) {
      throw new Error("expected one directory");
    }
    console.log(`listing ${ctx.args._[0]}`);
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

### 2.2 `@Main(flags?)`

Marks the method that runs for every command line. The application has exactly
one, and no `@Action` (section 2.5). `flags` declares the flags it accepts
(section 3.3).

### 2.3 `@Action(name, flags?)`

Marks the method that runs for `./app <name>`. `flags` declares the flags the
command accepts (section 3.3).

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

### 3.1 What a command receives: the context

A command method receives the **context** of the run, a `ChoCommandContext`:

| Property  | Holds                                                                        |
| --------- | ---------------------------------------------------------------------------- |
| `args`    | the parsed command line (`ChoArgs`): the positionals in `_`, and the flags   |
| `argv`    | the command line, as it was given to `run()`                                 |
| `command` | the command that runs: `"main"`, or the name of the action                   |
| `state`   | a `Map` for the run: what a middleware sets, later ones and the command read |

The middlewares, the command and the error handler of a run share one context;
each run has its own.

`ctx.args` is the result of `parseArgs` from `@std/cli` (minimist style):

```ts
// ./fs copy a.txt 007 --force --mode=644 -v
copy(ctx: ChoCommandContext) {
  ctx.args._;     // ["a.txt", "007"]  positionals, always as typed
  ctx.args.force; // true
  ctx.args.mode;  // 644: not declared, so typed from its look
  ctx.args.v;     // true
}
```

- **Positionals are strings**, exactly as typed: `007`, `0x10` and `1e3` are not
  turned into numbers.
- In multiple-action mode, `_` does not include the action name.
- `--help` and `--version` are never in it (section 3.2).
- A flag that is **not declared** is typed from the command line alone: followed
  by a word that is not a flag, it takes it as its value (`--out dir` gives
  `out: "dir"`), and a value that looks like a number becomes one (`--mode=644`
  gives `644`). Declare the flag (section 3.3) to decide instead.

### 3.2 Reserved flags: `--help` and `--version`

Only these two long flags are reserved. They never take a value (`--help copy`
is the help of `copy`), `--no-help` and `--help=false` turn them off, and they
are never passed to commands. Short flags (`-h`, `-v`) are left to the commands.

### 3.3 Declaring flags

**A command declares its own flags**, as the second argument of `@Action` (the
first of `@Main`), of type `CommandFlags`:

```ts
@Action("copy", {
  boolean: ["force"], // no value: never takes the next word
  string: ["mode"], // value kept as typed: "0755" stays "0755"
  collect: ["exclude"], // can repeat: collected in an array
  negatable: ["color"], // --no-color turns it off
  alias: { f: "force" }, // -f is --force
  default: { mode: "644" }, // when the flag is not given
  describe: { force: "Overwrite existing files" }, // for --help
})
copy(ctx: ChoCommandContext) {
  // ./fs copy a b -f --mode 0755 --exclude x --exclude y
  // { _: ["a", "b"], f: true, force: true, mode: "0755", exclude: ["x", "y"] }
}
```

They apply when that command runs, and only then: another command does not know
them. They are listed in the command's `--help` (section 5). A malformed
declaration, or a reserved flag in it, throws when the class is defined.

**The application declares flags for every command** with the `parseOptions`
option of `ChoCommand.create`, which takes `parseArgs` options (type
`ParserOptions`): `boolean`, `string`, `collect`, `negatable`, `alias`,
`default`, `stopEarly`, `"--"` and `unknown`. A command's flags are added to
them.

```ts
const app = ChoCommand.create(App, {
  parseOptions: { boolean: ["verbose"], string: ["config"] },
});
```

Whatever is declared, `--help` and `--version` keep the behavior of section 3.2.

### 3.4 Finding the command

With multiple actions, the command is the first word that **names an action**
and is not a flag, the value of a declared flag, or after `--`. It is removed,
and the rest is parsed with the application's options and the command's flags.

| Command line       | Runs   | Args                                                   |
| ------------------ | ------ | ------------------------------------------------------ |
| `copy a b`         | `copy` | `_: ["a", "b"]`                                        |
| `-v ls dir`        | `ls`   | `v: true`, `_: ["dir"]`: `-v` did not take `ls`        |
| `--out dir copy a` | `copy` | `out: "dir"`, `_: ["a"]`: `dir` is not an action       |
| `--force copy a`   | `copy` | `force: true`: a command's flag can come before it     |
| `--config ls copy` | `copy` | `config: "ls"`, once the application declares `config` |
| `copy -- ls`       | `copy` | `_: ["ls"]`                                            |

Only a word after a flag the **application** declares as `string` or `collect`
is known to be a value before the command is found; the value of any other flag
that happens to be an action name is taken as the command.

When no word names an action, the route is the first positional: it is reported
as an unknown action (section 4.2), or there is none.

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
| `overrides`    | none      | providers that replace declared ones, for tests           |
| `onError`      | none      | the application's error handler (section 4.4)             |

To run setup code before a command (open a connection, read a configuration
file, …), put it in a provider, an async factory if needed, and make the
controller depend on it: the injector creates it before the controller, once per
application.

To release it afterwards (close the connection), give the provider a
`[Symbol.asyncDispose]()` or `[Symbol.dispose]()` method and call `app.close()`
after the last `run()`. `run()` never does it: instances are kept between runs.

```ts
const app = ChoCommand.create(App);
const code = await app.run(Deno.args);
await app.close(); // disposes the instances, in reverse creation order
Deno.exit(code);
```

After `close()`, `run()` prints `Error: The injector is disposed` and resolves
to `1`.

### 4.2 `run(argv)`

Runs one command line and resolves to the exit code. It never exits the process:
pass the result to `Deno.exit` or `process.exit`.

1. `--help` prints the help (section 5) and resolves to `0`.
2. `--version` prints `<name> version <version>` and resolves to `0`.
3. In multiple-action mode, a command line without an action prints the help and
   resolves to `0`.
4. In multiple-action mode, an unknown action prints
   `Error: Action '<name>' not found. …` and resolves to `1`.
5. Otherwise the command's controller is created (with its dependencies, the
   first time only: later runs reuse it), and the method is called with the
   context (section 3.1), through its middlewares (section 4.3), and awaited.
   Only what that command needs is created.

Steps 1 to 4 are answered by the application itself: no middleware and no error
handler runs for them.

| Situation                                              | Exit code                 |
| ------------------------------------------------------ | ------------------------- |
| the command returns a non-negative integer `n`         | `n`                       |
| the command returns anything else, or nothing          | `0`                       |
| `--help`, `--version`, or no action (multiple actions) | `0`                       |
| a middleware returns a non-negative integer `n`        | `n`                       |
| the command fails, and its error handler returns `n`   | `n` (a non-negative int.) |
| the command fails, and its error handler returns other | `1`                       |
| the command fails, without an error handler            | `1`                       |
| the command fails, and its error handler fails too     | `2`                       |

An exit code above `255` is capped at `255`: a process reports exit codes modulo
256, so `256` would read as success. | an unknown action | `1` |

### 4.3 Middlewares

`@Middlewares(...)` (from `@chojs/command`) applies to a module that declares
controllers, a controller, or a command method. A middleware is either:

- a function `(ctx, next)`; or
- a class with a `handle(ctx, next)` method. It is created by the injector, in
  the scope of the module that declares the controller, so it must be a provider
  visible there, and it can have dependencies.

A middleware wraps the rest of the chain (the next middlewares, then the
command). It works as the middlewares of `@chojs/web` do, with the **exit code**
where web has a `Response`:

- `next()` runs the rest of the chain and resolves to its exit code;
- returning an exit code (a non-negative integer) ends the run with it: without
  calling `next()` to stop before the command, or after it to replace the exit
  code;
- returning nothing after calling `next()` passes the exit code on, so
  `await next();` alone is enough.

```ts
const confirm: ChoCommandMiddlewareFn = (ctx, next) =>
  ctx.args.yes ? next() : 1; // stops, with exit code 1

@Injectable([Config])
class LoadProfile {
  constructor(readonly config: Config) {}
  async handle(ctx: ChoCommandContext, next: ChoCommandNext) {
    ctx.state.set("profile", await this.config.profile(ctx.args.profile));
    return await next();
  }
}

@Middlewares(LoadProfile) // every command of the controller
@Controller()
class FileSystem {
  @Middlewares(confirm) // this command only
  @Action("rm")
  remove(ctx: ChoCommandContext) {
    const profile = ctx.state.get("profile");
    /* ... */
  }
}
```

A run executes the module's middlewares, then the controller's, then the
method's, each in declaration order. Middlewares belong to their commands: they
only run for a command they apply to, never for the commands of another
controller or module, nor for `--help`, `--version` or an unknown action.

**Nothing is created before a command runs.** A middleware class is created the
first time a command it applies to runs, and kept: printing the help creates
nothing. What can be checked without creating anything is checked by
`ChoCommand.create`: a middleware is a function or a class with a `handle`
method.

A middleware that calls `next()` twice, returns something that is not an exit
code, or returns nothing without calling `next()`, makes the run fail (section
4.4).

### 4.4 Errors and `@Catch`

`@Catch(handler)` (from `@chojs/command`) applies to a module that declares
controllers, a controller, or a command method. An error thrown by a command, by
a middleware, or while creating what the command needs (its controller, a
middleware class), goes to the nearest handler: the method's, else the
controller's, else the module's, else the application's.

```ts
@Injectable([Logger])
class ReportError {
  constructor(readonly logger: Logger) {}
  handle(error: unknown, ctx: ChoCommandContext) {
    this.logger.error(ctx.command, error);
    return 3;
  }
}

@Catch((error) => 2) // for every command of the controller
@Controller()
class FileSystem {
  @Catch((error) => (error instanceof NotFound ? 4 : 1)) // for `rm` only
  @Action("rm")
  remove(ctx: ChoCommandContext) {/* ... */}

  @Catch(ReportError) // a class, created by the injector
  @Action("sync")
  sync(ctx: ChoCommandContext) {/* ... */}
}
```

A handler is called with the error, as thrown, and the context of the run, and
awaited. Its result gives the exit code (section 4.2).

- **A function** is called as `(error, ctx)`.
- **A class** is created by the injector when it first has an error to handle,
  in the scope of the module that declares the controller (so it must be a
  provider visible there, and can have dependencies), and its
  `handle(error, ctx)` method is called.
- **The application's error handler** is the `onError` option of
  `ChoCommand.create`: the fallback for every command that no `@Catch` covers.
  It takes what `@Catch` takes; a class is created in the scope of the root
  module.
- If the handler fails (it throws, or the class cannot be created), `run()`
  prints the original error and resolves to `2`.
- Without a handler at any level, `run()` prints `Error: <message>` to stderr
  and resolves to `1`.

```ts
const app = ChoCommand.create(App, {
  onError: (error, ctx) => {
    console.error(`${ctx.command}: ${error}`);
    return 70;
  },
});
```

An unknown action is not an error of a command: it is reported by the
application (section 4.2) and no error handler runs.

### 4.5 Debug logging

`ChoCommand` logs to the `cho:command` debug context, on stderr. It is off by
default; enable it with `CHO_DEBUGLOG=cho:command`, `CHO_DEBUGLOG=cho:*` or
`CHO_DEBUG=1`. The core's `cho:di` context logs the injector (`core/specs.md`,
section 2.9).

```
cho:command actions mode: copy (Files.copy), rm (Files.remove)
cho:command run [ "copy", "a", "b" ]
cho:command copy (Files.copy) exited 0 +2ms
cho:command run [ "rm" ]
cho:command ERROR rm failed: Error: no such file
cho:command handled by onError
```

It logs the commands found when the application is created, each command line
with what it ran (a command, the help or the version), each command's exit code
and duration, each error, the error handler that received it, and a handler that
failed. Debug logging only adds these lines: errors are printed as described in
section 4.4 either way.

## 5. Help

`--help` prints to stdout, built from the `@Help` texts. The options listed are
the flags the command declares (section 3.3), then the two reserved flags. A
declared flag is shown with its other names, how it is written (`<value>` for a
`string`, `<value>...` for a `collect`, `--[no-]name` for a `negatable`), its
`describe` text and its default:

```
Options:
  -f, --force           Overwrite existing files
  --mode <value>        (default: 644)
  --exclude <value>...
  --[no-]color
  --help                Show this help
  --version             Show the version
```

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

| Export                                                                                  | Kind     | Section  |
| --------------------------------------------------------------------------------------- | -------- | -------- |
| `ChoCommand`, `ChoCommandOptions`                                                       | class    | 4        |
| `Main`, `Action`, `Help`                                                                | function | 2        |
| `Middlewares`, `Catch` (the core's, typed for `@chojs/command`)                         | function | 4.3, 4.4 |
| `ChoCommandContext`                                                                     | type     | 3.1      |
| `ChoArgs`, `CommandFlags`, `ParserOptions`                                              | type     | 3        |
| `ChoCommandHandler`, `ChoCommandNext`, `ChoCommandMiddlewareFn`, `ChoCommandMiddleware` | type     | 4.3      |
| `ChoCommandErrorHandlerFn`, `ChoCommandErrorHandler`                                    | type     | 4.4      |
| `Controller`, `Module` (the core's, with no extra option)                               | function | 2.1      |
| `Injectable` (re-exported from `@chojs/core`)                                           | function | 2.1      |
| `ControllerOptions`, `ModuleOptions`, `InjectableOptions` (re-exported, see core)       | type     | 2.1      |

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

Flags declared with `@Main` / `@Action`, each message starting with the
decorator (`@Action("copy"): …`):

- `TypeError: … the flags must be an object`
- `… unknown option "<key>". Known options: boolean, string, collect, negatable, alias, default, describe`
- `TypeError: … "<key>" must be an array of flag names` (`boolean`, `string`,
  `collect`, `negatable`)
- `TypeError: … "<key>" must be an object` (`alias`, `default`, `describe`)
- `… the flag "<name>" is reserved by the application` (`help`, `version`)

An unknown option of `@Module` or `@Controller` throws
`@Controller(): unknown option "<name>". Known options: dependencies`.

**By `ChoCommand.create`**, for the middlewares and error handlers of the
commands (nothing is created to check them):

- `Middleware class <Name> must implement 'handle' method.`
- `Error handler class <Name> must implement 'handle' method.` (`@Catch`, and
  the `onError` option)
- `Invalid error handler <v>: must be a function or a class with a 'handle' method.`
  (the `onError` option)

**By `ChoCommand.create`:** any module graph error of the core (`core/specs.md`,
section 2.8), and:

- `No @Main or @Action methods found in the application`
- `Mixing @Main and @Action methods in the same application is not allowed`
- `Multiple @Main methods in the same application is not allowed`
- `Duplicate @Action("<name>"): declared on <Controller>.<method> and <Controller>.<method>`

**Printed by `run()`** (exit code `1`), besides the command's own errors:

- `Error: middleware <name>: next() called more than once`
- `Error: middleware <name> returned no exit code: return an exit code or call next()`
- `Error: middleware <name> must return an exit code or nothing, got <typeof>`

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
- **Running.** Each command has a pipeline (`command/pipeline.ts`), built by
  `ChoCommand.create` from the core's metadata: the `middlewares` and the
  `errorHandler` of the module that declares the controller, of the controller
  and of the method. `run()` parses the command line, answers the built-ins,
  creates the context (`command/context.ts`) and calls the pipeline of the
  command.
- **Laziness.** On its first run, a pipeline resolves the controller and its
  middleware classes with the injector, in the scope of the module that declares
  the controller, and composes them around the command method with the core's
  `compose` (`@chojs/core/utils`, the runner `@chojs/web` uses too). An error
  handler class is resolved when it first has an error to handle. Everything is
  created once per application, and only for the commands that run.
- **Parsing.** `parseArgs` is a vendored copy of `@std/cli/parse-args`
  (`command/lib/parse-args.ts`), so the package has no dependency besides
  `@chojs/core`.
