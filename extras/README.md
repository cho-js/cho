# Extras

Modules that are built on top of a CHO application, and are not one of its
parts: they read what the application declares, and make something of it. An
OpenAPI document of the routes of a `@chojs/web` application is one.

An extra is a package of its own. An application that does not use it does not
install it.

## What belongs here

A module belongs here when **it reads the graph of an application, or anything
else the framework does not promise to keep**: `app.graph`, the refs of the
routes, the commands or the topics, the metadata the decorators write.

Such a module breaks when the framework changes. So it lives next to the
framework: it is changed in the same pull request, checked by the same CI, and
released with the same version.

## What does not

- **A module that only uses the public API**: a middleware, a provider, a client
  of a database, a logger. Nothing ties it to this repository, and such modules
  have no end: they go in a repository of their own.
- **An adapter of an external library**: a router, a broker. It goes in
  [`vendor/`](../vendor).
- **A kind of application**: it goes at the root, next to `web`, `command` and
  `message`.

When the answer is not clear, the question is: _can a change inside the
framework, with no change of its public API, break this module?_ Yes: it belongs
here. No: it does not.

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
   application declares for it: `@Doc` of `@chojs/web` is where an application
   says what its code cannot tell.
4. **It says which runtimes it runs on.** All of those of the package it reads,
   unless it documents why not.
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
4. Add it to the tables of the root `README.md`, and to the table below.
5. Create the package on JSR, in the `@chojs` scope, before the next release:
   the release publishes every package of the workspace.

## Packages

| Package                                 | What it makes of an application                                  |
| --------------------------------------- | ---------------------------------------------------------------- |
| [`@chojs/openapi`](./openapi/README.md) | The OpenAPI document of a `@chojs/web` application, and its page |

## When this folder grows

An extra that no longer reads what the framework does not promise, or one that
needs its own pace of releases, moves to a repository of its own, with its
history. Its name on JSR stays the same, so nothing changes for the applications
that use it.
