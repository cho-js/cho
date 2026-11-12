# @chojs/command Specifications

`@chojs/command` builds command-line applications on top of `@chojs/core`. An
application is a module graph whose controllers have command methods. The
command module reads their metadata, parses the command line and calls the right
method.

This document specifies the command module as implemented in `command/`. The
source code is the reference: when this document and the code disagree, the code
wins. Behaviors that are likely unintended are listed in section 9.

## 0. Overview

There are two modes: a single command, like `ls`, and multiple actions, like
`git`.

Single-command mode:

```ts
import { Controller, Module } from "@chojs/core";
import { ChoCommand, Help, Main } from "@chojs/command";
import type { ChoArgs } from "@chojs/command";

@Help("List files")
@Controller()
class ListFiles {
  @Help("List the files of a directory")
  @Main()
  main(args: ChoArgs) {
    if (args._.length !== 1) {
      throw new Error("expected one directory");
    }
    const path = String(args._[0]);
    // ...
    // returning nothing exits with 0
  }
}

@Module({ controllers: [ListFiles] })
class App {}

const app = ChoCommand.create(App, { name: "ls", version: "1.0.0" });
Deno.exit(await app.run(Deno.args));
```

Multi-command mode:

```ts
import { Catch, Controller, Module } from "@chojs/core";
import { Action, ChoCommand, Help } from "@chojs/command";
import type { ChoArgs } from "@chojs/command";

@Help("File system commands")
@Catch((error) => 2) // for every action of the controller
@Controller()
class FileSystem {
  @Help("Copy a file")
  @Action("copy")
  copy(args: ChoArgs) {}

  @Help("Delete a file")
  @Action("rm")
  remove(args: ChoArgs) {
    return 3; // exit code
  }
}

@Module({ controllers: [FileSystem] })
class App {}

const app = ChoCommand.create(App, { name: "fs", version: "1.0.0" });
Deno.exit(await app.run(Deno.args));
```

```shell
$ ./fs copy src dest
$ ./fs rm path/to/file
$ ./fs --version
fs version 1.0.0
```

The example apps `examples/hello-world-cli.ts` and
`examples/multi-actions-cli.ts` run the two modes.

---

## 1. Package and public API (`mod.ts`)

| Export              | Kind     | Section |
| ------------------- | -------- | ------- |
| `ChoCommand`        | class    | 6       |
| `ChoCommandOptions` | type     | 6.1     |
| `Main`              | function | 3.2     |
| `Action`            | function | 3.3     |
| `Help`              | function | 3.4     |
| `ChoArgs`           | type     | 5.1     |
| `ParserOptions`     | type     | 5.4     |

`mod.ts` also re-exports, unchanged, from `@chojs/core/di`: `Controller`,
`Module`, `Injectable`, `Catch`, and the types `ControllerOptions` and
`ModuleOptions`. An application can import everything it needs from
`@chojs/command`. `@Middlewares` is not re-exported (section 6.5).

Dependencies: `@chojs/core` (`/di` and `/utils`). `parseArgs` is a vendored copy
of `@std/cli/parse-args` in `lib/parse-args.ts`, so the package has no
`@std/cli` dependency.

---

## 2. Concepts

### 2.1 Controllers and commands

The command module relies on core's controllers (`../core/specs.old.md` §3.4, §6.6):
`@Controller()` marks a class, `@Module({ controllers: [...] })` declares it,
and the injector creates it. The command module never creates instances any
other way.

A **command method** is a controller method decorated with `@Main` or `@Action`
(section 3). Each one has an **alias**, the name it is invoked by: the action
name, or `"main"` for `@Main`.

### 2.2 Modes

An application runs in exactly one mode, decided by the whole module graph when
it is created (section 4):

| Mode        | Command methods                   | Invocation                         |
| ----------- | --------------------------------- | ---------------------------------- |
| `"main"`    | exactly one `@Main`, no `@Action` | `./app [options] [args]`           |
| `"actions"` | one or more `@Action`, no `@Main` | `./app <command> [options] [args]` |

