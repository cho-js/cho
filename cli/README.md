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

On Deno, the tool is given the permissions its commands need: they read and
write the workspace, and run `git` and the installation. Without one, Deno stops
and asks.

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

| Command line                 | What it does                                          |
| ---------------------------- | ----------------------------------------------------- |
| `cho`, `cho --help`          | Prints the help of the tool: every command            |
| `cho help`                   | The same                                              |
| `cho help <command>`         | Prints the help of one command, and its options       |
| `cho <command> --help`       | The same                                              |
| `cho --version`              | Prints the version of the tool: `cho version 3…`      |
| `cho new [name]`             | Creates a workspace: see below                        |
| `cho add [name]`             | Adds a project to a workspace: see below              |
| `cho serve [project]`        | Runs an application of a workspace: see below         |
| `cho generate [part] [name]` | Writes a controller, a service or a module: see below |

The exit code is `0`, and `1` for a command the tool does not have. `cho serve`
ends with the exit code of the project it ran.

## `cho new`

Creates a folder, and writes a workspace in it, with one project. The project is
a web application ([`@chojs/web`](../web/README.md)), a command-line tool
([`@chojs/command`](../command/README.md)) or a message consumer
([`@chojs/message`](../message/README.md)), with its tests, and it runs as it
is.

```
shop/
  cho.json           the settings of the workspace, for cho
  package.json       the workspace: its name, the folders of its projects
  .npmrc             the registry of JSR
  README.md
  apps/
    api/
      package.json   the project: its name, its dependencies
      tsconfig.json
      main.ts        runs the application
      app.ts         the application: AppModule
      app_test.ts    its tests
```

**The workspace is the same on Deno, on Node.js and on Bun.** The three read
`package.json`, and the packages of CHO come from JSR through its npm registry.
A workspace that one of them installed is installed and run by another the day
after: the runtime you choose is the one `cho` installs with, and nothing more.

