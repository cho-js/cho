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

## Status

Updated after the adapter redesign (`web/tasks.md`) and the fixes of every A
item (which brought D1 and D2 with them). The text below is the original review;
items are marked **[FIXED]**, **[PARTLY FIXED]** or left unmarked when still
open. Each mark was checked against the code.

| Item | Status   | Note                                                                        |
| ---- | -------- | --------------------------------------------------------------------------- |
| A1   | fixed    | middlewares are composed per route by `@chojs/web`; regression tests        |
| A2   | fixed    | `decorated_target` falls back to the class                                  |
| A3   | fixed    | guards added; wrapped and inherited handlers now work (D2)                  |
| A4   | fixed    | option types are closed; unknown options also throw at runtime (D1)         |
| A5   | fixed    | all six items                                                               |
| B2   | fixed    | handlers, middlewares and error handlers receive `ChoWebContext`            |
| B3   | resolved | teardown and overrides implemented; the other three are design positions    |
| D1   | fixed    | extras are `meta.options`; closed types. Dependency-list spelling unchanged |
| D2   | fixed    | method records are stored with the class, by method name                    |
| D3   | fixed    | the DI decorators check dependencies against the constructor                |
| D4   | fixed    | records are stamped with a format; another format is an error               |
| D5   | fixed    | positionals are strings; commands declare their flags                       |
| D6   | fixed    | `web/syntax_test.ts` runs real decorator syntax on Deno, Bun and Node       |

Current checks: `deno check`, `deno lint` pass; 111 tests / 701 steps on Deno,
684 on Bun and on Node.

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

### A1. [FIXED] Hono adapter: middlewares leak onto other features and controllers (high, probed)

