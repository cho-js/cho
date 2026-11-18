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
import { compose, type Endpoint } from "./compose.ts";
import { type ChoWebContext, create_context } from "./context.ts";
import type { AppRef, ErrorHandlerRef } from "./graph.ts";
import type { Route } from "./linker.ts";
import { to_response } from "./response.ts";
import { is_async_iterable, sse_response } from "./sse.ts";

/**
 * What identifies a route for a router: its method and path, with every
 * parameter name removed (`:id` and `:name` match the same requests).
 */
export function route_key(route: Pick<Route, "method" | "path">): string {
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
        }: declared by ${previous.name} and ${route.name}` +
          // one handler, twice: its controller is declared by two modules
          (previous.name === route.name
            ? ". Its controller is declared in more than one module: declare it in one."
            : ""),
      );
    }
    seen.set(key, route);
  }
}

/**
 * Make a route of a chain: the middlewares and the handler of the route, as
 * one function of the context.
 *
 * The route creates the context of each request and runs the chain. An error
 * thrown anywhere in the chain goes to the error handler, whose result is
 * converted by `to_response`. Without one, when it returns nothing, or when
 * it throws too, the route rejects. The response of a `HEAD` route is sent
 * without its body.
 *
 * @param method The HTTP method, upper case.
 * @param path The full path, starting with `/`.
 * @param name Where the route comes from, for logs.
 * @param run The chain of the route.
 * @param on_error The error handler of the route, if any.
 * @param log The `cho:web` debug logger.
 * @returns The route.
 */
export function make_route(
  method: string,
  path: string,
  name: string,
  run: Endpoint,
  on_error: ErrorHandlerRef,
  log: Debuglog,
): Route {
  // A HEAD response has no body, whatever produced it.
  const finish = method === "HEAD"
    ? (response: Response) =>
      response.body === null ? response : new Response(null, response)
    : (response: Response) => response;
  return {
    method,
    path,
    name,
    async handle(req, params, native, state) {
      const ctx = create_context(req, params, native, state);
      try {
        return finish(await run(ctx));
      } catch (error) {
        if (!on_error) {
          throw error;
        }
        log.error(`${req.method} ${ctx.url.pathname} failed:`, error);
        const handled = await on_error(error, ctx);
        // Nothing returned is no response: the error is still
        // unhandled. Answering 204, as for a handler that returns
        // nothing, would report a failed request as a success.
        if (handled === undefined) {
          throw error;
        }
        return finish(to_response(handled));
      }
    },
  };
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
 *   `to_response`, or, for an `@Sse` handler, becomes the body of an event
 *   stream (`sse_response`). An error that cuts such a stream is not given to
 *   an error handler: the response has started, so there is nothing to answer;
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
        const on_error = method.errorHandler ?? controller.errorHandler ??
          feature.errorHandler ?? graph.errorHandler;
        const { sse } = method;
        /** The response of an `@Sse` handler: its own, or its events. */
        const to_events = (value: unknown, ctx: ChoWebContext): Response => {
          if (value instanceof Response) {
            return value;
          }
          if (!is_async_iterable(value)) {
            throw new TypeError(
              `@Sse() handler ${name} must return an async iterable or a Response, got ${
                value === null ? "null" : typeof value
              }`,
            );
          }
          return sse_response(value, {
            name,
            keepAlive: sse?.keepAlive,
            // The status is sent: no error handler can answer this one.
            failed: (error) =>
              log.error(
                `${ctx.req.method} ${ctx.url.pathname} stream failed:`,
                error,
              ),
          });
        };
        const run = compose(
          [
            ...feature.middlewares,
            ...controller.middlewares,
            ...method.middlewares,
          ],
          sse === undefined
            ? async (ctx) => to_response(await method.handler(ctx))
            : async (ctx) => to_events(await method.handler(ctx), ctx),
        );
        if (
          log.enabled && !method.validated &&
          method.args.some((arg) => arg.info?.validator)
        ) {
          log(
            `${name} has an argument with a validator and no validate() middleware: it is not validated`,
          );
        }

        routes.push(
          make_route(method.method, path, name, run, on_error, log),
        );
      }
    }
  }
  assert_no_duplicate_routes(routes);
  return routes;
}