A project has no scripts: no one command runs it on the three.
[`cho serve`](#cho-serve) is that command. Without `cho`, each runtime has its
own, and the `README.md` of a workspace has them all:

| To             | Deno                                               | Node.js                 | Bun                   |
| -------------- | -------------------------------------------------- | ----------------------- | --------------------- |
| Install        | `deno install`                                     | `npm install`           | `bun install`         |
| Run            | `deno run --allow-net --allow-env main.ts`         | `npx tsx main.ts`       | `bun main.ts`         |
| Run, and watch | `deno run --allow-net --allow-env --watch main.ts` | `npx tsx watch main.ts` | `bun --watch main.ts` |
| Test           | `deno test --allow-env`                            | `npx tsx --test`        | `bun test`            |

`cho new` asks what it was not told. Every question has a flag, so the command
runs in a script as it runs in a terminal:

| Flag                  | Answers                                        | Default                   |
| --------------------- | ---------------------------------------------- | ------------------------- |
| `<name>`              | The name of the workspace: its folder          | None: it is asked         |
| `--kind <kind>`       | What the project is: `web`, `cli` or `message` | `web`                     |
| `--runtime <runtime>` | What installs: `deno`, `node`, `bun`           | The runtime `cho` runs on |
| `--project <name>`    | The name of the project                        | `api`, `cli` or `worker`  |
| `--apps-dir <name>`   | The folder of the projects                     | `apps`                    |
| `--no-git`            | Does not run `git init`                        | It is run                 |
| `--no-install`        | Does not install the packages                  | They are installed        |
| `--yes`, `-y`         | Takes the default of every question            |                           |
| `--dry-run`           | Prints what it would do, and does not          |                           |

```sh
cho new shop --yes                              # the defaults
cho new tool --kind cli --runtime bun --yes     # a command-line tool
cho new shop --kind message --yes               # a message consumer, on Kafka
cho new shop --yes --dry-run                    # the files, and nothing written
```

- **A name** is lower case letters, digits and `-`, and starts with a letter.
- **The folder must not exist**, even empty: `cho new` writes in a folder it
  created, and nowhere else.
- **Without a terminal**, a question that is still to ask is an error: give
  every answer as a flag, or `--yes`. No default is taken silently.
- **Ctrl+C** on a question cancels: nothing was written, and the exit code is
  `130`.
- **A file that cannot be written** leaves nothing: what was written is removed.
- **A step that fails** (`git init`, the installation) leaves the workspace,
  which is whole, and says what to run. The exit code is `1`.
- **A message consumer reads from Kafka**, with
  [`@chojs/vendor-kafka`](../vendor/kafka/README.md): at `localhost:9092`, or
  where `KAFKA_BROKERS` says. Its consumer group is the name of the project, and
  it handles one topic, `<project>.hello`. Its tests need no broker. The
  `README.md` of the workspace has a command that runs a broker in Docker.
  Another broker is a change of its `main.ts`.
- **No linter and no formatter is installed.** Deno has both (`deno fmt`,
  `deno lint`), and Bun has `bun fmt`.
- On Node.js, the project is run by [`tsx`](https://tsx.is): Node.js does not
  run the decorators of TypeScript. Every project installs it.

## `cho add`

Adds a project to a workspace. It is run in the workspace, or in any folder
under it: it looks for `cho.json`.

```console
$ cho add
✔ What are you adding? · A library
✔ Project name · shared
✔ Install the dependencies? · Yes
Added shared in libs/shared (4 files)
Updated cho.json
```

| A project is   | It                                                    | Goes in |
| -------------- | ----------------------------------------------------- | ------- |
| An application | Runs: `web`, `cli` or `message`, as in `cho new`      | `apps/` |
| A library      | Does not run: plain TypeScript, that applications use | `libs/` |

| Flag            | Answers                                   | Default            |
| --------------- | ----------------------------------------- | ------------------ |
| `<name>`        | The name of the project                   | None: it is asked  |
| `--type <type>` | `application` or `library`                | `application`      |
| `--kind <kind>` | An application: `web`, `cli` or `message` | `web`              |
| `--no-install`  | Does not install the packages             | They are installed |
| `--yes`, `-y`   | Takes the default of every question       |                    |
| `--dry-run`     | Prints what it would do, and does not     |                    |

```sh
cho add admin --kind web             # an application
cho add worker --kind message        # a message consumer, on Kafka
cho add shared --type library        # a library
cho add shared --type library --dry-run
```

- **The name must be free**: no project of that name in `cho.json`, and no
  folder of that name where the project goes.
- **It changes `cho.json`**, and `package.json` of the root when its
  `workspaces` do not have the folder yet. Both are JSON: a file with comments
  is refused.
- **A failure leaves the workspace as it was.** The files are written together,
  and what was written is undone when one cannot be.
- **The runtime is the one of `cho.json`**: it installs.

A library has a `mod.ts`, its test, and no package of CHO. An application that
uses it names it in its own `package.json`, and the packages are installed
again:

```json
{ "dependencies": { "@shop/shared": "*" } }
```

```ts
import { greet } from "@shop/shared";
```

### `cho.json`

The settings of a workspace, at its root: what `cho` needs to know and the
manifests do not say.

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

Its JSON Schema is [`cho.schema.json`](./new/cho.schema.json): an editor
completes the fields, and marks a mistake. The
[specification](./specs.md#7-chojson) describes each field.

## `cho serve`

Runs an application of the workspace, on its runtime. It is run in the
workspace, or in any folder under it.

```console
$ cho serve api
Running deno run --allow-net --allow-env --watch main.ts
api is listening on http://localhost:3000
```

```sh
cho serve                             # the project of the current folder
cho serve api --runtime bun           # on another runtime, for this run
cho serve api --no-watch              # not again when a file changes
cho serve tool -- hello --name Ada    # a command-line tool, with its arguments
```

| A project that is   | Is                                                         |
| ------------------- | ---------------------------------------------------------- |
| A web application   | Started, and run again when a file changes                 |
| A message consumer  | Started, and run again when a file changes: it needs Kafka |
| A command-line tool | Run once, with the words after `--`: it ends on its own    |
| A library           | Refused: it does not run. The message has its test command |

- **It runs the entry of the project**, `main.ts`: the file that creates the
  application, and serves it. `cho` adds nothing to it.
- **The runtime is the one of `cho.json`**, and `--runtime` picks another for a
  run: the workspace is the same on the three.
- **Without a name**, it runs the project the current folder is in, or the one
  application of the workspace.
- **The words after `--` go to the project** as they are. A flag before `--` is
  one of `cho serve`.
- **Ctrl+C** stops the project, and `cho` after it. The exit code is the one of
  the project.
- **The packages must be installed**: without `node_modules`, it says which
  command installs.
- It prints one line, `Running <command>`, on the error output: the output of
  the project is its own.

## `cho generate`

Writes a part of an application, in a file of its own: a controller, a service,
or a module. It is run in the workspace, or in any folder under it.

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
```

| Part         | Files                         | The class has                   |
| ------------ | ----------------------------- | ------------------------------- |
| `controller` | `<name>.ts`, `<name>_test.ts` | `@Controller`, and one endpoint |
| `service`    | `<name>.ts`, `<name>_test.ts` | `@Injectable`, and one method   |
| `module`     | `<name>.ts`                   | `@Module({})`                   |

| On the command line | Answers                                    | Default                       |
| ------------------- | ------------------------------------------ | ----------------------------- |
| `<part>`            | `controller`, `service` or `module`        | None: it is asked             |
| `<name>`            | The name of the file, and of the class     | None: it is asked             |
| `--project <name>`  | The application the part is for            | The one of the current folder |
| `--path <folder>`   | The folder, from the root of the workspace | The folder of the project     |
| `--yes`, `-y`       | Takes the default of every question        |                               |
| `--dry-run`         | Prints what it would write, and does not   |                               |

```sh
cho generate controller users                 # users.ts: the class Users
cho generate service userStore --yes          # user-store.ts: the class UserStore
cho generate module orders --path apps/api/orders
```

- **No type is added to a name.** `users` is the file `users.ts` and the class
  `Users`. `userProfile`, `UserProfile` and `user-profile` are the file
  `user-profile.ts` and the class `UserProfile`.
- **It writes new files, and changes none.** The part is not added to a module:
  the command says what to add, and where.
- **A file that exists is refused**, and nothing is replaced.
- **The folder is one of the project**: its folder, or one under it. Folders
  that do not exist are created.
- **The decorators come from the package of the project**: `@chojs/web` in a web
  application, `@chojs/command` in a command-line tool, `@chojs/message` in a
  message consumer. A library has none, and is refused.
- **The test of a part calls its method.** It runs with the tests of the
  project.

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

| File                      | What it is                                        |
| ------------------------- | ------------------------------------------------- |
| [`main.ts`](./main.ts)    | The entry point: runs the command line, and exits |
| [`app.ts`](./app.ts)      | The root module, and `run_cli`: one command line  |
| [`help.ts`](./help.ts)    | The `help` command                                |
| [`new/`](./new)           | The `new` command, and what the commands share    |
| [`add/`](./add)           | The `add` command                                 |
| [`serve/`](./serve)       | The `serve` command                               |
| [`generate/`](./generate) | The `generate` command, and its templates         |
| [`tree.ts`](./tree.ts)    | The tree: how a command writes files              |
| [`npm.ts`](./npm.ts)      | The build of the npm package                      |

The tool is an application of CHO, written as one would be: a command is a
method of a controller, and calls plain functions from top to bottom. `new` is
[`new/new.ts`](./new/new.ts):

```ts
const cwd = process.cwd();
const flags = read_flags(ctx.args); //            what the command line said
const answers = await ask_answers(flags, cwd); // the questions, for the rest
return create_workspace(answers, cwd, flags.dryRun); // plan, write, the steps
```

A command does not write files as it goes. It records them on a tree, a layer in
memory over the folder, and `commit` writes them together, or leaves the folder
as it was. `--dry-run` prints the tree, and a test reads it with no disk:

```ts
const tree = new Tree(disk_host(root));
tree.create("libs/shared/mod.ts", text); // a new file
tree.update("cho.json", json_text(config)); // a file that exists
await commit(tree);
```

The templates of `cho new` are the folders of
[`new/templates/`](./new/templates): real projects, checked and tested with the
repository. Those of `cho generate` are in
[`generate/templates/`](./generate/templates), a folder for each part. The tool
holds them all as text, in the two `templates.gen.ts`, and the schema of
`cho.json` is made from the constants of [`new/config.ts`](./new/config.ts).
After a change to any of them:

```sh
deno task --cwd cli gen   # writes the files that are made from others
```

A test fails when one of them was not written again.

A new command is a controller with an `@Action`, added to a module of
[`app.ts`](./app.ts). Its tests call `run_cli`, and check the exit code and what
was printed: see [`app_test.ts`](./app_test.ts).

## Runtime support

Deno, Node.js 24 and Bun: the tests run on the three. A Cloudflare Worker has no
command line.
