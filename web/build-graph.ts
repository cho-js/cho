/**
 * Builds the HTTP graph (see `graph.ts`) of an application from its injector,
 * and validates each route. Internal to `@chojs/web`: `ChoWeb.create` calls
 * {@link build_http_graph}; it is not a package export.
 *
 * @module
 */

import { web_error } from "./errors.ts";
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
  type SocketRef,
} from "./graph.ts";
import { evaluate_args, InvalidArgument } from "./args.ts";
import {
  doc_of,
  handler_args,
  http_route,
  type HttpRoute,
  SOCKET_DECORATORS,
  socket_event,
  type SocketEvent,
} from "./keys.ts";
import { normalize_route } from "./path.ts";
import type {
  ChoWebArg,
  ChoWebErrorHandlerFn,
  ChoWebHandler,
  ChoWebMiddlewareFn,
} from "./types.ts";
import { answer_invalid, is_validation } from "./validate.ts";

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

/** The methods of a controller that handle the events of its socket. */
type SocketMethods = Partial<Record<SocketEvent, MethodMetadata>>;

/**
 * The methods of a controller that handle the events of its socket, checked:
 * a controller has one socket.
 *
 * @param meta The controller's metadata.
 * @param methods The route handlers of the controller.
 * @returns The method of each event, for a controller with a `@Ws` method;
 *   `undefined` for a controller with no socket.
 * @throws {ChoError} `CHO_WEB_INVALID_SOCKET` when the controller has two
 *   methods for one of the four decorators, an event method with no `@Ws`
 *   method, or an event method with `@Middlewares`, `@Catch`, `@Args` or
 *   `@Doc`.
 */
