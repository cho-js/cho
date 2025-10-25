import type { Any, Ctr, Target } from "../meta/mod.ts";

/**
 * Token type for dependency injection.
 * It can be a string, symbol, or a class constructor.
 * @internal
 */
export type Token = string | symbol | Ctr;

/**
 * Resolver interface for resolving dependencies.
 * It defines a method to resolve a token to its value.
 * Implemented by the Injector class.
 * @internal
 */
export type Resolver = { resolve: <T>(token: Token) => Promise<T> };

/**
 * Factory type for creating instances of a dependency from a token.
 * @internal
 */
export type Factory<T = Any> = (injector: Resolver) => T;

/**
 * Provider type for defining how to provide a dependency.
 * It includes a token to identify the dependency and a factory function to create the instance.
 * The factory function receives a Resolver to resolve any dependencies needed to create the instance.
 * @internal
 */
export type Provider<T = Any> = {
  provide: Token;
  factory: Factory<T>;
};

/**
 * Injectable descriptor for defining dependencies of an injectable class.
 * It includes a list of tokens that the injectable depends on.
 * @internal
 */
export type InjectableDescriptor = {
  deps?: Token[];
};

/**
 * Module descriptor for defining imports and providers of a module.
 * It extends the InjectableDescriptor to include dependencies.
 * It includes a list of imported modules and a list of providers defined in the module.
 * @internal
 */
export type ModuleDescriptor = InjectableDescriptor & {
  route: string;
  imports: Ctr[];
  providers: (Provider | Ctr)[];
  controllers: Ctr[]; // AKA  gateways
  middlewares: (ChoMiddleware | ChoMiddlewareFn)[];
  errorHandler: ChoErrorHandler | ChoErrorHandlerFn;
  isModule: true;
};

/**
 * Descriptor for a controller class, combining injectable and routing metadata.
 */
export type ControllerDescriptor = InjectableDescriptor & {
  route: string;
  middlewares: (ChoMiddleware | ChoMiddlewareFn)[];
  errorHandler: ChoErrorHandler | ChoErrorHandlerFn;
  isGateway: true;
};

/**
 * Descriptor for a method within a controller, including routing and middleware information.
 */
export type MethodDescriptor = {
  route: string;
  middlewares: (ChoMiddleware | Target)[];
  errorHandler: ChoErrorHandler | ChoErrorHandlerFn;
  isMethod: true;
  type: string;
  name: string;
  args: InputFactory[];
};

// middlewares types

/**
 * A generic context type for middleware and handlers.
 */
export type Context<T = Any> = T;

/**
 * A factory function that produces an input value based on the given context.
 */
export type InputFactory = (c: Context) => Promise<unknown>;

/**
 * A function type representing an endpoint handler.
 */
export type ChoEndpointFn = {
  (ctx: Context): void | Response | Promise<void | Response>;
  (...args: unknown[]): void | Response | Promise<void | Response>;
};

/**
 * A function type representing the next middleware in the chain.
 */
export type Next = () => void | Promise<void>;

/**
 * A function type representing a middleware function.
 */
export type ChoMiddlewareFn = (
  ctx: Context,
  next: Next,
) => void | Response | Promise<void | Response>;

/**
 * An interface representing a middleware class.
 */
export interface ChoMiddleware {
  handle(ctx: Context, next: Next): Promise<void>;
}

// guards types

/**
 * A function type representing a guard function.
 */
export type ChoGuardFn = (ctx: Context) => boolean | Promise<boolean>;

/**
 * An interface representing a guard class.
 */
export interface ChoGuard {
  canActivate(ctx: Context): boolean | Promise<boolean>;
}

// error handlers types

/**
 * A function type representing an error handler function.
 */
export type ChoErrorHandlerFn = (
  err: Error,
  ctx: Context,
) => void | Response | Promise<void | Response>;

/**
 * An interface representing an error handler class.
 */
export interface ChoErrorHandler {
  catch(err: Error, ctx: Context): void | Response | Promise<void | Response>;
}
