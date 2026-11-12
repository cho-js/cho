# Code review: `web/graph.ts`

- **Reviewed:** `web/graph.ts`, the working tree on top of commit `0948f81`.
- **Goal of the file:** `build_http_graph` turns the DI graph into a route tree
  (`AppRef → FeatureRef → ControllerRef → MethodRef`). Every route in it can be
  invoked without the DI system, so a vendor linker (Hono, Fastify, …) can
  register them.
- **Rules (`web/specs.md`):**
  1. A module with controllers is a feature.
  2. Only features, controllers and methods have routes.
  3. There are 4 route levels: global prefix, feature, controller, action.
  4. Every feature is attached to the root.
  5. Middlewares and error handlers on non-feature modules are ignored.

  The code follows all five.
- **How this was checked:** `deno check`, `deno lint` and `deno fmt --check` on
  the file, plus a probe script run with `deno run --no-check`. The probe output
  is quoted under each finding.

| ID  | Severity | Finding                                                                 |
| --- | -------- | ----------------------------------------------------------------------- |
| M-1 | medium   | A bad method route is reported only after the controller was created    |
| M-2 | medium   | Controllers with no HTTP methods are still created                      |
| M-3 | medium   | The duplicate error doesn't say which methods collide                   |
| M-4 | medium   | Handler and middleware class errors don't say where they come from      |
| M-5 | medium   | The `*Ref` types don't describe the values stored in them               |
| L-1 | low      | Routes that differ only by parameter name aren't detected as duplicates |
| L-2 | low      | Dead and confusing types                                                |
| L-3 | low      | Everything is resolved one at a time                                    |
| L-4 | low      | Formatting and JSDoc                                                    |

---

## Medium

### M-1: A bad method route is reported only after the controller was created (lines 342-354)

The controller route is checked before `injector.resolve`, but method routes are
checked inside the loop, after the controller has been created:

```text
@Controller() class C5 { constructor() { created++ } @Get("a//b") a() {} }
→ THROWS: Invalid route "a//b" of method a of controller C5 …
  constructor ran: 1
```

So the error is correct, but the controller's constructor and dependencies have
already run.

**Fix:** check all method routes (`[...http_methods(ctrl)]`) before calling
`resolve`.

### M-2: Controllers with no HTTP methods are still created (lines 218-226)

`controllers_with_methods` keeps a controller if any of its methods has any
metadata. A controller whose only method decorator is `@Middlewares`, or a
`@chojs/command` controller in the same app, is created and added as an empty
`ControllerRef`:

```text
@Controller() class C6 { constructor() { created6++ } @Middlewares(ok) run() {} }
→ [["", 0, [["", 0, "object", []]]]]    constructor ran: 1
```

A feature that ends up with no routes is still added too, and its middlewares
and error handler are resolved anyway.

**Fix:** keep a controller only if `http_methods(ctrl)` yields at least one
method, and skip features that end up with no controllers.

### M-3: The duplicate error doesn't say which methods collide (lines 301-305)

```text
→ THROWS: Duplicate route "GET /api/x/y": already declared by another method.
```

The message doesn't name either method or controller. Since rule 4 puts every
feature at the root, collisions between features are easy to make by accident,
and the message gives nothing to search for.

**Fix:** keep `Controller.method` with each key, for example in a
`Map<key, string>`. Put both names in the message:
`Duplicate route "GET /api/x/y": C9a.a and C9b.b`.

### M-4: Handler and middleware class errors don't say where they come from (lines 246, 250, 269, 273)

- A class given to `@Catch` or `@Middlewares` is resolved in the feature
  module's scope. That means it must be `@Injectable` **and** listed in that
  feature's `providers`. If it isn't, the error comes straight from DI and
  doesn't mention `@Catch` or `@Middlewares`:
  ```text
  @Catch(Auth2) on a controller, Auth2 not in providers
  → THROWS: Auth2 is not visible in module A8
  ```
