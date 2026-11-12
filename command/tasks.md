# @chojs/command: middlewares and a command context — tasks

**Status: done.** Differences from the plan are listed at the end.

Goal: `@chojs/command` runs middlewares the way `@chojs/web` does, and a command
receives a **context** object that holds the parsed command line, instead of the
parsed command line itself.

Everything below mirrors `@chojs/web` wherever a command line allows it, so the
two packages are learned once. Where they differ, the reason is given.

## Decisions

1. **Context.** One per `run()`, shared by the middlewares, the command and the
   error handler.

   ```ts
   interface ChoCommandContext {
     readonly args: ChoArgs; // the parsed command line (what a command gets today)
     readonly argv: readonly string[]; // the command line as given to run()
     readonly command: string; // the command that runs: "main", or the action name
     readonly state: Map<PropertyKey, unknown>; // per run, for middlewares
   }
   ```

   The names (`ChoCommandContext`, `ChoCommandNext`) sit next to web's
   `ChoWebContext` / `ChoWebNext`.

2. **Middlewares.** The onion model of web. Web's result is a `Response`; a
   command's result is its **exit code**.

   ```ts
   type ChoCommandNext = () => Promise<number>;

   type ChoCommandMiddlewareFn = (
     ctx: ChoCommandContext,
     next: ChoCommandNext,
   ) => number | void | Promise<number | void>;
   ```

   - `next()` runs the rest of the chain and resolves to its exit code;
   - returning a number is the exit code: without calling `next()` to stop
     early, or after it to replace the code;
   - returning nothing after calling `next()` passes the exit code on, so
     `await next();` alone is enough;
   - returning nothing without calling `next()`, returning anything else, or
     calling `next()` twice, is an error (the same three rules as web).

   A middleware is a function, or a class with a `handle(ctx, next)` method
   created by the injector.

3. **Commands and error handlers.**

   ```ts
   type ChoCommandHandler = (ctx: ChoCommandContext) => unknown;
   type ChoCommandErrorHandlerFn = (
     error: unknown,
     ctx: ChoCommandContext,
   ) => unknown;
   ```

   Conversion is unchanged: a non-negative integer is the exit code (capped at
   `255`); anything else gives `0` for a command and `1` for an error handler.

4. **Levels and order.** `@Middlewares` and `@Catch` apply to a module that
   declares controllers, a controller, or a command method. A run executes the
   module's middlewares, then the controller's, then the method's. An error goes
   to the nearest error handler: the method's, the controller's, the module's,
   then the application's (`onError` option), as in web.

5. **Laziness is kept.** Web creates everything at startup; a command-line
   application must not (`--help` must not need the database). Middleware and
   error handler **classes** are therefore created by the injector when their
   command first runs, in the scope of the module that declares the controller,
   and kept for later runs. Their shape is still checked at `ChoCommand.create`,
   without creating anything.

6. **What middlewares do not see.** `--help`, `--version`, the help shown when
   no action is given, and an unknown action are answered by the application
   before any command is chosen: no middleware and no error handler runs, as a
   web request that matches no route runs none.

7. **One onion, shared.** The middleware runner moves from `web/compose.ts` to
   the core, generic over the context and the result, so both packages use the
   same code and the same error messages.

## Phase 1 — shared middleware runner (`core`, `web`)

- [x] 1.1 New `core/utils/compose.ts`:
      `compose<Ctx, Result>(middlewares, endpoint, is_result)`, moved from
      `web/compose.ts`. `is_result(value)` tells a result from anything else
      (`value instanceof Response` for web, an exit code for command). Keep the
      three errors, with a neutral wording: `next() called more than once`,
      `returned no result: return one or call next()`,
      `must return a result or nothing, got <typeof>`.
- [x] 1.2 Export it from `@chojs/core/utils`; move the tests to
      `core/utils/compose_test.ts`, with a non-`Response` result type.
