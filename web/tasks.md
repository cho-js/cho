# @chojs/web: vendor adapter redesign — tasks

**Status: done.** Differences from the plan are listed at the end.

Goal: `@chojs/web` does all the request plumbing (context, middlewares, error
handlers, response conversion) and hands the vendor a flat list of finished
routes. A vendor adapter only registers routes on its router and extracts path
parameters.

## Decisions

1. **Context.** Small and standard-based; no vendor types.

   ```ts
   interface ChoWebContext {
     readonly req: Request; // the standard Request
     readonly params: Readonly<Record<string, string>>; // path parameters
     readonly url: URL; // parsed lazily from req.url
     readonly state: Map<PropertyKey, unknown>; // per request, for middlewares
     readonly native: unknown; // the vendor's own context (escape hatch)
   }
   ```

   No `res`, no `json()` / `text()` methods on the context. The commented-out
   Hono-like interface in `context.ts` is deleted.

2. **Middlewares.** Onion model; `next()` returns the `Response`.

   ```ts
   type ChoWebMiddlewareFn = (
     ctx: ChoWebContext,
     next: () => Promise<Response>,
   ) => Response | Promise<Response>;
   ```

   A middleware changes the response by returning a new one, and short-circuits
   by returning without calling `next()`.

3. **Handlers and error handlers.**

   ```ts
   type ChoWebHandler = (ctx: ChoWebContext) => unknown;
   type ChoWebErrorHandlerFn = (error: unknown, ctx: ChoWebContext) => unknown;
   ```

   Both results go through the same conversion: a `Response` as is, `undefined`
   → `204`, anything else → `Response.json(value)`.

4. **What the vendor receives.**

   ```ts
   type Route = {
     readonly method: string; // "GET", ...
     readonly path: string; // full path, prefix included: "/api/users/:id"
     readonly name: string; // "UsersController.get", for logs and errors
     handle(
       req: Request,
       params: Record<string, string>,
       native?: unknown,
     ): Promise<Response>;
   };

   interface Linker<T> {
     link(routes: readonly Route[]): Linked<T>;
   }
   ```

   The tree (`AppRef` → features → controllers → methods) stays, for
   introspection only, as `ChoWeb.graph`.

## Phase 1 — types and contract (`web`)

- [x] 1.1 `web/context.ts`: replace the file with `ChoWebContext` (decision 1)
      and a `create_context(req, params, native)` factory with a lazy `url`.
- [x] 1.2 New `web/types.ts`: `ChoWebMiddlewareFn`, `ChoWebMiddleware` (function
      or class with `handle(ctx, next)`), `ChoWebHandler`,
      `ChoWebErrorHandlerFn`, `ChoWebErrorHandler` (function or class with
      `handle(error, ctx)`).
- [x] 1.3 `web/linker.ts`: add `Route`, change `Linker.link` to take
      `readonly Route[]` (decision 4). Update the JSDoc example.
- [x] 1.4 `web/graph.ts`: type `middlewares` and `errorHandler` with the web
      types; type `MethodRef.handler` as `ChoWebHandler`; remove
      `MethodRef.type` and `ControllerInstance`.

## Phase 2 — the request pipeline (`web`)

- [x] 2.1 New `web/response.ts`: `to_response(value)` (decision 3). Tests:
      `Response`, object, string, `undefined`, `null`.
- [x] 2.2 New `web/compose.ts`: `compose(middlewares, handler)` returning
      `(ctx) => Promise<Response>`. Rules:
  - runs in order, each `next()` runs the rest and resolves to the `Response`;
  - `next()` called twice in one middleware throws
    `next() called more than once`;
  - a middleware that returns `undefined` after calling `next()` passes the
    downstream response on (so `await next()` without `return` still works);
  - a middleware that returns `undefined` without calling `next()` throws
    `middleware <name> returned no response`.
- [x] 2.3 New `web/routes.ts`: `compile_routes(graph): Route[]`. For each
      method:
  - `path`:
    `"/" + [prefix, feature, controller, method].filter(Boolean).join("/")`;
  - chain: feature, controller, then method middlewares, then the handler
    through `to_response`;
  - `handle()` creates the context, runs the chain in a `try`, and on a throw
    calls the nearest error handler (method, controller, feature) and converts
    its result with `to_response`;
  - an error with no handler, or an error thrown by the error handler itself, is
    rethrown to the vendor.
- [x] 2.4 Move duplicate detection from `build-graph.ts` to `routes.ts`, on the
      compiled list. Compare with parameter names replaced by a placeholder
      (`:id` and `:name` collide), and name both routes in the message:
      `Duplicate route "GET /users/:": UsersController.get and UsersController.find`.
- [x] 2.5 `web/build-graph.ts`: check every method route before resolving the
      controller; skip controllers with no HTTP method and features left with no
      controller (and do not create their middlewares or error handlers).
- [x] 2.6 `web/web.ts`: `create()` builds the graph, compiles the routes, calls
      `linker.link(routes)`. Expose `readonly graph: AppRef` and
      `readonly routes: readonly Route[]` on `ChoWeb`.
- [x] 2.7 Debug logging (`cho:web`): one line per compiled route, one line per
      error handed to a `@Catch` handler. Remove the same logging from the
      adapter.

## Phase 3 — decorators (`web`, `core`)

