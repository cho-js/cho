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
  new       Create a new workspace, with a first project
  add       Add a project to the workspace: an application, or a library
    serve     Run an application of the workspace
  generate  Write a part of an application: a controller, a service or a module
  help      Show the help of cho, or of one of its commands

Options:
  --help     Show this help
  --version  Show the version

Run 'cho <command> --help' for help on a command.
```

- **One tool, three runtimes.** The same source runs on Deno, on Node.js and on
  Bun. Nothing in it is written for one of them.
- **Two packages.** Deno installs the tool from JSR, as the other packages of
  CHO. npm and Bun install it from npm, where it is one JavaScript file with no
  dependency (section 9).
- **The version of the framework.** The tool has the version of the other
  packages, and is released with them (section 10). What it creates depends on
  the packages of that version.

- **One workspace, three runtimes.** What the tool creates is the same on the
  three: a workspace that one of them installed is installed and run by another
  the day after (section 3.4). `cho serve` runs a project of it on any of them
  (section 5).

Four words are used all along:

- A **workspace** is what `cho new` creates: a folder that is a workspace of
  npm, which Deno and Bun read too, with `cho.json` at its root.
- A **project** is a member of the workspace. It is an **application**, which
  runs, or a **library**, which is plain TypeScript that the applications
  import.
- A **part** is a class of an application, in a file of its own: a controller, a
  service or a module. `cho generate` writes one (section 6).
- The **tree** is how a command writes: it records its changes in memory, and
  they are written together, or not at all (section 8.3).

## 2. The command line

It is a multiple-actions application: the first word names the command.

| Command line                 | Does                                             | Exit code |
| ---------------------------- | ------------------------------------------------ | --------- |
| `cho`                        | Prints the help of the tool: every command       | `0`       |
| `cho --help`                 | The same                                         | `0`       |
| `cho help`                   | The same                                         | `0`       |
| `cho help <command>`         | Prints the help of the command, with its options | `0`       |
| `cho <command> --help`       | The same                                         | `0`       |
| `cho --version`              | Prints `cho version <version>`                   | `0`       |
| `cho new [name]`             | Creates a workspace (section 3)                  | 3.7       |
| `cho add [name]`             | Adds a project to a workspace (section 4)        | 4.5       |
| `cho serve [project]`        | Runs an application of a workspace (section 5)   | 5.4       |
| `cho generate [part] [name]` | Writes a part of an application (section 6)      | 6.4       |
| `cho <unknown>`              | Prints an error, on the error output             | `1`       |

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

With `--dry-run`, it asks the same questions, prints what it would write and
run, and does nothing (section 3.7).

### 3.1 The answers

Every question has a flag, and is asked when its flag is not given. The
questions are those of `@chojs/prompt`.

| Answer                 | Flag                   | Question  | Default                           |
| ---------------------- | ---------------------- | --------- | --------------------------------- |
| Name of the workspace  | The first argument     | `text`    | None                              |
| Kind of the project    | `--kind <kind>`        | `select`  | `web`                             |
| Runtime                | `--runtime <runtime>`  | `select`  | The runtime `cho` is running on   |
| Name of the project    | `--project <name>`     | `text`    | `api`, `cli` or `worker`, by kind |
| Folder of the projects | `--apps-dir <name>`    | `text`    | `apps`                            |
| A git repository       | `--no-git` says no     | `confirm` | Yes                               |
| Install                | `--no-install` says no | `confirm` | Yes                               |

| Choice of   | Values                  | What it decides                                       |
| ----------- | ----------------------- | ----------------------------------------------------- |
| `--kind`    | `web`, `cli`, `message` | The template, and the package of CHO it depends on    |
| `--runtime` | `deno`, `node`, `bun`   | The program that installs, and the commands it prints |

The runtime changes no file but `cho.json`, which records it, and a sentence of
the `README.md`: the workspace is the same on the three.

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

For `cho new shop`, on any runtime:

```
shop/
  cho.json
  package.json       the workspace: its name, and the folders of its projects
  .npmrc             the registry of JSR
  .gitignore
  README.md
  apps/
    api/
      package.json   the project: its name, its dependencies
      tsconfig.json  the settings of TypeScript
      main.ts
      app.ts
      app_test.ts
```

- **Always a workspace.** A workspace with one project is where a second one is
  added, with no file to move.
- **`main.ts`, `app.ts` and `app_test.ts` come from the template** of the kind
  (section 3.5).
- **The other files are written by the tool**: they depend on the kind and on
  the names.
- **No linter and no formatter is installed.** The `README.md` of a workspace
  names those of Deno (`deno fmt`, `deno lint`), which work on any TypeScript
  project, and the one of Bun (`bun fmt`).

### 3.4 One workspace, for the three runtimes

A workspace does not depend on the runtime it was created with. Deno reads
`package.json`, its `workspaces`, and `.npmrc`, as npm and Bun do: so the
manifests are those of npm, and there is no `deno.json`.

|                  | On the three                                   |
| ---------------- | ---------------------------------------------- |
| The workspace    | `package.json`: `workspaces`                   |
| A project        | `package.json`, named `@<workspace>/<project>` |
| A package of CHO | `npm:@jsr/chojs__web@^<version>`               |
| Other packages   | `tsx`, `@types/node`                           |
| The registry     | `.npmrc`: `@jsr:registry=https://npm.jsr.io`   |

|               | Deno           | Node.js       | Bun           |
| ------------- | -------------- | ------------- | ------------- |
| Installs with | `deno install` | `npm install` | `bun install` |

- **`workspaces` is `["apps/*", "libs/*"]`** from the first day: the folder of
  the applications, and the one of the libraries. A pattern that matches no
  folder is accepted by the three, and `cho add` has nothing to change there.
- **The packages of CHO are those of JSR.** The three tools read them through
  the npm registry of JSR: `.npmrc` names it, as `npx jsr add` would write it.
- **`<version>` is the version of `cho`**: a workspace made by `cho` 3.6.0
  depends on `^3.6.0`.
- **`web` depends on `@chojs/web`, and `cli` on `@chojs/command`.** `message`
  depends on `@chojs/message`, and on `@chojs/vendor-kafka`: the adapter of its
  broker (section 3.5).
- **`tsx` and `@types/node` are in every project.** Node.js does not run the
  decorators of TypeScript: `tsx` runs the project there, and its tests. Deno
  checks the types of a test, which imports `node:test`, and needs the types for
  it. The types of Bun are not installed: the templates use nothing of Bun.
- **`tsconfig.json`** is for the editor and for a type check: the files import
  each other with their `.ts` extension, and nothing is compiled to a folder.
  - `types` names the types of Node.js: TypeScript loads no types that are not
    named.
  - It is in the folder of the project, not at the root. Bun installs the
    packages of a project in its folder, and TypeScript looks for the types from
    where the file is.
- The versions of `tsx` and `@types/node` are constants of the tool, in one
  file.

**A project has no scripts.** No one command runs a project on the three, so a
script would be the command of one runtime. `cho serve` is that command (section
5): it runs the one of the runtime of the workspace. The `README.md` of a
workspace has the commands of each, for who runs a project without `cho`:

| To             | Deno                                               | Node.js                 | Bun                   |
| -------------- | -------------------------------------------------- | ----------------------- | --------------------- |
| Run            | `deno run --allow-net --allow-env main.ts`         | `npx tsx main.ts`       | `bun main.ts`         |
| Run, and watch | `deno run --allow-net --allow-env --watch main.ts` | `npx tsx watch main.ts` | `bun --watch main.ts` |
| Test           | `deno test --allow-env`                            | `npx tsx --test`        | `bun test`            |

