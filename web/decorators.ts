/**
 * The decorators of `@chojs/web`.
 *
 * - `@Get`, `@Post`, `@Put`, `@Patch` and `@Delete` mark the route handlers of
 *   a controller. They write the handler's method and route on the decorated
 *   method, under the private `HTTP` key (`keys.ts`), which the web graph
 *   builder reads (see `build-graph.ts`).
 * - `@Middlewares` and `@Catch` declare the middlewares and the error handler
 *   of a feature module, a controller or a handler. They are the core's
 *   decorators, typed for `@chojs/web`.
 *
 * @module
 */

import {
  add_to_metadata_object,
  type ChoClassOrMethodDecorator,
  type ChoMethodDecorator,
  decorated_method,
  decorated_target,
  read_metadata_object,
  set_error_handler,
  set_middlewares,
} from "@chojs/core/di";
import { HTTP, http_route, type HttpRoute } from "./keys.ts";
import { normalize_route } from "./path.ts";
import type { ChoWebErrorHandler, ChoWebMiddleware } from "./types.ts";

/**
 * Create the decorator of one HTTP method. It works with both decorator
 * implementations (TC39, and legacy / Bun).
 *
 * The decorator checks, when the class is defined, what would otherwise be
 * silently lost: the route must be valid, the method must be one the graph
 * builder collects (public, not static, with a string name), and it can have
 * only one HTTP method decorator.
 *
 * @param name The decorator's name, for error messages (`"Get"`).
 * @param route The route of the handler, relative to its controller.
 * @param method The HTTP method.
 * @returns A method decorator.
 */
function create_http_decorator(
  name: string,
  route: string,
  method: string,
): ChoMethodDecorator {
  return function (target, context, descriptor) {
    const decorator = `@${name}()`;
    const decorated = decorated_method(decorator, target, context, descriptor);
    const of = `method ${String(decorated.name)}`;
    if (typeof decorated.name !== "string") {
      throw new TypeError(
        `${decorator} cannot decorate ${of}: a handler must have a string name`,
      );
    }
    if (decorated.private) {
      throw new TypeError(
        `${decorator} cannot decorate private ${of}: a handler must be public`,
      );
    }
    if (decorated.static) {
      throw new TypeError(
        `${decorator} cannot decorate static ${of}: a handler must not be static`,
      );
    }
    normalize_route(route, `${decorator} on ${of}`);
    const previous = http_route(read_metadata_object(decorated.fn) ?? {});
    if (previous) {
      throw new Error(
        `Cannot add ${decorator} to ${of}: it already handles ${previous.method} ${
          JSON.stringify(previous.route)
        }. A method can have one HTTP method decorator.`,
      );
    }
    add_to_metadata_object(decorated.fn, {
      [HTTP]: { method, route } satisfies HttpRoute,
    });
  };
}

/**
 * Declare middlewares for a feature module, a controller or a handler.
 *
 * A request runs the feature's middlewares, then the controller's, then the
 * handler's. The decorator can be applied several times: the middlewares are
 * kept in source order, top decorator first.
 *
 * @param middlewares The middlewares, in the order they run: functions
 *   `(ctx, next)`, or classes with a `handle(ctx, next)` method, created by
 *   the injector in the feature module's scope.
 * @returns A class or method decorator.
 * @throws {TypeError} When applied to anything other than a class or a method.
 * @throws {Error} When a middleware is not a function or a class.
 *
 * @example
 * ```ts
 * const auth: ChoWebMiddlewareFn = (ctx, next) =>
 *   ctx.req.headers.has("authorization")
 *     ? next()
 *     : new Response("unauthorized", { status: 401 });
 *
 * @Middlewares(auth)
 * @Controller({ route: "admin" })
 * class Admin {
 *   @Get("stats")
 *   stats() {
 *     return { users: 3 };
 *   }
 * }
 * ```
 */
export function Middlewares(
  ...middlewares: ChoWebMiddleware[]
): ChoClassOrMethodDecorator {
  return (target, context, descriptor) => {
    const meta = decorated_target(
      "@Middlewares()",
      target,
      context,
      descriptor,
    );
    set_middlewares(meta, middlewares);
  };
}

/**
 * Declare the error handler of a feature module, a controller or a handler.
 *
 * An error thrown by a handler or a middleware goes to the nearest one: the
 * handler's, else the controller's, else the feature's. What it returns is
 * the response, converted like a handler's result. A class or method has at
 * most one `@Catch`.
 *
 * @param handler A function `(error, ctx)`, or a class with a
 *   `handle(error, ctx)` method, created by the injector in the feature
 *   module's scope.
 * @returns A class or method decorator.
 * @throws {TypeError} When applied to anything other than a class or a method.
 * @throws {Error} When `handler` is not a function or a class, or when the
 *   class or method already has an error handler.
 *
 * @example
 * ```ts
 * @Catch((error, ctx) =>
 *   Response.json({ error: String(error), path: ctx.url.pathname }, { status: 500 })
 * )
 * @Controller({ route: "users" })
 * class UsersController {}
 * ```
 */
export function Catch(handler: ChoWebErrorHandler): ChoClassOrMethodDecorator {
  return (target, context, descriptor) => {
    const meta = decorated_target("@Catch()", target, context, descriptor);
    set_error_handler(meta, handler);
  };
}

