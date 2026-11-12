# Tasks: symbol keys for framework-written metadata

## Status

Done. All decisions were taken as proposed (D1–D4). Deviations from the plan:

- **2.7 / 3.7:** `command/specs.md` and `web/specs.md` were renamed to
  `specs.old.md` for a rewrite, so only the JSDoc was updated. The new specs
  should describe the private keys: `command/keys.ts` (`MAIN`, `ACTION`,
  `ALIAS`, `HELP`) and `web/keys.ts` (one `HTTP` key holding
  `{ method, route }`).
- **3.3:** web's `MethodMetadata` type was removed from `@chojs/web/graph` (a
  public entry point); the route data type is `HttpRoute` in the private
  `web/keys.ts`.
- **1.4:** `set_injectable` no longer stores extra keys of its options (the
  decorators never passed any).
- **Extra:** `own_keys()` was added to `metadata.ts` (string and symbol keys,
  enumerable only, like object spread), and the core and web middleware
  factories now accept `readonly` arrays.

## Goal

Every metadata key that the framework writes (not a key the user chose) becomes
a symbol, so a user option can never collide with it. Today core keys, extension
keys and user options share one flat string namespace, which causes bugs such as
these:

- `@Controller({ isModule: true })` turns a controller into a module.
- `@Controller({ errorHandler: fn })` acts like `@Catch` but skips its checks.
- `@Controller({ middlewares: "ab" })` is later spread into `["a", "b"]`.

The current fix (`assert_no_reserved_option`) only covers 3 names, and the code
relies on defensive spread ordering and on stripping keys.

## Rules

- **Key names.** Keys are `Symbol.for("chojs.<package>.<key>")`, for example
  `Symbol.for("chojs.core.isModule")`. Use `Symbol.for`, not `Symbol()`: the
  record itself lives under `Symbol.for("chojs.meta")` so that two copies of a
  package (different versions in one app) can read each other's records, and the
  keys must follow the same rule.
- **Where they live.** Each package defines its keys in a private `keys.ts`,
  which is not in the package `exports`. Only that package, and its tests,
  imports it.
- **User options stay strings.** Extra `@Module` / `@Controller` options, such
  as `route`, stay string keys, stored as given.
- **CHO modules read core data through the normalized graph.** They never read
  core's raw keys: the graph (`injector.meta`, `injector.controllers()`) exposes
  plain, typed fields.
- **Order of work.** Do core first, then command, then web. Each phase ends with
  every check green.

## Decisions to settle before starting

- [x] **D1. Descriptor types.** `InjectableDescriptor`, `ModuleDescriptor` and
      `ControllerDescriptor` are exported from `@chojs/core/di`, but no other
      package uses them. With symbol keys they describe private records.
      Proposal: stop exporting them. This is a public API change.
