# The tests on Cloudflare Workers

This folder runs the tests of CHO in [workerd](https://github.com/cloudflare/workerd),
the runtime of Cloudflare Workers. It is a tool of the repository: it is not a
package, and nothing here is published.

```sh
tools/workerd/docker.sh        # in Docker: nothing is installed on the machine
tools/workerd/run.sh           # here: needs Node.js, and installs in a temporary folder
tools/workerd/run.sh web/path_test.ts   # some files only
```

## How it works

A Worker has no test runner, no files and no `node:test`. So each test file
becomes a Worker of its own:

1. `build.mjs` bundles the test file with esbuild. `node:test` is replaced by
   `test-api.js`, a small stand-in that collects the suites and the tests.
2. The bundle is given to `workerd test`, which calls the `test` handler of the
   Worker: it runs what was collected, and prints one line for each failure and
   a `RESULT` line.
3. `run.sh` does this for every test file of the packages that run on Workers,
   and fails when a test fails or a file does not load.

The tests run at one compatibility date (`COMPATIBILITY_DATE` in `build.mjs`),
with the `nodejs_compat` flag: they use `node:assert`. The libraries need no
flag: `workers/app.ts` is a Worker built on `@chojs/web` that runs without it.

## What is in it

| File                  | What it is                                                                 |
| --------------------- | -------------------------------------------------------------------------- |
| `run.sh`              | runs the test files, and the Workers of `workers/`                         |
| `docker.sh`           | runs `run.sh` in a container, with the repository mounted read-only        |
| `build.mjs`           | bundles one test file, or one Worker, and writes the configuration of workerd |
| `test-api.js`        | the stand-in for `node:test`: `describe`, `it`, `skip`, `before`, `after`  |
| `package.json`        | the versions of workerd and esbuild: installed in a temporary folder       |
| `workers/app.ts`      | an application as one would write it, with no `nodejs_compat`              |
| `workers/bindings.ts` | the bindings and `waitUntil`, reached from a handler and from a provider   |

## What is skipped on Workers

A test that cannot run there skips itself, by what it needs:

- a server: `serve()` has none on a Worker (`web/serve_test.ts`, and the tests
  of server-sent events over a connection);
- files: the check of the error codes against the documents;
- Fastify, which runs on Node.js only.

Names matter: the bundle keeps the names of functions and classes
(`keepNames`), which CHO puts in error messages, in logs and in the tags of an
OpenAPI document.
