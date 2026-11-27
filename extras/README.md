# Extras

Modules that are not a part of a CHO application, and that this repository has a
reason to keep. There are two kinds:

- **A module built on top of an application**: it reads what the application
  declares, and makes something of it. An OpenAPI document of the routes of a
  `@chojs/web` application is one.
- **A module a package of this repository is built on**: `cho`, the command-line
  tool, asks its questions with `@chojs/prompt`.

An extra is a package of its own. An application that does not use it does not
install it.

## What belongs here

A module belongs here in one of two cases.

**It reads the graph of an application, or anything else the framework does not
promise to keep**: `app.graph`, the refs of the routes, the commands or the
topics, the metadata the decorators write. Such a module breaks when the
framework changes. So it lives next to the framework: it is changed in the same
pull request, checked by the same CI, and released with the same version.

**A package of this repository is built on it, and nothing else makes it.** It
may read nothing of the framework: `@chojs/prompt` asks questions in a terminal,
and would work with no CHO application at all. It is here because `cho` is
released with it, in one file that holds both: a change in one is tested with
the other, in the same pull request. A module of this kind is small and general,
and is written here because installing one was not worth a dependency (rule 5).

## What does not

- **A module that only uses the public API, and that no package of this
  repository is built on**: a middleware, a provider, a client of a database, a
  logger. Nothing ties it to this repository, and such modules have no end: they
  go in a repository of their own.
- **An adapter of an external library**: a router, a broker. It goes in
  [`vendor/`](../vendor).
- **A kind of application**: it goes at the root, next to `web`, `command` and
  `message`.

When the answer is not clear, there are two questions:

1. _Can a change inside the framework, with no change of its public API, break
   this module?_
2. _Is a package of this repository built on it?_

One yes: it belongs here. Two noes: it does not.

## Rules of an extra

1. **Named after what it does**: `@chojs/openapi`, in `extras/openapi`. The name
   has no `extras` in it, so the package can move to another repository without
   a new name.
2. **One package, one purpose.** There is no shared code between the extras, and
   no contract an extra has to implement. What two extras need both goes in the
   package they read: `@chojs/core`, `@chojs/web`, …
3. **It asks nothing of an application that does not use it.** No change in
   `@chojs/web`, `@chojs/command` or `@chojs/message` is made only for an extra
   to work, apart from exposing what it has to read, and from what an
   application declares for it: `@Doc` of `@chojs/web`, and of `@chojs/message`,
   is where an application says what its code cannot tell.
4. **It says which runtimes it runs on.** All of those of the package it reads,
   or of the package that is built on it, unless it documents why not.
5. **Small dependencies are written, not installed.** An external dependency
   needs a reason, and the README of the extra gives it.
6. **It is a package like the others**: `deno.json`, `mod.ts`, tests next to the
   code, a `README.md`, a `specs.md` for its decisions, and a `LICENSE`.

## Adding an extra

1. Create `extras/<name>`, with its `deno.json` (`@chojs/<name>`, the version of
   the other packages).
2. Add `./extras/<name>` to the `workspace` of the root `deno.json`.
3. Add the package to `release-please-config.json`, in the `packages` and in the
   linked versions, and to `.release-please-manifest.json`.
4. Add it to the table of the root `README.md`, and to the table below.
5. Create the package on JSR, in the `@chojs` scope, before the next release:
   the release publishes every package of the workspace.

## Packages

| Package                                   | What it gives                                                         |
| ----------------------------------------- | --------------------------------------------------------------------- |
| [`@chojs/openapi`](./openapi/README.md)   | The OpenAPI document of a `@chojs/web` application, and its page      |
| [`@chojs/asyncapi`](./asyncapi/README.md) | The AsyncAPI document of a `@chojs/message` application, and its page |
| [`@chojs/dev`](./dev/README.md)           | The list of its endpoints, and its graph, drawn on a page             |
| [`@chojs/prompt`](./prompt/README.md)     | Questions in a terminal: a text, a yes or no, a choice of a list      |

## When this folder grows

An extra that no longer has a reason to be here (it reads nothing the framework
does not promise, and no package of the repository is built on it), or one that
needs its own pace of releases, moves to a repository of its own, with its
history. Its name on JSR stays the same, so nothing changes for the applications
that use it.
