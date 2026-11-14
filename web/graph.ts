/**
 * The HTTP graph: the routes of a web application as a tree, with every
 * instance, middleware and error handler already created.
 *
 * `compile_routes` (`routes.ts`) turns it into the flat list of routes a
 * linker registers. The tree itself is kept on `ChoWeb.graph`, for
 * introspection (listing routes, generating documentation).
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

import type {
  ChoWebArg,
  ChoWebDoc,
  ChoWebErrorHandlerFn,
  ChoWebHandler,
  ChoWebMiddlewareFn,
} from "./types.ts";

export type { ChoWebContext } from "./context.ts";
export type {
  ChoWebArg,
  ChoWebArgInfo,
  ChoWebArgSource,
  ChoWebDoc,
  ChoWebDocResponse,
  ChoWebErrorHandlerFn,
  ChoWebHandler,
  ChoWebMiddlewareFn,
  ChoWebNext,
  ChoWebValidator,
} from "./types.ts";

/**
 * An error handler as stored in the graph: the function given to `@Catch`,
 * the bound `handle` method of a handler class, or `null` when there is none.
 */
export type ErrorHandlerRef = ChoWebErrorHandlerFn | null;

/** A node of the HTTP graph that has a route, middlewares and an error handler. */
export abstract class NodeRef {
  /** The route of the node, relative to its parent; `""` when it has none. */
  readonly route: string;
  /** The middlewares of the node, created and in order. */
  readonly middlewares: ChoWebMiddlewareFn[];
  /** The error handler of the node, or `null` when it has none. */
  readonly errorHandler: ErrorHandlerRef;
  /** What `@Doc` declares about the node; an empty object when there is none. */
  readonly doc: ChoWebDoc;

  /**
   * Create a node.
   *
   * @param route The route of the node, relative to its parent.
   * @param middlewares The middlewares of the node.
   * @param errorHandler The error handler of the node, or `null`.
   * @param doc What `@Doc` declares about the node. Default: nothing.
   */
  constructor(
    route: string,
    middlewares: ChoWebMiddlewareFn[],
    errorHandler: ErrorHandlerRef,
    doc: ChoWebDoc = {},
  ) {
    this.route = route;
    this.middlewares = middlewares;
    this.errorHandler = errorHandler;
    this.doc = doc;
  }
}

/** A route handler: a controller method marked with `@Get`, `@Post`, ... */
export class MethodRef extends NodeRef {
  /** The name of the method on the controller. */
  readonly name: string;
  /** The HTTP method, such as `"GET"`. */
  readonly method: string;
  /**
   * Calls the method on its controller instance, with the context of a
   * request. When the method has arguments (`@Args`), they are evaluated
   * first, and the method receives their values and then the context.
   */
  readonly handler: ChoWebHandler;
  /** The arguments of the handler (`@Args`), in order; empty when it has none. */
  readonly args: readonly ChoWebArg[];
  /**
   * Whether the validation middleware (`validate()`) covers the handler: it
   * is among the middlewares of its feature, of its controller or its own.
   */
  readonly validated: boolean;

  /**
   * Create a route handler node.
   *
   * @param name The name of the method on the controller.
   * @param route The route of the handler, relative to its controller.
   * @param method The HTTP method.
   * @param middlewares The middlewares of the method.
   * @param errorHandler The error handler of the method, or `null`.
   * @param handler Calls the method on its controller instance.
   * @param args The arguments of the handler. Default: none.
   * @param doc What `@Doc` declares about the handler. Default: nothing.
   * @param validated Whether the validation middleware covers the handler.
   *   Default: `false`.
   */
  constructor(
    name: string,
    route: string,
    method: string,
    middlewares: ChoWebMiddlewareFn[],
    errorHandler: ErrorHandlerRef,
    handler: ChoWebHandler,
    args: readonly ChoWebArg[] = [],
    doc: ChoWebDoc = {},
    validated = false,
  ) {
    super(route, middlewares, errorHandler, doc);
    this.name = name;
    this.method = method;
    this.handler = handler;
    this.args = args;
    this.validated = validated;
  }
}

/** A controller, with its instance and its route handlers. */
export class ControllerRef extends NodeRef {
  /** The controller instance, created by the injector. */
  readonly instance: object;
  /** The route handlers of the controller, in declaration order. */
  readonly methods: MethodRef[];

  /**
   * Create a controller node, with no route handlers yet.
   *
   * @param route The route of the controller, relative to its feature.
   * @param middlewares The middlewares of the controller.
   * @param errorHandler The error handler of the controller, or `null`.
   * @param instance The controller instance.
   * @param doc What `@Doc` declares about the controller. Default: nothing.
   */
  constructor(
    route: string,
    middlewares: ChoWebMiddlewareFn[],
    errorHandler: ErrorHandlerRef,
    instance: object,
    doc: ChoWebDoc = {},
  ) {
    super(route, middlewares, errorHandler, doc);
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
   * @param doc What `@Doc` declares about the feature. Default: nothing.
   */
  constructor(
    route: string,
    middlewares: ChoWebMiddlewareFn[],
    errorHandler: ErrorHandlerRef,
    doc: ChoWebDoc = {},
  ) {
    super(route, middlewares, errorHandler, doc);
    this.controllers = [];
  }
}

/** The root of the HTTP graph: the application. */
export class AppRef {
  /** The global route prefix; `""` when there is none. */
  readonly route: string;
  /**
   * The error handler of the application (the `onError` option of
   * `ChoWeb.create`), or `null` when it has none. It handles the errors of the
   * routes that no `@Catch` handler covers.
   */
  readonly errorHandler: ErrorHandlerRef;
  /** The features of the application. */
  readonly features: FeatureRef[];

  /**
   * Create the application node, with no features yet.
   *
   * @param route The global route prefix.
   * @param errorHandler The error handler of the application, or `null`.
   */
  constructor(route: string, errorHandler: ErrorHandlerRef = null) {
    this.route = route;
    this.errorHandler = errorHandler;
    this.features = [];
  }
}
