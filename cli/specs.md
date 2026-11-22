# @chojs/cli

`cho`, the command-line tool of the CHO framework. It is an application of
`@chojs/command` (see `command/specs.md`), and runs on Deno, Node.js and Bun.

This document describes what the tool does, how it is built and how it is
published. The source code is the reference: when this document and the code
disagree, the code wins.

## 1. Overview

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

- **One tool, three runtimes.** The same source runs on Deno, on Node.js and on
  Bun. Nothing in it is written for one of them.
- **Two packages.** Deno installs the tool from JSR, as the other packages of
  CHO. npm and Bun install it from npm, where it is one JavaScript file with no
  dependency (section 6).
- **The version of the framework.** The tool has the version of the other
  packages, and is released with them (section 7). What it creates depends on
  the packages of that version.

Two words are used all along:

- A **workspace** is what `cho new` creates: a folder that is a workspace of
  Deno, or of npm, with `cho.json` at its root.
- A **project** is a member of the workspace: an application.

## 2. The command line

It is a multiple-actions application: the first word names the command.

| Command line           | Does                                             | Exit code |
| ---------------------- | ------------------------------------------------ | --------- |
| `cho`                  | Prints the help of the tool: every command       | `0`       |
| `cho --help`           | The same                                         | `0`       |
| `cho help`             | The same                                         | `0`       |
| `cho help <command>`   | Prints the help of the command, with its options | `0`       |
| `cho <command> --help` | The same                                         | `0`       |
| `cho --version`        | Prints `cho version <version>`                   | `0`       |
| `cho new [name]`       | Creates a workspace (section 3)                  | 3.7       |
| `cho <unknown>`        | Prints an error, on the error output             | `1`       |

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

## 3. `cho new`

```console
$ cho new shop
✔ What are you building? · A web application
✔ Runtime · Deno
✔ Project name · api
✔ Folder of the projects · apps
✔ Initialize a git repository? · Yes
✔ Install the dependencies? · Yes
```

It asks what it was not told, creates the folder `shop` in the current folder,
writes a workspace with one project in it, and runs the steps that were asked
for: `git init`, and the installation of the dependencies.

It writes in a folder it created, and nowhere else. A folder that exists is
never written in.

### 3.1 The answers

Every question has a flag, and is asked when its flag is not given. The
questions are those of `@chojs/prompt`.

| Answer                 | Flag                   | Question  | Default                          |
| ---------------------- | ---------------------- | --------- | -------------------------------- |
| Name of the workspace  | The first argument     | `text`    | None                             |
| Kind of the project    | `--kind <kind>`        | `select`  | `web`                            |
| Runtime                | `--runtime <runtime>`  | `select`  | The runtime `cho` is running on  |
| Name of the project    | `--project <name>`     | `text`    | `api` for `web`, `cli` for `cli` |
| Folder of the projects | `--apps-dir <name>`    | `text`    | `apps`                           |
| A git repository       | `--no-git` says no     | `confirm` | Yes                              |
| Install                | `--no-install` says no | `confirm` | Yes                              |

| Choice of   | Values                | What it decides                                         |
| ----------- | --------------------- | ------------------------------------------------------- |
| `--kind`    | `web`, `cli`          | The template, and the package of CHO it depends on      |
| `--runtime` | `deno`, `node`, `bun` | The manifests, the tasks, and the program that installs |

- **A flag answers its question**: the question is not asked.
- **The flags are checked first**, all of them, before any question: a flag the
  command does not have, a value that is not one of the choices of its flag, a
  name that is not valid, a second name. A flag that was mistyped does not
  become a question.
- **`--yes`** (`-y`): every question that has a default takes it, and is not
  asked. The name of the workspace has no default: it is asked, or given.
- **The two steps are yes by default.** `--no-git` and `--no-install` say no,
  and their question is not asked. `--yes` says yes to the one that was not
  refused.
- **Without a terminal**, nobody can answer: a question that is still to ask is
  an error, which says to give every answer as a flag, or `--yes`. No default is
  taken silently.
