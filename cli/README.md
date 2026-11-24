# @chojs/cli

[![JSR](https://jsr.io/badges/@chojs/cli)](https://jsr.io/@chojs/cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

`cho`, the command-line tool of the [CHO](../README.md) framework. It is a
[`@chojs/command`](../command/README.md) application: modules, controllers and
providers, like the applications it is made for.

```console
$ cho new shop
✔ What are you building? · A web application
✔ Runtime · Deno
✔ Project name · api
✔ Folder of the projects · apps
✔ Initialize a git repository? · Yes
✔ Install the dependencies? · Yes
```

## Installation

Install it once, for the whole machine. The command is `cho`.

```sh
# Deno
deno install --global --allow-env --allow-read --allow-write --allow-run --name cho jsr:@chojs/cli

npm install --global @chojs/cli   # Node.js
bun add --global @chojs/cli       # Bun
```

On Deno, the tool is given the permissions `cho new` needs: it reads and writes
the workspace, and runs `git` and the installation. Without one, Deno stops and
asks.

Or run it without installing it:

```sh
deno run --allow-env jsr:@chojs/cli --help   # Deno
npx @chojs/cli --help                        # Node.js
bunx @chojs/cli --help                       # Bun
```

## Usage

```console
$ cho
Usage: cho <command> [options] [args]

Commands:
  new   Create a new workspace, with a first project
  help  Show the help of cho, or of one of its commands

Options:
  --help     Show this help
  --version  Show the version

Run 'cho <command> --help' for help on a command.
```

| Command line           | What it does                                     |
| ---------------------- | ------------------------------------------------ |
| `cho`, `cho --help`    | Prints the help of the tool: every command       |
| `cho help`             | The same                                         |
| `cho help <command>`   | Prints the help of one command, and its options  |
| `cho <command> --help` | The same                                         |
| `cho --version`        | Prints the version of the tool: `cho version 3…` |
| `cho new [name]`       | Creates a workspace: see below                   |

The exit code is `0`, and `1` for a command the tool does not have.

## `cho new`

Creates a folder, and writes a workspace in it: a workspace of Deno, or of npm,
with one project. The project is a web application
([`@chojs/web`](../web/README.md)) or a command-line tool
([`@chojs/command`](../command/README.md)), with its tests, and it runs as it
is.

```
shop/
  cho.json           the settings of the workspace, for cho
  deno.json          the workspace (package.json on Node.js and on Bun)
  README.md
  apps/
    api/
      deno.json      the project: its dependencies, its tasks
      main.ts        runs the application
      app.ts         the application: AppModule
      app_test.ts    its tests
```

It asks what it was not told. Every question has a flag, so the command runs in
a script as it runs in a terminal:

| Flag                  | Answers                               | Default                   |
| --------------------- | ------------------------------------- | ------------------------- |
| `<name>`              | The name of the workspace: its folder | None: it is asked         |
| `--kind <kind>`       | What the project is: `web` or `cli`   | `web`                     |
| `--runtime <runtime>` | `deno`, `node` or `bun`               | The runtime `cho` runs on |
| `--project <name>`    | The name of the project               | `api`, or `cli`           |
| `--apps-dir <name>`   | The folder of the projects            | `apps`                    |
| `--no-git`            | Does not run `git init`               | It is run                 |
| `--no-install`        | Does not install the packages         | They are installed        |
| `--yes`, `-y`         | Takes the default of every question   |                           |

```sh
cho new shop --yes                              # the defaults
cho new tool --kind cli --runtime bun --yes     # a command-line tool, on Bun
```

- **A name** is lower case letters, digits and `-`, and starts with a letter.
- **The folder must not exist**, even empty: `cho new` writes in a folder it
  created, and nowhere else.
- **Without a terminal**, a question that is still to ask is an error: give
  every answer as a flag, or `--yes`. No default is taken silently.
- **Ctrl+C** on a question cancels: nothing was written, and the exit code is
  `130`.
- **A step that fails** (`git init`, the installation) leaves the workspace,
  which is whole, and says what to run. The exit code is `1`.
- **No linter and no formatter is installed.** Deno has both (`deno fmt`,
  `deno lint`), and Bun has `bun fmt`.
- On Node.js, the project is run by [`tsx`](https://tsx.is): Node.js does not
  run the decorators of TypeScript.

### `cho.json`

The settings of a workspace, at its root: what `cho` needs to know and the
manifests do not say.

```json
{
  "$schema": "https://chojs.io/schema/cho.v1.json",
  "version": 1,
  "runtime": "deno",
  "appsDir": "apps",
  "projects": {
    "api": {
      "kind": "web",
      "root": "apps/api",
      "entry": "main.ts",
      "module": "app.ts"
    }
  }
}
```

Its JSON Schema is [`cho.schema.json`](./new/cho.schema.json): an editor
completes the fields, and marks a mistake. The
[specification](./specs.md#4-chojson) describes each field.

## Two packages, one tool

The packages of CHO are published to [JSR](https://jsr.io/@chojs), as
TypeScript. Deno installs a command from there. npm does not: a command of npm
is JavaScript, in a package with a `bin` entry. So the tool is published twice,
from the same source and with the same version:

| Registry | Package      | What it holds                                                |
| -------- | ------------ | ------------------------------------------------------------ |
| JSR      | `@chojs/cli` | The source. It depends on `@chojs/command`, `@chojs/prompt`  |
| npm      | `@chojs/cli` | One JavaScript file, with the framework in it: no dependency |

The npm package is built in [`npm/`](./npm.ts), a folder that is not kept in
git. A release publishes the one of JSR, and sends the one of npm to wait there
for the approval of a maintainer. CI runs the dry run of both:

```sh
deno task --cwd cli npm        # builds cli/npm/
npm pack --dry-run ./cli/npm   # packs it and lists its files, sends nothing
```

The [specification](./specs.md) says how the tool is built and released.

## Development

```sh
deno run --allow-env cli/main.ts --help   # Deno
npx tsx cli/main.ts --help                # Node.js
bun cli/main.ts --help                    # Bun
```

| File                   | What it is                                        |
| ---------------------- | ------------------------------------------------- |
| [`main.ts`](./main.ts) | The entry point: runs the command line, and exits |
| [`app.ts`](./app.ts)   | The root module, and `run_cli`: one command line  |
| [`help.ts`](./help.ts) | The `help` command                                |
| [`new/`](./new)        | The `new` command, and all it needs               |
| [`npm.ts`](./npm.ts)   | The build of the npm package                      |

The tool is an application of CHO, written as one would be: a command is a
method of a controller, and calls plain functions from top to bottom. `new` is
[`new/new.ts`](./new/new.ts):

```ts
const cwd = process.cwd();
const flags = read_flags(ctx.args); //            what the command line said
const answers = await ask_answers(flags, cwd); // the questions, for the rest
return create_workspace(answers, cwd); //         plan, write, run the steps
```

The templates of `cho new` are the folders of
[`new/templates/`](./new/templates): real projects, checked and tested with the
repository. The tool holds them as text, in `new/templates.gen.ts`, and the
schema of `cho.json` is made from the constants of
[`new/config.ts`](./new/config.ts). After a change to either:

```sh
deno task --cwd cli gen   # writes templates.gen.ts and cho.schema.json
```

A test fails when one of the two was not written again.

A new command is a controller with an `@Action`, added to a module of
[`app.ts`](./app.ts). Its tests call `run_cli`, and check the exit code and what
was printed: see [`app_test.ts`](./app_test.ts).

## Runtime support

Deno, Node.js 24 and Bun: the tests run on the three. A Cloudflare Worker has no
command line.
