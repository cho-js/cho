# @chojs/cli

`cho`, the command-line tool of the CHO framework. It is an application of
`@chojs/command` (see `command/specs.md`), and runs on Deno, Node.js and Bun.

This document describes what the tool does, how it is built and how it is
published. The source code is the reference: when this document and the code
disagree, the code wins.

This version is the base of the tool: it is installed, it is named `cho`, and it
has one command, `help`.

## 1. Overview

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

- **One tool, three runtimes.** The same source runs on Deno, on Node.js and on
  Bun. Nothing in it is written for one of them.
- **Two packages.** Deno installs the tool from JSR, as the other packages of
  CHO. npm and Bun install it from npm, where it is one JavaScript file with no
  dependency (section 4).
- **The version of the framework.** The tool has the version of the other
  packages, and is released with them (section 5).

## 2. The command line

It is a multiple-actions application: the first word names the command.

| Command line           | Prints                                    | Exit code |
| ---------------------- | ----------------------------------------- | --------- |
| `cho`                  | The help of the tool: every command       | `0`       |
| `cho --help`           | The same                                  | `0`       |
| `cho help`             | The same                                  | `0`       |
| `cho help <command>`   | The help of the command, with its options | `0`       |
| `cho <command> --help` | The same                                  | `0`       |
| `cho --version`        | `cho version <version>`                   | `0`       |
| `cho <unknown>`        | An error, on the error output             | `1`       |

- The help and the version go to the standard output, an error to the error
  output.
- The version is the one of the package: it is read from `deno.json`, and is
  written nowhere else.
- `cho help <unknown>` prints the help of the tool, with exit code `0`, as
  `cho <unknown> --help` does: it is the rule of `@chojs/command`.
- The words after the first argument of `help` are ignored.

### 2.1 The `help` command

`@chojs/command` writes the help of an application, for `--help`, and the tool
writes none of its own. `help` runs the command line that asks for the same
text:

| Command line         | Runs                   |
| -------------------- | ---------------------- |
| `cho help`           | `cho --help`           |
| `cho help <command>` | `cho <command> --help` |

So the two never differ, and a command that is added is in both.

The text of a command is its `@Help`: the first line is in the list of the
commands, and the whole text is in the help of the command.

## 3. The application

| File          | What it holds                                                 |
| ------------- | ------------------------------------------------------------- |
| `main.ts`     | The entry point: runs the command line of the process, exits  |
| `app.ts`      | `AppModule`, the root module, and `run_cli`                   |
| `help.ts`     | `HelpCommands`, the controller of `help`, and the `RUN` token |
| `app_test.ts` | The tests                                                     |
| `npm.ts`      | The build of the npm package (section 4.2)                    |

- **`run_cli(argv)`** runs one command line: it creates the application, runs
  it, releases what it created (`close()`), and resolves to the exit code. It
  never exits the process. The tests call it.
- **`main.ts`** is the only file that reads the process: it gives
  `process.argv.slice(2)` to `run_cli`, and exits with the result
  (`process.exit`). Both are those of `node:process`, which the three runtimes
  have.
- **`RUN`** is a token: a function that runs a command line of the tool, and
  resolves to its exit code. The root module provides it, with `run_cli`. A
  command that runs another one, as `help` does, asks for it as a dependency: it
  does not import the application.
- The classes are declared with decorator syntax (`@Module`, `@Controller`,
  `@Action`), as an application is. Deno and Bun run it as it is, the tests on
  Node.js run it through `tsx`, and the npm package is compiled (section 4.2).

### 3.1 Adding a command

A command is a method with `@Action` and `@Help`, on a controller that a module
declares. A command of its own area gets a controller of its own, in a file of
its own, and the module that declares it is imported by `AppModule`.

Its tests call `run_cli`, with `console.log` and `console.error` captured, and
compare the exit code and what was printed: what a user sees.

## 4. Two packages

The packages of CHO are published to JSR, as TypeScript. A command of npm is
JavaScript, in a package whose `package.json` has a `bin` entry, and JSR makes
no such package. So the tool is published twice, from the same source, with the
same name and the same version.

| Registry | Package      | What it holds                         | Depends on       |
| -------- | ------------ | ------------------------------------- | ---------------- |
| JSR      | `@chojs/cli` | The source: `main.ts` is its export   | `@chojs/command` |
| npm      | `@chojs/cli` | `cho.js`: the tool, and the framework | nothing          |

### 4.1 Installation

```sh
deno install --global --allow-env --name cho jsr:@chojs/cli   # Deno
npm install --global @chojs/cli                               # Node.js
bun add --global @chojs/cli                                   # Bun
```

- On Deno, `--name cho` names the command: without it, Deno names it after the
  package, `cli`.