- **The question of git is not asked**, and its answer is no, when the current
  folder is in a repository already: it, or a folder above it, has a `.git`.
- **Ctrl+C** on a question cancels the command: nothing was written, it prints
  `Cancelled.`, and the exit code is `130`.

The default of the runtime is the one `cho` runs on: a tool that was installed
with Deno proposes Deno.

### 3.2 The names

The name of the workspace, the name of a project and the folder of the projects
follow one rule:

- a lower case letter, then lower case letters, digits and `-`:
  `^[a-z][a-z0-9-]*$`;
- 64 characters at most;
- not a name Windows keeps for a device: `con`, `prn`, `aux`, `nul`, `com1` to
  `com9`, `lpt1` to `lpt9`.

Such a name is a folder on every system, and a name of a package for Deno, for
npm and for JSR.

- **The name of the workspace is a name, not a path.** The workspace is created
  in the current folder.
- **The folder must not exist**: not as a folder, even an empty one, and not as
  a file. As an argument, a name that exists is an error before any question
  (`CHO_CLI_TARGET_EXISTS`). In the question, it is a mistake shown under it,
  and another name can be typed.

### 3.3 What is created

On Deno, for `cho new shop`:

```
shop/
  cho.json
  deno.json          the workspace
  .gitignore
  README.md
  apps/
    api/
      deno.json      the project: its name, its imports, its tasks
      main.ts
      app.ts
      app_test.ts
```

On Node.js and on Bun:

```
shop/
  cho.json
  package.json       the workspace
  .npmrc             the registry of JSR, for npm
  .gitignore
  README.md
  apps/
    api/
      package.json   the project: its name, its dependencies, its scripts
      tsconfig.json  the types of the runtime, for the editor
      main.ts
      app.ts
      app_test.ts
```

- **Always a workspace.** A workspace with one project is where a second one is
  added, with no file to move.
- **`main.ts`, `app.ts` and `app_test.ts` come from the template** of the kind
  (section 3.5). They are the same on the three runtimes.
- **The other files are written by the tool**: they depend on the runtime, on
  the kind and on the names.
- **No linter and no formatter is installed.** The `README.md` of a workspace
  names those of its runtime: `deno fmt` and `deno lint`, or `bun fmt`. Node.js
  has none, and is pointed to those of Deno.

### 3.4 The manifests

The package of a project is named `@<workspace>/<project>`: `@shop/api`.

|                  | Deno                        | Node.js                          | Bun                 |
| ---------------- | --------------------------- | -------------------------------- | ------------------- |
| The workspace    | `deno.json`: `workspace`    | `package.json`: `workspaces`     | The same as Node.js |
| A package of CHO | `jsr:@chojs/web@^<version>` | `npm:@jsr/chojs__web@^<version>` | The same as Node.js |
| Other packages   | None                        | `tsx`, `@types/node`             | `@types/bun`        |
| Installs with    | `deno install`              | `npm install`                    | `bun install`       |

- **The packages of CHO are those of JSR**, on the three runtimes. npm and Bun
  read them through the npm registry of JSR: `.npmrc` names it
  (`@jsr:registry=https://npm.jsr.io`), as `npx jsr add` would write it.
- **A project of Deno has an `exports`**, its `app.ts`: Deno wants one of a
  package that has a name, and the module of the application is what another
  project would import.
- **`<version>` is the version of `cho`**: a workspace made by `cho` 3.6.0
  depends on `^3.6.0`.
- **`web` depends on `@chojs/web`, and `cli` on `@chojs/command`.**
- **`tsx` on Node.js.** Node.js does not run the decorators of TypeScript: `tsx`
  runs the project, and its tests. It is the one tool a workspace installs.
- **`tsconfig.json`**, on Node.js and on Bun, is for the editor and for a type
  check: the files import each other with their `.ts` extension, and nothing is
  compiled to a folder. Deno needs none.
  - `types` names the types of the runtime, `node` or `bun`: TypeScript loads no
    types that are not named.
  - It is in the folder of the project, not at the root. Bun installs the
    packages of a project in its folder, and TypeScript looks for the types from
    where the file is: at the root, those of Bun are not found.
