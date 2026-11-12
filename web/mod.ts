/**
 * @chojs/web — HTTP applications on top of `@chojs/core`.
 *
 * Controllers declare route handlers with `@Get`, `@Post`, `@Put` and
 * `@Delete`, and {@link ChoWeb} links them to an HTTP runtime with a linker
 * from a runtime adapter (such as `HonoLinker` from `@chojs/vendor-hono`),
 * which gives a `fetch`-style request handler. `@Controller`,
 * `@Module`, `@Middlewares` and `@Catch` come from `@chojs/core`.
 *
 * Routes have up to four levels: the global `prefix` of
 * {@link ChoWeb.create}, the `route` of the feature module (a module that
 * declares controllers), the `route` of the controller, and the route of the
 * handler.
 *
 * This package is at an early stage: its API may change.
 *
 * @example
 * ```ts
 * import { ChoWeb, Controller, Get, Middlewares, Module } from "@chojs/web";
 * import { HonoLinker } from "@chojs/vendor-hono";
 * import type { Context } from "hono";
 *
 * @Controller({ route: "users" })
 * class UsersController {
 *   @Get(":id")
 *   get(ctx: Context) {
 *     return { id: ctx.req.param("id") };
 *   }
 * }
 *
 * @Middlewares(async (ctx, next) => {
 *   console.log(ctx.req.method, ctx.req.url);
 *   await next();
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

export {
  Catch,
  Controller,
  type ControllerOptions,
  Injectable,
  type InjectableOptions,
  Middlewares,
  Module,
  type ModuleOptions,
} from "@chojs/core/di";
export type { ChoMiddlewareFn } from "@chojs/core/di";
export * from "./decorators.ts";
export * from "./web.ts";
