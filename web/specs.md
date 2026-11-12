# @chojs/web Specifications

`@chojs/web` is at an early stage: this document lists the rules the current
code (`graph.ts`, `build-graph.ts`, `web.ts`, `@chojs/vendor-hono`) follows.
When this document and the code disagree, the code wins.

## Routing rules

1. Modules with controllers are features.
2. Only feature modules, controllers and methods have routes.
3. There are only 4 levels of routes: global prefix, feature, controller, action
   (NestJS allows only 3 levels, CHO allows 4). The global prefix comes from the
   `prefix` option of `ChoWeb.create`.
4. All features are attached to the root route, whatever the module imports.
5. Middlewares and error handlers on non-feature modules are ignored.

## Routes

- A feature or a controller declares its route with the `route` option of
  `@Module` / `@Controller` (an untyped extra option of core). Without it, the
  route is `""`: that level adds nothing to the path.
- A handler's route is the argument of `@Get` / `@Post` / `@Put` / `@Delete`.
- Every route is trimmed, then checked when the graph is built (`assert_route`):
  `""` is valid; otherwise it is one or more `/`-separated segments, with no
  leading or trailing `/`, no empty, `.` or `..` segment, and only URL path
  characters (RFC 3986 `pchar`) or percent-encoded bytes in each segment. `:` is
  allowed, so `:id` parameters are valid. A route that is not a string throws a
  `TypeError`; an invalid one throws an `Error`.
- The full route of a handler joins the non-empty levels with `/`. Two handlers
  with the same HTTP method and full route throw
  `Duplicate route "<METHOD> /<path>": already declared by another method.`

## Middlewares and error handlers

- A middleware (`@Middlewares`) is a function `(ctx, next) => Promise`, or a
  class with a `handle` method, resolved with the injector in the scope of the
  feature module and called as `instance.handle`. Any other class, or any other
  value, throws when the graph is built.
- An error handler (`@Catch`) is a function `(ctx, error) => unknown`, or a
  class with a `handle` method, resolved the same way. Any other class throws.
- Middlewares and error handlers apply at the feature, controller and method
  levels.

## Application

- `ChoWeb.create(app, options)` creates the injector, runs `init()` (every
  instance is created up front), builds the graph, and links it with
  `options.linker`, which is required. There is no default linker: `@chojs/web`
  does not depend on any runtime adapter; the adapters (`@chojs/vendor-hono`)
  depend on `@chojs/web`.
- With the Hono linker, what a handler returns is sent with `ctx.json()`, unless
  it is a `Response`. Supported HTTP methods: GET, POST, PUT, DELETE, PATCH; any
  other one throws when linking.
- The `name` and `version` options are not used yet.