- The versions of `tsx`, `@types/node` and `@types/bun` are constants of the
  tool, in one file.

The tasks of a project (`deno.json`), or its scripts (`package.json`):

| Task    | Deno                       | Node.js             | Bun                   |
| ------- | -------------------------- | ------------------- | --------------------- |
| `dev`   | `deno run --watch main.ts` | `tsx watch main.ts` | `bun --watch main.ts` |
| `start` | `deno run main.ts`         | `tsx main.ts`       | `bun main.ts`         |
| `test`  | `deno test`                | `tsx --test`        | `bun test`            |

On Deno, a task has the permissions the kind needs: `--allow-env` for both, and
`--allow-net` for `web`.

### 3.5 The templates

A template is the source of a project of one kind: `templates/<kind>/`.

| Kind  | `app.ts`                                    | `main.ts`                                        |
| ----- | ------------------------------------------- | ------------------------------------------------ |
| `web` | `AppModule`, with a controller: one route   | Creates the application, and serves it (`serve`) |
| `cli` | `AppModule`, with a controller: one command | Runs the command line of the process, and exits  |

`app_test.ts` tests what `app.ts` declares, with `node:test`: the same file runs
with `deno test`, `tsx --test` and `bun test`.

- **A template is real TypeScript, in the repository.** Its files are checked,
  linted and tested with the source of the framework, on each runtime, like any
  file of the workspace of CHO. A change of the framework that breaks a template
  fails in its own pull request.
- **A file of a template is written as it is**, but for one marker: `__name__`
  becomes the name of the project. The marker is in a string, so the template is
  valid as it is.
- **`app.ts` exports the root module as `AppModule`**, and running nothing:
  `main.ts` runs. A tool that reads the module of a project (`@chojs/dev`)
  imports `app.ts`.
- **The templates are in the package, not downloaded.** `new/templates.gen.ts`
  holds every file of every template, as text. It is written by
  `deno task --cwd cli gen`, and is kept in git: a test fails when it is not
  what the files are. A text import (`with { type: "text" }`) would do the same,
  but `tsx` does not load one.

### 3.6 Writing, and the steps

In this order:

1. **The flags** are read, and checked.
2. **The answers** (section 3.1). Nothing is written before the last one.
3. **The plan**: the list of the files, each with its text. It is made from the
   answers alone, and reads nothing.
4. **The folder.** It is created with a call that fails when it exists, so the
   check of section 3.2 cannot be passed by a folder that appeared since.
5. **The files.** When one cannot be written, the folder is removed, with what
   was written in it: the tool created it, so nothing of the user is in it. The
   error is `CHO_CLI_WRITE_FAILED`, and its `cause` is the error of the system.
6. **`git init`**, when asked for. No commit is made: a commit needs an
   identity, and it is the user's to make.
7. **The installation**, when asked for: the program of the runtime (section
   3.4), in the workspace. Its output is shown as it comes. It is last, since it
   is the long one: Ctrl+C there leaves a whole workspace.

**A step that fails does not undo the workspace.** The files are right, and the
step can be run again by hand: the tool says which step failed, and the exit
code is `1`. A program that is not installed (`git`, `bun`) is a step that
failed.

### 3.7 What it prints, and the exit code

After the questions, one line for what was created and one for each step, then
the commands that start the project:

```console
Created shop (8 files)
Running git init --quiet
Running deno install

  cd shop/apps/api
  deno task dev
```

The output of a step is shown under its line. When the packages were not
installed, the commands start with the one that installs them, in the workspace.
A command-line tool is started with its first command: `deno task start hello`.

