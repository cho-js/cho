/**
 * The keys of the records the core decorators write, and the shape of those
 * records. Private to `@chojs/core`: not exported by any entry point.
 *
 * Every key the framework writes is a symbol, so a user option can never
 * collide with it: an object literal cannot hold one of these keys by
 * accident. User options (the extra `@Module` / `@Controller` options, such as
 * `route`) stay string keys in the same record.
 *
 * The keys are `Symbol.for("chojs.core.<key>")`, not `Symbol()`, for the same
 * reason the record itself is stored under `Symbol.for("chojs.meta")`: two
 * copies of the package in one application (two versions, say) must read each
 * other's records.
 *
 * CHO modules never read these keys: they read the normalized metadata graph
 * (`metadata-graph.ts`), which exposes the same data as plain, typed fields.
 *
 * @module
 */

import type {
  ChoErrorHandler,
  ChoMiddleware,
  Ctr,
  Dependency,
  Provider,
  Token,
} from "./types.ts";

/** Marks a class as injectable (`@Injectable`, `@Module`, `@Controller`). */
export const INJECTABLE: unique symbol = Symbol.for("chojs.core.isInjectable");
/** The constructor's dependencies, in argument order. */
export const DEPENDENCIES: unique symbol = Symbol.for(
  "chojs.core.dependencies",
);
/** Marks a class as a module (`@Module`). */
export const MODULE: unique symbol = Symbol.for("chojs.core.isModule");
/** The modules a module imports. */
export const IMPORTS: unique symbol = Symbol.for("chojs.core.imports");
/** The tokens a module exports. */
export const EXPORTS: unique symbol = Symbol.for("chojs.core.exports");
/** The providers a module declares. */
export const PROVIDERS: unique symbol = Symbol.for("chojs.core.providers");
/** The controllers a module declares. */
export const CONTROLLERS: unique symbol = Symbol.for("chojs.core.controllers");
/** Marks a class as a controller (`@Controller`). */
export const CONTROLLER: unique symbol = Symbol.for("chojs.core.isController");
/** The middlewares of a class or a method (`@Middlewares`). */
export const MIDDLEWARES: unique symbol = Symbol.for("chojs.core.middlewares");
/** The error handler of a class or a method (`@Catch`). */
export const ERROR_HANDLER: unique symbol = Symbol.for(
  "chojs.core.errorHandler",
);

/** Every core key: what the normalized graph leaves out of a record's keys. */
export const CORE_KEYS: ReadonlySet<PropertyKey> = new Set<PropertyKey>([
  INJECTABLE,
  DEPENDENCIES,
  MODULE,
  IMPORTS,
  EXPORTS,
  PROVIDERS,
  CONTROLLERS,
  CONTROLLER,
  MIDDLEWARES,
  ERROR_HANDLER,
]);

/**
 * What `@Middlewares` and `@Catch` write, on a class or a method. Any record
 * can have them.
 */
export type HandlersRecord = {
  /** The middlewares, in source order. */
  readonly [MIDDLEWARES]?: readonly ChoMiddleware[];
  /** The error handler. */
  readonly [ERROR_HANDLER]?: ChoErrorHandler;
};

/**
 * The record `@Injectable` writes on a class. It is also the base of the
 * `@Module` and `@Controller` records: modules and controllers are injectable
 * too.
 */
export type InjectableRecord = HandlersRecord & {
  /** Marks the class as injectable. */
  readonly [INJECTABLE]: true;
  /** The dependencies passed to the constructor, in argument order. */
  readonly [DEPENDENCIES]: readonly Dependency[];
};

/**
 * The record `@Controller` writes on a class. Its extra options are stored in
 * it too, as string keys.
 */
export type ControllerRecord = InjectableRecord & {
  /** Marks the class as a controller. */
  readonly [CONTROLLER]: true;
};

/**
 * The record `@Module` writes on a class. Its extra options are stored in it
 * too, as string keys.
 */
export type ModuleRecord = InjectableRecord & {
  /** Marks the class as a module. */
  readonly [MODULE]: true;
  /** Modules whose exported tokens this module can inject. */
  readonly [IMPORTS]: readonly Ctr[];
  /** Tokens that modules importing this module can inject. */
  readonly [EXPORTS]: readonly Token[];
  /** `@Injectable` classes and provider objects this module declares. */
  readonly [PROVIDERS]: readonly (Provider | Ctr)[];
  /** `@Controller` classes this module declares. */
  readonly [CONTROLLERS]: readonly Ctr[];
};
