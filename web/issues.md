# @chojs/web issues

Bugs and limitations of `@chojs/web` and `@chojs/vendor-hono`, found while
writing `web/specs.md`. Each was reproduced against the current code.

## Bugs

1. **[FIXED] The Hono adapter ignores the global prefix.** `HonoLinker.link`
   mounts every feature with `app.route(feature.route, …)` and never uses
   `graph.route`. With `ChoWeb.create(App, { linker, prefix: "api" })`,
   `GET /api/v1/users/42` is `404` and `GET /v1/users/42` answers. The JSDoc
   examples of `ChoWeb` and `@chojs/web` show the prefix working.

   **Fix:** each feature is mounted at the global prefix plus its route.
   (`basePath()` was tried first, but it returns a copy built from Hono's base
   class, so `linked.instance` was no longer `instanceof Hono`.) Tests in
   `vendor/hono/mod_test.ts`.

2. **[FIXED] Error handlers receive their arguments in a different order by
   level.** A handler-level `@Catch` is called as `(ctx, error)` (the adapter
   calls it itself), while controller- and feature-level ones are passed to
   Hono's `onError`, which calls them as `(error, ctx)`. The graph types them
   all as `ChoErrorHandlerFn`, `(ctx, error)`.

   **Fix:** handlers are called error first everywhere: `ChoErrorHandlerFn` is
   now `(error, ctx?)`, and the adapter calls handler-level ones as
   `(error, ctx)`, like Hono's `onError` (see `core/issues.md` #7).

3. **[FIXED] An error handler that does not return a `Response` breaks the
   response.** Its result is returned to Hono as is: returning
   `{ handled: true }` makes `app.handler` resolve to that object, not to a
   `Response`. A handler's own result is sent as JSON; the error handler's
   should be too, or be required to be a `Response`.

   **Fix:** every `@Catch` result is now sent like a handler's, with
   `ctx.json()` unless it is a `Response`: handler-level ones in the route's
   handler, controller- and feature-level ones in their Hono `onError`
   (`to_response` in `vendor/hono/mod.ts`). Async handlers are awaited. Tests in
   `vendor/hono/mod_test.ts`.

4. **[FIXED] `@Catch` is typed for one argument.** Core's `@Catch` takes
   `ChoErrorHandler`, `(error) => unknown`, so `@Catch((ctx, error) => …)` does
   not type-check (TS2345), although web calls handlers with the context (see
   also the root `issues.md`, B3, and `core/issues.md`).

   **Fix:** `ChoErrorHandler` now accepts `(error, ctx?) => unknown`, so
   `@Catch((error, ctx) => …)` type-checks (`core/issues.md` #7).

## Limitations

5. **Routes match in declaration order.** With Hono, a parameter route declared
   first (`@Get(":id")`) also matches the static routes declared after it
   (`@Get("raw")`), which are then unreachable. Nothing warns about it.

6. **There is no `@Patch` decorator**, although the Hono adapter supports PATCH.

7. **The `name` and `version` options of `ChoWeb.create` are not used.**

8. **[FIXED] The HTTP method decorators do not check their route** until the
   application is created, unlike the core decorators, which fail when the class
   is defined.

   **Fix:** `@Get` and its siblings validate their route in the decorator. They
   also reject what was silently lost before: a second HTTP method decorator on
   a method, and static, private or symbol-named methods.

9. **[FIXED] A decorator that replaces the method hides the route.** Method
   records were stored on the method function, so a wrapping decorator applied
   above `@Get` (`@Logged @Get("x")`) left the route on a function the
   controller no longer had: no route, no error. Handlers inherited from a base
   class were not collected either.

   **Fix:** the core stores method records with the class, by method name
   (`core/specs.md`, section 4.1), and reads them along the prototype chain.
   Tests with real decorator syntax in `web/syntax_test.ts`.

10. **[FIXED] Misspelled options were accepted.** `@Controller({ deps: [...] })`
    or `@Module({ provider: [...] })` type-checked and did nothing, and
    `@Controller({ middlewares: [...] })` was stored and discarded.

    **Fix:** `@Module` and `@Controller` of `@chojs/web` accept the core's
    options and `route` only: anything else is a compile error, and throws when
    the class is defined.

## Adapter redesign

Done as planned in `web/tasks.md`: `@chojs/web` now does all the request
plumbing, and an adapter only registers finished routes. It resolved, besides
the items above:

- **Middlewares leaked to other routes** (`fable.md` A1): with Hono
  sub-applications, a feature or controller without a route applied its
  middlewares to every later route and to unmatched paths. Middlewares are now
  composed per route by `@chojs/web`.
- **Application code depended on Hono**: handlers, middlewares and error
  handlers now all receive `ChoWebContext`.
- Controllers without handlers were created and listed; the duplicate route
  error named nothing; `:id` and `:name` duplicates passed.

Behavior changes:

- Handlers, middlewares and error handlers receive `ChoWebContext`, not Hono's
  context (still there as `ctx.native`). Path parameters are `ctx.params.id`.
- `next()` resolves to the `Response`, and a middleware answers by returning
  one. Hono middlewares can no longer be given to `@Middlewares`: add them to a
  Hono application and give it to the linker, `new HonoLinker(hono)`.
- A handler that returns nothing answers `204`, not `200` with an empty body.
- `Linker.link` receives the routes, not the graph; the graph is `app.graph`.
- `@Middlewares` and `@Catch` for web applications come from `@chojs/web`
  (typed); core's `ChoMiddlewareFn` and `ChoErrorHandlerFn` types are gone.
- `HonoLinker` no longer logs (`cho:web:hono`); `cho:web` logs the same events.
- `HonoLinker` accepts any HTTP method (it used to throw on methods other than
  GET, POST, PUT, DELETE and PATCH).
