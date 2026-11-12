# CHO code review (Fable)

Reviewed: branch `v3` at `30bf511` — `core`, `command`, `web`, `vendor/hono`,
examples, CI and release configuration.

How it was checked: every source file was read in full. The test suite, type
check and lint were run on a scratch copy of the repository (Deno 2.9.8, Bun
1.2.20, Node 24.6 + tsx), and each finding marked **(probed)** was reproduced
with a script that uses real decorator syntax on all three runtimes.

| Check                        | Result                                        |
| ---------------------------- | --------------------------------------------- |
| `deno check .`               | pass                                          |
| `deno lint`                  | pass                                          |
| `deno task test`             | 66 tests / 481 steps pass                     |
| `bun test`, `tsx --test`     | 463 pass on each                              |
| `deno fmt --check`           | fails on `assets/cho.svg` only (not in CI)    |
| Decorator syntax, 3 runtimes | works (not covered by the test suite, see D6) |

## Verdict

The core DI is the strong part: a small, well-factored pipeline with careful
validation and good error messages. I found no correctness bug in the graph
building or in the injector. It is ready to build on.

The layers above it are not at the same level. `@chojs/web` with the Hono
adapter has one security-relevant bug that is not in any `issues.md` (A1:
middlewares leak onto other features' routes), and several places where a
decorator is silently ignored. The largest design gap is that the project's
headline promise, portability, stops at the linker: controller code is written
against Hono's `Context`.

Findings already tracked in `core/issues.md`, `command/issues.md` and
`web/issues.md` are not repeated in detail; "Release readiness" says which of
them I would treat as release blockers.

## A. New bugs

### A1. Hono adapter: middlewares leak onto other features and controllers (high, probed)

`vendor/hono/mod.ts:101-112` registers a node's middlewares with `ctrl.use(...)`
on a sub-application, then mounts it with `app.route(fr.route, feature)` (line
96). When the route is `""`, Hono merges that `/*` middleware into the parent,
so it runs for every path registered after it, and for unmatched paths.

```text
@Middlewares(adminAuth) @Module({ controllers: [Admin] }) class AdminM {}
@Module({ controllers: [Public] })                        class PublicM {}

GET /public/y  -> adminAuth runs
GET /nope      -> adminAuth runs (a 401 instead of a 404)
```

The same happens between sibling controllers of one feature when the controller
with middlewares has no `route`, and between two features that share a route.
Whether a route is protected then depends on `imports` order. An auth middleware
scoped to one feature silently applying elsewhere is the benign direction; the
reverse reading of the same bug is that reordering imports changes which routes
are guarded.

Error handlers do not leak (probed): Hono scopes `onError` per sub-app.

Fix: do not use `use()` on sub-apps. The graph already has everything needed:
register each handler with the concatenated chain
`[...feature.middlewares, ...controller.middlewares, ...method.middlewares]`,
the way method middlewares are passed today (line 92). That also makes the
adapter independent of Hono's sub-app semantics, and makes the global prefix fix
(web issue 1) a one-line path join.

### A2. Class-level `@Middlewares`, `@Catch` and `@Help` crash where `context.metadata` is undefined (medium, probed)

`decorated_target` (`core/di/decorations.ts:671-672`) returns `context.metadata`
unconditionally. TypeScript's own TC39 emit only creates the metadata object
when the runtime has `Symbol.metadata`; otherwise `context.metadata` is
`undefined`, and the write fails with
`Object.defineProperty called on non-object`.

`@Injectable`, `@Module` and `@Controller` already handle this
(`context?.metadata ?? target`, `decorators.ts:73`). Deno polyfills the symbol
and esbuild/tsx always creates the object, which is why nothing fails today;
plain `tsc` output on Node does not.

Fix: `return context.metadata ?? target` in `decorated_target`, and use
`decorated_target` in the three DI decorators so there is one implementation.

### A3. Web decorators are silently dropped in four cases (medium, probed)

`web/decorators.ts:31-42` does no validation (`// todo assert_route`), so:

| Code                                         | Result                         |
| -------------------------------------------- | ------------------------------ |
| `@Get("x") @Post("x") h()`                   | only GET exists; POST is `404` |
| `@Get("x") static h()` (or private / symbol) | no route, no error             |
| `@Logged @Get("x") h()` (wrapping decorator) | no route, no error             |
| `@Get` on a method of a base class           | no route on the subclass       |

`@chojs/command` guards the first two (`assert_no_command`,
`assert_command_method`); web needs the same guards. The last two come from the
storage design, see D2.

### A4. Typos in decorator options are accepted silently (medium, probed)

`ModuleOptions` and `ControllerOptions` have an index signature
(`decorations.ts:133`, `160`), so every misspelling type-checks and is stored as
an "extra option":

```ts
@Controller({ deps: [Svc] })                     // no dependency injected
@Module({ provider: [Svc], controller: [Ctrl] }) // empty module
```

The three spellings of the same concept make this likely: `@Injectable([...])`,
`@Controller({ dependencies })`, `provider({ deps })`.

Related: the normalized metadata spreads user options first and then overwrites
them (`metadata-graph.ts:255-268`), so `@Controller({ middlewares: [auth] })`
type-checks, is stored, and is then discarded. For an option with that name,
silent loss is the worst outcome.

Fix: see D1.

### A5. Smaller items

- **Stale JSDoc.** `core/di/decorators.ts:94-95`, `131-132`, `140-141` still say
  the options `isInjectable`, `isModule`, `isController` are reserved and throw.
  They are plain options since the symbol-key change.
- **`Injector.modules()`** (`injector.ts:241-249`): the `WeakSet` dedupe is dead
  code; the map's values are already unique. `controllers()` could filter on
  `node.owner === scope.ctr` instead of deduping imported nodes.
- **`@Module` is not atomic.** `set_injectable` writes before `set_module`
  validates (acknowledged in the file header). Validating both first is a small
  change.
- **`provider()` rejects sync factories at the type level** (`tokens.ts:118`),
  although the injector awaits the result either way. `T | Promise<T>` would
  remove `() => Promise.resolve("x")` boilerplate.
- **`command.ts:63`** `is_positive_integer` accepts `0`; the name should say
  non-negative. Exit codes above 255 are passed through.
- **`core/utils/describe.ts`** is used on arbitrary user values in web
  (`assert_route`) and falls back to `String(value)`, which throws on
  `Object.create(null)`. `describe_value` in `decorations.ts` is the safe one;
  it should be the shared utility.

## B. Architecture and design

### B1. What works well

- **Declare, read, link, create.** Four small stages with one responsibility
  each. Decorators only write records; nothing runs at class definition. The
  whole graph is validated synchronously in `new Injector()`, before any factory
  runs. This is the right shape, and the code matches the description in
  `core/specs.md`.
- **Scope rules are strict and predictable.** Dependencies always resolve in the
  declaring module; no global providers, no implicit transitive visibility.
  Ambiguity is an error instead of import-order luck. I checked the reasoning
  that cycles cannot cross modules (imports are a DAG and a node only sees its
  own scope) and it holds.
- **Memoized promises** stored before any await give single creation under
  concurrency with very little code. Failure wrapping happens once, where it
  fails.
- **No `reflect-metadata`, no `emitDecoratorMetadata`.** Explicit dependency
  lists are what make the framework work with TC39 decorators and without a
  compiler plugin. This is the real differentiator from NestJS.
- **Symbol keys for framework data** end the option-name collisions cleanly.
- **Linker inversion in web**: `@chojs/web` does not import an adapter, and the
  graph handed to the linker is fully materialized.
- Error messages name the module, the token, the argument index and the fix.

### B2. Portability stops at the linker

The README's first claim is engine-agnostic code. But a web handler receives the
adapter's context (`ctx: Context` from `hono`, `ctx.req.param("id")`), and
middlewares have Hono's signature. Application code therefore imports `hono`
directly, and swapping the linker means rewriting every controller. The `Linker`
abstraction protects the framework from the vendor, not the user.

`web/cr.md` Q-1 raised this and it is still open. It should be decided before
anything else in web, because it fixes the signatures of handlers, middlewares
and error handlers (web issues 2, 3, 4 are all symptoms). The Web-standard
option fits the project best: handlers take a small CHO context built on
`Request` (`req`, `params`, `url`) and return a `Response` or a JSON value; each
linker adapts it. Access to the vendor context can remain as an escape hatch.

### B3. Missing pieces in the DI model

These are absent by design today; each one will be asked for early:

1. **No teardown.** Factories are async so they can open connections, but
   nothing can close them. An `injector.dispose()` that calls a hook on created
   instances in reverse creation order is cheap to add now, since the injector
   already knows the order.
2. **No way to override a provider for tests.** Because dependencies resolve in
   the declaring module, a test cannot replace `DbConn` inside an imported
   module. `new Injector(App, { overrides: [provider(...)] })` applied at link
   time would cover it.
3. **No configurable modules.** A module is a static class, so a reusable module
   cannot take parameters (`DbModule.with({ url })`). The usual answer is a
   function that returns a module class, or a dynamic-module object in
   `imports`. Worth deciding before 3.0 since it affects `imports` validation
   ("all imports must be classes").
4. **Failures are permanent** (probed: a factory that fails once is never called
   again). Documented, and right for CLI and startup. For a long-lived server
   that resolves lazily, one transient failure poisons the token until restart.
   At least document that servers should `init()` and exit on failure.
5. Singleton only: no transient or request scope, no optional dependencies. Fine
   for v3, but say so in the README.

## C. Recommended design changes (D1–D6)

### D1. Separate user options from framework fields, and close the option types

Keep extras under one key in the normalized metadata (`meta.options.route`)
instead of spreading them into the same object as `provider`, `methods`,
`middlewares`. Then remove the index signature from `ModuleOptions` /
`ControllerOptions` and let each CHO module declare its own option type:

```ts
// web
export const Controller = core.Controller<{ route?: string }>;
```

This turns A4 into compile errors, removes the "normalized fields always win"
rule, and makes `route` typed in web instead of `meta["route"]` plus a runtime
check. Also pick one spelling for dependency lists.

### D2. Store method records on the class, not on the function

Method records live on the method function object (`decorations.ts:568-570`) and
are found again through `Object.getOwnPropertyDescriptors(ctr.prototype)`. That
is why wrapped, inherited, static and symbol-named methods disappear (A3, core
issue 6), and why a function shared by two classes shares its record.

Both call shapes can reach the class instead: TC39 gives `context.metadata`
(inherited through the prototype chain by the spec), legacy gives
`target.constructor`. A per-class map `name -> record` in the same bag:

- survives any other decorator that replaces the function;
- gives inheritance for free, with own-vs-inherited as an explicit choice;
- removes the prototype scan and the string-name restriction.

This is the one structural change in core I would make before 3.0, because the
record location is part of the contract with CHO module authors.

### D3. Check constructor signatures at compile time

The cost of explicit dependency lists is that list and constructor can drift.
With TC39 class decorators the list can be checked against the constructor
(probed, `deno check` passes and rejects the wrong order):

```ts
function Injectable<const D extends readonly Dependency[]>(deps: D) {
  return (target: new (...args: ResolvedAll<D>) => unknown, ctx?) => { ... };
}

@Injectable([PORT, Logger])          // compile error
class Server { constructor(l: Logger, p: number) {} }
```

`ResolvedAll` already exists for `provider()`. This would be the strongest
answer to "why not reflect-metadata".

### D4. Version the record key

`Symbol.for("chojs.meta")` lets two copies of the package share records, which
is the intent. It also lets two **versions** read each other's records with no
format check. Put the format version in the key (`chojs.meta.v3`) or in the
record, so a mismatch is an error and not a misread.

### D5. Command: flags are global and untyped

`parseOptions` applies to the whole application, and undeclared values are
coerced (probed):

```text
./app call 0501234567 --id=007 --hash 1e3 0x10
-> { _: [501234567, 16], id: 7, hash: 1000 }
```

Leading zeros, hashes and hex-looking strings are altered before the handler
sees them. Two changes: default positionals to strings (`string: ["_"]`), and
let each command declare its flags (`@Action("copy", { boolean: ["force"] })`),
which also fixes command issue 4 and gives `--help` an options list.

### D6. Test the decorator syntax

Tests apply decorators as function calls so they run on Node. The consequence is
that no test executes `@Decorator` syntax, and the examples are type-checked but
never run. The framework's main promise is therefore unverified by CI; A2 is the
kind of bug that follows. One fixture file with real syntax, executed by
`deno run`, `bun` and `tsx` in CI (my probe is exactly that), closes the gap.

## Per package

**core** — Solid. Beyond the above: `engine.ts` is unexported and has the typos
already listed in issue 8; `debuglog` is exported but used by no package, while
`command/command.ts`'s module doc still says errors go to the `cho` debug
logger; `env()` has no path for runtimes without `process` (Workers bindings),
which matters for a framework that names Workers and Lambda in its README.

**command** — Small and readable. `run()`'s catch block (`command.ts:298-330`)
is the weak spot: the class-handler branch calls an instance as a function with
`args` instead of the error, and a throwing function handler makes `run()`
reject (issues 1, 2). `@Middlewares` is accepted and ignored (issue 3).
`initModule` resolves only the owning module; `injector.init()` semantics would
be less surprising. `command/lib/parse-args.ts` is a 906-line vendored copy of
`@std/cli` with its license header intact; note its origin and version in the
README so it can be updated.

**web** — Honest about being early. Graph building is clear and the route
validation is good. Still open from `web/cr.md`: controllers with no HTTP method
and features with no routes are still created and emitted (M-2), the
duplicate-route error names nothing (M-3), `:id` vs `:name` duplicates pass
(L-1). `ControllerInstance` and `MethodRef.type` are loose leftovers. No
`@Patch`, `@Head`, `@Options`.

**vendor/hono** — 148 lines carrying A1, the ignored prefix (probed: `/api/a/v`
is 404, `/a/v` answers) and the inconsistent error-handler argument order. A
rewrite along the lines of A1's fix resolves all three at once. The `@ts-ignore`
on line 91 goes away with `app.on(method, path, ...handlers)`.

## Release readiness

Blockers for a 3.0 of web + vendor-hono, in my view: A1, web issue 1 (prefix),
web issues 2-4 (error handler contract), A3. For command: issues 1-3. For core:
A2 and the stale JSDoc; D1 and D2 are breaking, so they belong in 3.0 or wait
for 4.0.

Repository housekeeping:

- `release-please-config.json` has `"release-as": "3.0.0"` on every package. It
  must be removed after the first release or every later release is 3.0.0.
- `README.md` lists `@chojs/dev`, which is not in the workspace.
- `web/cr.md` reviews a file layout that no longer exists; `core/issues.md`
  refers to `tasks.md` and `web/issues.md` to a root `issues.md`, neither of
  which exists. `core/issues.md` item 11 mentions `core/readme.md`.
- `test.sh` has no `set -e`, so a failing runtime does not fail the script.
- CI does not run `deno fmt --check` (it fails on `assets/cho.svg`; exclude the
  asset).
- `tsconfig.json` carries `"jsx": "react-jsx"` and `web/deno.json` an empty
  `imports`.

## Suggested order

1. A1 with the prefix fix: rewrite `HonoLinker.link` to flat registration.
2. A2 and the web decorator guards (A3, first two rows); add the syntax fixture
   to CI (D6).
3. Decide the handler / middleware / error-handler contract (B2), then fix web
   issues 2-4 and command issues 1-3 against it.
4. D1 and D2 together, as the one breaking change to the metadata contract; D3
   fits in the same pass.
5. `dispose()` and test overrides (B3.1, B3.2).