### 2.3 Which controllers count

Every controller of the module graph is scanned once, in the order of
`Injector.controllers()` (core §6.6): modules in post-order (imports before
importers, the root last), and within a module, its controllers in declaration
order. Within a controller, methods are scanned in declaration order. Only
methods with a `@Main` or `@Action` record are commands; any other method (with
or without other metadata, such as `@Help` alone) is ignored, and a controller
without command methods is ignored. It may belong to another application module.

### 2.4 Namespace

Action names share one flat namespace across the whole graph: two `@Action`s
with the same name, in any controllers or modules, are a create-time error.
There are no groups, nested subcommands or aliases.

---

## 3. Decorators (`decorators.ts`)

### 3.1 Common rules

- The decorators work with TC39 decorators and with legacy or Bun decorators.
  They take the call shapes of core's `ChoMethodDecorator` (`@Main`, `@Action`)
  and `ChoClassOrMethodDecorator` (`@Help`), and find their target with core's
  `decorated_method` and `decorated_target`.
- A method record is written on the **method function**, where the metadata
  graph reads it (core §4.2). A class record is written on the class (legacy) or
  on `context.metadata` (TC39), so it merges with the `@Controller` record.
- Records are merged with `add_to_metadata_object`, so `@Help` combines with a
  command decorator in any order, and with core's `@Catch` and `@Middlewares`.
- Every rule is checked when the decorator is applied, that is when the class is
  defined. A failed check throws and writes nothing.

### 3.2 `@Main()`

Marks a method as the single command of the application.

- Writes `{ isMain: true, name, alias: "main" }` on the method, where `name` is
  the method name.
- The method must follow the method rules (section 3.5), and must not already
  have a command decorator (section 3.6).

### 3.3 `@Action(name)`

Marks a method as the command `name`.

- Writes `{ isAction: true, name: <method name>, alias: name }` on the method.
- `name` must be a non-empty string, with no whitespace (`/\s/`), that does not
  start with `-`. Such a name can be typed as one command-line word that is not
  a flag. Any other character is accepted (`x-y`, `v1.2`, `42`).
- The method must follow the method rules (section 3.5), and must not already
  have a command decorator (section 3.6).

### 3.4 `@Help(text)`

Help text for a controller class or for a method.

- `text` must be a non-empty string.
- Writes `{ help: text }` on the class or the method.
- It can decorate any method, including a static, private or non-command one;
  the method rules do not apply.
- Only the texts of controllers and command methods are shown (section 7); the
  others are stored but never read.

### 3.5 Method rules

A command method must be:

- **string-named**: not a symbol-named method;
- **public**: not a `#private` method (TC39 only: legacy decorators cannot
  decorate private methods);
- **non-static**: a static method is detected from `context.static` (TC39) or
  from a `target` that is the class rather than its prototype (legacy).

The decorated member must be a method: a field, an accessor or a class is
rejected by `decorated_method`.

These rules exist because the metadata graph only collects the own, string-named
methods of the controller's prototype; any other method would be silently
dropped.

### 3.6 One command per method

A method has at most one `@Main` or `@Action`. Both write into the same method
record, so a second one would overwrite the first one's `alias`; it throws
instead. Decorators are applied bottom up, so the error names the lower
decorator as the existing one.

---

## 4. The command graph (`graph.ts`)

`command_graph(injector)` turns the injector's controllers into a
`CommandGraph`:

```ts
type ControllerNode = DependencyNode<ControllerMetadata>;

type CommandGraph = {
  mode: "main" | "actions";
  actions: [ControllerNode, MethodMetadata][];
};
```

Algorithm:

1. For each controller node of `injector.controllers()`, and each of its
   `meta.methods`: a method with `isMain` is a main method; otherwise a method
   with `isAction` is an action. An action whose alias was already seen throws
   at once (duplicate action).