| What happened                                                    | Written                | Exit code |
| ---------------------------------------------------------------- | ---------------------- | --------- |
| The workspace was created, and every step that was asked for ran | The workspace          | `0`       |
| A flag or a name is not valid, or the folder exists              | Nothing                | `1`       |
| A question is to ask, and there is no terminal                   | Nothing                | `1`       |
| A question was cancelled                                         | Nothing                | `130`     |
| A file could not be written                                      | Nothing: it is removed | `1`       |
| A step failed                                                    | The workspace          | `1`       |

An error is printed on the error output, as `Error: <message>`.

## 4. `cho.json`

The settings of a workspace, at its root. `cho new` writes it, and the commands
that work in a workspace read it. It holds what the manifests do not say: the
runtime, where a project is, what kind it is, and which file holds its module.

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

### 4.1 The fields

| Field                    | Required | Default   | What it is                                         |
| ------------------------ | -------- | --------- | -------------------------------------------------- |
| `$schema`                | No       |           | The address of the schema, for an editor           |
| `version`                | Yes      |           | The version of this format: `1`                    |
| `runtime`                | Yes      |           | `deno`, `node` or `bun`                            |
| `appsDir`                | No       | `apps`    | The folder a new project is created in             |
| `projects`               | Yes      |           | The projects, by name                              |
| `projects.<name>.kind`   | Yes      |           | `web` or `cli`                                     |
| `projects.<name>.root`   | Yes      |           | The folder of the project, from the root           |
| `projects.<name>.entry`  | No       | `main.ts` | The file that runs the project, from its folder    |
| `projects.<name>.module` | No       | `app.ts`  | The file that exports `AppModule`, from its folder |

- **`cho new` writes every field**, the ones with a default too: the file says
  what it means.
- **A name of a project** follows the rule of section 3.2.
- **`root`, `entry` and `module` are relative paths**, with `/`, that do not
  leave the workspace: no `..`, and no absolute path.
- **`projects`, not `apps`.** A project of another kind, such as a library, will
  be a project too. `appsDir` is where a new one is created: a project can be
  anywhere, and `root` says where.
- **`root` is not `appsDir` and the name**: a project that was moved is still
  found.

### 4.2 Reading it

`check_config` takes what was parsed from the file, and gives the settings,
typed, or throws `CHO_CLI_INVALID_CONFIG`. The message names the field:
`projects.api.kind`.

- **A field that is not known is an error**, at any depth. A field that was
  mistyped is not ignored.
- **A `version` that is not `1`** is an error that says so: the file was written
  by a newer `cho`.
- The tool has no validation library: the check is its own code.

In this version, `new` writes the file, and no command reads it yet. The check
is written with it, and tested with it, so the file and its schema have one
definition from the first day.

### 4.3 The schema

`cho.schema.json`, a JSON Schema (draft-07, the one editors read best). An
editor that opens `cho.json` completes its fields, describes them, and marks a
mistake.

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://chojs.io/schema/cho.v1.json",
  "title": "cho.json",
  "description": "The settings of a CHO workspace, read by the cho command-line tool.",
  "type": "object",
  "required": ["version", "runtime", "projects"],
  "additionalProperties": false,
  "properties": {
    "$schema": { "type": "string" },
    "version": { "const": 1 },
    "runtime": { "enum": ["deno", "node", "bun"] },
    "appsDir": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9-]*$",
      "default": "apps"
    },
    "projects": {
      "type": "object",
      "propertyNames": { "pattern": "^[a-z][a-z0-9-]*$" },
      "additionalProperties": { "$ref": "#/definitions/project" }
    }
  },
  "definitions": {
    "project": {
      "type": "object",
      "required": ["kind", "root"],
      "additionalProperties": false,
      "properties": {
        "kind": { "enum": ["web", "cli"] },
        "root": { "type": "string" },
        "entry": { "type": "string", "default": "main.ts" },
        "module": { "type": "string", "default": "app.ts" }
      }
    }
  }
}
```

In the file, every property has a `description` too: the text of section 4.1.

- **One definition.** The kinds, the runtimes and the rule of a name are
  constants of the tool. `check_config` reads them, and the schema is made from
  them (`config_schema()`). `cho.schema.json` is written by
  `deno task --cwd cli gen`, and is kept in git: a test fails when it is not
  what the constants give.
- **What the schema does not say.** `check_config` also refuses a path that
  leaves the workspace, and a name of section 3.2 that is too long or kept by
  Windows.
- **Its address is `https://chojs.io/schema/cho.v1.json`.** The site of CHO
  serves the file of this package. The address has the version of the format: a
  version 2 gets an address of its own, and a file of version 1 keeps the schema
  it was written for.

