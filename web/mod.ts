/**
 * @chojs/web — HTTP applications on top of `@chojs/core`.
 *
 * Controllers declare route handlers with `@Get`, `@Post`, `@Put` and
 * `@Delete`, and {@link ChoWeb} links them to an HTTP runtime with a linker
 * from a runtime adapter (such as `HonoLinker` from `@chojs/vendor-hono`),
 * which gives a `fetch`-style request handler. `@Middlewares` and `@Catch`
 * declare middlewares and error handlers; `@Controller`, `@Module` and
 * `@Injectable` come from `@chojs/core`, and so do `token` and `provider`,
 * to declare values that are not classes: an application imports everything
 * from `@chojs/web`.
 *
 * Handlers, middlewares and error handlers receive a {@link ChoWebContext},
 * built on the standard `Request`: application code does not depend on the
 * HTTP runtime.
 *
 * Routes have up to four levels: the global `prefix` of
 * {@link ChoWeb.create}, the `route` of the feature module (a module that
 * declares controllers), the `route` of the controller, and the route of the
 * handler.
 *
 * @example
 * ```ts
 * import {
 *   ChoWeb,
 *   type ChoWebContext,
 *   Controller,
 *   Get,
 *   Middlewares,
 *   Module,
 * } from "@chojs/web";
 * import { HonoLinker } from "@chojs/vendor-hono";
 *
 * @Controller({ route: "users" })
 * class UsersController {
 *   @Get(":id")
 *   get(ctx: ChoWebContext) {
 *     return { id: ctx.params.id };
 *   }
 * }
 *
 * @Middlewares(async (ctx, next) => {
 *   console.log(ctx.req.method, ctx.url.pathname);
 *   return await next();
 * })
 * @Module({ route: "v1", controllers: [UsersController] })
 * class App {}
 *
 * // GET /api/v1/users/42 -> {"id":"42"}
 * const app = await ChoWeb.create(App, {
 *   linker: new HonoLinker(),
 *   prefix: "api",
 * });
 * Deno.serve(app.handler);
 * ```
 *
 * @module
 */

// What an application needs from the core, so that it only imports
// `@chojs/web`: the `@Injectable` decorator, and `token` and `provider` to
// declare values that are not classes (and the `overrides` of tests).
export {
  type ControllerOptions,
  Injectable,
  type InjectableOptions,
  type InjectionToken,
  type ModuleOptions,
  type Provider,
  provider,
  token,
  type WithDependencies,
} from "@chojs/core/di";
// What `ChoWeb` exposes: its routes, its graph and its linked application.
// They are also in `@chojs/web/linker` and `@chojs/web/graph`, for adapters.
export type { Linked, Linker, Route } from "./linker.ts";
export type {
  AppRef,
  ControllerRef,
  ErrorHandlerRef,
  FeatureRef,
  MethodRef,
  NodeRef,
} from "./graph.ts";
export * from "./decorators.ts";
export * from "./web.ts";
// The built-in router, and default linker.
export {
  ChoLinker,
  type ChoLinkerOptions,
  type ChoMatch,
  ChoRouter,
} from "./router.ts";
export type { ChoWebContext } from "./context.ts";
export type * from "./types.ts";