/**
 * Mark a method as the handler of `GET route`.
 *
 * The method receives the request's `ChoWebContext`. What it returns is the
 * response: a `Response` as is, nothing as `204`, anything else as JSON.
 *
 * @param route The route of the handler, relative to its controller, without
 *   leading or trailing `/`. It can declare parameters (`":id"`); `""` is the
 *   controller's own route.
 * @returns A method decorator.
 * @throws {Error} When the route is invalid, or when the method already has
 *   an HTTP method decorator.
 * @throws {TypeError} When the decorated member is not a public, non-static,
 *   string-named method.
 *
 * @example
 * ```ts
 * @Controller({ route: "users" })
 * class UsersController {
 *   // GET /users
 *   @Get("")
 *   list() {
 *     return [{ id: 1 }, { id: 2 }];
 *   }
 *
 *   // GET /users/42
 *   @Get(":id")
 *   get(ctx: ChoWebContext) {
 *     return { id: ctx.params.id };
 *   }
 * }
 * ```
 */
export function Get(route: string): ChoMethodDecorator {
  return create_http_decorator("Get", route, "GET");
}

/**
 * Mark a method as the handler of `POST route`.
 *
 * The method receives the request's `ChoWebContext`. What it returns is the
 * response: a `Response` as is, nothing as `204`, anything else as JSON.
 *
 * @param route The route of the handler, relative to its controller, without
 *   leading or trailing `/`. It can declare parameters (`":id"`); `""` is the
 *   controller's own route.
 * @returns A method decorator.
 * @throws {Error} When the route is invalid, or when the method already has
 *   an HTTP method decorator.
 * @throws {TypeError} When the decorated member is not a public, non-static,
 *   string-named method.
 *
 * @example
 * ```ts
 * @Controller({ route: "users" })
 * class UsersController {
 *   // POST /users
 *   @Post("")
 *   async create(ctx: ChoWebContext) {
 *     const user = await ctx.req.json();
 *     return new Response(JSON.stringify(user), { status: 201 });
 *   }
 * }
 * ```
 */
export function Post(route: string): ChoMethodDecorator {
  return create_http_decorator("Post", route, "POST");
}

/**
 * Mark a method as the handler of `PUT route`.
 *
 * The method receives the request's `ChoWebContext`. What it returns is the
 * response: a `Response` as is, nothing as `204`, anything else as JSON.
 *
 * @param route The route of the handler, relative to its controller, without
 *   leading or trailing `/`. It can declare parameters (`":id"`); `""` is the
 *   controller's own route.
 * @returns A method decorator.
 * @throws {Error} When the route is invalid, or when the method already has
 *   an HTTP method decorator.
 * @throws {TypeError} When the decorated member is not a public, non-static,
 *   string-named method.
 *
 * @example
 * ```ts
 * @Controller({ route: "users" })
 * class UsersController {
 *   // PUT /users/42
 *   @Put(":id")
 *   async update(ctx: ChoWebContext) {
 *     const changes = await ctx.req.json();
 *     return { id: ctx.params.id, ...changes };
 *   }
 * }
 * ```
 */
export function Put(route: string): ChoMethodDecorator {
  return create_http_decorator("Put", route, "PUT");
}

/**
 * Mark a method as the handler of `PATCH route`.
 *
 * The method receives the request's `ChoWebContext`. What it returns is the
 * response: a `Response` as is, nothing as `204`, anything else as JSON.
 *
 * @param route The route of the handler, relative to its controller, without
 *   leading or trailing `/`. It can declare parameters (`":id"`); `""` is the
 *   controller's own route.
 * @returns A method decorator.
 * @throws {Error} When the route is invalid, or when the method already has
 *   an HTTP method decorator.
 * @throws {TypeError} When the decorated member is not a public, non-static,
 *   string-named method.
 *
 * @example
 * ```ts
 * @Controller({ route: "users" })
 * class UsersController {
 *   // PATCH /users/42
 *   @Patch(":id")
 *   async update(ctx: ChoWebContext) {
 *     const changes = await ctx.req.json();
 *     return { id: ctx.params.id, ...changes };
 *   }
 * }
 * ```
 */
export function Patch(route: string): ChoMethodDecorator {
  return create_http_decorator("Patch", route, "PATCH");
}

/**
 * Mark a method as the handler of `DELETE route`.
 *
 * The method receives the request's `ChoWebContext`. What it returns is the
 * response: a `Response` as is, nothing as `204`, anything else as JSON.
 *
 * @param route The route of the handler, relative to its controller, without
 *   leading or trailing `/`. It can declare parameters (`":id"`); `""` is the
 *   controller's own route.
 * @returns A method decorator.
 * @throws {Error} When the route is invalid, or when the method already has
 *   an HTTP method decorator.
 * @throws {TypeError} When the decorated member is not a public, non-static,
 *   string-named method.
 *
 * @example
 * ```ts
 * @Controller({ route: "users" })
 * class UsersController {
 *   // DELETE /users/42
 *   @Delete(":id")
 *   remove(ctx: ChoWebContext) {
 *     return new Response(null, { status: 204 });
 *   }
 * }
 * ```
 */
export function Delete(route: string): ChoMethodDecorator {
  return create_http_decorator("Delete", route, "DELETE");
}
