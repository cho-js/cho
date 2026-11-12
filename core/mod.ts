/**
 * @chojs/core — core building blocks of the CHO framework.
 *
 * @example
 * ```ts
 * import { Injectable, Module } from "@chojs/core";
 *
 * @Injectable()
 * class Logger {}
 *
 * @Module({ providers: [Logger] })
 * class AppModule {}
 * ```
 * @module
 */

export * from "./di/decorators.ts";
export * from "./di/injector.ts";
export { provider, token } from "./di/tokens.ts";
export type { Any, Ctr, Target } from "./di/types.ts";
// The types the exports above refer to, so that each of them can be named
// from this entry point.
export type { InjectableOptions } from "./di/decorations.ts";
export type {
  ControllerMetadata,
  HandlersMetadata,
  InjectableMetadata,
  MethodMetadata,
  ModuleMetadata,
  OptionsMetadata,
  ProviderMetadata,
} from "./di/metadata-graph.ts";
export type {
  ChoClassOrMethodDecorator,
  ChoErrorHandler,
  ChoInjectableDecorator,
  ChoMiddleware,
  Dependency,
  InjectedArgs,
  InjectionToken,
  Provider,
  Token,
} from "./di/types.ts";