2. No main method and no action: throws.
3. Main methods and actions: throws (mixing).
4. More than one main method: throws.
5. Returns `{ mode: "main", actions: [main] }` or
   `{ mode: "actions", actions }`, actions in scan order.

The controller node gives the controller class (`token`), its module (`owner`),
its method records (`meta.methods`) and every other key of its class record
(`meta.help`, `meta.errorHandler`, ...; core §4.1).

---

## 5. Parsing the command line (`args.ts`)

### 5.1 `ChoArgs`

`ChoArgs` is `Args` of the vendored `@std/cli/parse-args` (`lib/parse-args.ts`):
the result of `parseArgs` (minimist API), with every key typed `any`.

- `_` holds the positionals. Positionals that look like numbers are numbers
  (`"42"` → `42`); handlers that need strings convert them.
- In multi-command mode, `_` does not include the command name.
- `help` and `version` are never in it (section 5.2).

### 5.2 Reserved flags

Only the long flags `--help` and `--version` are reserved. They are parsed as
negatable booleans, then removed from the handler's arguments:

- `-h`, `-v` and every other short flag go to the handler;
- `--help` never consumes the next word: `--help copy` is help for `copy`;
- `--help=false`, `--no-help`, `--version=false` and `--no-version` are off, and
  do not consume the next word either.

This holds whatever parser options are given (section 5.4).

### 5.3 Parsers

Both parsers parse the whole `argv` once and return
`{ args, route, help, version }`:

| Parser             | Mode        | `route`                                                       | `args._`                 |
| ------------------ | ----------- | ------------------------------------------------------------- | ------------------------ |
| `ChoMainParser`    | `"main"`    | always `"main"`                                               | every positional         |
| `ChoActionsParser` | `"actions"` | the first positional, as a string, or `""` when there is none | the positionals after it |

Flags are parsed without declarations, so a flag that is not reserved takes the
next word as its value when that word is not a flag: `--out dir` gives
`out: "dir"`. Before the command name, this takes the command name too (see
section 9), unless the flag is declared a boolean (section 5.4).

### 5.4 Parser options

`parse(argv, options?)` takes `ParserOptions`, which are the `ParseOptions` of
`parseArgs` (`boolean`, `string`, `collect`, `negatable`, `alias`, `default`,
`stopEarly`, `"--"`, `unknown`). `ChoCommand` passes its `parseOptions` option
(section 6.1). The options declare the handlers' flags. For example,
`{ boolean: ["force"] }` makes `--force copy` run `copy`.

The reserved flags keep the behavior of section 5.2 whatever the options say:

- `help` and `version` are added to `boolean` and `negatable`. With
  `boolean: true`, every flag without a value is a boolean, the reserved flags
  included;
- `help` and `version` are removed from `string`, `collect` and `default`;
- the caller's options object is not changed.

A list option can be a single name (`boolean: "force"`) or a list of names.

---

## 6. `ChoCommand` (`command.ts`)

### 6.1 `ChoCommand.create(app, options = {})`

- Creates an `Injector` for the root module `app`. Its read and link errors
  (core §8.2, §8.3) are thrown as is.
- Builds the command graph (section 4). Its errors are thrown as is.
- Picks the parser of the mode (section 5.3).
- Creates no instance: controllers and modules are created on `run()`.

Options (`Partial<ChoCommandOptions>`):

| Option         | Default   | Use                                                  |
| -------------- | --------- | ---------------------------------------------------- |
| `name`         | `"chojs"` | the `--version` output and the help usage lines      |
| `version`      | `"1.0.0"` | the `--version` output                               |
| `initModule`   | off       | create the controller's module before the controller |
| `parseOptions` | none      | `parseArgs` options for the handlers' flags (5.4)    |

The constructor is public, but `create` is the way to build a `ChoCommand`.

### 6.2 `run(argv)`

`run(argv: string[]): Promise<number>` runs one command line and resolves to the
process exit code. It never exits the process itself. Steps, in order:

