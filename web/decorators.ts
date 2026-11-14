/**
 * The decorators of `@chojs/web`.
 *
 * - `@Get`, `@Post`, `@Put`, `@Patch`, `@Delete`, `@Head` and `@Options` mark
 *   the route handlers of a controller. They write the handler's method and route on the decorated
 *   method, under the private `HTTP` key (`keys.ts`), which the web graph
 *   builder reads (see `build-graph.ts`).
 * - `@Module` and `@Controller` are the core's decorators, with the `route`
 *   option of `@chojs/web`. They accept no other option.
 * - `@Middlewares` and `@Catch` declare the middlewares and the error handler
 *   of a feature module, a controller or a handler. They are the core's
 *   decorators, typed for `@chojs/web`.
 * - `@Args` declares the arguments a handler receives (see `args.ts`), and
 *   `@Doc` what the documentation of the application says about a handler, a
 *   controller or a feature module.
 *
 * @module
 */

import {
  add_to_metadata_object,
  assert_known_options,
  type ChoClassOrMethodDecorator,
  type ChoInjectableDecorator,
  type ChoMethodDecorator,
  Controller as CoreController,
  type ControllerOptions,
  decorated_method,
  decorated_target,
  type Dependency,
  Module as CoreModule,
  type ModuleOptions,
  read_metadata_object,
  set_error_handler,
  set_middlewares,
  type WithDependencies,
} from "@chojs/core/di";
import { describe } from "@chojs/core/utils";
import {
  ARGS,
  DOC,
  doc_of,
  handler_args,
  type HandlerArgs,
  HTTP,
  http_route,
  type HttpRoute,
} from "./keys.ts";
import { normalize_route } from "./path.ts";
import type {
  ChoWebArg,
  ChoWebArgsDecorator,
  ChoWebArgValues,
  ChoWebDoc,
  ChoWebErrorHandler,
  ChoWebMiddleware,
} from "./types.ts";

/** The option `@chojs/web` adds to `@Module` and `@Controller`. */
export type RouteOption = {
  /**
   * The route of the feature module or of the controller, without leading or
   * trailing `/` (`"users"`, `"api/v1"`). Default: none.
   */
  route?: string;
};

/**
 * Options of `@Module` in a web application: the module options of the core,
 * and the `route` of the feature.
 */
export type WebModuleOptions<
  D extends readonly Dependency[] = readonly Dependency[],
> = WithDependencies<Partial<ModuleOptions>, D> & RouteOption;

/**
 * Options of `@Controller` in a web application: its `dependencies`, and its
 * `route`.
 */
export type WebControllerOptions<
  D extends readonly Dependency[] = readonly Dependency[],
> = WithDependencies<Partial<ControllerOptions>, D> & RouteOption;

/**
 * Mark a class as a module (see `@Module` of `@chojs/core`). A module that
 * declares controllers is a feature: its `route` comes before the routes of
 * its controllers.
 *
 * @param options What the module imports, declares and exports, and its
 *   `route`.
 * @returns The class decorator.
 * @throws {Error} When an option is unknown or invalid, or when the class
 *   already has a DI decorator.
 *
 * @example
 * ```ts
 * @Module({ route: "v1", providers: [UserStore], controllers: [UsersController] })
 * class App {}
 * ```
 */
export function Module<const D extends readonly Dependency[] = []>(
  options: WebModuleOptions<D> = {},
): ChoInjectableDecorator<NoInfer<D>> {
  assert_known_options("@Module()", options, [
    "dependencies",
    "imports",
    "providers",
    "controllers",
    "exports",
    "route",
  ]);
  return CoreModule<RouteOption, D>(options);
}

/**
 * Mark a class as a controller (see `@Controller` of `@chojs/core`): its
 * methods marked with `@Get`, `@Post`, ... are route handlers, under its
 * `route`.
 *
 * @param options The controller's `dependencies` and its `route`.
 * @returns The class decorator.
 * @throws {Error} When an option is unknown or invalid, or when the class
 *   already has a DI decorator.
 *
 * @example
 * ```ts
 * @Controller({ route: "users", dependencies: [UserStore] })
 * class UsersController {
 *   constructor(readonly store: UserStore) {}
 * }
 * ```
 */