function socket_methods(
  meta: ControllerMetadata,
  methods: readonly [MethodMetadata, HttpRoute][],
): SocketMethods | undefined {
  const controller = describe(meta.provider.provide);
  const two = (decorator: string, first: string, second: string) =>
    web_error(
      "CHO_WEB_INVALID_SOCKET",
      `Controller ${controller} has two ${decorator} methods, ${first} and ${second}: a controller has one socket, and one method for each of its events. Put the second socket in a controller of its own`,
    );
  const upgrades = methods.filter(([, http]) => http.socket);
  if (upgrades.length > 1) {
    throw two("@Ws()", upgrades[0]![0].name, upgrades[1]![0].name);
  }
  const events: SocketMethods = {};
  for (const m of meta.methods) {
    const event = socket_event(m.meta);
    if (!event) {
      continue;
    }
    const decorator = SOCKET_DECORATORS[event];
    const previous = events[event];
    if (previous) {
      throw two(decorator, previous.name, m.name);
    }
    const extra = m.middlewares.length > 0
      ? "@Middlewares()"
      : m.errorHandler !== undefined
      ? "@Catch()"
      : handler_args(m.meta)
      ? "@Args()"
      : doc_of(m.meta)
      ? "@Doc()"
      : undefined;
    if (extra) {
      throw web_error(
        "CHO_WEB_INVALID_SOCKET",
        `${decorator} method ${controller}.${m.name} cannot have ${extra}: an event of a socket has no request. Put ${extra} on the @Ws() method of the controller, which handles the request that is upgraded`,
      );
    }
    events[event] = m;
  }
  const declared = Object.keys(events) as SocketEvent[];
  if (upgrades.length === 0 && declared.length > 0) {
    throw web_error(
      "CHO_WEB_INVALID_SOCKET",
      `Controller ${controller} has ${
        declared.map((event) => SOCKET_DECORATORS[event]).join(", ")
      } and no @Ws() method: the events of a socket need the method that upgrades the request`,
    );
  }
  return upgrades.length === 0 ? undefined : events;
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
      throw web_error(
        "CHO_WEB_CREATE_FAILED",
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
        throw web_error(
          "CHO_WEB_CREATE_FAILED",
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
 * @param middlewares The middlewares of the application, if any: functions,
 *   or classes with a `handle` method, created the same way.
 * @returns The HTTP graph.
 * @throws {ChoError} When a route is invalid, or when a middleware or an error
 *   handler is invalid or cannot be created.
 */
/**
 * Make the function that calls a handler with the context of a request.
 *
 * @param method The method, bound to its controller instance.
 * @param args The arguments of the handler (`@Args`).
 * @returns The method itself when it has no arguments. Otherwise a function
 *   that evaluates them, and calls the method with their values and then the
 *   context. For a validated request with an argument that is not valid, the
 *   method is not called: the function resolves with the response that
 *   answers the request.
 */
function create_handler(
  method: (...args: unknown[]) => unknown,
  args: readonly ChoWebArg[],
): ChoWebHandler {
  if (args.length === 0) {
    return method;
  }
  return async (ctx) => {
    let values: unknown[];
    try {
      values = await evaluate_args(args, ctx);
    } catch (error) {
      // Answered here, at the end of the chain: the validation middleware
      // only marked the request, from wherever it is declared.
      if (error instanceof InvalidArgument) {
        return answer_invalid(error, ctx);
      }
      throw error;
    }
    return method(...values, ctx);
  };
}

/**
 * Assert that every `Param("name")` argument of a handler names a parameter
 * of its path.
 *
 * @param args The arguments of the handler.
 * @param levels The routes of the application, the feature, the controller
 *   and the handler.
 * @param name Where the handler is declared, for the error message.
 * @throws {ChoError} When a name is not a parameter of the path.
 */
function assert_param_args(
  args: readonly ChoWebArg[],
  levels: readonly string[],
  name: string,
): void {
  const path = "/" + levels.filter((level) => level !== "").join("/");
  const params = new Set(
    path.split("/")
      .filter((segment) => segment.startsWith(":"))
      .map((segment) => segment.slice(1)),
  );
  for (const { info } of args) {
    if (
      info?.source === "param" && info.key !== undefined &&
      !params.has(info.key)
    ) {
      throw web_error(
        "CHO_WEB_UNKNOWN_PARAM",
        `@Args() of ${name}: Param(${
          JSON.stringify(info.key)
        }) is not a parameter of the route ${JSON.stringify(path)}`,
      );
    }
  }
}

export async function build_http_graph(
  injector: Injector,
  prefix: string,
  on_error?: unknown,
  middlewares: unknown = [],
): Promise<AppRef> {
  const route = normalize_route(prefix, "the global prefix");
  if (!Array.isArray(middlewares)) {
    throw web_error(
      "CHO_WEB_INVALID_OPTION",
      `ChoWeb.create(): "middlewares" must be an array, got ${
        describe(middlewares)
      }`,
    );
  }
  // A class of the application is created in the scope of the root module.
  const root = injector.graph.root.ctr;
  const graph = new AppRef(
    route,
    await error_handler_factory(root, injector)(on_error),
    await create_middleware_factory(root, injector)(middlewares),
  );

  for (const mdl of injector.modules()) {
    const meta: ModuleMetadata = mdl.meta;

    // Routes first: nothing is created for an invalid route.
    const controllers = meta.controllers.flatMap((ctrl) => {
      const methods = http_methods(ctrl);
      // Before the controller is left out: an event with no @Ws is a mistake.
      const socket = socket_methods(ctrl, methods);
      if (methods.length === 0) {
        return [];
      }
      const name = describe(ctrl.provider.provide);
      return [{
        ctrl,
        socket,
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
      doc_of(meta.options),
    );

    for (const { ctrl, route, methods, socket } of controllers) {
      const instance = await injector.resolve(ctrl.provider.provide, mdl.ctr);
      /** The socket of the controller: its event methods, bound to it. */
      const socket_ref: SocketRef | undefined = socket && Object.freeze(
        Object.fromEntries(
          Object.entries(socket).map(([event, m]) => [event, {
            name: m.name,
            handler: instance[m.name].bind(instance),
          }]),
        ),
      );
      const controller = new ControllerRef(
        route,
        await create_middlewares(ctrl.middlewares),
        await error_handler(ctrl.errorHandler),
        instance,
        doc_of(ctrl.options),
      );

      for (const { m, http, route: method_route } of methods) {
        const args = handler_args(m.meta)?.list ?? [];
        assert_param_args(
          args,
          [graph.route, feature.route, route, method_route],
          `${describe(ctrl.provider.provide)}.${m.name}`,
        );
        const middlewares = await create_middlewares(m.middlewares);
        controller.methods.push(
          new MethodRef(
            m.name,
            method_route,
            http.method,
            middlewares,
            await error_handler(m.errorHandler),
            create_handler(instance[m.name].bind(instance), args),
            args,
            doc_of(m.meta),
            [
              ...graph.middlewares,
              ...feature.middlewares,
              ...controller.middlewares,
              ...middlewares,
            ].some(is_validation),
            http.sse,
            http.socket ? socket_ref : undefined,
          ),
        );
      }
      feature.controllers.push(controller);
    }
    graph.features.push(feature);
  }
  return graph;
}
