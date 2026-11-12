/**
 * The HTTP method decorators: `@Get`, `@Post`, `@Put` and `@Delete` mark the
 * route handlers of a controller. They write a record on the decorated method,
 * which the web graph reads (see `graph.ts`).
 *
 * @module
 */

import {
  add_to_metadata_object,
  type ChoMethodDecorator,
  decorated_method,
} from "@chojs/core/di";

/**
 * Create the decorator of one HTTP method. It works with both decorator
 * implementations (TC39, and legacy / Bun).
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
    // todo assert_route(route);
    const decorated = decorated_method(
      `@${name}()`,
      target,
      context,
      descriptor,
    );
    add_to_metadata_object(decorated.fn, {
      isHTTP: true,
      type: "HTTP",
      method,
      name: decorated.name,
      route,
    });
  };
}

/**
 * Mark a method as the handler of `GET route`.
 *
 * The method receives the request context of the HTTP runtime (Hono's
 * `Context` with `HonoLinker`). What it returns is sent as JSON, unless it is a
 * `Response`.
 *
 * @param route The route of the handler, relative to its controller, without
 *   leading or trailing `/`. It can declare parameters (`":id"`); `""` is the
 *   controller's own route.
 * @returns A method decorator.
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
 *   get(ctx: Context) {
 *     return { id: ctx.req.param("id") };
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
 * The method receives the request context of the HTTP runtime (Hono's
 * `Context` with `HonoLinker`). What it returns is sent as JSON, unless it is a
 * `Response`.
 *
 * @param route The route of the handler, relative to its controller, without
 *   leading or trailing `/`. It can declare parameters (`":id"`); `""` is the
 *   controller's own route.
 * @returns A method decorator.
 *
 * @example
 * ```ts
 * @Controller({ route: "users" })
 * class UsersController {
 *   // POST /users
 *   @Post("")
 *   async create(ctx: Context) {
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
 * The method receives the request context of the HTTP runtime (Hono's
 * `Context` with `HonoLinker`). What it returns is sent as JSON, unless it is a
 * `Response`.
 *
 * @param route The route of the handler, relative to its controller, without
 *   leading or trailing `/`. It can declare parameters (`":id"`); `""` is the
 *   controller's own route.
 * @returns A method decorator.
 *
 * @example
 * ```ts
 * @Controller({ route: "users" })
 * class UsersController {
 *   // PUT /users/42
 *   @Put(":id")
 *   async update(ctx: Context) {
 *     const changes = await ctx.req.json();
 *     return { id: ctx.req.param("id"), ...changes };
 *   }
 * }
 * ```
 */
export function Put(route: string): ChoMethodDecorator {
  return create_http_decorator("Put", route, "PUT");
}

/**
 * Mark a method as the handler of `DELETE route`.
 *
 * The method receives the request context of the HTTP runtime (Hono's
 * `Context` with `HonoLinker`). What it returns is sent as JSON, unless it is a
 * `Response`.
 *
 * @param route The route of the handler, relative to its controller, without
 *   leading or trailing `/`. It can declare parameters (`":id"`); `""` is the
 *   controller's own route.
 * @returns A method decorator.
 *
 * @example
 * ```ts
 * @Controller({ route: "users" })
 * class UsersController {
 *   // DELETE /users/42
 *   @Delete(":id")
 *   remove(ctx: Context) {
 *     return new Response(null, { status: 204 });
 *   }
 * }
 * ```
 */
export function Delete(route: string): ChoMethodDecorator {
  return create_http_decorator("Delete", route, "DELETE");
}