- `must implement 'handle' method.` doesn't say which controller or method
  declares the class.

**Fix:** pass a description of the location to both factories (the way
`normalize_route` gets `where`). Wrap the `injector.resolve` call and add that
description to the message, for example
`@Catch(Auth2) on controller C8: Auth2 is not visible in module A8. Add it to
the module's providers.`
Also document the `@Injectable` + `providers` requirement in `web/specs.md`.

### M-5: The `*Ref` types don't describe the values stored in them (lines 15-22, 55, 80, 102)

- `FeatureRef`, `ControllerRef` and `MethodRef` declare
  `middlewares: Middleware[]` (`Function[]`). After resolution they actually
  hold `ChoMiddlewareFn[]`. Type them as `ChoMiddlewareFn[]`, so a linker knows
  what it can call (`(ctx, next) => Promise<unknown>`).
- The JSDoc of `ErrorHandlerRef` still says it can be "an instance of a handler
  class". The value is now always a function (a bound `handle`) or `null`. Give
  it a callable type, for example `((error: unknown) => unknown) | null`, and
  fix the comment.

---

## Low

### L-1: Routes that differ only by parameter name aren't detected as duplicates

```text
@Get(":id") a()  and  @Get(":name") b()  on the same controller
→ graph built with both
```

Every router treats these as the same route: only the first one is ever reached.
A key that replaces each `:param` with a placeholder before comparing
(`GET /u/:`) would catch this.

### L-2: Dead and confusing types

- `WebControllerMetadata` and `WebModuleMetadata` (lines 38-48) are exported but
  not used anywhere in `web/` or `vendor/`. Lines 334 and 345 cast to
  `ChoMiddleware[]` instead. Use the types for those casts, or remove them.
- `MethodMetadata` (line 28) has the same name as core's exported
  `MethodMetadata`, which has a different shape. `web/mod.ts` re-exports it with
  `export *`, so the two collide. Rename it, for example to
  `HttpMethodMetadata`.
- `isHTTP: true` and `type: "HTTP"` say the same thing twice. Also, `method` is
  a `string`, where a union of HTTP verbs would be more precise.
- `ControllerInstance` (line 24) says every key is a `() => Promise<unknown>`.
  That's only true of the HTTP methods, and they may not return a promise.
- The `*Ref` constructors default `middlewares ?? []`, but every caller already
  passes an array.

### L-3: Everything is resolved one at a time

Controllers, middlewares and error handlers are each awaited one after another
(lines 334-358). In a large app this adds up at startup. Calling
`await injector.init()` first, or `Promise.all` per controller, would avoid it.

### L-4: Formatting and JSDoc

- `deno fmt --check` fails on lines 269, 271-277, 296-298 and 352-360.
- The JSDoc of `build_http_graph` (lines 313-318) is longer than 80 columns, and
  its `@param` and `@returns` tags have no descriptions. It should say that the
  function throws, and on what: invalid routes, duplicate routes, and handler or
  middleware classes that can't be resolved.

---

## Open design questions

**Q-1: What do handlers and error handlers receive?**

- Middlewares get `(ctx, next)`.
- `MethodRef.handler` is `() => Promise<unknown>` and gets nothing.
- Error handlers get only `(error)`.

So a controller method can't read the request, and an error handler has no
context to build a response from. One vendor-neutral context, passed to all
three and adapted by each linker, would keep controllers independent of the
vendor. This decides the signatures in M-5.

**Q-2: Where do app-wide middlewares and the fallback error handler come from?**
Rule 5 ignores them on non-feature modules, so the root module can't declare
them, and `AppRef` holds only `route`. Taking them from the application options,
the same way as the prefix, would let a linker treat all four levels the same
way.

## Suggested order

1. M-1 and M-2: create controllers only once their routes are known to be valid
   and non-empty.
2. M-3 and L-1: both are in `assert_no_duplicate_routes`.
3. Q-1, then M-5 and M-4.