**Fix:** `@chojs/web` composes each route's middlewares itself
(`web/compose.ts`, `web/routes.ts`) and the adapter registers flat routes with
`app.on(...)`; no sub-applications. Regression tests in `web/routes_test.ts`
("never runs a feature's middlewares for another feature…", "…for a sibling
controller").

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

### A2. [FIXED] Class-level `@Middlewares`, `@Catch` and `@Help` crash where `context.metadata` is undefined (medium, probed)

**Fix:** `decorated_target` returns the class when a TC39 class context has no
`metadata`, as the DI decorators do. The DI decorators keep their own
`context?.metadata ?? target`: they are class-only, and routing them through
`decorated_target` would let `@Injectable` on a method mark the method. Tests in
`core/di/decorations_test.ts`, `core/di/decorators_test.ts` ("TC39 decorators
without context.metadata") and `command/decorators_test.ts`.

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

### A3. [FIXED] Web decorators are silently dropped in four cases (medium, probed)

**Fix:** the first two rows throw when the class is defined, and the route is
validated there too (`web/decorators.ts`). The last two rows work now: the core
stores method records with the class, by method name (D2), so a route survives a
decorator that replaces the method, and a controller gets the handlers it
inherits. Tests with real decorator syntax, on both decorator call shapes, in
`web/syntax_test.ts`.

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

### A4. [FIXED] Typos in decorator options are accepted silently (medium, probed)

**Fix:** D1. `ModuleOptions` and `ControllerOptions` have no index signature any
more, so `{ deps: [...] }` and `{ provider: [...] }` are compile errors. A CHO
module declares its own options with the type parameter of `@Module` /
`@Controller`; `@chojs/web` and `@chojs/command` export their own typed
decorators, which also reject unknown options at runtime
(`assert_known_options`). `@Controller({ middlewares })` is now an error instead
of being discarded. Not done: the three spellings of dependency lists (`[...]`,
`dependencies`, `deps`) are unchanged.

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

### A5. [FIXED] Smaller items

**Fix:** all six. The JSDoc is corrected; `Injector.modules()` yields the map's
values and `controllers()` filters on the owner; `@Module` validates its options
before writing, so a failed `@Module` leaves the class undecorated; `provider()`
accepts sync factories; `is_positive_integer` became `exit_code`, which also
caps at `255` (256 would read as success); `describe` no longer throws.

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
- **[FIXED] `core/utils/describe.ts`** is used on arbitrary user values in web
  (`assert_route`) and falls back to `String(value)`, which throws on
  `Object.create(null)`. `describe_value` in `decorations.ts` is the safe one;
  it should be the shared utility. **Fix:** `describe` no longer throws; it
  falls back to `Object.prototype.toString`, then `<unknown>`.

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

### B2. [FIXED] Portability stops at the linker

**Fix:** handlers, middlewares and error handlers receive `ChoWebContext`
(standard `Request`, `params`, `url`, `state`), and middlewares return a
standard `Response`. The vendor context is the `native` escape hatch. An adapter
only registers finished routes (`Route.handle`).

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

### B3. [RESOLVED] Lifecycle and scope of the DI

The review listed five things as "missing pieces". After discussion, two were
implemented and three are design positions of the project, not gaps.

**Implemented**

1. **Teardown.** `Injector.dispose()` releases what was created, in reverse
   creation order, through the standard `Symbol.asyncDispose` / `Symbol.dispose`
   methods. The DI provides the mechanism and never the trigger:
   `ChoWeb.close()` and `ChoCommand.close()` call it, when the application says
   so. `resolve()` and `init()` reject afterwards.
2. **Test overrides.** `new Injector(App, { overrides })` replaces declared
   providers anywhere in the graph; `ChoWeb.create` and `ChoCommand.create` take
   the same option. An override that replaces nothing is an error. The design is
   still to be discussed.

**Design positions** (documented in `core/specs.md`, sections 2.4 and 2.7)

3. **Modules are not configured.** The review asked for configurable modules;
   that is an anti-pattern here. Configuration belongs to the creation of
   values: a library ships classes, and the application declares the providers
   that construct them. A module never sees its importer's providers, so it
   cannot be handed configuration either.
4. **A DI failure stops the application.** A missing dependency is a wiring
   error thrown by `new Injector()`, before anything is created. A factory that
   fails is not retried; `@chojs/web` creates everything at startup and refuses
   to start. `@chojs/command` creates lazily, so `--help` does not need the
   database. There are no optional dependencies. The review's concern (a
   long-lived server that resolves lazily) does not apply to either.
5. **Singletons only.** Transient and request scope are not the DI's job:
   request data lives in the request context (`ctx.state` in `@chojs/web`), and
   a value that must be new each time comes from an injected factory function.

## C. Recommended design changes (D1–D6)

### D1. [FIXED] Separate user options from framework fields, and close the option types

**Fix:** see A4. The normalized metadata keeps extras under `options`
(`ControllerMetadata.options`, `ModuleMetadata.options`); web reads
`meta.options.route`, command reads its class-level `@Help` there.

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

### D2. [FIXED] Store method records on the class, not on the function

**Fix:** `core/di/metadata.ts` has a per-class method table (`method_metadata`,
`method_records`, `read_method_metadata`), and `decorated_method` returns where
to write as `.meta`. Records written on a function are still read, and merged:
that is the fallback for static and private methods, and for TC39 decorators
compiled without `Symbol.metadata`. Symbol-named methods are stored but still
not collected into `methods`.

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

### D3. [FIXED] Check constructor signatures at compile time

**Fix:** `@Injectable`, `@Module` and `@Controller` return a
`ChoInjectableDecorator<D>`, typed by the dependency tuple, in core and in the
`web` and `command` wrappers. A wrong order, a wrong type or a missing
dependency is a compile error, with decorator syntax and with plain calls.
Limits: a class may take fewer parameters than there are dependencies; a list
typed `Dependency[]` is not checked; symbols are untyped; and the check is
structural, so a class with no members accepts anything. Type tests in
`core/di/types_test.ts`, `web/syntax_test.ts` and the web and command decorator
tests. No existing code in the repository failed the new check.

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

### D4. [FIXED] Version the record key

**Fix:** the key is unchanged, so copies still find each other's records; each
record is stamped with its format (`METADATA_FORMAT`, in `core/di/metadata.ts`).
Reading, overwriting or extending a record of another format, or one with no
stamp, throws an error that says two incompatible versions of `@chojs/core` are
loaded. A versioned key was the other option: it would have hidden the records,
and reported a decorated class as "not a module".

`Symbol.for("chojs.meta")` lets two copies of the package share records, which
is the intent. It also lets two **versions** read each other's records with no
format check. Put the format version in the key (`chojs.meta.v3`) or in the
record, so a mismatch is an error and not a misread.

### D5. [FIXED] Command: flags are global and untyped

**Fix:** positionals are always strings (`007`, `0x10` and `1e3` arrive as
typed). `@Action(name, flags)` and `@Main(flags)` declare a command's flags
(`boolean`, `string`, `collect`, `negatable`, `alias`, `default`, `describe`);
they apply to that command only and are listed in its `--help`. The command is
found before the line is parsed, so `-v ls` runs `ls` (command issue 4). Still
as before: the value of a flag that is not declared is typed from its look
(`--id=007` gives `7`).

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

### D6. [FIXED] Test the decorator syntax

**Fix:** `web/syntax_test.ts` uses real syntax for `@Injectable`, `@Module`,
`@Controller`, `@Middlewares`, `@Catch`, `@Get` and `@Post`, and runs in the
three CI jobs. The command decorators (`@Main`, `@Action`, `@Help`) are still
only applied as function calls.

Tests apply decorators as function calls so they run on Node. The consequence is
that no test executes `@Decorator` syntax, and the examples are type-checked but
never run. The framework's main promise is therefore unverified by CI; A2 is the
kind of bug that follows. One fixture file with real syntax, executed by
`deno run`, `bun` and `tsx` in CI (my probe is exactly that), closes the gap.

## Per package

**core** — Solid. Beyond the above:

- **[FIXED]** `engine.ts` was unexported and had typos: `engine` and
  `EngineType` are exported, the typos are gone.
- **[FIXED]** `debuglog` was used by no package: `web` and `command` log to
  `cho:web` and `cho:command`.
- **[FIXED]** `env()` had no path for runtimes without `process`: `set_env`
  takes another source.
- Open: the JSDoc of `ChoCommand.run` (`command/command.ts`) still names the
  `cho` debug logger; the context is `cho:command`.

**command** — Small and readable.

- **[FIXED]** Class error handlers were called as functions, with `args` instead
  of the error: they are called through `handle(error, args)`.
- **[FIXED]** A throwing function error handler made `run()` reject: it now
  resolves to `2`.
- **[FIXED]** `@Middlewares` was accepted and ignored: commands now run
  middlewares, with a context, as `@chojs/web` does (`command/tasks.md`).
- Open: `initModule` resolves only the owning module; `injector.init()`
  semantics would be less surprising.
- Open: `command/lib/parse-args.ts` is a vendored copy of `@std/cli` with its
  license header intact; note its origin and version in the README so it can be
  updated.

**web** — Rebuilt around the new adapter contract.

- **[FIXED]** Controllers with no HTTP method and features with no routes were
  created and emitted.
- **[FIXED]** The duplicate-route error named nothing; `:id` vs `:name`
  duplicates passed.
- **[FIXED]** `ControllerInstance` and `MethodRef.type` are removed.
- **[FIXED]** `@Patch`, `@Head` and `@Options` exist.

**vendor/hono** — **[FIXED]** The middleware leak (A1), the ignored prefix and
the inconsistent error-handler argument order are gone with the rewrite, and so
is the `@ts-ignore`: the adapter is one `app.on(method, path, …)` loop.

## Release readiness

Blockers for a 3.0, in my view, and where they stand:

- web + vendor-hono: A1 **[FIXED]**, the prefix **[FIXED]**, the error handler
  contract **[FIXED]**, A3 **[FIXED]**.
- command: class and throwing error handlers **[FIXED]**; `@Middlewares` ignored
  **[FIXED]**.
- core: A2, the stale JSDoc (A5), D1 and D2 are all **[FIXED]**. D1 and D2 are
  breaking for CHO module authors (`method.fn` → `method.meta`, extras under
  `options`), so they had to land before 3.0.

Repository housekeeping:

- `release-please-config.json` has `"release-as": "3.0.0"` on every package. It
  must be removed after the first release or every later release is 3.0.0.
- `README.md` lists `@chojs/dev`, which is not in the workspace.
- **[PARTLY FIXED]** Stale documents: `web/cr.md` and `core/issues.md` are
  deleted. `web/issues.md` (#2, #4) still refers to a root `issues.md` and to
  the deleted `core/issues.md`.
- `test.sh` has no `set -e`, so a failing runtime does not fail the script.
- CI does not run `deno fmt --check` (it fails on `assets/cho.svg`; exclude the
  asset).
- **[PARTLY FIXED]** `web/deno.json` no longer has an empty `imports`;
  `tsconfig.json` still carries `"jsx": "react-jsx"`.

## Suggested order

1. **[DONE]** A1 with the prefix fix: rewrite `HonoLinker.link` to flat
   registration.
2. **[DONE]** A2 and the web decorator guards (A3, first two rows); add the
   syntax fixture to CI (D6).
3. **[DONE]** Decide the handler / middleware / error-handler contract (B2),
   then fix the web and command issues against it; command now has the same
   middleware and error-handler contract.
4. **[DONE]** D1 and D2 together, as the one breaking change to the metadata
   contract; D3 as well.
5. **[DONE]** `dispose()` and test overrides (B3.1, B3.2).