1. Parse `argv` with the mode's parser.
2. `--help`: print the help for `route` (section 7) and return `0`. Nothing
   runs.
3. `--version`: print `<name> version <version>` with `console.log` and return
   `0`. Nothing runs.
4. Multi-command mode without a command name: print the global help and return
   `0`.
5. Find the command method whose alias is `route`. None: an error (handled by
   step 9, without an error handler).
6. With `initModule`: resolve the controller's module (`node.owner`) in its own
   scope. This creates the module class and its dependencies; it does not run
   `Injector.init()`.
7. Resolve the controller in its module's scope. The injector creates it on the
   first run and returns the same instance afterwards.
8. Call the method on the controller, with `args`, and await it. It returns a
   non-negative integer: that is the exit code. Anything else (including
   nothing): `0`.
9. On any error thrown or rejected in steps 5 to 8, including a failure to
   create the controller or its dependencies, see section 6.3.

### 6.3 Errors and `@Catch`

The error handler of a command is found in this order:

1. the method's `errorHandler` (`@Catch` on the method);
2. the controller's `errorHandler` (`@Catch` on the controller class), read from
   the controller node's metadata;
3. none: the default.

How the handler runs depends on what it is (a class is a function whose
`prototype` is not writable, see core's `isClass`):

- **A function** (not a class): it is called with the error, as thrown (an
  `Error` or any other value), and its result is awaited, so an `async` handler
  works. A non-negative integer is the exit code; anything else gives `1`. If
  the handler throws or rejects, `run()` rejects with that error.
- **A class**: it is resolved with the injector in the scope of the controller's
  module (`node.owner`), then the instance is called as a function with the
  parsed `args` (not the error), and its result is awaited. A non-negative
  integer is the exit code; anything else gives `1`. If resolving or calling
  fails, `run()` prints `Error: <message>` of the **original** error with
  `console.error` and returns `2`. Since an instance is normally not callable, a
  class handler in practice always prints the error and returns `2` (see section
  9).

The default prints `Error: <message>` with `console.error` (stderr) and returns
`1`. `<message>` is the error's `message` for an `Error`, `String(error)` for
any other value. It always prints, whatever the debug logging settings.

An unknown command (step 5) has no action yet, so it always gets the default.

### 6.4 Exit codes

| Situation                                          | Exit code                           |
| -------------------------------------------------- | ----------------------------------- |
| the method returns a non-negative integer `n`      | `n`                                 |
| the method returns anything else                   | `0`                                 |
| `--help`, `--version`, or no command (multi mode)  | `0`                                 |
| the method fails, and an error handler returns `n` | `n` (a non-negative integer) or `1` |
| the method fails, and a class error handler fails  | `2`                                 |
| the method fails, without an error handler         | `1`                                 |
| unknown command                                    | `1`                                 |

### 6.5 What the command module does not use

- `@Middlewares` records are stored by core but never run.
- Extra `@Controller({...})` options are kept on the controller node, but the
  command module does not read them.

---

## 7. Help (`help.ts`)

`run()` prints the help text with `console.log` (stdout) for `--help` (with the
parsed route) and for a missing command in multi-command mode (with `""`); both
exit `0`. Help is not part of the public API: `ChoCommand` prints it only from
`run()`. The text is built by `format_help(graph, name, route)` from the `@Help`
records: the controller's in `node.meta.help`, the method's in
`method.meta.help`. `name` is the `name` option.

Help texts are trimmed. Where one line fits (a group heading, the list of
commands), the first line is used; the usage line and the descriptions are
separated by a blank line, and missing texts are left out.

Which help is shown:

| Mode    | Route                    | Help                       |
| ------- | ------------------------ | -------------------------- |
| main    | any                      | the `@Main` command's help |
| actions | `""`, or no such command | the global help            |
| actions | a command name           | that command's help        |

The route is matched as a command name only in multi-command mode, so an action
named `main` shows its own help.

Single-command mode: the usage, the controller's `@Help`, the method's `@Help`,
then the options.

```
Usage: ls [options] [args]

List files

List the files of a directory

Options:
  --help     Show this help
  --version  Show the version
```

Multi-command mode, one command: the usage, the method's `@Help` (all of it),
then the options.

```
Usage: fs copy [options] [args]

Copy a file

Options:
  --help     Show this help
  --version  Show the version
```

Multi-command mode, global help: the commands, grouped under the first line of
their controller's `@Help`. Commands of controllers without `@Help` are under
`Commands`. Controllers with the same heading share a group. Groups and commands
keep the scan order (section 2.3), and each command shows the first line of its
`@Help`, aligned.

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

The options are always the two reserved flags (section 5.2): flags are not
declared, so no other flag is listed.

---

## 8. Errors

### 8.1 Thrown by the decorators (section 3)

| Decorator         | Message                                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `@Action`         | `TypeError: Action must be a non-empty string`                                                                                 |
| `@Action`         | `TypeError: @Action("<name>"): the name must not contain whitespace`                                                           |
| `@Action`         | `TypeError: @Action("<name>"): the name must not start with "-"`                                                               |
| `@Main`/`@Action` | `TypeError: <decorator> cannot decorate method Symbol(...): a command method must have a string name`                          |
| `@Main`/`@Action` | `TypeError: <decorator> cannot decorate private method '#<name>': a command method must be public`                             |
| `@Main`/`@Action` | `TypeError: <decorator> cannot decorate static method '<name>': a command method must not be static`                           |
| `@Main`/`@Action` | `TypeError: <decorator> can only decorate a method`                                                                            |
| `@Main`/`@Action` | `Error: Cannot add <decorator> to method '<name>': it already has <existing>. A method can have at most one @Main or @Action.` |
| `@Help`           | `TypeError: Help must be a non-empty string`                                                                                   |
| `@Help`           | `TypeError: @Help() can only decorate a class or a method` (or `... a method`)                                                 |

### 8.2 Thrown by `ChoCommand.create` (section 4)

- `No @Main or @Action methods found in the application`
- `Mixing @Main and @Action methods in the same application is not allowed`
- `Multiple @Main methods in the same application is not allowed`
- `Duplicate @Action("<name>"): declared on <Controller>.<method> and <Controller>.<method>`
- any error of `new Injector(app)` (core §8.2, §8.3).

### 8.3 Handled by `run()` (section 6.3)

`run()` resolves to an exit code for every error in steps 5 to 8, unless a
function error handler throws. The messages of its own errors, printed by the
default handler:

- `Action '<name>' not found. Use --help for usage information.`
- `Method '<name>' is not a function on controller '<Controller>'.`

---

## 9. Known gaps

Behaviors of the current code that are not enforced or are likely unintended.
They are listed so the specification stays truthful; they are not guarantees.

- **A flag before the command name swallows it.** `./app -v ls` parses `ls` as
  the value of `-v`, so there is no command name: it shows the help and exits
  `0` without running `ls`. `./app ls -v` works (section 5.3), and so does
  declaring the flag a boolean in `parseOptions` (section 5.4).
- **Class error handlers do not work.** A class given to `@Catch` is resolved
  with the injector (so it must be a provider visible in the controller's
  module), then the instance is called as a function with `args` instead of the
  error. An instance is not callable, so the call throws: the original error is
  printed and the exit code is `2`, whatever the class does. A class that is not
  provided fails the same way.
- **A function error handler that throws** makes `run()` reject instead of
  resolving to an exit code.
- **The `cho` debug logger is unused.** Errors are printed with `console.error`,
  not with `debuglog("cho")`, so `CHO_DEBUG` does not change what `run()`
  prints.
- **Middlewares are not run** (section 6.5).
- **Unknown command with `--help`.** `./app nope --help` shows the global help
  and exits `0`, without saying that `nope` is not a command.