- [x] 1.3 `web/compose.ts` becomes the `Response` instance of it (or is removed,
      with `web/routes.ts` calling the core's). Keep web's messages readable
      ("returned no response"): pass the noun as a parameter, or update
      `web/specs.md` section 9 and the web tests to the neutral wording.
- [x] 1.4 `core/specs.md` section 3.3: document `compose`.

## Phase 2 — context and types (`command`)

- [x] 2.1 New `command/context.ts`: `ChoCommandContext` (decision 1) and
      `create_context(args, argv, command)`.
- [x] 2.2 New `command/types.ts`: `ChoCommandNext`, `ChoCommandMiddlewareFn`,
      `ChoCommandMiddleware` (function, or class with `handle(ctx, next)`),
      `ChoCommandHandler`, `ChoCommandErrorHandlerFn`, `ChoCommandErrorHandler`
      (function, or class with `handle(error, ctx)`).
- [x] 2.3 `command/args.ts`: `ChoArgs` stays the type of `ctx.args`; update its
      JSDoc (it is no longer what a command receives).

## Phase 3 — decorators (`command`)

- [x] 3.1 `command/decorators.ts`: export typed `Middlewares` (taking
      `ChoCommandMiddleware` values) and `Catch` (taking a
      `ChoCommandErrorHandler`), thin wrappers over the core's `set_middlewares`
      / `set_error_handler` with `decorated_target`, as `web/decorators.ts`
      does.
- [x] 3.2 `command/mod.ts`: export them instead of the core's `Catch`; export
      `ChoCommandContext` and the types of 2.2.
- [x] 3.3 Reject `@Middlewares` / `@Catch` where they would never run: on a
      method that is not a command (`@Main` / `@Action`). Decide where: at
      `ChoCommand.create`, when the command graph is read (the decorators cannot
      know the order they are applied in).

## Phase 4 — the command pipeline (`command`)

- [x] 4.1 `command/graph.ts`: for each command, keep what the pipeline needs:
      the owner module's, the controller's and the method's `middlewares` and
      `errorHandler` (from the core's metadata: `ModuleScope.meta`,
      `ControllerMetadata`, `MethodMetadata`).
- [x] 4.2 Validate them at `ChoCommand.create`, creating nothing: a middleware
      is a function or a class with a `handle` method
      (`Middleware class <Name> must implement 'handle' method.`), and so is an
      error handler. Reuse web's messages.
- [x] 4.3 New `command/pipeline.ts`: `compile_command(injector, command)`
      returns `run(ctx): Promise<number>`, built on first use and kept:
  - resolve the controller, and the middleware and error handler classes, in the
    scope of the controller's module (bound `handle`, named `<Class>.handle`);
  - chain: the module's, the controller's, then the method's middlewares, then
    the method, whose result is converted with `exit_code(value, 0)`;
  - on an error anywhere (creating an instance, a middleware, the command): the
    nearest error handler, converted with `exit_code(value, 1)`;
  - no error handler: print `Error: <message>`, exit `1` (as today);
  - the error handler fails (or cannot be created): print the original error,
    exit `2` (as today).
- [x] 4.4 `ChoCommandOptions.onError`: the application's error handler, last in
      the chain of 4.3; a class is created in the scope of the root module. Same
      validation as web's `onError`.
- [x] 4.5 `command/command.ts`: `run()` parses, answers the built-ins (decision
      6), creates the context, and calls the command's pipeline. Remove the
      inline `try` / `catch` and `find_error_handler`.
- [x] 4.6 Debug logging (`cho:command`): keep what is logged today (the run, the
      exit code, an error and what handled it); add the middlewares of a command
      when the application is created.

## Phase 5 — tests

- [x] 5.1 `command/pipeline_test.ts`:
  - a command receives the context: `args`, `argv`, `command`, `state`;
  - middleware order: module, controller, method; several `@Middlewares` on one
    target, in source order;
  - a middleware of one controller or module never runs for a command of
    another;
  - stop early with an exit code; replace the exit code after `next()`;
    `await next()` without `return`; `state` shared along the chain;
  - the three middleware errors reach the error handler;
  - class middlewares and class error handlers with dependencies; created on the
    first run of their command only, once;
  - error handler precedence: method, controller, module, `onError`; an error
    thrown by a middleware is handled; `(error, ctx)` arguments;
  - `--help`, `--version`, no action and an unknown action run no middleware and
    no error handler.
- [x] 5.2 `command/command_test.ts`, `command/graph_test.ts`: adapt to the
      context (`args` → `ctx.args`) and to the validation of 4.2 and 3.3.
- [x] 5.3 One test with real decorator syntax (`command/syntax_test.ts`):
      `@Middlewares` and `@Catch` on a class and on a method, a class
      middleware, `@Main` and `@Action`, on the three runtimes.

## Phase 6 — docs and examples

- [x] 6.1 `command/specs.md`: section 3.1 (the context replaces `ChoArgs` as the
      argument), a new "Middlewares" section, section 4.3 (errors and `@Catch`:
      levels, `onError`, arguments), section 6 (public API), section 7 (errors),
      section 8 (internals).
- [x] 6.2 `command/README.md` and the JSDoc examples of `command/mod.ts`,
      `command/decorators.ts`, `command/command.ts`, `command/args.ts`.
- [x] 6.3 `examples/hello-world-cli.ts`: enable the commented `Timing`
      middleware (`@Middlewares(Timing)` on the controller); update
      `examples/multi-actions-cli.ts` to the context.
- [x] 6.4 `command/issues.md`: close "`@Middlewares` is silently ignored";
      record the behavior changes below. `fable.md`: mark the command item.

## Behavior changes to announce

- A command receives `ChoCommandContext`, not `ChoArgs`: `args.force` becomes
  `ctx.args.force`.
- An error handler receives `(error, ctx)`, not `(error, args)`.
- `@Middlewares` and `@Catch` come from `@chojs/command` (typed); the core's
  `@Catch` is no longer re-exported.
- `@Middlewares` runs. It was accepted and ignored.
- `@Catch` on a module now handles the errors of its controllers' commands.
- A middleware or an error handler that is neither a function nor a class with a
  `handle` method makes `ChoCommand.create` throw.

## Open questions (settled during implementation)

- **Names.** `ChoCommand*` (`ChoCommandContext`, `ChoCommandNext`,
  `ChoCommandMiddlewareFn`, …), consistent with `ChoCommand` and `cho:command`.
  The example sketch used `ChoCli*`; the types were renamed after
  implementation, and this document with them.
- **Unknown action.** Kept outside `onError` (decision 6): the application
  prints `Error: Action '<name>' not found. …` and exits `1`.

## Differences from the plan

- 1.1 / 1.3: `compose` takes a `kind` (`is`, `name`, `noun`) instead of only a
  predicate, so each package keeps readable messages ("returned no response",
  "returned no exit code"). `web/compose.ts` stays, as the `Response` instance;
  web's messages and tests are unchanged.
- 3.3: `@Middlewares` / `@Catch` on a method that is not a command are **not**
  rejected. `@chojs/web` ignores them on methods that are not handlers, and a
  controller can serve both packages; rejecting here would break that.
- 4.1: `command/graph.ts` is unchanged. The pipeline reads the module's metadata
  from the injector (`injector.graph.modules`).
- 4.2: an error handler is validated only where it would be used (the nearest
  one of each command).
- 4.3: an error handler class is created when it first has an error to handle,
  not on the command's first run. A middleware must return a valid exit code (a
  non-negative integer): another number is an error.
- 4.6: the debug log is unchanged (the middlewares of a command are not listed).
- 6.3: `examples/hello-world-cli.ts` was rewritten around the `Timing`
  middleware of the sketch; the commented `TimingModule` was dropped.

## Later (not part of this change)

- Application-wide middlewares (an option of `ChoCommand.create`).
- Reading stdin, and writing through the context instead of `console`.