export function Controller<const D extends readonly Dependency[] = []>(
  options: WebControllerOptions<D> = {},
): ChoInjectableDecorator<NoInfer<D>> {
  assert_known_options("@Controller()", options, ["dependencies", "route"]);
  return CoreController<RouteOption, D>(options);
}

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
    const previous = http_route(read_metadata_object(decorated.meta) ?? {});
    if (previous) {
      throw new Error(
        `Cannot add ${decorator} to ${of}: it already handles ${previous.method} ${
          JSON.stringify(previous.route)
        }. A method can have one HTTP method decorator.`,
      );
    }
    add_to_metadata_object(decorated.meta, {
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
 * the response, converted like a handler's result; when it returns nothing,
 * the error is still unhandled and goes on to the HTTP runtime (a `500`). A
 * class or method has at most one `@Catch`.
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
 * response: a `Response` as is, nothing as `204`, a string or bytes as they
 * are, anything else as JSON.
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
 * response: a `Response` as is, nothing as `204`, a string or bytes as they
 * are, anything else as JSON.
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
 * response: a `Response` as is, nothing as `204`, a string or bytes as they
 * are, anything else as JSON.
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
 * response: a `Response` as is, nothing as `204`, a string or bytes as they
 * are, anything else as JSON.
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
 * Mark a method as the handler of `HEAD route`.
 *
 * The method receives the request's `ChoWebContext`. A `HEAD` response has no
 * body: only the status and the headers of what the method returns are sent,
 * so return a `Response` to set them.
 *
 * Without a `@Head` handler, what a `HEAD` request gets is up to the adapter:
 * Hono answers it from the `@Get` handler of the same route, without the
 * body.
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
 * @Controller({ route: "files" })
 * class FilesController {
 *   // HEAD /files/report.pdf
 *   @Head(":name")
 *   async stat(ctx: ChoWebContext) {
 *     const size = await this.files.size(ctx.params.name);
 *     return new Response(null, { headers: { "content-length": `${size}` } });
 *   }
 * }
 * ```
 */
export function Head(route: string): ChoMethodDecorator {
  return create_http_decorator("Head", route, "HEAD");
}

/**
 * Mark a method as the handler of `OPTIONS route`.
 *
 * The method receives the request's `ChoWebContext`. What it returns is the
 * response: a `Response` as is, nothing as `204`, a string or bytes as they
 * are, anything else as JSON.
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
 *   // OPTIONS /users
 *   @Options("")
 *   options() {
 *     return new Response(null, {
 *       status: 204,
 *       headers: { allow: "GET, POST, OPTIONS" },
 *     });
 *   }
 * }
 * ```
 */
export function Options(route: string): ChoMethodDecorator {
  return create_http_decorator("Options", route, "OPTIONS");
}

/**
 * Mark a method as the handler of `DELETE route`.
 *
 * The method receives the request's `ChoWebContext`. What it returns is the
 * response: a `Response` as is, nothing as `204`, a string or bytes as they
 * are, anything else as JSON.
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

/**
 * Declare the arguments a handler receives.
 *
 * Standard decorators cannot decorate a parameter, so the arguments are
 * listed on the method, in the order of its parameters. The handler is then
 * called with the value of each argument, and with the context last:
 * `handler(...values, ctx)`. A handler without `@Args` receives the context
 * alone.
 *
 * An argument is made by `Param`, `Query`, `Header`, `Body` or `Form`, or is
 * any function `(ctx) => value`. The parameters of the method are checked
 * against the arguments at compile time.
 *
 * - The decorator goes above or below the HTTP method decorator.
 * - A method has one `@Args`. An override that declares it replaces the
 *   arguments it inherits; one that does not keeps them.
 * - The arguments are evaluated in order, after the middlewares of the route
 *   and just before the handler.
 *
 * @typeParam A The arguments.
 * @param args The arguments, in the order of the parameters of the method.
 * @returns A method decorator.
 * @throws {TypeError} When an argument is not a function, or when the
 *   decorated member is not a public, non-static, string-named method.
 * @throws {Error} When the method already has `@Args`.
 *
 * @example
 * ```ts
 * @Controller({ route: "users" })
 * class UsersController {
 *   // PUT /users/42?notify=1
 *   @Put(":id")
 *   @Args(Param("id"), Query("notify"), Body<UpdateUser>())
 *   update(id: string, notify: string | undefined, user: UpdateUser, ctx: ChoWebContext) {
 *     return { id, ...user };
 *   }
 * }
 * ```
 */
export function Args<const A extends readonly ChoWebArg[]>(
  ...args: A
): ChoWebArgsDecorator<ChoWebArgValues<A>> {
  const decorate: ChoMethodDecorator = (target, context, descriptor) => {
    const { name } = decorated_method("@Args()", target, context, descriptor);
    const of = `method ${String(name)}`;
    // Rejects a static, private or symbol-named method: its record would
    // never be read.
    const meta = decorated_target("@Args()", target, context, descriptor);
    args.forEach((arg, index) => {
      if (typeof arg !== "function") {
        throw new TypeError(
          `@Args() on ${of}: argument ${
            index + 1
          } must be made with Param, Query, Header, Body or Form, or be a function, got ${
            describe(arg)
          }`,
        );
      }
    });
    if (handler_args(read_metadata_object(meta) ?? {})) {
      throw new Error(`Cannot add @Args() to ${of}: it already has one.`);
    }
    add_to_metadata_object(meta, {
      [ARGS]: Object.freeze(
        { list: Object.freeze([...args]) } satisfies HandlerArgs,
      ),
    });
  };
  return decorate as ChoWebArgsDecorator<ChoWebArgValues<A>>;
}

/** The options of `@Doc` that are for a handler only. */
const HANDLER_DOC = ["summary", "responses"] as const;

/**
 * Describe a handler, a controller or a feature module for the documentation
 * of the application, such as an OpenAPI document. It says what the code
 * cannot tell, and changes nothing in how a request is handled.
 *
 * What is declared is exposed on the graph of the application (`app.graph`),
 * as the `doc` of the feature, of the controller and of the handler.
 *
 * @param options The description: `summary` and `responses` on a handler;
 *   `description`, `tags`, `deprecated` and `hidden` on a handler, a
 *   controller or a feature module.
 * @returns A class or method decorator.
 * @throws {Error} When an option is unknown, when a handler option is given
 *   on a class, or when the class or the method already has `@Doc`.
 * @throws {TypeError} When applied to anything other than a class or a
 *   public, non-static, string-named method.
 *
 * @example
 * ```ts
 * @Doc({ tags: ["users"], description: "The users of the application" })
 * @Controller({ route: "users" })
 * class UsersController {
 *   @Doc({
 *     summary: "Find a user",
 *     responses: { 200: { description: "The user" }, 404: { description: "No such user" } },
 *   })
 *   @Get(":id")
 *   get(ctx: ChoWebContext) {
 *     return this.store.find(ctx.params.id);
 *   }
 * }
 * ```
 */
export function Doc(options: ChoWebDoc): ChoClassOrMethodDecorator {
  assert_known_options("@Doc()", options, [
    "deprecated",
    "description",
    "hidden",
    "responses",
    "summary",
    "tags",
  ]);
  return (target, context, descriptor) => {
    const meta = decorated_target("@Doc()", target, context, descriptor);
    let what: string;
    if (
      context === undefined ||
      (typeof context === "object" && context.kind === "class")
    ) {
      what = `class ${describe(target)}`;
      for (const key of HANDLER_DOC) {
        if (key in options) {
          throw new Error(
            `@Doc(): option ${
              JSON.stringify(key)
            } is for a handler, not for a class (${what})`,
          );
        }
      }
    } else {
      const { name } = decorated_method("@Doc()", target, context, descriptor);
      what = `method ${String(name)}`;
    }
    if (doc_of(read_metadata_object(meta) ?? {})) {
      throw new Error(`Cannot add @Doc() to ${what}: it already has one.`);
    }
    add_to_metadata_object(meta, { [DOC]: Object.freeze({ ...options }) });
  };
}
