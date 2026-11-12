/**
 * The HTTP graph: what a linker needs to register the routes of a web
 * application, with every instance, middleware and error handler already
 * created, so it can run without the DI system.
 *
 * `build_http_graph` (`build-graph.ts`) builds it from an injector:
 *
 * - {@link AppRef}: the application, with the global route prefix;
 * - {@link FeatureRef}: a module that declares controllers;
 * - {@link ControllerRef}: a controller, with its instance;
 * - {@link MethodRef}: a route handler (`@Get`, `@Post`, ...).
 *
 * @module
 */

import type { ChoErrorHandlerFn, ChoMiddlewareFn } from "@chojs/core/di";
import type { ChoWebContext } from "./context.ts";

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
  [key: string]: (ctx: ChoWebContext) => Promise<unknown>;
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
  readonly handler: (ctx: ChoWebContext) => Promise<unknown>;

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