- [x] **D2. How extension keys reach CHO modules.** Extension keys (command's
      help, web's route data) are written to the same class and method records,
      so the normalized graph must pass them on. Proposal:
  - Keep spreading the raw record into `ModuleMetadata` / `ControllerMetadata`.
    Spread copies symbol keys, so extensions read their own symbols, and user
    string options stay at the top level, so `meta["route"]` keeps working.
  - Filter out core's own symbol keys.
  - Keep `MethodMetadata.meta` as the whole method record.
- [x] **D3. Behavior change.** After this work, `@Controller({ middlewares })`,
      `@Controller({ errorHandler })` and `@Module({ isController })` are plain,
      inert user options. Before, they changed DI behavior. Confirm this is
      intended. It is the point of the change.
- [x] **D4. Web record shape.** The web handler record is
      `{ isHTTP, type, method, name, route }`. `name` duplicates
      `MethodMetadata.name`, and `type` is always `"HTTP"`. Proposal: one key,
      `[HTTP]: { method, route }`.

## Phase 1: core

- [x] **1.1 Symbol keys in the metadata store** (`core/di/metadata.ts`).
  - `write_metadata_object` and `add_to_metadata_object` iterate with
    `Object.entries`, which drops symbol keys. Switch them to `Reflect.ownKeys`,
    so symbol keys are copied, merged (arrays concatenated) and frozen like
    string keys.
  - Tests in `metadata_test.ts`: symbol keys survive a write and a merge, and
    symbol arrays are concatenated.
- [x] **1.2 Core keys** (new `core/di/keys.ts`, not exported).
  - One `unique symbol` constant per key: `INJECTABLE`, `DEPENDENCIES`,
    `MODULE`, `IMPORTS`, `EXPORTS`, `PROVIDERS`, `CONTROLLERS`, `CONTROLLER`,
    `MIDDLEWARES`, `ERROR_HANDLER`.
  - Example:
    `export const MODULE: unique symbol = Symbol.for("chojs.core.isModule")`.
- [x] **1.3 Record types** (`metadata.ts`). Rewrite the `*Descriptor` types with
      the symbol keys, and apply D1.
- [x] **1.4 Record writers** (`core/di/decorations.ts`).
  - `set_injectable`, `set_module`, `set_controller`, `set_middlewares` and
    `set_error_handler` write the symbol keys. `assert_decorated` reads
    `INJECTABLE`.
  - User extras are the options minus the options the decorator uses
    (`dependencies`, `imports`, `exports`, `providers`, `controllers`), stored
    as plain string keys.
  - Remove the defensive code: `RESERVED_OPTIONS`, `assert_no_reserved_option`,
    the `dependencies: _` stripping and its comments, and the "extras first so
    the module keys win" spread ordering.
  - Update the module JSDoc ("What is validated here") and the JSDoc of the
    option types.
- [x] **1.5 Normalized graph** (`core/di/metadata-graph.ts`).
  - Read the raw records through the symbol keys.
  - Add typed fields:
    - `middlewares: readonly ChoMiddleware[]` (default `[]`) and
      `errorHandler?: ChoErrorHandler` on `ModuleMetadata` and
      `ControllerMetadata`;
    - the same two fields on `MethodMetadata`, read from the method record.
  - Pass the extension keys and user options on as decided in D2.
  - The normalized fields are still set last.
- [x] **1.6 Dependency graph and injector.** Check that `dependency-graph.ts`
      and `injector.ts` use only the normalized fields (`node.isController()`
      reads normalized metadata). No change is expected.
- [x] **1.7 Tests.** Several files assert raw records with string keys:
  - `decorations_test.ts` (~48 references), `decorators_test.ts` (~46),
    `metadata-graph_test.ts` (~22), `dependency-graph_test.ts` (2). Import the
    keys from `./keys.ts`.
  - Delete the reserved-name tests (the bug 2 fix).
  - Add tests:
    - an option named `isModule`, `middlewares`, `errorHandler` or
      `dependencies` is stored as an inert extra and does not change DI
      behavior;
    - `@Middlewares` and `@Catch` on methods surface as `MethodMetadata` fields;
    - a record written with `Symbol.for` keys by "another copy" is read.
- [x] **1.8 Docs.**
  - `core/specs.md`: remove the reserved names (sections 2.4 and 2.5) and their
    row in the error table (2.8), update the public API (3.2, per D1), and
    describe the private `Symbol.for("chojs.core.*")` keys in Internals (4.1).
  - `core/issues.md`: item 2 is superseded by this work.
- [x] **1.9 Verify.** `deno check .`, `deno lint`, `deno fmt --check`,
      `deno task test`, `deno task test-node`, `deno task test-bun`, the doc
      lint for each package, and `deno publish --dry-run`. Command and web must
      still pass before phase 2: they read core keys through the graph, so fix
      any read that breaks.

## Phase 2: command

- [x] **2.1 Command keys** (new `command/keys.ts`, not exported): `MAIN`,
      `ACTION`, `ALIAS`, `HELP`, as `Symbol.for("chojs.command.<key>")`. Drop
      the record's `name` key, which duplicates `MethodMetadata.name`.
- [x] **2.2 Writers** (`command/decorators.ts`). `@Main`, `@Action` and `@Help`
      write the symbol keys. `assert_no_command` reads them.
- [x] **2.3 Graph** (`command/graph.ts`). Read `MAIN` / `ACTION` / `ALIAS`.
      Consider a small typed reader, so the casts live in one place.
- [x] **2.4 Help** (`command/help.ts`). `help_of` reads `HELP`. The usage lines
      and the command lookup read `ALIAS`.
- [x] **2.5 Run** (`command/command.ts`).
  - `find_error_handler` uses core's normalized fields:
    `method.errorHandler ?? node.meta.errorHandler`.
  - `#find_controller` matches on `ALIAS`.
- [x] **2.6 Tests.** Update `decorators_test.ts` (~21 references) and any test
      that builds or reads records by hand (`graph_test.ts`, `help_test.ts`,
      `command_test.ts`).
- [x] **2.7 Docs.** Update the JSDoc. Note the record keys for the coming
      `command/specs.md`; the old one is `specs.old.md`.
- [x] **2.8 Verify.** Same checks as 1.9, and run `examples/*-cli.ts`.

## Phase 3: web

- [x] **3.1 Web keys** (new `web/keys.ts`, not exported): the handler key, or
      keys, per D4, as `Symbol.for("chojs.web.<key>")`.
- [x] **3.2 Writers** (`web/decorators.ts`). `@Get`, `@Post`, `@Put` and
      `@Delete` write the symbol record.
- [x] **3.3 Types** (`web/graph.ts`). Replace web's `MethodMetadata` (which also
      carries `middlewares` / `errorHandler`) with an internal record type, such
      as `HttpRoute`, holding only web's own data.
- [x] **3.4 Builder** (`web/build-graph.ts`).
  - `http_methods` reads the web key.
  - Middlewares and error handlers come from core's normalized fields at all
    three levels: module, controller and method.
  - The `route` option of `@Module` / `@Controller` stays a user string key.
- [x] **3.5 Hono adapter** (`vendor/hono`). It only uses the graph refs. No
      change is expected; verify.
- [x] **3.6 Tests.** Web has none. Add at least decorator tests (the record is
      written under the web key) and `build_http_graph` tests: routes,
      middlewares and error handlers at each level.
- [x] **3.7 Docs.** `web/specs.md` and the JSDoc.
- [x] **3.8 Verify.** Same checks as 1.9, and run
      `examples/hello-world-http.ts`.

## Phase 4: wrap-up

- [x] **4.1 `CLAUDE.md`.** Add a convention:
  - framework-written metadata keys are `Symbol.for("chojs.<package>.<key>")`,
    defined in each package's private `keys.ts`;
  - user options stay string keys;
  - extensions read core data through the normalized graph, never through core's
    keys.

  Also update the "Extension packages attach their own metadata…" sentence.
- [x] **4.2 Issue trackers.** In the root `issues.md`, remove the entries this
      work makes obsolete (section A items 7 and 16). In `core/issues.md`, mark
      item 2 as superseded.
