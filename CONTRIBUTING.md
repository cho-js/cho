# How to contribute

I'm really glad you're reading this, we need volunteer developers to help bring
this project to fruition.

Please read our [Code of Conduct](./CODE_OF_CONDUCT.md) before you take part:
everyone who contributes is expected to follow it.

## Contents

- [Ways to contribute](#ways-to-contribute)
- [Development](#development)
  - [Setup](#setup)
  - [Project layout](#project-layout)
  - [Checks](#checks)
  - [Tests](#tests)
  - [Documentation](#documentation)
  - [Naming](#naming)
  - [Adding a runtime adapter](#adding-a-runtime-adapter)
- [Pull requests](#pull-requests)
- [Commit messages](#commit-messages)
- [Releases](#releases)

## Ways to contribute

### Did you find a bug?

- Ensure the bug was not already reported by searching on GitHub under
  [Issues](https://github.com/cho-js/cho/issues).
- If you're unable to find an open issue addressing the problem,
  [open a new one](https://github.com/cho-js/cho/issues/new). Be sure to include
  a title and clear description, as much relevant information as possible, and a
  code sample or an executable test case demonstrating the expected behavior
  that is not occurring.

### Did you write a patch that fixes a bug?

- Open a new GitHub pull request with the patch.
- Ensure the PR description clearly describes the problem and solution. Include
  the relevant issue number if applicable.

### Did you find a security vulnerability?

Do not open a public issue. Report it privately, as described in the
[security policy](./SECURITY.md).

### Do you have a question?

Ask it in [Discussions](https://github.com/cho-js/cho/discussions). Issues are
for bugs and feature requests.

### Do you have a new idea? A feature request?

Create a new issue describing the feature you would like to see implemented. Be
sure to include a clear description of the problem you're trying to solve and
how your proposed feature would solve it. If you have any relevant code samples
or mockups, please include them as well.

For a change that is more than a small fix, open the issue first, so we can
agree on the design before you write the code.

## Development

### Setup

CHO is a [Deno](https://deno.com) workspace. Deno is all you need to work on it;
Node.js and Bun are needed only to run the tests on those runtimes.

| Tool    | Version        | Needed for                               |
| ------- | -------------- | ---------------------------------------- |
| Deno    | 2.x            | Everything: checks, tests, publishing    |
| Node.js | 24 or later    | Running the tests on Node.js, with `tsx` |
| Bun     | 1.3.4 or later | Running the tests on Bun                 |

```sh
git clone https://github.com/cho-js/cho.git
cd cho
deno install   # installs the npm dependencies (hono, fastify) into node_modules
```

### Project layout

Each package is a workspace member with its own `deno.json`, `README.md` and
tests.

| Folder            | Package                 | What it is                                            |
| ----------------- | ----------------------- | ----------------------------------------------------- |
| `core/`           | `@chojs/core`           | The dependency injection engine, and shared utilities |
| `command/`        | `@chojs/command`        | Command-line applications                             |
| `web/`            | `@chojs/web`            | HTTP applications                                     |
| `vendor/hono/`    | `@chojs/vendor-hono`    | Web adapter on Hono                                   |
| `vendor/fastify/` | `@chojs/vendor-fastify` | Web adapter on Fastify (Node.js only)                 |
| `examples/`       |                         | Runnable examples                                     |

`core`, `command` and `web` each have a `specs.md`: the specification of the
package, and the place to look for how something is meant to behave.

### Checks

Run these before you open a pull request. The CI runs the same ones.

```sh
deno fmt                    # format
deno lint                   # lint
deno check .                # type-check
deno task test              # tests on Deno
deno task test-node         # tests on Node.js (needs tsx)
deno task test-bun          # tests on Bun
deno publish --dry-run --allow-dirty   # what would be published to JSR
```

`./test.sh` runs the tests on the three runtimes, one after the other. The
Node.js tests need [`tsx`](https://tsx.is) on the path (`npm install -g tsx`),
or run them with `npx tsx --test`.

### Tests

- Tests are written with `node:test` and `node:assert/strict`, so the same file
  runs on Deno, Node.js and Bun. Do not use a runtime's own test API.
- A test file sits next to the code it tests, and is named `<file>_test.ts`.
- Decorators are applied as plain function calls in tests (see `legacy` and
  `tc39` in `core/utils/test_utils.ts`), so that both decorator proposals are
  covered on every runtime. Decorator **syntax** is tested only in the
  `syntax_test.ts` of each package.
- A bug fix comes with a test that fails without the fix. A new feature comes
  with tests of what it does and of how it fails.
- A change must pass on the three runtimes. An adapter that supports only some
  of them skips its tests on the others, and says so in its README.

### Documentation

- Every exported symbol has a JSDoc comment. `deno doc --lint <entry file>`
  reports the missing ones.
- A change of behavior updates the `README.md` of the package and, where there
  is one, its `specs.md`.
- Code samples in the documentation must compile and run.

### Naming

The name of a function says who it is for.

| What                                                   | Convention   | Examples                                           |
| ------------------------------------------------------ | ------------ | -------------------------------------------------- |
| Public API (userland): classes                         | `PascalCase` | `ChoWeb`, `ChoCommand`, `HonoLinker`               |
| Public API (userland): functions and methods           | `camelCase`  | `ChoWeb.create()`, `app.close()`, `route.handle()` |
| Decorators, public or internal                         | `PascalCase` | `@Injectable`, `@Get`, `@Action`                   |
| Internal functions and methods, **even when exported** | `snake_case` | `is_token`, `read_metadata_object`, `set_env`      |

- **`@chojs/core` is internal**, for now: every function and method in it is
  `snake_case`, and carries no compatibility promise. Applications get what they
  need from it through `@chojs/command` and `@chojs/web`, which re-export it.
  Some internal functions are still called by applications (`set_env`, on a
  runtime without `process`); they keep their internal name.
- **A single word fits both conventions** (`provider`, `token`, `env`,
  `compose`, `describe`, `debuglog`), so a function can move between the two
  audiences without a rename.
- **Methods follow their class**: a method of an internal class is `snake_case`
  (`DependencyNode.is_controller()`), a method of a public class is `camelCase`.
- The rule is about functions. Whatever the audience: properties and option keys
  are `camelCase` (`errorHandler`, `parseOptions`, `onError`), types are
  `PascalCase` (`ChoWebContext`), constants are `UPPER_SNAKE_CASE`
  (`METADATA_FORMAT`).

### Adding a runtime adapter

A web adapter connects `@chojs/web` to an HTTP library. It lives in
`vendor/<name>/` and is published as `@chojs/vendor-<name>`.

- It exports a linker (`HonoLinker`, `FastifyLinker`) that implements `Linker`
  from `@chojs/web/linker`, and is passed to `ChoWeb.create`. See
  [the web specification](./web/specs.md), section 7.
- It only matches requests to routes. Middlewares, error handling and the
  conversion of results belong to `@chojs/web`.
- It does not have to support every runtime, as long as its README says which
  ones it supports.
- Add the package to the `workspace` of the root `deno.json`, to
  `release-please-config.json` and to `.release-please-manifest.json`, and list
  it in the root `README.md` and in `web/README.md`.

## Pull requests

- Create a branch from `main`, and open the pull request against `main`.
- Keep a pull request to one change. Unrelated fixes go in their own pull
  request.
- Describe the problem and the solution, and link the issue (`Fixes #123`).
- Make sure the [checks](#checks) pass, and that the documentation is updated.
- Give the pull request a title that follows the
  [commit message convention](#commit-messages): when it is squashed, the title
  becomes the commit message.

## Commit messages

Commit messages, and pull request titles, follow
[Conventional Commits](https://www.conventionalcommits.org). The release notes
and the next version of each package are built from them, so a message that does
not follow the convention is left out of the release.

```
<type>(<scope>): <description>
```

| Type       | Use it for                                    | Release |
| ---------- | --------------------------------------------- | ------- |
| `feat`     | A new feature                                 | Minor   |
| `fix`      | A bug fix                                     | Patch   |
| `docs`     | Documentation only                            | None    |
| `test`     | Tests only                                    | None    |
| `refactor` | A change that neither fixes nor adds anything | None    |
| `perf`     | A performance improvement                     | Patch   |
| `build`    | The build, the CI or the dependencies         | None    |
| `chore`    | Anything else                                 | None    |

- The scope is the package: `core`, `command`, `web`, `vendor-hono` or
  `vendor-fastify`.
- A breaking change has a `!` after the type or the scope, and is released as a
  major version.

```
feat(web): add the @Head and @Options decorators
fix(command): cap the exit code at 255
feat(core)!: store method records with the class
```

## Releases

Releases are automated with
[release-please](https://github.com/googleapis/release-please). Do not change
the `version` of a `deno.json` or a `CHANGELOG.md` by hand.

1. Every push to `main` updates a release pull request, with the next version
   and the changelog of each package that changed.
2. Merging that pull request tags a GitHub release for each package, and
   publishes it to [JSR](https://jsr.io/@chojs).
