/**
 * Compiles the HTTP graph (see `graph.ts`) into the flat list of routes a
 * linker registers (see `linker.ts`). Internal to `@chojs/web`.
 *
 * Each route is one function that does all the request plumbing: it creates
 * the context, runs the middlewares of the feature, the controller and the
 * handler, converts the result to a `Response`, and hands errors to the
 * nearest error handler.
 *
 * @module
 */

import { type Debuglog, debuglog, describe } from "@chojs/core/utils";
import { compose } from "./compose.ts";
import { create_context } from "./context.ts";
import type { AppRef } from "./graph.ts";
import type { Route } from "./linker.ts";
import { to_response } from "./response.ts";

/**
 * What identifies a route for a router: its method and path, with every
 * parameter name removed (`:id` and `:name` match the same requests).
 */
function route_key(route: Route): string {
  const path = route.path
    .split("/")
    .map((segment) => segment.startsWith(":") ? ":" : segment)
    .join("/");
  return `${route.method} ${path}`;
}

/**
 * Throw if two routes answer the same requests.
 *
 * @param routes The routes of the application.
 * @throws {Error} On two routes with the same method and path, parameter
 *   names aside.
 */
export function assert_no_duplicate_routes(routes: readonly Route[]): void {
  const seen = new Map<string, Route>();
  for (const route of routes) {
    const key = route_key(route);
    const previous = seen.get(key);
    if (previous) {
      throw new Error(
        `Duplicate route ${
          describe(`${previous.method} ${previous.path}`)
        }: declared by ${previous.name} and ${route.name}`,
      );
    }
    seen.set(key, route);
  }
}

/**
 * Compile the routes of an HTTP graph.
 *
 * For each handler, in declaration order:
 *
 * - the path joins the global prefix and the feature's, the controller's and
 *   the handler's routes;
 * - the chain is the feature's, the controller's, then the handler's
 *   middlewares, then the handler, whose result is converted by
 *   `to_response`;
 * - an error thrown anywhere in the chain goes to the nearest error handler
 *   (the handler's, the controller's, the feature's, then the application's),
 *   whose result is
 *   converted the same way. Without one, or when it throws too, the route
 *   rejects;
 * - the response of a `HEAD` route is sent without its body.
 *
 * @param graph The HTTP graph of the application.
 * @param log The `cho:web` debug logger: each error given to an error
 *   handler is logged to it.
 * @returns The routes.
 * @throws {Error} When two routes answer the same requests.
 */
export function compile_routes(
  graph: AppRef,
  log: Debuglog = debuglog("cho:web"),
): Route[] {
  const routes: Route[] = [];
  for (const feature of graph.features) {
    for (const controller of feature.controllers) {
      for (const method of controller.methods) {
        const path = "/" +
          [graph.route, feature.route, controller.route, method.route]
            .filter((segment) => segment !== "")
            .join("/");
        const name = `${
          describe(controller.instance.constructor)
        }.${method.name}`;
        const run = compose(
          [
            ...feature.middlewares,
            ...controller.middlewares,
            ...method.middlewares,
          ],
          async (ctx) => to_response(await method.handler(ctx)),
        );
        // A HEAD response has no body, whatever produced it.
        const finish = method.method === "HEAD"
          ? (response: Response) =>
            response.body === null ? response : new Response(null, response)
          : (response: Response) => response;
        const on_error = method.errorHandler ?? controller.errorHandler ??
          feature.errorHandler ?? graph.errorHandler;

        routes.push({
          method: method.method,
          path,
          name,
          async handle(req, params, native) {
            const ctx = create_context(req, params, native);
            try {
              return finish(await run(ctx));
            } catch (error) {
              if (!on_error) {
                throw error;
              }
              log.error(`${req.method} ${ctx.url.pathname} failed:`, error);
              return finish(to_response(await on_error(error, ctx)));
            }
          },
        });
      }
    }
  }
  assert_no_duplicate_routes(routes);
  return routes;
}