## 5. The application

The tool is an application of `@chojs/command`, written as one is: a root
module, and a controller for each command. Nothing in it is clever: a command is
a method that calls plain functions, from top to bottom.

| File          | What it holds                                                 |
| ------------- | ------------------------------------------------------------- |
| `main.ts`     | The entry point: runs the command line of the process, exits  |
| `app.ts`      | `AppModule`, the root module, and `run_cli`                   |
| `help.ts`     | `HelpCommands`, the controller of `help`, and the `RUN` token |
| `new/`        | The `new` command, and all it needs (section 5.1)             |
| `app_test.ts` | The tests of the command line: the help, the version          |
| `npm.ts`      | The build of the npm package (section 6.2)                    |

- **`run_cli(argv)`** runs one command line: it creates the application, runs
  it, releases what it created (`close()`), and resolves to the exit code. It
  never exits the process. The tests call it.
- **`main.ts`** is the only file that reads the command line of the process: it
  gives `process.argv.slice(2)` to `run_cli`, and exits with the result
  (`process.exit`). Both are those of `node:process`, which the three runtimes
  have.
- **`RUN`** is a token: a function that runs a command line of the tool. `help`
  asks for it, to run `--help`: it does not import the application.
- The classes are declared with decorator syntax (`@Module`, `@Controller`,
  `@Action`), as an application is. Deno and Bun run it as it is, the tests on
  Node.js run it through `tsx`, and the npm package is compiled (section 6.2).
- **The tool uses the public API of the framework**, and no function of its
  inside: it is an application like the ones it creates.

### 5.1 The `new` folder

Everything of `cho new` is in `new/`. A file does one thing:

| File               | What it holds                                                        |
| ------------------ | -------------------------------------------------------------------- |
| `new.ts`           | `NewCommand`: the command, `create_workspace`, and its error handler |
| `flags.ts`         | The flags of the command, and `read_flags`, which checks them        |
| `answers.ts`       | `ask_answers`: the questions, for what the flags did not say         |
| `names.ts`         | The rule of a name                                                   |
| `plan.ts`          | `plan_workspace`: the files of a workspace, from the answers         |
| `manifests.ts`     | The manifests, for each runtime                                      |
| `templates/`       | The templates, one folder for each kind                              |
| `templates.gen.ts` | The templates, as text: written by `gen.ts`                          |
| `config.ts`        | `cho.json`: its type, `check_config`, `config_schema`                |
| `cho.schema.json`  | The schema: written by `gen.ts`                                      |
| `write.ts`         | `write_workspace`: writes a plan in a new folder                     |
| `steps.ts`         | `run`: runs a step, `git init` or the installation                   |
| `errors.ts`        | The codes of the errors                                              |
| `gen.ts`           | Writes `templates.gen.ts` and `cho.schema.json`                      |
| `testing.ts`       | What the tests share: a temporary folder                             |

The command is these five calls, in this order:

```ts
const cwd = process.cwd();
const flags = read_flags(ctx.args); //            what the command line said
const answers = await ask_answers(flags, cwd); // the questions, for the rest
return create_workspace(answers, cwd); //         plan, write, run the steps
```

- **The command takes nothing from the injector.** It asks with `@chojs/prompt`,
  writes with `node:fs`, and runs programs with `node:child_process`: it imports
  them.
- **`@Catch`** gives the errors of the command to one function, `report_error`:
  `Cancelled.` and `130` for a question that was cancelled, `Error: <message>`
  and `1` for the rest.
