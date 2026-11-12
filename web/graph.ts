/**
 * The HTTP graph: what a linker needs to register the routes of a web
 * application, with every instance, middleware and error handler already
 * created, so it can run without the DI system.
 *
 * {@link build_http_graph} builds it from an {@link Injector}:
 *
 * - {@link AppRef}: the application, with the global route prefix;
 * - {@link FeatureRef}: a module that declares controllers;
 * - {@link ControllerRef}: a controller, with its instance;
 * - {@link MethodRef}: a route handler (`@Get`, `@Post`, ...).
 *
 * @module
 */

import type {
  ChoErrorHandler,
  ChoErrorHandlerFn,
  ChoMiddleware,
  ChoMiddlewareFn,
  ControllerMetadata,
  Ctr,
  Injector,
  ModuleMetadata,
  ModuleScope,
} from "@chojs/core/di";
import { describe, isClass, isClassImplement } from "@chojs/core/utils";

export type { ChoMiddlewareFn };

/**
 * An error handler as stored in the graph: a function given to `@Catch`, an
 * instance of a handler class (one with a `handle` method), or `null` when
 * there is none.
 */
export type ErrorHandlerRef =
  | ChoErrorHandlerFn
  | null;

/** A controller instance: its handler methods, by name. */
export type ControllerInstance = {
  [key: string]: () => Promise<unknown>;
};

/**
 * The record of a route handler method: what the HTTP method decorators
 * (`@Get`, `@Post`, ...) write, plus what `@Middlewares` and `@Catch` add.
 */
export type MethodMetadata = {
  /** Marks a route handler. */
  isHTTP: true;
  /** The kind of handler. */
  type: "HTTP";
  /** The HTTP method, such as `"GET"`. */
  method: string;
  /** The name of the method on the controller. */
  name: string;
  /** The route of the handler, relative to its controller. */
  route: string;
  /** The middlewares of `@Middlewares`, in order. */
  middlewares?: ChoMiddleware[];
  /** The error handler of `@Catch`. */
  errorHandler?: ChoErrorHandler;
};

/** A node of the HTTP graph that has a route, middlewares and an error handler. */
export abstract class NodeRef {
  /** The route of the node, relative to its parent; `""` when it has none. */
  readonly route: string;
  /** The middlewares of the node, created and in order. */
  readonly middlewares: ChoMiddlewareFn[];
  /** The error handler of the node, or `null` when it has none. */
  readonly errorHandler: ErrorHandlerRef;

  /**
   * Create a node.
   *
   * @param route The route of the node, relative to its parent.
   * @param middlewares The middlewares of the node.
   * @param errorHandler The error handler of the node, or `null`.
   */
  constructor(
    route: string,
    middlewares: ChoMiddlewareFn[],
    errorHandler: ErrorHandlerRef,
  ) {
    this.route = route;
    this.middlewares = middlewares ?? [];
    this.errorHandler = errorHandler;
  }
}

/** A route handler: a controller method marked with `@Get`, `@Post`, ... */
export class MethodRef extends NodeRef {
  /** The name of the method on the controller. */
  readonly name: string;
  /** The HTTP method, such as `"GET"`. */
  readonly method: string;
  /** The kind of handler: `"HTTP"`. */
  readonly type: string;
  /** The method, bound to its controller instance. */
  readonly handler: (...args: unknown[]) => Promise<unknown>;

  /**
   * Create a route handler node.
   *
   * @param name The name of the method on the controller.
   * @param route The route of the handler, relative to its controller.
   * @param method The HTTP method.
   * @param type The kind of handler.
   * @param middlewares The middlewares of the method.
   * @param errorHandler The error handler of the method, or `null`.
   * @param handler The method, bound to its controller instance.
   */
  constructor(
    name: string,
    route: string,
    method: string,
    type: string,
    middlewares: ChoMiddlewareFn[],
    errorHandler: ErrorHandlerRef,
    handler: (...args: unknown[]) => Promise<unknown>,
  ) {
    super(route, middlewares, errorHandler);
    this.name = name;
    this.method = method;
    this.type = type;
    this.handler = handler;
  }
}

/** A controller, with its instance and its route handlers. */
export class ControllerRef extends NodeRef {
  /** The controller instance, created by the injector. */
  readonly instance: ControllerInstance;
  /** The route handlers of the controller, in declaration order. */
  readonly methods: MethodRef[];

  /**
   * Create a controller node, with no route handlers yet.
   *
   * @param route The route of the controller, relative to its feature.
   * @param middlewares The middlewares of the controller.
   * @param errorHandler The error handler of the controller, or `null`.
   * @param instance The controller instance.
   */
  constructor(
    route: string,
    middlewares: ChoMiddlewareFn[],
    errorHandler: ErrorHandlerRef,
    instance: ControllerInstance,
  ) {
    super(route, middlewares, errorHandler);
    this.instance = instance;
    this.methods = [];
  }
}

