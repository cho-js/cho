import type { Any, Target } from "@chojs/core/meta";
import type {
  ChoEndpointFn,
  ChoErrorHandlerFn,
  ChoMiddlewareFn,
} from "@chojs/core/di";
import type { ChoWebContext } from "./context.ts";

/**
 * The main adapter interface that all framework adapters should implement
 * The extended adapter includes optional methods for specialized adapters
 */
export type ChoWebAdapter<
  Application = Any,
  Feature = Any,
  Controller = Any,
  Middleware = Target,
  Endpoint = Target,
  Ctx = Any,
> = {
  createContext(
    raw: Ctx,
  ): ChoWebContext;

  /**
   * Takes cho middleware and converts it to the framework's middleware
   * @param middleware
   */
  createMiddlewares(
    middleware: ChoMiddlewareFn[],
  ): Middleware[];

  /**
   * Takes cho endpoint and converts it to the framework's endpoint
   * @param endpoint
   */
  createEndpoint(
    endpoint: ChoEndpointFn,
  ): Endpoint;

  /**
   * Takes cho controller and converts it to the framework's controller
   * @param middlewares
   * @param errorHandler
   */
  createController(
    middlewares: Middleware[],
    errorHandler?: ChoErrorHandlerFn,
  ): Controller;

  /**
   * Takes cho feature and converts it to the framework's feature
   * @param middlewares
   * @param errorHandler
   */
  createFeature(
    middlewares: Middleware[],
    errorHandler?: ChoErrorHandlerFn,
  ): Feature;

  /**
   * Mounts an endpoint to a controller
   * @param ctr
   * @param middlewares
   * @param endpoint
   * @param route
   * @param httpMethod
   */
  mountEndpoint(
    ctr: Controller,
    middlewares: Middleware[],
    endpoint: Endpoint,
    route: string,
    httpMethod: string,
  ): void;

  /**
   * Mounts a controller to a feature
   * @param feat
   * @param controller
   * @param route
   */
  mountController(
    feat: Feature,
    controller: Controller,
    route: string,
  ): void;

  /**
   * Mounts a sub-feature to a feature
   * @param feat
   * @param feature
   * @param route
   */
  mountFeature(
    feat: Feature,
    feature: Feature,
    route: string,
  ): void;

  /**
   * Mounts a top-level feature to the application
   * @param feature
   * @param route
   */
  mountApp<R = Application>(
    feature: Feature,
    route: string,
  ): R;

  // optional extended methods for specialized adapters

  /**
   * Creates an SSE endpoint from a cho endpoint function
   * @param endpoint
   */
  createSseEndpoint?: (endpoint: ChoEndpointFn) => Endpoint;

  /**
   * Creates a text stream endpoint from a cho endpoint function
   * @param endpoint
   */
  createStreamEndpoint?: (endpoint: ChoEndpointFn) => Endpoint;

  /**
   * Creates a text stream endpoint from a cho endpoint function
   * @param endpoint
   */
  createTextStreamEndpoint?: (endpoint: ChoEndpointFn) => Endpoint;
};