- **The functions take what they work on as arguments**: the flags, the answers,
  the folder. So a test calls each with its own: a temporary folder, and for
  `ask_answers` the questions of a scripted terminal (`@chojs/prompt/testing`),
  its one optional argument.
- `gen.ts` and `npm.ts` run on Deno only: they are the build, not a part of the
  tool. `gen.ts`, `npm.ts`, `testing.ts`, `templates/` and the tests are not
  published.

### 5.2 Adding a command

A command is a method with `@Action` and `@Help`, on a controller that a module
declares. A command with files of its own gets a folder, as `new` has, and its
controller is added to `AppModule`.

Its tests call its functions, and `run_cli` for the command line: they compare
the exit code and what was printed, what a user sees.

## 6. Two packages

The packages of CHO are published to JSR, as TypeScript. A command of npm is
JavaScript, in a package whose `package.json` has a `bin` entry, and JSR makes
no such package. So the tool is published twice, from the same source, with the
same name and the same version.

| Registry | Package      | What it holds                         | Depends on                        |
| -------- | ------------ | ------------------------------------- | --------------------------------- |
| JSR      | `@chojs/cli` | The source: `main.ts` is its export   | `@chojs/command`, `@chojs/prompt` |
| npm      | `@chojs/cli` | `cho.js`: the tool, and the framework | Nothing                           |

### 6.1 Installation

```sh
deno install --global --allow-env --allow-read --allow-write --allow-run --name cho jsr:@chojs/cli   # Deno
npm install --global @chojs/cli                                                                      # Node.js
bun add --global @chojs/cli                                                                          # Bun
```

- On Deno, `--name cho` names the command: without it, Deno names it after the
  package, `cli`.
- On Deno, the tool is given what it needs. Without a permission, in a terminal,
  Deno stops and asks the user for it.

  | Permission      | For                                                   |
  | --------------- | ----------------------------------------------------- |
  | `--allow-env`   | `@chojs/command` reads `CHO_DEBUG`, for its debug log |
  | `--allow-read`  | `new`: whether the folder exists                      |
  | `--allow-write` | `new`: the workspace                                  |
  | `--allow-run`   | `new`: `git`, and the program that installs           |

- On npm and on Bun, the name is the `bin` entry of the package.

### 6.2 The npm package

`deno task --cwd cli npm` runs `npm.ts`, which writes the package in `cli/npm/`:

| File           | What it is                                             |
| -------------- | ------------------------------------------------------ |
| `cho.js`       | `main.ts` and all it imports, bundled by `deno bundle` |
| `package.json` | Written by `npm.ts`                                    |
| `README.md`    | A copy                                                 |
| `LICENSE`      | A copy                                                 |

- **The bundle.** One ES module. The decorators are compiled; `@chojs/command`,
  `@chojs/prompt`, `@chojs/core` and the templates are in it, and the only
  imports that are left are those of `node:`. Its first line is
  `#!/usr/bin/env node`, and the file is executable.
- **It is not minified.** CHO puts the names of classes and functions in its
  help and in its error messages: the bundle keeps them.
- **The manifest.** `name`, `version` and `license` are those of `deno.json`.
  `bin` is `{ "cho": "cho.js" }`. `engines` names the versions the tests run on:
  Node.js 24 and Bun 1.3.4. `publishConfig.access` is `public`. `repository` is
  the repository of CHO, with `cli` as its directory: npm compares it with the
  workflow that publishes (section 7.2).
- **The folder is built, not kept.** It is ignored by git, it is not a part of
  the JSR package, and `deno check`, `deno lint`, `deno fmt` and the tests skip
  it. `npm.ts` empties it first.

## 7. Releases

The tool is a package of the workspace, and a component of the linked versions
of `release-please`: it gets the version of every other package, in the same
release pull request (`release-please-config.json`).

### 7.1 Before a release: the dry runs

Both run in CI, on every pull request and every push to `main`:

| Registry | Job    | Command                        |
| -------- | ------ | ------------------------------ |
| JSR      | `deno` | `deno publish --dry-run`       |
| npm      | `node` | `npm pack --dry-run ./cli/npm` |

