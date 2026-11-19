/**
 * The message graph: the topics of a message application as a tree, with
 * every instance, middleware and error handler already created.
 *
 * `compile_routes` (`routes.ts`) turns it into the flat list of routes a
 * linker subscribes to. The tree itself is kept on `ChoMessage.graph`, for
 * introspection (listing the topics, generating documentation).
 *
 * `build_message_graph` (`build-graph.ts`) builds it from an injector:
 *
 * - {@link AppRef}: the application, with the global topic prefix;
 * - {@link FeatureRef}: a module that declares controllers;
 * - {@link ControllerRef}: a controller, with its instance;
 * - {@link MethodRef}: a message handler (`@Subscribe`).
 *
 * @module
 */

import type { Contract } from "./contract.ts";
import type {
  ChoMessageArg,
  ChoMessageErrorHandlerFn,
  ChoMessageHandler,
  ChoMessageMiddlewareFn,
} from "./types.ts";

export type { ChoMessageContext } from "./context.ts";
export type { Contract } from "./contract.ts";
export type {
  ChoMessageArg,
  ChoMessageArgInfo,
  ChoMessageArgSource,
  ChoMessageErrorHandlerFn,
  ChoMessageHandler,
  ChoMessageMiddlewareFn,
  ChoMessageNext,
} from "./types.ts";
export type { ChoIssue, ChoValidator } from "@chojs/core";

/**
 * An error handler as stored in the graph: the function given to `@Catch`,
 * the bound `handle` method of a handler class, or `null` when there is none.
 */
export type ErrorHandlerRef = ChoMessageErrorHandlerFn | null;

/** A node of the message graph that has a topic, middlewares and an error handler. */
export abstract class NodeRef {
  /** The topic of the node, relative to its parent; `""` when it has none. */
  readonly topic: string;
  /** The middlewares of the node, created and in order. */
  readonly middlewares: ChoMessageMiddlewareFn[];
  /** The error handler of the node, or `null` when it has none. */
  readonly errorHandler: ErrorHandlerRef;

  /**
   * Create a node.
   *
   * @param topic The topic of the node, relative to its parent.
   * @param middlewares The middlewares of the node.
   * @param errorHandler The error handler of the node, or `null`.
   */
  constructor(
    topic: string,
    middlewares: ChoMessageMiddlewareFn[],
    errorHandler: ErrorHandlerRef,
  ) {
    this.topic = topic;
    this.middlewares = middlewares;
    this.errorHandler = errorHandler;
  }
}

/** A message handler: a controller method marked with `@Subscribe`. */
export class MethodRef extends NodeRef {
  /** The name of the method on the controller. */
  readonly name: string;
  /**
   * Calls the method on its controller instance, with the context of a
   * message alone: it evaluates the arguments of `@Args` itself, and
   * validates them when {@link validated} is `true`.
   */
  readonly handler: ChoMessageHandler;
  /**
   * The arguments of the handler, as given to `@Args`, in order; empty when
   * it has none. An argument made by `Value`, `Key` or `Header` has an
   * `info`: its source, its key and its validator.
   */
  readonly args: readonly ChoMessageArg[];
  /**
   * Whether the validation middleware covers the handler: whether
   * `validate()` is among the middlewares of the feature, of the controller
   * or of the handler. The validators of {@link args} are run only then.
   */
  readonly validated: boolean;
  /**
   * The contract of the handler, when `@Subscribe` was given one: its whole
   * topic, and the validators of its request and of its reply.
   */
  readonly contract: Contract<unknown, unknown> | undefined;

  /**
   * Create a message handler node.
   *
   * @param name The name of the method on the controller.
   * @param topic The topic of the handler, relative to its controller.
   * @param middlewares The middlewares of the method.
   * @param errorHandler The error handler of the method, or `null`.
   * @param handler Calls the method on its controller instance.
   * @param args The arguments of the handler. Default: none.
   * @param validated Whether the validation middleware covers the handler.
   *   Default: `false`.
   * @param contract The contract of the handler. Default: none.
   */
  constructor(
    name: string,
    topic: string,
    middlewares: ChoMessageMiddlewareFn[],
    errorHandler: ErrorHandlerRef,
    handler: ChoMessageHandler,
    args: readonly ChoMessageArg[] = [],
    validated = false,
    contract?: Contract<unknown, unknown>,
  ) {
    super(topic, middlewares, errorHandler);
    this.name = name;
    this.handler = handler;
    this.args = args;
    this.validated = validated;
    this.contract = contract;
  }
}

/** A controller, with its instance and its message handlers. */
export class ControllerRef extends NodeRef {
  /** The controller instance, created by the injector. */
  readonly instance: object;
  /** The message handlers of the controller, in declaration order. */
  readonly methods: MethodRef[];

  /**
   * Create a controller node, with no message handlers yet.
   *
   * @param topic The topic of the controller, relative to its feature.
   * @param middlewares The middlewares of the controller.
   * @param errorHandler The error handler of the controller, or `null`.
   * @param instance The controller instance.
   */
  constructor(
    topic: string,
    middlewares: ChoMessageMiddlewareFn[],
    errorHandler: ErrorHandlerRef,
    instance: object,
  ) {
    super(topic, middlewares, errorHandler);
    this.instance = instance;
    this.methods = [];
  }
}

/** A feature: a module that declares controllers. */
export class FeatureRef extends NodeRef {
  /** The controllers of the feature that have message handlers. */
  readonly controllers: ControllerRef[];

  /**
   * Create a feature node, with no controllers yet.
   *
   * @param topic The topic of the feature, relative to the global prefix.
   * @param middlewares The middlewares of the feature module.
   * @param errorHandler The error handler of the feature module, or `null`.
   */
  constructor(
    topic: string,
    middlewares: ChoMessageMiddlewareFn[],
    errorHandler: ErrorHandlerRef,
  ) {
    super(topic, middlewares, errorHandler);
    this.controllers = [];
  }
}

/** The root of the message graph: the application. */
export class AppRef {
  /** The global topic prefix; `""` when there is none. */
  readonly topic: string;
  /**
   * The error handler of the application (the `onError` option of
   * `ChoMessage.create`), or `null` when it has none. It handles the errors
   * of the handlers that no `@Catch` handler covers.
   */
  readonly errorHandler: ErrorHandlerRef;
  /** The features of the application. */
  readonly features: FeatureRef[];

  /**
   * Create the application node, with no features yet.
   *
   * @param topic The global topic prefix.
   * @param errorHandler The error handler of the application, or `null`.
   */
  constructor(topic: string, errorHandler: ErrorHandlerRef = null) {
    this.topic = topic;
    this.errorHandler = errorHandler;
    this.features = [];
  }
}
