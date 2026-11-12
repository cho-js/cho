/**
 * Builds the HTTP graph (see `graph.ts`) of an application from its injector,
 * and validates each route. Internal to `@chojs/web`: `ChoWeb.create` calls
 * {@link build_http_graph}; it is not a package export.
 *
 * @module
 */

import {
  assert_handle,
  type ControllerMetadata,
  type Ctr,
  type Injector,
  type MethodMetadata,
  type ModuleMetadata,
  resolve_handle,
} from "@chojs/core/di";
import { describe } from "@chojs/core/utils";
import {
  AppRef,
  ControllerRef,
  type ErrorHandlerRef,
  FeatureRef,
  MethodRef,
} from "./graph.ts";
import { http_route, type HttpRoute } from "./keys.ts";
import { normalize_route } from "./path.ts";
import type { ChoWebErrorHandlerFn, ChoWebMiddlewareFn } from "./types.ts";

/**
 * The route of a feature module or a controller: `""` when it declares none.
 *
 * @param meta The module's or controller's metadata.
 * @param where Where the route is declared, for the error message.
 * @returns The trimmed, valid route.
 */
function get_route(
  meta: ModuleMetadata | ControllerMetadata,
  where: string,
): string {
  const route = meta.options["route"];
  return route === undefined ? "" : normalize_route(route, where);
}

/**
 * The route handlers of a controller: its methods that an HTTP method
 * decorator marked, with the route it declared.
 *
 * @param meta The controller's metadata.
 * @returns Each handler method, with its HTTP method and route.
 */
function http_methods(
  meta: ControllerMetadata,
): [MethodMetadata, HttpRoute][] {
  const methods: [MethodMetadata, HttpRoute][] = [];
  for (const m of meta.methods) {
    const route = http_route(m.meta);
    if (route) {
      methods.push([m, route]);
    }
  }
  return methods;
}

/**
 * Make the function that creates the error handler of a node: a function is
 * kept as is, a class with a `handle` method is created by the injector.
 *
 * @param mdl The module in whose scope a class is resolved.
 * @param injector The injector of the application.
 */
function error_handler_factory(
  mdl: Ctr,
  injector: Injector,
): (handler: unknown) => Promise<ErrorHandlerRef> {
  return async function (handler: unknown): Promise<ErrorHandlerRef> {
    if (handler === undefined) {
      return null;
    }
    assert_handle(handler, "Error handler");
    try {
      return await resolve_handle<ChoWebErrorHandlerFn>(injector, handler, mdl);
    } catch (error) {
      throw new Error(
        `Failed to create error handler ${describe(handler)} in module ${
          describe(mdl)
        }`,
        { cause: error },
      );
    }
  };
}

/**
 * Make the function that creates the middlewares of a node: a function is
 * kept as is, a class with a `handle` method is created by the injector.
 *
 * @param mdl The feature module: classes are resolved in its scope.
 * @param injector The injector of the application.
 */
function create_middleware_factory(
  mdl: Ctr,
  injector: Injector,
): (mws: readonly unknown[]) => Promise<ChoWebMiddlewareFn[]> {
  return async function (mws: readonly unknown[]) {
    const fns: ChoWebMiddlewareFn[] = [];
    for (const mw of mws) {
      assert_handle(mw, "Middleware");
      try {
        fns.push(await resolve_handle<ChoWebMiddlewareFn>(injector, mw, mdl));
      } catch (error) {
        throw new Error(
          `Failed to create middleware ${describe(mw)} in module ${
            describe(mdl)
          }`,
          { cause: error },
        );
      }
    }
    return fns;
  };
}

/**
 * Build the HTTP graph of an application: every feature module, controller
 * and route handler, with their routes, middlewares and error handlers,
 * ready to invoke without the DI system.
 *
 * Only what serves a route is part of the graph: a controller without a
 * route handler is left out, and so is a module left without such a
 * controller. Their middlewares and error handlers are not created.
 *
 * Every route of a controller is checked before the controller is resolved.
 * Controller instances, middleware classes and error handler classes are
 * created by the injector, in the scope of the module that declares the
 * controller.
 *
 * @param injector The injector of the application.
 * @param prefix The global route prefix (`""` for none).
 * @param on_error The error handler of the application, if any: a function,
 *   or a class with a `handle` method, created by the injector in the scope
 *   of the root module.
 * @returns The HTTP graph.
 * @throws {Error} When a route is invalid, or when a middleware or an error
 *   handler is invalid or cannot be created.
 */
export async function build_http_graph(
  injector: Injector,
  prefix: string,
  on_error?: unknown,
): Promise<AppRef> {
  const route = normalize_route(prefix, "the global prefix");
  // A handler class is created in the scope of the root module.
  const root = injector.graph.root.ctr;
  const graph = new AppRef(
    route,
    await error_handler_factory(root, injector)(on_error),
  );

  for (const mdl of injector.modules()) {
    const meta: ModuleMetadata = mdl.meta;

    // Routes first: nothing is created for an invalid route.
    const controllers = meta.controllers.flatMap((ctrl) => {
      const methods = http_methods(ctrl);
      if (methods.length === 0) {
        return [];
      }
      const name = describe(ctrl.provider.provide);
      return [{
        ctrl,
        route: get_route(ctrl, `controller ${name}`),
        methods: methods.map(([m, http]) => ({
          m,
          http,
          route: normalize_route(
            http.route,
            `method ${m.name} of controller ${name}`,
          ),
        })),
      }];
    });
    if (controllers.length === 0) {
      continue;
    }

    const error_handler = error_handler_factory(mdl.ctr, injector);
    const create_middlewares = create_middleware_factory(mdl.ctr, injector);

    const feature = new FeatureRef(
      get_route(meta, `feature ${describe(mdl.ctr)}`),
      await create_middlewares(meta.middlewares),
      await error_handler(meta.errorHandler),
    );

    for (const { ctrl, route, methods } of controllers) {
      const instance = await injector.resolve(ctrl.provider.provide, mdl.ctr);
      const controller = new ControllerRef(
        route,
        await create_middlewares(ctrl.middlewares),
        await error_handler(ctrl.errorHandler),
        instance,
      );

      for (const { m, http, route } of methods) {
        controller.methods.push(
          new MethodRef(
            m.name,
            route,
            http.method,
            await create_middlewares(m.middlewares),
            await error_handler(m.errorHandler),
            instance[m.name].bind(instance),
          ),
        );
      }
      feature.controllers.push(controller);
    }
    graph.features.push(feature);
  }
  return graph;
}