The job of npm builds the package first, and runs the file a user would get:
`node cli/npm/cho.js --help`, and a `cho new` with every answer as a flag, no
git and no installation, whose files are checked.

A dry run packs the package, checks its manifest and lists its files, and sends
nothing. It does not check that the workflow may publish: that is known when a
release runs.

The one of npm is `npm pack`, not `npm publish --dry-run`: the second asks the
registry, and fails for a version that is already there. The version of the
repository is the one on npm from a release until the next release pull request
is merged, so that dry run would fail on every pull request in between.

### 7.2 The release

`release.yml`, when a release pull request is merged:

1. `deno publish`: every package whose version is not on JSR yet, the tool
   included.
2. `deno task --cwd cli npm`, and `npm stage publish`, in `cli/npm`. A version
   that is already on npm is skipped, as on JSR.
3. By hand: a maintainer approves the staged version, and only then it is on
   npm.

JSR is first: when npm fails, running the job again sends what is missing.

**The version is staged, not published.** `npm stage publish` sends the package
to npm, where it waits, and is not public. The workflow cannot approve it: an
approval asks for a second factor.

```sh
npm stage list @chojs/cli      # what waits, with the id of each
npm stage approve <stage-id>   # asks for the second factor, then publishes
npm stage reject <stage-id>    # or drops it
```

The same is done on npmjs.com, in "Staged Packages" of the package.

- **A release is not done when the workflow is green.** Until the approval, JSR
  has the new version of the tool and npm has the one before.
- **A version is staged once.** A version that waits is not seen by `npm view`,
  so the check before the step does not skip it, and npm refuses it. When the
  job runs again for it, the step fails: approve what waits, or reject it and
  run the job again.

npm accepts the workflow by **trusted publishing** (OIDC): there is no npm
token, and the workflow reads none.

- The package names, on npmjs.com, who may publish it: the organization
  (`cho-js`), the repository (`cho`) and the file of the workflow
  (`release.yml`). Every field is case-sensitive. `npm stage publish` is always
  among the actions it allows; `npm publish` does not have to be.
- The workflow has the `id-token: write` permission, which JSR uses too, and
  runs on a runner of GitHub. `npm stage` needs npm 11.15.0 or later: Node.js 24
  has it.
- `repository.url` of the package is the repository of CHO: npm compares it with
  the workflow that publishes.
- The package is staged with its provenance (`--provenance`).

## 8. Runtime support

| Runtime            | Runs the tool | How it is tested                              |
| ------------------ | ------------- | --------------------------------------------- |
| Deno               | Yes           | `deno test`, on the source                    |
| Node.js 24         | Yes           | `tsx --test`, on the source; the bundle in CI |
| Bun                | Yes           | `bun test`, on the source                     |
| Cloudflare Workers | No            | A Worker has no command line                  |

The tests ask the questions of `new` on a scripted terminal, and write in a
temporary folder. They run `git init` there, and never the installation.
`tools/pty.sh` runs `cho new` in a real terminal, on the three: on Node.js it is
the bundle that runs.

The templates are tested as the source is, on the three. The installation of a
workspace that was created, and its own tests, are not run by CI (section 11).
They were run by hand for this version: section 8.1.

Not tested on Windows.

### 8.1 A workspace that was created

Run by hand, with `cho` 3.6.0 from the bundle, on macOS: a `web` and a `cli`
workspace on each runtime, with `git init` and the installation.

| Runtime        | Installs | `test` | `start`, `dev`             | Type check  |
| -------------- | -------- | ------ | -------------------------- | ----------- |
| Deno 2.9.8     | Yes      | Passes | The server answers `GET /` | By Deno     |
| Node.js 24.6.0 | Yes      | Passes | The server answers `GET /` | `bun check` |
| Bun 1.4.4      | Yes      | Passes | The server answers `GET /` | `bun check` |

The command-line tool prints `Hello, Ada!` for `start hello --name Ada`, on the
three.

