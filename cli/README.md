# @chojs/cli

[![JSR](https://jsr.io/badges/@chojs/cli)](https://jsr.io/@chojs/cli)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

`cho`, the command-line tool of the [CHO](../README.md) framework. It is a
[`@chojs/command`](../command/README.md) application: modules, controllers and
providers, like the applications it is made for.

> It is the base of the tool. For now it has one command, `help`.

## Installation

Install it once, for the whole machine. The command is `cho`.

```sh
deno install --global --allow-env --name cho jsr:@chojs/cli   # Deno
npm install --global @chojs/cli                               # Node.js
bun add --global @chojs/cli                                   # Bun
```

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

The exit code is `0`, and `1` for a command the tool does not have.

## Two packages, one tool

The packages of CHO are published to [JSR](https://jsr.io/@chojs), as
TypeScript. Deno installs a command from there. npm does not: a command of npm
is JavaScript, in a package with a `bin` entry. So the tool is published twice,
from the same source and with the same version:

| Registry | Package      | What it holds                                                |
| -------- | ------------ | ------------------------------------------------------------ |
| JSR      | `@chojs/cli` | The source. It depends on `@chojs/command`                   |
| npm      | `@chojs/cli` | One JavaScript file, with the framework in it: no dependency |

The npm package is built in [`npm/`](./npm.ts), a folder that is not kept in
git. A release publishes both, and CI runs the dry run of both:

```sh
deno task --cwd cli npm           # builds cli/npm/
npm publish --dry-run ./cli/npm   # packs it and checks it, sends nothing
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
| [`npm.ts`](./npm.ts)   | The build of the npm package                      |

A new command is a controller with an `@Action`, added to a module of
[`app.ts`](./app.ts). Its tests call `run_cli`, and check the exit code and what
was printed: see [`app_test.ts`](./app_test.ts).

## Runtime support

Deno, Node.js 24 and Bun: the tests run on the three. A Cloudflare Worker has no
command line.
