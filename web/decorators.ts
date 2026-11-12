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

/** Mark a method as the handler of `GET route`. */
export function Get(route: string): ChoMethodDecorator {
  return create_http_decorator("Get", route, "GET");
}

/** Mark a method as the handler of `POST route`. */
export function Post(route: string): ChoMethodDecorator {
  return create_http_decorator("Post", route, "POST");
}

/** Mark a method as the handler of `PUT route`. */
export function Put(route: string): ChoMethodDecorator {
  return create_http_decorator("Put", route, "PUT");
}

/** Mark a method as the handler of `DELETE route`. */
export function Delete(route: string): ChoMethodDecorator {
  return create_http_decorator("Delete", route, "DELETE");
}