- On Deno, `--allow-env` lets the tool read its environment: `@chojs/command`
  reads `CHO_DEBUG` for its debug log. Without it, in a terminal, Deno stops and
  asks the user to allow each variable. It is the only permission `help` needs;
  a command that writes files or runs a program will need its own.
- On npm and on Bun, the name is the `bin` entry of the package.

### 4.2 The npm package

`deno task --cwd cli npm` runs `npm.ts`, which writes the package in `cli/npm/`:

| File           | What it is                                             |
| -------------- | ------------------------------------------------------ |
| `cho.js`       | `main.ts` and all it imports, bundled by `deno bundle` |
| `package.json` | Written by `npm.ts`                                    |
| `README.md`    | A copy                                                 |
| `LICENSE`      | A copy                                                 |

- **The bundle.** One ES module. The decorators are compiled, `@chojs/command`
  and `@chojs/core` are in it, and the only imports that are left are those of
  `node:`. Its first line is `#!/usr/bin/env node`, and the file is executable.
- **It is not minified.** CHO puts the names of classes and functions in its
  help and in its error messages: the bundle keeps them.
- **The manifest.** `name`, `version` and `license` are those of `deno.json`.
  `bin` is `{ "cho": "cho.js" }`. `engines` names the versions the tests run on:
  Node.js 24 and Bun 1.3.4. `publishConfig.access` is `public`. `repository` is
  the repository of CHO, with `cli` as its directory: npm compares it with the
  workflow that publishes (section 5.2).
- **The folder is built, not kept.** It is ignored by git, it is not a part of
  the JSR package, and `deno check`, `deno lint`, `deno fmt` and the tests skip
  it. `npm.ts` empties it first.
- `npm.ts` runs on Deno only: it is the build, not a part of the tool.

## 5. Releases

The tool is a package of the workspace, and a component of the linked versions
of `release-please`: it gets the version of every other package, in the same
release pull request (`release-please-config.json`).

### 5.1 Before a release: the dry runs

Both run in CI, on every pull request and every push to `main`:

| Registry | Job    | Command                           |
| -------- | ------ | --------------------------------- |
| JSR      | `deno` | `deno publish --dry-run`          |
| npm      | `node` | `npm publish --dry-run ./cli/npm` |

The job of npm builds the package first, and runs `node cli/npm/cho.js
--help`:
the file a user would get.

A dry run packs the package, checks its manifest and lists its files, and sends
nothing. It does not check that the workflow may publish: that is known when a
release runs.

### 5.2 The release

`release.yml`, when a release pull request is merged:

1. `deno publish`: every package whose version is not on JSR yet, the tool
   included.
2. `deno task --cwd cli npm`, and `npm publish ./cli/npm`. A version that is
   already on npm is skipped, as on JSR: the job can run again.

JSR is first: when npm fails, running the job again publishes what is missing.

npm accepts the workflow in one of two ways:

- **Trusted publishing.** The package names, on npmjs.com, the repository
  (`cho-js/cho`) and the workflow (`release.yml`) that may publish it. The
  workflow has the `id-token: write` permission, which JSR uses too, and no
  secret is kept. npm adds the provenance of the package itself.
- **A token**, in the `NPM_TOKEN` secret of the repository.

## 6. Runtime support

| Runtime            | Runs the tool | How it is tested                              |
| ------------------ | ------------- | --------------------------------------------- |
| Deno               | Yes           | `deno test`, on the source                    |
| Node.js 24         | Yes           | `tsx --test`, on the source; the bundle in CI |
| Bun                | Yes           | `bun test`, on the source                     |
| Cloudflare Workers | No            | A Worker has no command line                  |

## 7. Errors

The tool has no error code of its own. What it prints for a command it does not
have is the message of `@chojs/command`.

## 8. Decisions

1. **In the repository of the framework**, at the top level, like `command/`.
   The tool is tested against the source of the framework, in the same pull
   request, and is released with it.
2. **The version of the framework.** The version of the tool says which version
   of CHO it is made for.
3. **`help` is a command, and has no text of its own.** An application of
   `@chojs/command` has at least one command, and `help` is the one a tool
   always has. It runs `--help`, so there is one help.
4. **A bundle for npm, the source for JSR.** A package with dependencies on npm
   would need every package of CHO there too. One file with the framework in it
   needs none, and installs with no download but its own.
5. **`node:process`, not `Deno.args`.** One entry point for the three runtimes.
6. **The npm package is written by the build.** `deno.json` stays the only
   manifest in git: there is one name and one version to keep.

## 9. Not in this version

- Any command but `help`: creating a project, the tools of `@chojs/dev`.
- A test of the installed command on Bun (`bun add --global`): the bundle is run
  by Bun, the installation is not.
- A check of the bundle on a Node.js older than 24.