- On Deno, a command has the permissions the project needs: `--allow-env` for a
  package of CHO, which reads its debug settings there, and `--allow-net` for a
  web application. A message consumer has `--allow-net`, and `--allow-read`: the
  client library of Kafka reads a file when it loads. A library needs none:
  `deno test`.
- A command-line tool is run with its first command: `bun main.ts hello`.
- `run_command(runtime, project, options)` is the one function that knows how an
  application is run. `cho serve` runs what it gives, and `command_of` is the
  same command as it is typed, for the `README.md`.

**Another runtime installs first.** Each tool lays out `node_modules` its own
way, and writes its own lock file. A workspace that Bun installed is run by Deno
after `deno install`.

### 3.5 The templates

A template is the source of a project: `templates/<name>/`.

| Template  | Files                              | What it is                                    |
| --------- | ---------------------------------- | --------------------------------------------- |
| `web`     | `app.ts`, `main.ts`, `app_test.ts` | `AppModule`, with a controller: one route     |
| `cli`     | `app.ts`, `main.ts`, `app_test.ts` | `AppModule`, with a controller: one command   |
| `message` | `app.ts`, `main.ts`, `app_test.ts` | `AppModule`, with a controller: one topic     |
| `library` | `mod.ts`, `mod_test.ts`            | One function, and its test. No package of CHO |

In an application, `main.ts` runs: it serves the web application (`serve`), runs
the command line of the process and exits, or connects the message consumer to
its broker. A test file tests what the project declares, with `node:test`: the
same file runs with `deno test`, `tsx --test` and `bun test`.

**A message consumer reads from Kafka**, with `@chojs/vendor-kafka`:

- **The brokers are those of `KAFKA_BROKERS`** (`host:port`, with a `,` between
  two), or `localhost:9092`.
- **The consumer group is the name of the project**, and so is the topic of its
  controller: the project `worker` handles `worker.hello`, and prints
  `Hello, <name>!` for a message such as `{"name":"Ada"}`.
- **`main.ts` closes the application on `SIGINT` and on `SIGTERM`**: the
  messages in hand are finished, and the group is left.
- **A start that fails says where it tried**, before the error of the client
  library: most often, no broker answers there.
- **The test needs no broker.** It gives the application a message
  (`app.handle`), with no linker.
- **What it needs is said**: after the commands that `cho new` and `cho add`
  print, and in a section of the `README.md` of a new workspace, with a command
  that runs a broker in Docker. The application does not create its topics.

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
- **A library is plain TypeScript.** It imports no package of CHO, so it has no
  kind: an application of any kind imports it.
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
4. **The tree** (section 8.3). Its root is the current folder, and every file is
   recorded under the folder of the workspace: `shop/cho.json`. So the folder
   itself is a change, like any file.
5. **The commit.** The folder is created with a call that fails when it exists,
   so the check of section 3.2 cannot be passed by a folder that appeared since.
   When a file cannot be written, what was written is removed, and the folder
   with it: the tool created it, so nothing of the user is in it. The error is
   `CHO_CLI_WRITE_FAILED`, and its `cause` is the error of the system.
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
Created shop (10 files)
Running git init --quiet
Running deno install

    cd shop
  cho serve api
```

The output of a step is shown under its line. When the packages were not
installed, the command that installs them comes before `cho serve`. A
command-line tool is run with its first command: `cho serve cli -- hello`. A
message consumer has one line more, under the commands: it reads from Kafka, and
where.

With `--dry-run`, the files and the steps are printed, and nothing is done:

```console
$ cho new shop --yes --dry-run
Dry run: nothing is written, and nothing is run.

  create  shop/cho.json
  create  shop/package.json
  create  shop/.npmrc
  create  shop/.gitignore
  create  shop/README.md
  create  shop/apps/api/package.json
  create  shop/apps/api/tsconfig.json
  create  shop/apps/api/app.ts
  create  shop/apps/api/app_test.ts
  create  shop/apps/api/main.ts