/** A feature: a module that declares controllers. */
export class FeatureRef extends NodeRef {
  /** The controllers of the feature that have route handlers. */
  readonly controllers: ControllerRef[];

  /**
   * Create a feature node, with no controllers yet.
   *
   * @param route The route of the feature, relative to the global prefix.
   * @param middlewares The middlewares of the feature module.
   * @param errorHandler The error handler of the feature module, or `null`.
   */
  constructor(
    route: string,
    middlewares: ChoMiddlewareFn[],
    errorHandler: ErrorHandlerRef,
  ) {
    super(route, middlewares, errorHandler);
    this.controllers = [];
  }
}

/** The root of the HTTP graph: the application. */
export class AppRef {
  /** The global route prefix; `""` when there is none. */
  readonly route: string;
  /** The features of the application. */
  readonly features: FeatureRef[];

  /**
   * Create the application node, with no features yet.
   *
   * @param route The global route prefix.
   */
  constructor(route: string) {
    this.route = route;
    this.features = [];
  }
}

/**
 * One path segment: RFC 3986 `pchar` characters (unreserved, sub-delims, `:`
 * and `@`) or percent-encoded bytes. `:` keeps route parameters (`:id`) valid.
 */
const ROUTE_SEGMENT = /^(?:[A-Za-z0-9\-._~!$&'()*+,;=:@]|%[0-9A-Fa-f]{2})+$/;

/**
 * Assert that a route is valid. The empty string is valid: there is no route
 * at that level. Otherwise the route is one or more path segments separated by
 * `/`, where:
 *
 * - the route does not start or end with `/`;
 * - no segment is empty (`a//b`), `.` or `..`;
 * - every segment contains only characters a URL path allows, or
 *   percent-encoded bytes (no spaces, `?` or `#`).
 *
 * @param route The route to check.
 * @param where Where the route is declared, for the error message.
 * @throws {TypeError} When the route is not a string.
 * @throws {Error} When the route is not valid.
 */
export function assert_route(
  route: unknown,
  where: string,
): asserts route is string {
  if (typeof route !== "string") {
    throw new TypeError(
      `Invalid route of ${where}: expected a string, got ${describe(route)}`,
    );
  }
  if (route === "") {
    return;
  }
  const invalid = (reason: string) =>
    new Error(`Invalid route ${describe(route)} of ${where}: ${reason}`);
  if (route.startsWith("/") || route.endsWith("/")) {
    throw invalid('it must not start or end with "/"');
  }
  for (const segment of route.split("/")) {
    if (segment === "") {
      throw invalid('it must not contain an empty segment ("//")');
    }
    if (segment === "." || segment === "..") {
      throw invalid(`it must not contain a "${segment}" segment`);
    }
    if (!ROUTE_SEGMENT.test(segment)) {
      throw invalid(
        `${describe(segment)} is not a valid URL path segment`,
      );
    }
  }
}

/**
 * Trim a route and assert that it is valid (see {@link assert_route}).
 *
 * @param route The route as declared.
 * @param where Where the route is declared, for the error message.
 * @returns The trimmed route.
 */
function normalize_route(route: unknown, where: string): string {
  const trimmed = typeof route === "string" ? route.trim() : route;
  assert_route(trimmed, where);
  return trimmed;
}

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
  const route = meta["route"];
  return route === undefined ? "" : normalize_route(route, where);
}

function* modules_with_controllers(
  injector: Injector,
): IterableIterator<ModuleScope> {
  for (const mdl of injector.modules()) {
    if (mdl.meta.controllers && mdl.meta.controllers.length > 0) {
      yield mdl;
    }
  }
}

function* controllers_with_methods(
  meta: ModuleMetadata,
): IterableIterator<ControllerMetadata> {
  for (const ctrl of meta.controllers) {
    if (ctrl.methods && ctrl.methods.length > 0) {
      yield ctrl;
    }
  }
}

function* http_methods(
  meta: ControllerMetadata,
): IterableIterator<MethodMetadata> {
  for (const m of meta.methods) {
    if (m.meta.isHTTP) {
      yield m.meta as MethodMetadata;
    }
  }
}

function error_handler_factory(
  mdl: Ctr,
  injector: Injector,
): (ctr: unknown) => Promise<ErrorHandlerRef> {
  return async function (ctr: unknown): Promise<ErrorHandlerRef> {
    if (
      isClassImplement<{ handle(error: unknown): unknown }>(ctr, "handle")
    ) {
      try {
        const instance = await injector.resolve(ctr, mdl);
        return instance.handle.bind(instance) as ChoErrorHandlerFn;
      } catch (error) {
        throw new Error(
          `Failed to create error handler ${describe(ctr)} in module ${
            describe(mdl)
          }`,
          { cause: error },
        );
      }
    }
    if (isClass(ctr)) {
      throw new Error(
        `Error handler class ${ctr.name} must implement 'handle' method.`,
      );
    }
    if (typeof ctr === "function") {
      return ctr as ChoErrorHandlerFn;
    }
    return null;
  };
}

function create_middleware_factory(
  mdl: Ctr,
  injector: Injector,
): (mws: ChoMiddleware[]) => Promise<ChoMiddlewareFn[]> {
  return async function (mws: ChoMiddleware[]) {
    const fns: ChoMiddlewareFn[] = [];
    for (const mw of mws) {
      if (isClassImplement(mw, "handle")) {
        try {
          const instance = await injector.resolve<{ handle: ChoMiddlewareFn }>(
            mw as Ctr,
            mdl,
          );
          fns.push(instance.handle.bind(instance));
        } catch (error) {
          throw new Error(
            `Failed to create middleware ${describe(mw)} in module ${
              describe(mdl)
            }`,
            { cause: error },
          );
        }
      } else if (isClass(mw)) {
        throw new Error(
          `Middleware class ${mw.name} must implement 'handle' method.`,
        );
      } else if (typeof mw === "function") {
        fns.push(mw);
      } else {
        throw new Error(
          `Invalid middleware ${
            describe(mw)
          }: must be a function or a class with a 'handle' method.`,
        );
      }
    }
    return fns;
  };
}

function assert_no_duplicate_routes(ref: AppRef): void {
  const routes = new Set<string>();
  for (const feature of ref.features) {
    for (const controller of feature.controllers) {
      for (const method of controller.methods) {
        const path = [ref.route, feature.route, controller.route, method.route]
          .filter((segment) => segment !== "")
          .join("/");
        const full_route = `${method.method} /${path}`;
        if (routes.has(full_route)) {
          throw new Error(
            `Duplicate route ${
              describe(full_route)
            }: already declared by another method.`,
          );
        }
        routes.add(full_route);
      }
    }
  }
}

/**
 * Build the HTTP graph of an application: every feature module, controller
 * and route handler, with their routes, middlewares and error handlers,
 * ready to invoke without the DI system, so that a linker can register them.
 *
 * Controller instances, middleware classes and error handler classes are
 * created by the injector, in the scope of the module that declares the
 * controller.
 *
 * @param injector The injector of the application.
 * @param prefix The global route prefix (`""` for none).
 * @returns The HTTP graph.
 * @throws {Error} When a route is invalid, when two handlers have the same
 *   HTTP method and full route, or when a middleware or an error handler is
 *   invalid or cannot be created.
 */
export async function build_http_graph(
  injector: Injector,
  prefix: string,
): Promise<AppRef> {
  const graph = new AppRef(normalize_route(prefix, "the global prefix"));

  for (const mdl of modules_with_controllers(injector)) {
    // error handler resolver with context
    const error_handler = error_handler_factory(mdl.ctr, injector);
    // middleware resolver with context
    const create_middlewares = create_middleware_factory(mdl.ctr, injector);

    const meta = mdl.meta;
    const feature = new FeatureRef(
      get_route(meta, `feature ${describe(mdl.ctr)}`),
      await create_middlewares((meta.middlewares ?? []) as ChoMiddleware[]),
      await error_handler(meta.errorHandler),
    );

    for (const ctrl of controllers_with_methods(meta)) {
      const name = describe(ctrl.provider.provide);
      const route = get_route(ctrl, `controller ${name}`);

      const instance = await injector.resolve(ctrl.provider.provide, mdl.ctr);
      const controller = new ControllerRef(
        route,
        await create_middlewares((ctrl.middlewares ?? []) as ChoMiddleware[]),
        await error_handler(ctrl.errorHandler),
        instance,
      );

      for (const m of http_methods(ctrl)) {
        const handler = instance[m.name].bind(instance);
        const method = new MethodRef(
          m.name,
          normalize_route(m.route, `method ${m.name} of controller ${name}`),
          m.method,
          m.type,
          await create_middlewares(m.middlewares ?? []),
          await error_handler(m.errorHandler),
          handler,
        );
        controller.methods.push(method);
      }
      feature.controllers.push(controller);
    }
    graph.features.push(feature);
  }
  assert_no_duplicate_routes(graph);
  return graph;
}
