# @chojs/core issues

Bugs and open questions found while rewriting `core/specs.md`. Each bug was
reproduced with a probe script against the current code.

## Bugs

1. **[FIXED] A list option that is not an array crashes with an unhelpful
   message.** `@Injectable(Logger)` (instead of `@Injectable([Logger])`) throws
   `TypeError: options.dependencies.forEach is not a function`.
   `@Module({ imports: X })` and `@Module({ providers: {} })` fail the same way
   (`norm.imports.forEach is not a function`, …). This is an easy mistake to
   make, and every other option mistake gets a message that names the bad value.
   Check `Array.isArray` first, in `set_injectable` and `set_module`
   (`di/decorations.ts`).

   **Fix:** `set_injectable` and `set_module` now check every list option first
   (`assert_array`, which `set_middlewares` uses too) and throw
   `<option> must be an array, got <v>`, e.g.
   `dependencies must be an array, got Logger`. Nothing is written when the
   check fails. Tests in `di/decorations_test.ts`.

2. **[FIXED] Extra options can overwrite the record's reserved keys.** Extra
   options are stored as is, but they share the record with the DI flags:
   - `@Controller({ isModule: true })` marks the controller as a module.
     Importing it then crashes `new Injector()` with
     `TypeError: Cannot read properties of undefined (reading 'map')`.
   - `@Module({ isController: true })` marks the module as a controller, so
     another module can list it in `controllers` without any error.
   - `@Controller({ isInjectable: false })` clears the flag, so a second DI
     decorator on the class is accepted.

   Reject, or drop, the reserved keys (`isInjectable`, `isModule`,
   `isController`) in `set_module` and `set_controller`.

   **Fix:** every key the framework writes is now a private symbol
   (`Symbol.for("chojs.<package>.<key>")`, see `di/keys.ts`), and user options
   stay string keys, so an option can no longer change what a class is, whatever
   its name. `@Controller({ isModule: true })` is just an option. This replaced
   an earlier fix that rejected the three flag names. See `tasks.md`.

3. **[FIXED] `resolve()` reports an ambiguous token as "not visible".**
   Injecting it gives the clear
   `X is ambiguous in module M: A, B export different
   instances of it…`
   message, but `injector.resolve(X)` rejects with
   `X is not visible in module M`, which suggests a missing import instead.

   **Fix:** each `ModuleScope` now keeps its ambiguous tokens (`ambiguous`, with
   the modules that export each one), and one function, `ambiguity_error`
   (`di/dependency-graph.ts`), builds the message for both the graph build and
   `Injector.resolve`. `resolve(X)` now rejects with the ambiguity message.
   Tests in `di/injector_test.ts` and `di/dependency-graph_test.ts`.

4. **[FIXED] `resolve()` can throw synchronously.** It returns a rejected
   promise for every failure, but builds the message first. A token whose
   `String()` throws (`Object.create(null)`) makes it throw
   `TypeError: Cannot convert object to primitive value` instead of rejecting.
   Its JSDoc says it never throws synchronously.

   **Fix:** the cause was `describe()` (`utils/describe.ts`), the helper that
   names values in every error message: it called `String()`, which throws for
   such values. It now never throws: it falls back to the value's
   `Object.prototype.toString` tag (`[object Object]`), then `<unknown>`. So
   `resolve(Object.create(null))` rejects with
   `[object Object] is not visible in module App`, and no other message can fail
   to build. Tests in `utils/describe_test.ts` and `di/injector_test.ts`.

5. **Anonymous classes are named inconsistently in messages.** Some messages use
   `describe()` (`<anonymous>`), others `ctr.name` (an empty string):
   `Cannot resolve InjectionToken(T) (argument #0) of X in module . Provide it…`.
   The `ctr.name` ones are the "not a module / not injectable / not a
   controller" messages, the import cycle message, and the module name `M` in
   the link messages (`dependency-graph.ts`).

6. **Symbol-named controller methods are silently dropped.** A method record on
   a symbol-named method is never collected (`Object.entries` in
   `metadata-graph.ts`), and nothing reports it. `@chojs/command` guards against
   it in its own decorators; any other CHO module would lose the method without
   a word.

7. **`@Catch` does not accept the handler type CHO modules call.** `@Catch`
   takes `ChoErrorHandler` (`(error) => unknown`), but `@chojs/web` calls
   handlers as `ChoErrorHandlerFn` (`(ctx, error) => unknown`). So
   `@Catch((ctx, error) => …)` does not type-check (TS2345), and a handler
   written as `(error) => …` receives the context as its `error`. The core types
   should let each CHO module say what its handlers receive.

## Utilities

8. **`engine()` is not exported** from `@chojs/core/utils` (nor are the
   `is*Rt()` checks), although the project docs list it as a utility. Its type
   is misspelled `EngineTpe`, and the Cloudflare Workers value is `"worked"`.
9. **`env()` reads only `globalThis.process.env`.** It works on Deno 2, Node and
   Bun, but returns `undefined` on runtimes without `process` (Cloudflare
   Workers without Node compatibility, browsers), with no way to pass the
   environment in.

## Open questions

10. **Should controllers be ordinary declarations?** Today a provider can depend
    on a controller, `resolve()` can create one, and a module can export one.
    Nothing in the CHO modules needs this.
11. **`core/readme.md` is out of date.** It mentions "application lifecycle
    management", which the core does not have.