Would run git init --quiet
Would run deno install
```

| What happened                                                    | Written                | Exit code |
| ---------------------------------------------------------------- | ---------------------- | --------- |
| The workspace was created, and every step that was asked for ran | The workspace          | `0`       |
| `--dry-run`                                                      | Nothing                | `0`       |
| A flag or a name is not valid, or the folder exists              | Nothing                | `1`       |
| A question is to ask, and there is no terminal                   | Nothing                | `1`       |
| A question was cancelled                                         | Nothing                | `130`     |
| A file could not be written                                      | Nothing: it is removed | `1`       |
| A step failed                                                    | The workspace          | `1`       |

An error is printed on the error output, as `Error: <message>`.

## 4. `cho add`

```console
$ cho add
✔ What are you adding? · A library
✔ Project name · shared
✔ Install the dependencies? · Yes
```

It adds a project to the workspace it is run in: an application, as the one of
`cho new`, or a library. It asks what it was not told, writes the project in a
folder that does not exist, names it in `cho.json`, and installs the packages
when asked to.

A failure leaves the workspace as it was: what was written is undone.

### 4.1 The workspace

- **It is found from the current folder**: the folder, or the nearest one above
  it, that has a `cho.json`. So the command runs from the root of a workspace,
  or from any folder under it. No folder has one: `CHO_CLI_NO_WORKSPACE`.
- **`cho.json` is read, and checked** (section 7.2). A file that is not JSON, or
  not what section 7 says: `CHO_CLI_INVALID_CONFIG`.
- **`package.json` of the root is read.** Its `name` is the name of the
  workspace: the package of a project is named `@<name>/<project>`. A file that
  is missing, that is not an object of JSON, or whose `name` is not a name
  (section 3.2): `CHO_CLI_INVALID_MANIFEST`.
- **A file with comments is not JSON.** It is refused, and not written again
  without them.
- **A workspace of Deno made by `cho` 3.7** has a `deno.json` and no
  `package.json`. It is refused, with a message that says why. A workspace of
  Node.js or of Bun made by 3.7 is like the ones of today, and works.

### 4.2 The answers

Every question has a flag, as in `cho new` (section 3.1): the flags are checked
first, a flag answers its question, `--yes` takes the defaults, and a question
with no terminal is an error.

| Answer              | Flag                   | Question  | Default       |
| ------------------- | ---------------------- | --------- | ------------- |
| Type of the project | `--type <type>`        | `select`  | `application` |
| Kind                | `--kind <kind>`        | `select`  | `web`         |
| Name of the project | The first argument     | `text`    | None          |
| Install             | `--no-install` says no | `confirm` | Yes           |

- **The type** is `application` or `library`.
- **The kind is the one of an application.** It is not asked for a library, and
  `--kind` with `--type library` is `CHO_CLI_INVALID_OPTION`. `--kind` alone
  says the project is an application.
- **The name has no default**: `--yes` does not answer it. It follows the rule
  of section 3.2.
- **A name that is taken is refused.** A project of that name in `cho.json` is
  `CHO_CLI_PROJECT_EXISTS`, and a folder that exists is `CHO_CLI_TARGET_EXISTS`.
  In the question, each is a mistake shown under it, and another name can be
  typed.
- **The runtime is not asked**: it is the one of `cho.json`.
- **`--dry-run`**: the questions are asked, what would be written and run is
  printed, and nothing is done.

### 4.3 What is written

An application goes in `appsDir`, and a library in `libsDir` (section 7.1).

| Type          | Files, in `<folder>/<name>/`                                          |
| ------------- | --------------------------------------------------------------------- |
| `application` | Those of `cho new`: `package.json`, `tsconfig.json`, and the template |
| `library`     | `package.json`, `tsconfig.json`, `mod.ts`, `mod_test.ts`              |

The `package.json` of a library has an `exports`, its `mod.ts`, and no package
of CHO:

```json
{
  "name": "@shop/shared",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": "./mod.ts",
  "devDependencies": { "@types/node": "^24.0.0", "tsx": "^4.20.0" }
}
```

Two files of the root name the project:

| File           | Change                                                           |
| -------------- | ---------------------------------------------------------------- |
| `cho.json`     | The project, added to `projects`, after the others               |
| `package.json` | `<folder>/*`, added to `workspaces` when no pattern there has it |

- **`package.json` is rarely changed**: `cho new` names both folders there. It
  is changed for a folder that `cho.json` names and `workspaces` does not, and
  in a workspace made by `cho` 3.7, which has `apps/*` alone.
- **`workspaces` must be a list of folders.** Anything else is
  `CHO_CLI_INVALID_MANIFEST`, and nothing is written.
- **A file that is changed is written again as JSON**, with two spaces: its
  fields keep their order, and its layout does not.
- **The `README.md` of the workspace is not changed.**

### 4.4 Writing, and the installation

In this order:

1. **The flags** are read, and checked.
2. **The workspace** is found, read and checked (section 4.1).
3. **The answers** (section 4.2). Nothing is written before the last one.
4. **The plan**, recorded on the tree of the workspace (section 8.3): the files
   of the project, then `cho.json`, then `package.json`.
5. **The commit.** The files of the project are written first, and the two files
   of the root last. When a change fails, the ones before it are undone: the
   files and the folders that were created are removed, and a file that was
   changed gets its text back.
6. **The installation**, when asked for: the program of the runtime of
   `cho.json`, at the root of the workspace. It is what puts a new project in
   `node_modules`, where the others find it.

An installation that fails does not undo the project: the workspace is whole,
the tool says what to run, and the exit code is `1`.

### 4.5 What it prints, and the exit code

```console
Added shared in libs/shared (4 files)
Updated cho.json
Running deno install

  cd libs/shared
  deno test
```

- A library has nothing to run: its tests are, in its folder. The `cd` goes
  there from the current folder.
- An application is run by `cho serve <name>`, from where the command ran.
- When the packages were not installed, the commands start with the one that
  installs them, at the root of the workspace.
- After a library, the tool says how an application uses it (section 4.6).

| What happened                                                | Written     | Exit code |
| ------------------------------------------------------------ | ----------- | --------- |
| The project was added, and the installation ran if asked for | The project | `0`       |
| `--dry-run`                                                  | Nothing     | `0`       |
| A flag or a name is not valid, or the name is taken          | Nothing     | `1`       |
| There is no workspace, or one of its two files is not right  | Nothing     | `1`       |
| A question is to ask, and there is no terminal               | Nothing     | `1`       |
| A question was cancelled                                     | Nothing     | `130`     |
| A file could not be written                                  | Nothing     | `1`       |
| The installation failed                                      | The project | `1`       |

### 4.6 Using a library

`cho add` does not change an application. An application that uses a library
names it in its `package.json`, and the packages are installed again:

```json
{ "dependencies": { "@shop/shared": "*" } }
```

```ts
import { greet } from "@shop/shared";
```

- **`*` is the one range the three take** for a member of the workspace. npm
  refuses `workspace:*`.
- **The library is imported as TypeScript**: its `exports` is `mod.ts`, and
  nothing is built. `tsx`, Deno and Bun run it as it is.
- On npm and on Deno the import works without the line, since every member is
  linked at the root. Bun links what is declared: with the line, the three do
  the same.

## 5. `cho serve`

```console
$ cho serve api
Running deno run --allow-net --allow-env --watch main.ts
api is listening on http://localhost:3000
```

It runs an application of the workspace it is run in: the entry of the project
(`main.ts`), with the runtime of the workspace, in a child process, on the
terminal of `cho`. It is the one command that runs a project on the three
runtimes.

- **An application is run, whatever its kind.** A web application is started,
  and stays up, and so is a message consumer, which reads from its broker. A
  command-line tool runs, and ends.
- **A library does not run**: `CHO_CLI_NOT_AN_APPLICATION`.
- **`cho` serves nothing itself.** The `main.ts` of a web application creates it
  and calls `serve` of `@chojs/web/serve`, with its own linker and options: what
  `cho serve` runs is what runs in production.
- It writes nothing.

### 5.1 The command line

```sh
cho serve                             # the project of the current folder
cho serve api --runtime bun           # on another runtime, for this run
cho serve api --no-watch
cho serve tool -- hello --name Ada    # a command-line tool, with its arguments
```

| Word                  | What it is                                | Default                 |
| --------------------- | ----------------------------------------- | ----------------------- |
| `<project>`           | The name of the project                   | Section 5.2             |
| `--runtime <runtime>` | `deno`, `node` or `bun`, for this run     | `runtime` of `cho.json` |
| `--no-watch`          | It is not run again when a file changes   | It is watched           |
| `<arguments>`         | The words after the name: for the project |                         |
| `-- <arguments>`      | The words after `--`: for the project too |                         |

- **A flag before `--` is one of `cho serve`.** One it does not have is
  `CHO_CLI_INVALID_OPTION`, with a message that says a flag of the project goes
  after `--`.
- **After `--`, `cho` reads nothing**: the words go to the project as they are,
  each one argument, with its spaces.
- **The words after `--` are never the name.** `cho serve -- hello` runs the
  project of section 5.2, with `hello`.

### 5.2 Which project

1. The one that is named. A name that is not in `cho.json`:
   `CHO_CLI_UNKNOWN_PROJECT`, with the names of the projects.
2. Else the project the current folder is in: its folder, or a folder under it.
   The deepest one, when a project is in the folder of another.
3. Else the application of the workspace, when it has one only.
4. Else `CHO_CLI_UNKNOWN_PROJECT`, which says to name one, with the names of the
   applications.

The workspace is found as in `cho add` (section 4.1), and `cho.json` alone is
read: `package.json` is not.

### 5.3 What runs

In the folder of the project:

| Runtime | An application that stays up                       | One that runs, and ends        |
| ------- | -------------------------------------------------- | ------------------------------ |
| Deno    | `deno run --allow-net --allow-env --watch <entry>` | `deno run --allow-env <entry>` |
| Node.js | `npx tsx watch <entry>`                            | `npx tsx <entry>`              |
| Bun     | `bun --watch <entry>`                              | `bun <entry>`                  |

- **`<entry>` is the one of `cho.json`**: `main.ts` by default. The arguments of
  the project follow it.
- **What a kind needs is one row of a table** (`KIND_TRAITS`): whether it uses
  the network, whether what it is built with reads files, and whether it stays
  up.

  | Kind      | Uses the network | Reads files | Stays up |
  | --------- | ---------------- | ----------- | -------- |
  | `web`     | Yes              | No          | Yes      |
  | `cli`     | No               | No          | No       |
  | `message` | Yes              | Yes         | Yes      |

  A kind that comes later is a row more: `serve` reads nothing else of a kind.
- **On Deno, a kind that uses the network gets `--allow-net`**, one that reads
  files gets `--allow-read`, and every kind gets `--allow-env`. So a message
  consumer is run with
  `deno run --allow-net --allow-env --allow-read --watch <entry>`. A project
  that needs more is asked for it by Deno, in the terminal.
- **An application that stays up is watched**: it is run again when a file
  changes. `--no-watch` runs it once.
- **One that runs and ends is never watched.** A watcher would keep it open
  after it ended. The parser gives `false` for a boolean that was not given, so
  "not said" and `--no-watch` are the same, and there is no `--watch` to ask for
  it.
- **The runtime is the one of `--runtime`**, else the one of `cho.json`. A
  workspace is the same on the three (section 3.4), so any of them runs it once
  it has installed it.

Before it runs:

| Check                                                | Error                    |
| ---------------------------------------------------- | ------------------------ |
| The entry is a file                                  | `CHO_CLI_INVALID_CONFIG` |
| A workspace with a `package.json` has `node_modules` | `CHO_CLI_NOT_INSTALLED`  |

`CHO_CLI_NOT_INSTALLED` names the command that installs. Without the check,
`npx` would propose to download `tsx`. A workspace of Deno made by `cho` 3.7 has
no `package.json`, and its packages are not in `node_modules`: it is not
checked, and it is served.

### 5.4 What it prints, and the exit code

- **One line, on the error output**: `Running <command>`. The standard output is
  the one of the project: a tool whose output is piped is not changed.
- **The input, the output and the error output of the project** are those of
  `cho`: a tool that asks a question asks it in the terminal.
- **Ctrl+C** reaches the project and `cho` alike. `cho` ignores it while the
  project runs, and ends after it: a server closes as it chooses. A request to
  end `cho` alone (`SIGTERM`) is passed to the project.
- **The exit code is the one of the project.** For a project that a signal
  ended, it is 128 and the number of the signal.
- **No shell reads the command.** The runtime is started with its arguments as
  they are: one with a space stays one. The exception is `npx` on Windows, which
  is a script (`npx.cmd`) that only a shell runs: there an argument that is not
  a plain word is written in quotes, and a `npx` that is not installed is an
  error of the shell, with its exit code, and not `CHO_CLI_NOT_STARTED`.

| What happened                                        | Exit code              |
| ---------------------------------------------------- | ---------------------- |
| The project ran, and ended                           | The one of the project |
| No workspace, no such project, a library             | `1`                    |
| The entry is not a file, or nothing is installed     | `1`                    |
| The runtime is not installed (`CHO_CLI_NOT_STARTED`) | `1`                    |

After Ctrl+C, the exit code is what the runtime gives. Seen on macOS, the same
with `cho serve` and without it:

| The command                       | Exit code after Ctrl+C     |
| --------------------------------- | -------------------------- |
| `deno run`, with `--watch` or not | `130`                      |
| `npx tsx`, with `watch` or not    | `1`                        |
| `bun --watch`                     | `0`                        |
| `bun`                             | `130`: the signal ended it |

## 6. `cho generate`

```console
$ cho generate
✔ What are you generating? · A controller
✔ Name · users
✔ Project · api
✔ Folder · apps/api
Created apps/api/users.ts, apps/api/users_test.ts

Nothing uses it yet. Add it to a module, as the one of apps/api/app.ts:

  import { Users } from "./users.ts";

  @Module({ controllers: [Users] })

Its test runs with the tests of the project, in apps/api:

  deno test --allow-env
```

It writes a part of an application, in a file of its own: a controller, a
service, or a module.

**It writes new files, and changes none.** A part is not added to a module: the
command says what to add, and where. Changing a file of the user is another step
(section 14).

### 6.1 The answers

Every question has an answer on the command line, as in the other commands
(section 3.1): what was typed is checked first, `--yes` takes the defaults, and
a question with no terminal is an error.

| Answer  | On the command line | Question | Default                       |
| ------- | ------------------- | -------- | ----------------------------- |
| Part    | The first word      | `select` | None                          |
| Name    | The second word     | `text`   | None                          |
| Project | `--project <name>`  | `select` | The one of the current folder |
| Folder  | `--path <folder>`   | `text`   | The folder of the project     |

- **The part** is `controller`, `service` or `module`.
- **The part and the name have no default**: `--yes` does not answer them.
- **The project is an application.** A library has no package of CHO, so no
  decorator to import: `CHO_CLI_NOT_AN_APPLICATION`. A name that is not a
  project: `CHO_CLI_UNKNOWN_PROJECT`.
- **The project is not asked when the workspace has one application.** With
  several, the one the current folder is in is proposed. `--yes` takes it, and
  from a folder that is in none it is `CHO_CLI_UNKNOWN_PROJECT`, which says to
  give `--project`.
- **The folder is from the root of the workspace**, with `/`. The one of the
  project is proposed, and another one can be typed, whole: `apps/api/users`.
  Folders that do not exist are created.
- **The folder is in the project**: its folder, or one under it. The file
  imports the package of CHO of the project, which another project may not have.
  Another folder: `CHO_CLI_INVALID_OPTION`.
- **A file that exists is refused**: `CHO_CLI_TARGET_EXISTS`. In the question of
  the folder, it is a mistake shown under it, and another folder can be typed.
- **`--dry-run`**: the questions are asked, the files are printed, and nothing
  is written.

### 6.2 The names

The name of a part is the name of its file, and of its class. **No type is added
to it**: `cho generate controller users` writes the class `Users`, in
`users.ts`, and not `UsersController` in `users.controller.ts`.

| Typed as       | The file          | The class     |
| -------------- | ----------------- | ------------- |
| `users`        | `users.ts`        | `Users`       |
| `userProfile`  | `user-profile.ts` | `UserProfile` |
| `UserProfile`  | `user-profile.ts` | `UserProfile` |
| `user-profile` | `user-profile.ts` | `UserProfile` |
| `HTTPClient`   | `http-client.ts`  | `HTTPClient`  |

- **A name** is letters and digits, starting with a letter, in `camelCase`,
  `PascalCase` or `kebab-case`: 64 characters at most. Anything else is
  `CHO_CLI_INVALID_NAME`.
- **The words of a name** are cut at each `-`, and before each capital letter
  that starts a word. The file is the words in lower case, with `-` between
  them. The class is the words, each with a capital first letter.
- **The test of a part** is beside it: `users_test.ts`.
- **Two parts of one name, in one folder, are one file.** The second is refused,
  and nothing is replaced: a controller and a service of a feature get two
  names, or two folders.

### 6.3 What is written

| Part         | Files                         | The class has                              |
| ------------ | ----------------------------- | ------------------------------------------ |
| `controller` | `<name>.ts`, `<name>_test.ts` | `@Controller`, and one method: an endpoint |
| `service`    | `<name>.ts`, `<name>_test.ts` | `@Injectable`, and one method              |
| `module`     | `<name>.ts`                   | `@Module({})`, and nothing else            |

- **The decorators come from the package of the kind of the project**:
  `@chojs/web` in a web application, `@chojs/command` in a command-line tool,
  `@chojs/message` in a message consumer.
- **The method of a controller is an endpoint.** In a web application, the
  controller has the route of the name, and the method `@Get("")`: `GET /users`.
  In a command-line tool, the method has `@Action("<name>")`: the command
  `users`. In a message consumer, the controller has the topic of the name, and
  the method `@Subscribe("hello")`: the topic `users.hello`.
- **The test calls the method**: `new Users().hello()`. A part is a class, and
  its test needs no module and no injector. It runs with `node:test`, as the
  tests of a project do, on the three runtimes.
- **A module has no test**: it declares, and does nothing.

A part is written from its template: `generate/templates/<kind>/<part>/`. As the
templates of a project (section 3.5), these are real TypeScript of the
repository, checked and tested with it, and held in the tool as text
(`generate/templates.gen.ts`, written by `deno task --cwd cli gen`).

| Marker     | Becomes               | Where                              |
| ---------- | --------------------- | ---------------------------------- |
| `__name__` | The name of the file  | The text, and the name of the file |
| `__Name__` | The name of the class | The text                           |

`__Name__` is a name a class can have, and `__name__.ts` a name a file can have:
a template is valid as it is.

### 6.4 What it prints, and the exit code

One line names the files, then the explanation:

| Part         | What to add to a module | And                                                                |
| ------------ | ----------------------- | ------------------------------------------------------------------ |
| `controller` | `controllers: [Users]`  | The command of the tests of the project                            |
| `service`    | `providers: [Users]`    | `dependencies: [Users]`, on what uses it; the command of the tests |
| `module`     | `imports: [Users]`      |                                                                    |

- **The module that is named is the one of the project**: `module`, in
  `cho.json`. The `import` that is printed is the one that file would write:
  `./users/users.ts` for a part in the folder `users`.
- **The command of the tests** is the one of the runtime of the workspace.

| What happened                                           | Written   | Exit code |
| ------------------------------------------------------- | --------- | --------- |
| The part was written                                    | Its files | `0`       |
| `--dry-run`                                             | Nothing   | `0`       |
| A part, a name, a project or a folder that is not valid | Nothing   | `1`       |
| A file of the part exists                               | Nothing   | `1`       |
| There is no workspace, or `cho.json` is not right       | Nothing   | `1`       |
| A question is to ask, and there is no terminal          | Nothing   | `1`       |
| A question was cancelled                                | Nothing   | `130`     |
| A file could not be written                             | Nothing   | `1`       |

The files are recorded on the tree of the workspace, and committed (section
8.3): the two files of a part are written together, or not at all.

## 7. `cho.json`

The settings of a workspace, at its root. `cho new` writes it, `cho add` reads
it and adds a project to it, and `cho serve` reads it to run one. It holds what
the manifests do not say: the runtime, where a project is, whether it runs, what
kind it is, and which file holds its module.

```json
{
  "$schema": "https://chojs.io/schema/cho.v1.json",
  "version": 1,
  "runtime": "deno",
  "appsDir": "apps",
  "libsDir": "libs",
  "projects": {
    "api": {
      "type": "application",
      "kind": "web",
      "root": "apps/api",
      "entry": "main.ts",
      "module": "app.ts"
    },
    "shared": {
      "type": "library",
      "root": "libs/shared",
      "entry": "mod.ts"
    }
  }
}
```

### 7.1 The fields

| Field      | Required | Default | What it is                                 |
| ---------- | -------- | ------- | ------------------------------------------ |
| `$schema`  | No       |         | The address of the schema, for an editor   |
| `version`  | Yes      |         | The version of this format: `1`            |
| `runtime`  | Yes      |         | `deno`, `node` or `bun`                    |
| `appsDir`  | No       | `apps`  | The folder a new application is created in |
| `libsDir`  | No       | `libs`  | The folder a new library is created in     |
| `projects` | Yes      |         | The projects, by name                      |

A project, `projects.<name>`:

| Field    | An application                      | A library           | What it is                                         |
| -------- | ----------------------------------- | ------------------- | -------------------------------------------------- |
| `type`   | Optional: `application`             | Required: `library` | Whether the project runs                           |
| `kind`   | Required: `web`, `cli` or `message` | Refused             | What an application is built with                  |
| `root`   | Required                            | Required            | The folder of the project, from the root           |
| `entry`  | Optional: `main.ts`                 | Optional: `mod.ts`  | The file that runs it, or the file it exports      |
| `module` | Optional: `app.ts`                  | Refused             | The file that exports `AppModule`, from its folder |

- **`runtime` is the runtime of the workspace**: `cho new` and `cho add` install
  with it, and `cho serve` runs with it. No file of a project depends on it
  (section 3.4): to work with another tool, change it here, or give `--runtime`
  to `cho serve`.
- **`type` and `kind` are two questions.** The type says whether a project runs.
  The kind says what an application is built with, and a library, which is built
  with nothing of CHO, has none. `cho serve` runs an application, and refuses a
  library.
- **A project with no `type` is an application**: what `cho` 3.7 wrote is still
  right.
- **`cho new` and `cho add` write every field**, the ones with a default too:
  the file says what it means.
- **A name of a project** follows the rule of section 3.2.
- **`root`, `entry` and `module` are relative paths**, with `/`, that do not
  leave the workspace: no `..`, and no absolute path.
- **`projects`, not `apps`.** A library is a project too. `appsDir` and
  `libsDir` are where a new one is created: a project can be anywhere, and
  `root` says where.
- **`root` is not the folder and the name**: a project that was moved is still
  found.
- **The name of the workspace is not here.** It is `name`, in the `package.json`
  of the root: it is written once.

### 7.2 Reading it

`check_config` takes what was parsed from the file, and gives the settings,
typed, or throws `CHO_CLI_INVALID_CONFIG`. The message names the field:
`projects.api.kind`.

- **A field that is not known is an error**, at any depth. A field that was
  mistyped is not ignored, and a `kind` on a library is such a field.
- **A `version` that is not `1`** is an error that says so: the file was written
  by a newer `cho`.
- The tool has no validation library: the check is its own code.

`cho add` and `cho serve` read the file. The version of the format is still `1`:
no released command read the file before, and every field that was added is
optional.

### 7.3 The schema

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
    "libsDir": {
      "type": "string",
      "pattern": "^[a-z][a-z0-9-]*$",
      "default": "libs"
    },
    "projects": {
      "type": "object",
      "propertyNames": { "pattern": "^[a-z][a-z0-9-]*$" },
      "additionalProperties": {
        "oneOf": [
          { "$ref": "#/definitions/application" },
          { "$ref": "#/definitions/library" }
        ]
      }
    }
  },
  "definitions": {
    "application": {
      "type": "object",
      "required": ["kind", "root"],
      "additionalProperties": false,
      "properties": {
        "type": { "const": "application", "default": "application" },
        "kind": { "enum": ["web", "cli", "message"] },
        "root": { "type": "string" },
        "entry": { "type": "string", "default": "main.ts" },
        "module": { "type": "string", "default": "app.ts" }
      }
    },
    "library": {
      "type": "object",
      "required": ["type", "root"],
      "additionalProperties": false,
      "properties": {
        "type": { "const": "library" },
        "root": { "type": "string" },
        "entry": { "type": "string", "default": "mod.ts" }
      }
    }
  }
}
```

In the file, every property has a `description` too: the text of section 7.1.

- **One definition.** The types, the kinds, the runtimes and the rule of a name
  are constants of the tool. `check_config` reads them, and the schema is made
  from them (`config_schema()`). `cho.schema.json` is written by
  `deno task --cwd cli gen`, and is kept in git: a test fails when it is not
  what the constants give.
- **A project is one of two.** A library says its type, so a project matches the
  definition of an application or the one of a library, and an editor proposes
  the fields of the one that is written.
- **What the schema does not say.** `check_config` also refuses a path that
  leaves the workspace, and a name of section 3.2 that is too long or kept by
  Windows.
- **Its address is `https://chojs.io/schema/cho.v1.json`.** The site of CHO
  serves the file of this package. The address has the version of the format: a
  version 2 gets an address of its own, and a file of version 1 keeps the schema
  it was written for.

## 8. The application

The tool is an application of `@chojs/command`, written as one is: a root
module, and a controller for each command. Nothing in it is clever: a command is
a method that calls plain functions, from top to bottom.

| File          | What it holds                                                 |
| ------------- | ------------------------------------------------------------- |
| `main.ts`     | The entry point: runs the command line of the process, exits  |
| `app.ts`      | `AppModule`, the root module, and `run_cli`                   |
| `help.ts`     | `HelpCommands`, the controller of `help`, and the `RUN` token |
| `new/`        | The `new` command, and what the commands share (section 8.1)  |
| `add/`        | The `add` command (section 8.1)                               |
| `serve/`      | The `serve` command (section 8.1)                             |
| `generate/`   | The `generate` command (section 8.1)                          |
| `tree.ts`     | The tree: how a command writes (section 8.3)                  |
| `errors.ts`   | The codes of the errors, and `print_error`                    |
| `app_test.ts` | The tests of the command line: the help, the version          |
| `npm.ts`      | The build of the npm package (section 9.2)                    |

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
  Node.js run it through `tsx`, and the npm package is compiled (section 9.2).
- **The tool uses the public API of the framework**, and no function of its
  inside: it is an application like the ones it creates.

### 8.1 The folders of the commands

A command has a folder, and a file does one thing. `new/` has the `new` command,
and what `add` shares with it: the settings, the manifests, the templates.

| File               | What it holds                                                        |
| ------------------ | -------------------------------------------------------------------- |
| `new.ts`           | `NewCommand`: the command, `create_workspace`, and its error handler |
| `flags.ts`         | The flags of the command, and `read_flags`, which checks them        |
| `answers.ts`       | `ask_answers`: the questions, for what the flags did not say         |
| `names.ts`         | The rule of a name                                                   |
| `plan.ts`          | `plan_workspace`, `project_files`, and `run_command`                 |
| `manifests.ts`     | The manifests, of a workspace and of a project                       |
| `templates/`       | The templates: one folder for each kind, and one for a library       |
| `templates.gen.ts` | The templates, as text: written by `gen.ts`                          |
| `config.ts`        | `cho.json`: its types, `check_config`, `config_schema`               |
| `cho.schema.json`  | The schema: written by `gen.ts`                                      |
| `steps.ts`         | `run_steps`: `git init`, the installation; `run_program`: a project  |
| `gen.ts`           | Writes the two `templates.gen.ts`, and `cho.schema.json`             |
| `testing.ts`       | What the tests share: a temporary folder, and a folder in memory     |

`add/` has the files of `cho add` alone:

| File           | What it holds                                                   |
| -------------- | --------------------------------------------------------------- |
| `add.ts`       | `AddCommand`: the command, `add_project`, and its error handler |
| `flags.ts`     | The flags of the command, and `read_flags`                      |
| `answers.ts`   | `ask_answers`, and why a name is taken                          |
| `workspace.ts` | `find_workspace`, `read_config`, and `read_workspace`           |
| `plan.ts`      | `plan_project`: the changes of a new project, on the tree       |

`serve/` has the files of `cho serve`:

| File         | What it holds                                                       |
| ------------ | ------------------------------------------------------------------- |
| `serve.ts`   | `ServeCommand`: the command, `serve_project`, and its error handler |
| `flags.ts`   | The flags, the name, and the arguments of the project               |
| `project.ts` | `pick_project`: which project; `check_ready`: whether it can run    |

`generate/` has the files of `cho generate`:

| File               | What it holds                                                      |
| ------------------ | ------------------------------------------------------------------ |
| `generate.ts`      | `GenerateCommand`: the command, `generate_part`, its error handler |
| `flags.ts`         | The part, the name, and the flags                                  |
| `answers.ts`       | `ask_answers`: the questions, the project, the folder              |
| `parts.ts`         | The parts, and the names of one: its file, its class               |
| `plan.ts`          | `part_files`: the files of a part; `explanation`: what to add      |
| `templates/`       | The templates: a folder for each kind, and in it one for each part |
| `templates.gen.ts` | The templates, as text: written by `new/gen.ts`                    |

A command is a few calls, in order. `new`:

```ts
const cwd = process.cwd();
const flags = read_flags(ctx.args); //            what the command line said
const answers = await ask_answers(flags, cwd); // the questions, for the rest
return create_workspace(answers, cwd, flags.dryRun); // plan, write, the steps
```

`add`:

```ts
const cwd = process.cwd();
const flags = read_flags(ctx.args);
const root = find_workspace(cwd); //              the folder with cho.json
const tree = new Tree(disk_host(root));
const workspace = read_workspace(tree); //        cho.json, and package.json
const answers = await ask_answers(flags, workspace, tree);
return add_project(tree, workspace, answers, { root, cwd }, flags.dryRun);
```

`serve`:

```ts
const cwd = process.cwd();
const flags = read_flags(ctx.args, ctx.argv); //  the name, the arguments
const root = find_workspace(cwd);
const tree = new Tree(disk_host(root));
const config = read_config(tree); //              cho.json alone
return await serve_project(tree, config, flags, { root, cwd });
```

- **A command takes nothing from the injector.** It asks with `@chojs/prompt`,
  writes with `node:fs`, and runs programs with `node:child_process`: it imports
  them.
- **`@Catch`** gives the errors of a command to one function, `report_error`:
  `Cancelled.` and `130` for a question that was cancelled, `Error: <message>`
  and `1` for the rest. The two commands share `print_error`.
- **The functions take what they work on as arguments**: the flags, the answers,
  the folder, the tree. So a test calls each with its own: a temporary folder or
  a folder in memory, for `ask_answers` the questions of a scripted terminal
  (`@chojs/prompt/testing`), and for `serve_project` a runner that runs nothing:
  each is one optional argument.
- `gen.ts` and `npm.ts` run on Deno only: they are the build, not a part of the
  tool. `gen.ts`, `npm.ts`, `testing.ts`, the two `templates/` and the tests are
  not published.

### 8.2 Adding a command

A command is a method with `@Action` and `@Help`, on a controller that a module
declares. A command with files of its own gets a folder, as `new` and `add`
have, and its controller is added to `AppModule`.

A command that writes files records them on a tree, and commits it (section
8.3): it gets `--dry-run` with one call, and its plan is tested in memory. A
command that only reads a workspace, as `serve` does, reads it through a tree
too, and records nothing.

Its tests call its functions, and `run_cli` for the command line: they compare
the exit code and what was printed, what a user sees.

### 8.3 The tree

A command does not write files as it goes. It records its changes on a tree, a
layer in memory over a folder, and `commit` writes them together.

```ts
const tree = new Tree(disk_host(root));

tree.read("cho.json"); //   the text: what was recorded, else what the folder has
tree.exists("libs/shared"); // a file or a folder, recorded or in the folder
tree.create("libs/shared/mod.ts", text); // a new file
tree.update("cho.json", text); //           a file that exists
tree.changes(); //           what commit would do, in order

await commit(tree); //       writes them, or leaves the folder as it was
```

| Change   | Recorded by | `commit` does                            | Undone by             |
| -------- | ----------- | ---------------------------------------- | --------------------- |
| `folder` | `create`    | Creates the folder; fails when it exists | Removing it, if empty |
| `create` | `create`    | Writes the file; fails when it exists    | Removing it           |
| `update` | `update`    | Replaces the text of the file            | Writing the old text  |

- **A path** is from the root of the tree, with `/`.
- **`create` refuses a path that exists**, in the folder or on the tree
  (`CHO_CLI_TARGET_EXISTS`), and records a `folder` for each folder above the
  file that does not exist. So the list says everything `commit` does.
- **`update` is the only way to change a file that exists.** It refuses a path
  that is not a file. A file is changed once: a second text takes the place of
  the first.
- **`commit` applies the changes in order**, and when one fails, undoes the ones
  before it, last first. The folder is whole afterwards, or as it was. The error
  is `CHO_CLI_WRITE_FAILED`, with the error of the system as its `cause`.
- **A file is never replaced by a `create`, and never removed by an undo that
  did not create it.** A path that appeared since it was recorded fails the
  commit (`CHO_CLI_TARGET_EXISTS`), and stays.
- **`--dry-run` prints `changes()`**, without the folders, and does not commit.
- **A host** is the folder under a tree: six calls. `disk_host(root)` is the one
  of `node:fs`, and the tests have one in memory (`memory_host`). A plan is
  tested with no disk, and `commit` in a temporary folder.
- **No delete and no rename**: no command needs one.

What a tree does not do: it does not check what it writes, and it runs nothing.
`git init` and the installation run after the commit, in the folder. One that
fails leaves files that are right (sections 3.6 and 4.4).

## 9. Two packages

The packages of CHO are published to JSR, as TypeScript. A command of npm is
JavaScript, in a package whose `package.json` has a `bin` entry, and JSR makes
no such package. So the tool is published twice, from the same source, with the
same name and the same version.

| Registry | Package      | What it holds                         | Depends on                        |
| -------- | ------------ | ------------------------------------- | --------------------------------- |
| JSR      | `@chojs/cli` | The source: `main.ts` is its export   | `@chojs/command`, `@chojs/prompt` |
| npm      | `@chojs/cli` | `cho.js`: the tool, and the framework | Nothing                           |

### 9.1 Installation

```sh
deno install --global --allow-env --allow-read --allow-write --allow-run --name cho jsr:@chojs/cli   # Deno
npm install --global @chojs/cli                                                                      # Node.js
bun add --global @chojs/cli                                                                          # Bun
```

- On Deno, `--name cho` names the command: without it, Deno names it after the
  package, `cli`.
- On Deno, the tool is given what it needs. Without a permission, in a terminal,
  Deno stops and asks the user for it.

  | Permission      | For                                                            |
  | --------------- | -------------------------------------------------------------- |
  | `--allow-env`   | `@chojs/command` reads `CHO_DEBUG`, for its debug log          |
  | `--allow-read`  | `new`: whether the folder exists. The others: the workspace    |
  | `--allow-write` | `new`: the workspace. `add`: the project. `generate`: the part |
  | `--allow-run`   | `git`, the program that installs, and `serve`: the runtime     |

- On npm and on Bun, the name is the `bin` entry of the package.

### 9.2 The npm package

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
  workflow that publishes (section 10.2).
- **The folder is built, not kept.** It is ignored by git, it is not a part of
  the JSR package, and `deno check`, `deno lint`, `deno fmt` and the tests skip
  it. `npm.ts` empties it first.

## 10. Releases

The tool is a package of the workspace, and a component of the linked versions
of `release-please`: it gets the version of every other package, in the same
release pull request (`release-please-config.json`).

### 10.1 Before a release: the dry runs

Both run in CI, on every pull request and every push to `main`:

| Registry | Job    | Command                        |
| -------- | ------ | ------------------------------ |
| JSR      | `deno` | `deno publish --dry-run`       |
| npm      | `node` | `npm pack --dry-run ./cli/npm` |

The job of npm builds the package first, and runs the file a user would get:
`node cli/npm/cho.js --help`, then a `cho new` and a `cho add` in the workspace
it created, with every answer as a flag, no git and no installation, whose files
are checked.

A dry run packs the package, checks its manifest and lists its files, and sends
nothing. It does not check that the workflow may publish: that is known when a
release runs.

The one of npm is `npm pack`, not `npm publish --dry-run`: the second asks the
registry, and fails for a version that is already there. The version of the
repository is the one on npm from a release until the next release pull request
is merged, so that dry run would fail on every pull request in between.

### 10.2 The release

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

## 11. Runtime support

| Runtime            | Runs the tool | How it is tested                              |
| ------------------ | ------------- | --------------------------------------------- |
| Deno               | Yes           | `deno test`, on the source                    |
| Node.js 24         | Yes           | `tsx --test`, on the source; the bundle in CI |
| Bun                | Yes           | `bun test`, on the source                     |
| Cloudflare Workers | No            | A Worker has no command line                  |

The tests ask the questions of `new` and of `add` on a scripted terminal. They
plan on a folder in memory, and write in a temporary folder. They run `git init`
there, and never the installation. The tests of `serve` give it a runner that
runs nothing, and check the command; one test runs a real tool, which has no
dependency, on Deno and on Bun. On Node.js a project is run by `tsx`, which a
test does not install: there the real run was done by hand (section 11.1).
`tools/pty.sh` runs `cho new` in a real terminal, on the three: on Node.js it is
the bundle that runs.

The templates are tested as the source is, on the three. The test of a message
consumer gives it messages, with no broker: its `main.ts` is not run against a
broker by a test of the tool. The adapter has tests of its own, against a real
one (`vendor/kafka`). The installation of a workspace that was created, and its
own tests, are not run by CI (section 14). They were run by hand for this
version: section 11.1.

**Linux, macOS and Windows.** The tests above run on Linux. One job of the CI
(`os`) runs the tests of the tool on macOS and on Windows too, on the three
runtimes, and `tools/npm-cli.sh` there: the bundle writes a workspace, adds a
library to it and generates a controller. `tools/pty.sh` runs on Linux and on
macOS: Windows has no `script(1)`, so the questions are asked there on the
scripted terminal of the tests only. On Windows, a project is not run on Node.js
by a test (`npx tsx`, as on the other systems).

### 11.1 A workspace that was created

Run by hand, with `cho` from the source and the packages of CHO 3.7.1, on macOS:
`cho new shop`, then `cho add` for a command-line tool and for a library, which
the web application was changed to import. The workspace was copied three times,
and each copy installed by one runtime.

| Installed and run by | The tests of the three projects | The server               | The tool      | Type check   |
| -------------------- | ------------------------------- | ------------------------ | ------------- | ------------ |
| Deno 2.9.8           | Pass                            | Answers with the library | `Hello, Ada!` | `deno check` |
| Node.js 24.6.0       | Pass                            | Answers with the library | `Hello, Ada!` | `bun check`  |
| Bun 1.4.4            | Pass                            | Answers with the library | `Hello, Ada!` | `bun check`  |

Then each copy was run by the two other runtimes, with no second installation:

| Installed by | Run by Deno                                | Run by Node.js | Run by Bun |
| ------------ | ------------------------------------------ | -------------- | ---------- |
| Deno         |                                            | Passes         | Passes     |
| npm          | Passes                                     |                | Passes     |
| Bun          | Fails the type check, until `deno install` | Passes         |            |

Deno looks for the types of Node.js where it would install them, and Bun puts
them elsewhere. After `deno install` in that copy, the tests pass on Deno, and
still pass on Bun.

`cho serve`, in the same three copies, with `cho` from the source on Deno and on
Bun, and from the npm bundle on Node.js:

| What was run                                    | Deno | Node.js | Bun     |
| ----------------------------------------------- | ---- | ------- | ------- |
| `cho serve api`: the server answers `GET /`     | Yes  | Yes     | Yes     |
| A change of a file of the library restarts it   | Yes  | Yes     | Yes     |
| `--no-watch`: a change does not restart it      | Yes  | Not run | Not run |
| Ctrl+C closes the server, and `cho` after it    | Yes  | Yes     | Yes     |
| `cho serve admin -- hello --name ...`, exit `0` | Yes  | Yes     | Yes     |

The runtime was the one of `cho.json` on Deno, and `--runtime` on the two
others: the three copies name Deno there. A copy that npm installed, and one
that Bun installed, were also served by Deno, with no `--runtime`.

`cho generate`, in the same three copies: a controller, a service in a folder of
its own, and a module in the web application, and a controller in the tool.

| What was run                                                                                                                                     | Deno | Node.js | Bun  |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ------- | ---- |
| The tests of the two projects, with those of the new parts                                                                                       | Pass | Pass    | Pass |
| The type check of the web application                                                                                                            | Yes  | Not run | Yes  |
| The parts, added to the module by hand as the command says, and the service to the controller: `GET /users` answers with the text of the service | Yes  | Yes     | Yes  |

## 12. Errors

A `ChoError` of `@chojs/core`, with a `code`:

| Code                         | When                                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CHO_CLI_INVALID_NAME`       | A name does not follow its rule: section 3.2, and section 6.2 for the name of a part                                                              |
| `CHO_CLI_INVALID_OPTION`     | A flag the command does not have, a value that is not one of the choices of its flag, a word too many, or a folder that is not one of the project |
| `CHO_CLI_TARGET_EXISTS`      | A folder or a file to create exists: the folder of a workspace or of a project, the file of a part                                                |
| `CHO_CLI_WRITE_FAILED`       | A file could not be written; the `cause` says why. What was written before it was undone                                                          |
| `CHO_CLI_INVALID_CONFIG`     | `cho.json` is not JSON, is not what section 7 says, or names an entry that is not a file                                                          |
| `CHO_CLI_NO_WORKSPACE`       | `cho add`: no `cho.json` in the current folder, or in a folder above it                                                                           |
| `CHO_CLI_INVALID_MANIFEST`   | `cho add`: `package.json` of the root is missing, is not JSON, or has no `name` or `workspaces` to use                                            |
| `CHO_CLI_PROJECT_EXISTS`     | `cho add`: the workspace has a project of that name                                                                                               |
| `CHO_CLI_UNKNOWN_PROJECT`    | `cho serve`, `cho generate`: no project of that name, or no name and nothing that says which project                                              |
| `CHO_CLI_NOT_AN_APPLICATION` | `cho serve`, `cho generate`: the project is a library                                                                                             |
| `CHO_CLI_NOT_INSTALLED`      | `cho serve`: the workspace has a `package.json`, and no `node_modules`                                                                            |
| `CHO_CLI_NOT_STARTED`        | `cho serve`: the program of the runtime could not be started                                                                                      |

- A command prints an error as `Error: <message>`, and the exit code is `1`.
- A question that was cancelled (`CHO_PROMPT_CANCELLED` of `@chojs/prompt`) is
  not printed as an error: `Cancelled.`, and the exit code is `130`.
- A question with no terminal to ask on (`CHO_PROMPT_NO_TERMINAL`) is printed as
  an error that says how to answer without one: the flags, or `--yes`.
- A step that fails (sections 3.6 and 4.4) is not an error that is thrown: it is
  reported, with the command to run.
- What the tool prints for a command it does not have is the message of
  `@chojs/command`.

## 13. Decisions

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
    `README.md` of a workspace names them. A workspace installs what it cannot
    run without: `tsx`, for Node.js, and the types of Node.js.
12. **`cho.json` at the root, one for the workspace.** What a command needs to
    know is in one place, and is not guessed from the manifests.
13. **Every question has a flag.** The command runs in a script as it runs in a
    terminal, and never takes a default nobody chose.
14. **The tool is an example of an application of CHO.** It is written as one
    would be: plain, from top to bottom, with the public API of the framework. A
    command gets nothing from the injector that it can import.
15. **One workspace, for the three runtimes.** A workspace that was made for one
    runtime ties a project to the tool that created it. Deno reads
    `package.json`, so one layout serves the three, and the runtime is a choice
    of the day, not of the project. The price is on Deno: the packages of CHO
    come through the npm registry of JSR, and there is no `deno.json`.
16. **No scripts in a project.** A script named `dev` would be the command of
    one runtime, and the workspace would not be the same on the three. Nine
    scripts, three for each runtime, were weighed, and refused: `cho serve` is
    the one command, and it picks the runtime.
17. **A tree, of our own.** A command that changes files of the user must not
    stop half way. Recording the changes first, as the schematics of Angular and
    the generators of Nx do, makes a failure leave nothing, makes a dry run a
    list to print, and makes a plan a thing to test with no disk. Their
    libraries are not used: the tree is one file, with no dependency.
18. **No check of git before writing.** A dry run shows what would change, and a
    failure undoes what it wrote.
19. **JSON is parsed, and written again.** A file with comments is not JSON, and
    is refused: nothing of the user is lost by a rewrite.
20. **One command adds a project**, with `--type`: an application and a library
    are asked the same way, and differ by one answer.
21. **A library is plain TypeScript.** It has no kind, and depends on no package
    of CHO: an application of any kind imports it. The decorators of CHO come
    from the package of a kind, and a library that had them would be tied to
    one.
22. **`cho add` does not change an application.** Which application uses a
    library is the user's to say: the tool prints the line to add.
23. **`cho serve` runs the entry, not the module.** The settings of an
    application are in its `main.ts`: its linker, its options. A command that
    served `AppModule` itself would serve another application than the one that
    is deployed. And `cho` cannot load a project in its own process: the npm
    bundle runs on Node.js, which does not run decorators, and the runtime of
    `cho` is not always the one of the workspace.
24. **`serve` runs every kind of application.** What differs is what a kind
    needs, in one table: the command does not name a kind. A library is the one
    project it refuses.
25. **The runtime is a choice of the run.** `--runtime` runs a workspace on
    another runtime with no file to change: it is why a workspace is the same on
    the three.
26. **`cho serve` adds one line, on the error output.** What a project prints is
    its own, and so is its exit code.
27. **`cho generate` writes, and does not edit.** Adding a part to a module is
    an edit of a file of the user, in a language: it needs to know where the
    list of a module is, in a file it did not write. The first step creates
    files alone, and says what to add. The tools that edit (the schematics of
    Angular, of NestJS) parse the file with the compiler of TypeScript to find
    the place, and insert text there. That compiler is a program for each system
    now, and cannot be a part of a tool that is one file: an edit here will be a
    small scanner of our own, that gives up when it is not sure.
28. **No type in the name of a part.** `users.ts`, with the class `Users`: the
    folder and the decorator say what a class is, and a name that says it again
    is longer, and no clearer. The price: two parts of one name need two
    folders.
29. **The test of a part calls its method.** A part is a class, and no module
    has it yet: a test through an application would need one. The templates of a
    project show the other test, through the application.
30. **A part is generated in an application.** A library is plain TypeScript
    (decision 21), and has no decorator to give a class.
31. **A message consumer reads from Kafka.** Its adapter is one package, the
    same on the three runtimes, so the workspace stays the same on the three
    (decision 15). The adapter of NATS takes the connection of a transport,
    which is another package on Deno than on Node.js and on Bun. Another broker
    is a change of `main.ts`, and of the `package.json` of the project.
32. **The broker is not in `cho.json`.** `cho` reads the kind of a project, and
    nothing of what the project is connected with: that is its own code.
33. **A new kind keeps the version of the format.** `cho.json` is still version
    1: a file that was valid is valid. An older `cho` refuses a project of a
    kind it does not know, and says which kinds it takes.

## 14. Not in this version

- A message consumer on another broker than Kafka: `main.ts` is where another
  adapter is given, by hand. A question for the broker.
- A library that is built with a package of CHO: one with modules and providers.
- pnpm and Yarn.
- A port, or any setting, that `cho serve` gives to a project: `main.ts` says
  them. Serving several projects at once. A command that tests, or builds.
- `--watch` for a command-line tool.
- The tools of `@chojs/dev`.
- Wiring a library into an application; removing or renaming a project.
- Adding a part that was generated to a module: the edit of a file of the user.
  Other parts: a middleware, an error handler, a gateway. A template of the
  user.
- A folder that is proposed as a text to edit, in the question of
  `cho generate`: a question of `@chojs/prompt` proposes a default, and an
  answer that is typed takes its place whole.
- A workspace of Deno made by `cho` 3.7, which has no `package.json`: `cho add`
  refuses it, and nothing converts it.
- Tasks at the root of a workspace, that run every project.
- A path as the name of a workspace.
- A test, in CI, that installs a workspace that was created and runs its tests:
  in a release pull request, the version it depends on is not published yet.
- A test of the installed command on Bun (`bun add --global`): the bundle is run
  by Bun, the installation is not.
- A check of the bundle on a Node.js older than 24.