## 9. Errors

A `ChoError` of `@chojs/core`, with a `code`:

| Code                     | When                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------ |
| `CHO_CLI_INVALID_NAME`   | A name does not follow the rule of section 3.2                                                         |
| `CHO_CLI_INVALID_OPTION` | A flag the command does not have, a value that is not one of the choices of its flag, or a second name |
| `CHO_CLI_TARGET_EXISTS`  | The folder of the workspace exists                                                                     |
| `CHO_CLI_WRITE_FAILED`   | A file of the workspace could not be written; the `cause` says why                                     |
| `CHO_CLI_INVALID_CONFIG` | `cho.json` is not what section 4 says                                                                  |

- `new` prints an error as `Error: <message>`, and the exit code is `1`.
- A question that was cancelled (`CHO_PROMPT_CANCELLED` of `@chojs/prompt`) is
  not printed as an error: `Cancelled.`, and the exit code is `130`.
- A question with no terminal to ask on (`CHO_PROMPT_NO_TERMINAL`) is printed as
  an error that says how to answer without one: the flags, or `--yes`.
- A step that fails (section 3.6) is not an error that is thrown: it is
  reported, with the command to run.
- What the tool prints for a command it does not have is the message of
  `@chojs/command`.

## 10. Decisions

1. **In the repository of the framework**, at the top level, like `command/`.
   The tool is tested against the source of the framework, in the same pull
   request, and is released with it.
2. **The version of the framework.** The version of the tool says which version
   of CHO it is made for, and which one a workspace it creates depends on.
3. **`help` is a command, and has no text of its own.** An application of
   `@chojs/command` has at least one command, and `help` is the one a tool
   always has. It runs `--help`, so there is one help.
4. **A bundle for npm, the source for JSR.** A package with dependencies on npm
   would need every package of CHO there too. One file with the framework in it
   needs none, and installs with no download but its own. An executable for each
   system was weighed: 89 MB instead of 117 kB, and a package for each system,
   for a tool that needs nothing a runtime does not have. The same source can be
   compiled to one later.
5. **`node:process`, not `Deno.args`.** One entry point for the three runtimes,
   and the same for files and programs: `node:fs`, `node:child_process`.
6. **The npm package is written by the build.** `deno.json` stays the only
   manifest in git: there is one name and one version to keep.
7. **The templates are in the package.** A template that was downloaded when a
   workspace is created could be newer than the packages that are published, and
   needs a second server to answer. A template in the tool was tested with the
   version it is released with.
8. **A workspace, always.** One layout to create, to describe and to add a
   project to.
9. **A folder that exists is refused, an empty one too.** One rule, and no file
   of the user is ever at risk.
10. **`git init`, and no commit.**
11. **No linter, no formatter.** Deno has both, and Bun has a formatter: the
    `README.md` of a workspace names those of its runtime, and those of Deno on
    Node.js, which has none. A workspace installs what it cannot run without: on
    Node.js, `tsx`.
12. **`cho.json` at the root, one for the workspace.** What a command needs to
    know is in one place, and is not guessed from the manifests.
13. **Every question has a flag.** The command runs in a script as it runs in a
    terminal, and never takes a default nobody chose.
14. **The tool is an example of an application of CHO.** It is written as one
    would be: plain, from top to bottom, with the public API of the framework. A
    command gets nothing from the injector that it can import.

## 11. Not in this version

- A project of `@chojs/message`: it needs a broker to be chosen, and to run.
- A library, as a kind of project.
- pnpm and Yarn.
- Adding a project to a workspace that exists, and any command that reads
  `cho.json`: the tools of `@chojs/dev`, running a project by its name.
- Tasks at the root of a workspace, that run the ones of every project.
- A path as the name of a workspace.
- A test, in CI, that installs a workspace that was created and runs its tests:
  in a release pull request, the version it depends on is not published yet.
- A test of the installed command on Bun (`bun add --global`): the bundle is run
  by Bun, the installation is not.
- A check of the bundle on a Node.js older than 24.
