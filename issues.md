# Open issues

Issues found while documenting the packages and auditing the specs, to handle
later. Section A comes from an automated audit of `core/specs.old.md` against the
code (probe scripts and code reading); verify each item before fixing it.

## A. `core/specs.old.md` does not match the code

The code wins: update the spec. `command/specs.old.md` cites core §3.4, §4.1, §4.2,
§6.6, §8.2 and §8.3, so append new sections instead of renumbering those.

1. **"Already decorated" message** (spec §3, §8.1). The spec says
   `@<Decorator>: class is already decorated with @Injectable, @Module or @Controller`.
   The code (`di/decorations.ts`) throws the message without the `@<Decorator>:`
   prefix, and the tests expect that.
2. **Decorators validate their arguments** (spec §3 says nothing is validated
   beyond the one-DI-decorator rule). `set_injectable`, `set_module` and
   `assert_provider` (`di/decorations.ts`) check dependencies, imports,
   controllers, exports and provider objects, all before writing. Document the
   rules and messages (new §3.5) and add them to the §8.1 table. Messages:
   - `all dependencies must be classes, symbols or injection tokens: <v>`
   - `all imports must be classes: <v>`
   - `all controllers must be classes: <v>`
   - `all exports must be classes, symbols or injection tokens: <v>`
   - `provider <name> is not an object`
   - `provider <name> is missing the "provide" property`
   - `provider <name>: "provide" must be a class, symbol or injection token, got <v>`
   - `provider <name> is missing the "factory" property`
   - `provider <name>: "factory" must be a function, got <v>`
   - `provider <name>: "deps" must be an array, got <v>`
   - `provider <name>: all deps must be classes, symbols or injection tokens: <v>`
3. **Strings are rejected at runtime now.** The spec (§2) says they are not;
   every token list goes through `isToken`.
4. **`isToken` is used** by the decorators (the spec says it is not used yet),
   and is exported from `@chojs/core/di`, not from `@chojs/core`.
5. **The metadata functions are exported** from `@chojs/core/di` (the spec calls
   them internal), with the type `MetaTarget`.
6. **`@Middlewares`, `@Catch`, `decorated_target`, `decorated_method` and the
   types `ChoMiddlewareFn`, `ChoMiddleware`, `ChoErrorHandler`,
   `ChoErrorHandlerFn`, `ChoMethodDecorator`, `ChoClassOrMethodDecorator` are
   not specified.** `command/specs.old.md` relies on them. Add them as §3.6–§3.8:
   middlewares are kept in source order (prepended, top decorator first);
   `@Catch` allows one handler per target; the error messages.
7. **`@Controller` flags** (spec §3.4 and §9). It now writes
   `{ ...rest, isController: true }`: `isController` can no longer be
   overwritten by an option, but `isInjectable` still can.
8. **§7 Public API is wrong.** `core/mod.ts` does not re-export `di/mod.ts`; it
   exports `Injectable`, `Module`, `Controller`, `Middlewares`, `Catch`,
   `Injector`, `token`, `provider`, and the types `ControllerOptions`,
   `ModuleOptions`, `Dependency`, `DependencyGraph`, `DependencyNode`,
   `MetadataGraph`, `ModuleScope`, `Any`, `ChoMiddlewareFn`, `Ctr`, `Target`.
   Rewrite §7 with the actual surfaces of `@chojs/core`, `@chojs/core/di`,
   `@chojs/core/utils` and `@chojs/core/utils/test_utils`.
9. **`Injector` is incomplete in the spec:** `readonly meta: MetadataGraph` and
   `modules()` (each module scope once, post-order, root last; add as §6.8).
10. **`controllers()` deduplicates:** a controller exported to importers is
    yielded once, from its owner module.
11. **`resolve` is not `async`.** It returns a rejected promise for every
    failure, but builds the message synchronously, so a token whose `String()`
    throws (`Object.create(null)`) makes it throw synchronously.
12. **More messages use the bare `ctr.name`** than §8 says: the module name in
    the link errors (`dependency-graph.ts`: import cycle, duplicate, ambiguous,
    export, cannot resolve), so an anonymous module shows an empty name.
13. **Two §8.2 read errors can no longer happen through the decorators**
    ("import is not a function", "controller entry not a function"): only for
    the root or a hand-written record.
14. **Symbol-named controller methods are not collected** (`Object.entries` in
    `metadata-graph.ts`).
15. **Smaller omissions:** `DependencyNode` and `ModuleScope` are classes, and
    `DependencyNode.isController()` exists; the Declare step also lives in
    `di/decorations.ts`.
16. **New known gaps for §9:**
    - a failed `@Module` / `@Controller` leaves a partial
      `{ isInjectable: true, dependencies: [] }` record, so the class then looks
      decorated;
    - `@Controller({ isInjectable: false })` clears the flag, so a second DI
      decorator is accepted;
    - `resolve` can throw synchronously (item 11).

## B. Bugs

1. **Class error handlers don't work in `@chojs/command`**
   (`command/command.ts`, `run()`). A class given to `@Catch` is resolved, then
   the instance is called as a function with `args` instead of the error. The
   call always throws, so the original error is printed and the exit code is
   `2`, whatever the class does. Documented in `command/specs.old.md` §9.
2. **A function error handler that throws makes `ChoCommand.run()` reject**
   instead of resolving to an exit code (`command/specs.old.md` §9).
3. **`@Catch` and web error handlers disagree on the type.** `@Catch` takes
   `ChoErrorHandler` (`(error) => unknown`), but `web/build-graph.ts` and the
   Hono linker call handlers as `ChoErrorHandlerFn` (`(ctx, error) => unknown`).
   So `@Catch((ctx, err) => …)` does not type-check (TS2345), and a handler
   typed `(error) => …` gets the context as its `error`.
4. **`CHO_DEBUG` does nothing in `@chojs/command`:** errors are printed with
   `console.error`; the `cho` debug logger was removed. Decide whether errors
   should be silent by default again.

## C. Packaging and tooling

1. **`engine()` is not exported** by any entry point (`core/utils/engine.ts`),
   although `CLAUDE.md` lists it as a `core/utils` helper.
2. **`HonoLinked.handler` casts `fetch`** instead of typing it, and the Hono
   linker uses a `@ts-ignore` to register routes by method name.
3. **The JSDoc examples don't type-check** with `deno check --doc`: they leave
   out the classes they use (`AppModule`, …).

## D. Missing tests

1. `@chojs/web` has no tests (`build-graph.ts`: routes, duplicates, middlewares,
   error handlers).
2. `@chojs/vendor-hono` has no tests.