- [x] 3.1 `core/di/types.ts`: make the stored types neutral. `ChoMiddleware` and
      `ChoErrorHandler` become "any function or class"; remove the `(ctx, next)`
      and `(error, ctx?)` signatures and the Hono wording from the JSDoc. Drop
      `ChoMiddlewareFn` from the exports of `core/mod.ts`.
- [x] 3.2 `web`: export its own typed `Middlewares(...mws: ChoWebMiddleware[])`
      and `Catch(handler: ChoWebErrorHandler)`, thin wrappers over core's
      `set_middlewares` / `set_error_handler` with `decorated_target`. Stop
      re-exporting core's two decorators and `ChoMiddlewareFn` from
      `web/mod.ts`.
- [x] 3.3 `web/decorators.ts`: guards, as `@chojs/command` has:
  - reject a second HTTP decorator on the same method;
  - reject static, private and symbol-named methods;
  - validate the route in the decorator (`assert_route`; removes the `todo`).
- [x] 3.4 `command/command.ts`: follow 3.1 (it imports `ChoErrorHandler`); no
      behavior change.

## Phase 4 — Hono adapter (`vendor/hono`)

- [x] 4.1 Rewrite `HonoLinker.link(routes)`:

      ```ts
      const app = new Hono();
      for (const r of routes) {
        app.on(r.method, r.path, (c) => r.handle(c.req.raw, c.req.param(), c));
      }
      ```

      Remove the sub-applications, `onError`, `createMiddleware`, `to_response`,
      the method allow-list and the `@ts-ignore`.
- [x] 4.2 Confirm `c.req.param()` returns decoded values for every parameter of
      the matched route; add a test with an encoded segment.
- [x] 4.3 README: handlers get `ChoWebContext`; Hono's context is `ctx.native`;
      app-wide Hono middlewares (`cors()`, …) go on a Hono application given to
      the linker, `new HonoLinker(hono)` (added during implementation: a
      middleware added to `linked.instance` after linking would not wrap the
      routes).

## Phase 5 — tests

- [x] 5.1 `web`: a test-only linker (a `Map` of `METHOD path` → route, exact
      match, plus a one-parameter matcher) so the pipeline is tested with no
      vendor.
- [x] 5.2 `web/routes_test.ts`, through that linker:
  - middleware order: feature, controller, method;
  - a middleware of one feature or controller never runs for another, with and
    without `route` (the leak in `fable.md` A1);
  - short-circuit; response replaced after `next()`; `state` shared along the
    chain;
  - error handler precedence, async handlers, non-`Response` results;
  - an error thrown inside a middleware reaches the error handler;
  - class middlewares and class error handlers with dependencies.
- [x] 5.3 `vendor/hono/mod_test.ts`: reduce to what the adapter owns: method and
      path registration, parameters, `native`, `404` for unknown paths, `500`
      when a route rethrows.
- [x] 5.4 One fixture with real decorator syntax (`@Get`, `@Middlewares`,
      `@Catch` on class and method), run by `deno run`, `bun` and `tsx` in CI.

## Phase 6 — docs and cleanup

- [x] 6.1 `web/specs.md`: sections 3–7 and 9 (handlers, middlewares, error
      handlers, `ChoWeb`, adapters, errors) for the new contracts.
- [x] 6.2 `web/README.md`, `web/mod.ts` JSDoc, `examples/hello-world-http.ts`:
      remove `import type { Context } from "hono"`, use `ctx.params.id`.
- [x] 6.3 `web/issues.md`: close what this resolves; record the behavior changes
      below. Delete `web/cr.md` (its open items are tasks 2.4 and 2.5).
- [x] 6.4 `web/deno.json` and `tsconfig.json` paths: add any new entry point
      (`@chojs/web/linker` now also carries `Route`); remove the empty
      `imports`.

## Behavior changes to announce

- Handlers, middlewares and error handlers receive `ChoWebContext`, not Hono's
  context. Path parameters are `ctx.params.id`.
- Middlewares return the `Response`; Hono middlewares can no longer be passed to
  `@Middlewares`.
- A handler that returns nothing answers `204`, not `200` with an empty body.
- `Linker.link` takes the route list, not the graph.

## Later (not part of this change)

- A built-in adapter on `URLPattern`, so `@chojs/web` works with no vendor.
- An `onError` option on `ChoWeb.create` as the application-wide fallback.
- `@Head` and `@Options`.
- Helpers as plain functions (`json(value, init)`, `redirect(url)`), if the
  standard `Response` statics prove too thin.

## Differences from the plan

- 1.4 / 2.3: `Route.handle`'s `params` is optional (a route without parameters
  can be called with the request alone).
- 2.2: a middleware that returns something that is neither a `Response` nor
  `undefined` is also an error (`must return a Response or nothing`).
- 3.3: route validation moved to `web/path.ts`, shared by the decorators and the
  graph builder.
- 3.4: `@chojs/command` needed no change.
- 4.1: `HonoLinker` takes an optional Hono application (see 4.3).
- 5.1: the test linker is `web/testing.ts` (excluded from publishing) and
  matches any number of parameters.
- 5.4: the syntax fixture is a normal test, `web/syntax_test.ts`; the three CI
  jobs already run it, so CI did not change.
- 6.4: no new entry point was needed; `tsconfig.json` is unchanged.
