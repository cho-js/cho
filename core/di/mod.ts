/**
 * Dependency injection (DI) for the CHO framework.
 *
 * Classes declare what they need with decorators, modules group them and
 * control what other modules can use, and an {@link Injector} creates
 * everything in the right order, each instance once.
 *
 * ## Quick start
 *
 * ```ts
 * import { Injectable, Injector, Module, provider, token } from "@chojs/core";
 *
 * const GREETING = token<string>("greeting");
 *
 * @Module({
 *   providers: [provider({ provide: GREETING, factory: () => Promise.resolve("hello") })],
 *   exports: [GREETING],
 * })
 * class GreetingModule {}
 *
 * @Injectable([GREETING])
 * class Greeter {
 *   constructor(readonly greeting: string) {}
 * }
 *
 * @Module({ imports: [GreetingModule], providers: [Greeter] })
 * class App {}
 *
 * const injector = new Injector(App);
 * await injector.init();
 * const greeter = await injector.resolve(Greeter); // greeter.greeting === "hello"
 * ```
 *
 * ## Concepts
 *
 * - **Token**: what identifies something injectable: a class, an injection
 *   token made with `token<T>()`, or a symbol.
 * - **Provider**: how to create a token's value: a factory and the
 *   dependencies it receives. An `@Injectable` class is a provider of itself.
 * - **Module**: a group of providers and controllers. A module can inject what
 *   it declares and what its imports export; other modules can inject only
 *   what it exports.
 * - **Controller**: an entry point of the application (such as a CLI
 *   command), declared by a module and created by the injector.
 *
 * ## How it works
 *
 * Creating an injector runs a pipeline. The first three steps are synchronous
 * and throw on any error, so a misconfigured application fails before
 * anything is created:
 *
 * 1. **Declare** (`decorators.ts`, `metadata.ts`): decorators write a record
 *    on each class.
 * 2. **Read** (`metadata-graph.ts`): starting from the root module, the
 *    records are read, validated and normalized into providers.
 * 3. **Link** (`dependency-graph.ts`): every dependency is resolved to the
 *    declaration that provides it, following the module scope rules, and
 *    ambiguous, duplicate, missing and circular dependencies are rejected.
 * 4. **Create** (`injector.ts`): instances are created asynchronously, each
 *    after its dependencies, at most once per injector.
 *
 * @module
 */

export {
  Catch,
  Controller,
  Injectable,
  Middlewares,
  Module,
} from "./decorators.ts";
export type {
  ControllerOptions,
  InjectableOptions,
  ModuleOptions,
} from "./decorations.ts";
export { Injector } from "./injector.ts";
export { isToken, provider, token } from "./tokens.ts";
export type {
  AbstractCtr,
  ChoClassDecorator,
  ChoClassOrMethodDecorator,
  ChoErrorHandler,
  ChoMethodDecorator,
  ChoMiddleware,
  Ctr,
  Dependency,
  Factory,
  InjectionToken,
  Provider,
  Resolved,
  ResolvedAll,
  Token,
} from "./types.ts";
// The graph types are public because `Injector.graph` exposes the graph.
export type {
  ControllerMetadata,
  InjectableMetadata,
  MethodMetadata,
  ModuleMetadata,
  ProviderMetadata,
} from "./metadata-graph.ts";
export type {
  DependencyGraph,
  DependencyNode,
  ModuleScope,
} from "./dependency-graph.ts";
export * from "./metadata.ts";
export * from "./decorations.ts";
