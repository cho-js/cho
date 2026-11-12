/**
 * The metadata graph: the decorator records of an application, read and
 * normalized.
 *
 * Building an injector starts here. {@link build_meta_graph} starts from the
 * root module and follows its `imports`, depth first, reading the record each
 * decorator wrote (see `metadata.ts`). Along the way it:
 *
 * - **validates** the declarations: every import must be a `@Module`, every
 *   class in `providers` an `@Injectable`, every class in `controllers` a
 *   `@Controller`, and imports must not form a cycle;
 * - **normalizes** every declaration into a {@link Provider}: a class becomes a
 *   provider whose token is the class, whose dependencies are the ones it
 *   declared, and whose factory constructs it;
 * - **deduplicates** modules: a module imported through several paths is read
 *   once and shared.
 *
 * The records store the DI data under private symbol keys (`keys.ts`). The
 * normalized metadata exposes it as plain, typed fields, so CHO modules never
 * need those keys. The other keys of a record (user options, and what CHO
 * modules' own decorators wrote) are passed on as they are.
 *
 * The result is the input of the dependency graph (`dependency-graph.ts`),
 * which resolves every dependency to the provider that satisfies it.
 *
 * @module
 */

import type {
  ChoErrorHandler,
  ChoMiddleware,
  Ctr,
  Factory,
  Provider,
  Token,
} from "./types.ts";
import { own_keys, read_metadata_object } from "./metadata.ts";
import {
  CONTROLLER,
  type ControllerRecord,
  CONTROLLERS,
  CORE_KEYS,
  DEPENDENCIES,
  ERROR_HANDLER,
  EXPORTS,
  type HandlersRecord,
  IMPORTS,
  INJECTABLE,
  type InjectableRecord,
  MIDDLEWARES,
  MODULE,
  type ModuleRecord,
  PROVIDERS,
} from "./keys.ts";
import { provider } from "./tokens.ts";

// Types
// -----------------------------------------------------------------------------

/**
 * What `@Middlewares` and `@Catch` declared on a module, a controller or a
 * method. The DI system only stores them; the CHO module that runs the class
 * or method uses them.
 */
export type HandlersMetadata = {
  /** The middlewares of `@Middlewares`, in source order; `[]` when none. */
  middlewares: readonly ChoMiddleware[];
  /** The error handler of `@Catch`, or `undefined` when none. */
  errorHandler: ChoErrorHandler | undefined;
};

/**
 * A method of a controller that carries metadata: what CHO modules' own
 * decorators wrote on it (such as `@Action`), and its middlewares and error
 * handler.
 */
export type MethodMetadata = HandlersMetadata & {
  /** The method name. */
  name: string;
  /**
   * The method's record, as CHO modules' decorators wrote it, without the
   * core's own keys. Each CHO module reads its own keys from it.
   */
  meta: Readonly<Record<PropertyKey, unknown>>;
};

/**
 * A normalized declaration: anything that provides a value.
 *
 * Provider objects listed in a module's `providers` are kept as they are.
 * Classes are normalized into the more specific {@link InjectableMetadata},
 * {@link ControllerMetadata} and {@link ModuleMetadata}.
 */
export type ProviderMetadata = {
  /** Marks the record as a normalized declaration. */
  isProvider: true;
  /** How to create the value: token, dependencies and factory. */
  provider: Provider;
};

/**
 * A normalized injectable class. Its provider constructs the class with the
 * dependencies it declared.
 */
export type InjectableMetadata = ProviderMetadata & {
  /** Marks the declaration as an injectable class. */
  isInjectable: true;
};

/**
 * A normalized `@Controller` class.
 *
 * Besides the fields below, it keeps the other keys of the controller's
 * record as they are: the extra `@Controller` options (string keys, such as
 * `route`) and what CHO modules' own decorators wrote on the class. The DI
 * system ignores them; they are for the CHO module that invokes the
 * controller. The fields below always win over a record key of the same name.
 */
export type ControllerMetadata = InjectableMetadata & HandlersMetadata & {
  /** Marks the declaration as a controller. */
  isController: true;
  /**
   * The controller's methods that carry metadata, in declaration order.
   * Methods without metadata are left out.
   */
  methods: readonly MethodMetadata[];
  /** Any other key of the controller's record, as is. */
  readonly [key: string]: unknown;
  /** CHO modules' own keys on the controller's record, as is. */
  readonly [key: symbol]: unknown;
};

/**
 * A normalized `@Module` class, with everything it declares.
 *
 * Besides the fields below, it keeps the other keys of the module's record as
 * they are: the extra `@Module` options (string keys, such as `route`) and
 * what CHO modules' own decorators wrote on the class. The DI system ignores
 * them; they are for the CHO module. The fields below always win over a
 * record key of the same name.
 */
export type ModuleMetadata = InjectableMetadata & HandlersMetadata & {
  /** Marks the declaration as a module. */
  isModule: true;
  /** The imported modules, normalized, in `imports` order. */
  imports: readonly ModuleMetadata[];
  /** The tokens this module exports, as declared. */
  exports: readonly Token[];
  /** The declared providers, normalized, in `providers` order. */
  providers: readonly (InjectableMetadata | ProviderMetadata)[];
  /** The declared controllers, normalized, in `controllers` order. */
  controllers: readonly ControllerMetadata[];
  /** Any other key of the module's record, as is. */
  readonly [key: string]: unknown;
  /** CHO modules' own keys on the module's record, as is. */
  readonly [key: symbol]: unknown;
};

/** The normalized metadata of an application, from its root module. */
export type MetadataGraph = {
  /** Every module reachable from the root, each read once. */
  modules: Map<Ctr, ModuleMetadata>;
  /** The root module. */
  root: ModuleMetadata;
};

// Normalization
// -----------------------------------------------------------------------------

/**
 * The factory of a class: constructs it with the resolved dependencies as
 * constructor arguments.
 *
 * The factory is `async` so that a constructor that throws produces a rejected
 * promise, like any other failing factory, rather than a synchronous
 * exception.
 *
 * @param ctr The class to construct.
 * @returns The factory.
 */
function class_factory(ctr: Ctr): Factory {
  // deno-lint-ignore require-await
  return async (...args: unknown[]) => Reflect.construct(ctr, args);
}

/**
 * The keys of a record that are not the core's: user options and CHO
 * modules' own keys.
 *
 * @param record A class or method record.
 * @returns A copy of the record without the core's keys.
 */
function extras(record: object): Record<PropertyKey, unknown> {
  const out: Record<PropertyKey, unknown> = {};
  for (const key of own_keys(record)) {
    if (!CORE_KEYS.has(key)) {
      out[key] = (record as Record<PropertyKey, unknown>)[key];
    }
  }
  return out;
}

/**
 * The middlewares and error handler of a record.
 *
 * @param record A class or method record.
 * @returns Its `@Middlewares` and `@Catch` data, normalized.
 */
function handlers(record: HandlersRecord): HandlersMetadata {
  return {
    middlewares: record[MIDDLEWARES] ?? [],
    errorHandler: record[ERROR_HANDLER],
  };
}

/**
 * Normalize a `controllers` entry.
 *
 * @param ctr The entry: must be a `@Controller` class.
 * The other keys of the controller's record are kept, so the CHO module can
 * read its options. The normalized fields are set after them, so a record key
 * can never override them (an option named `provider`, for example).
 *
 * @returns The controller's normalized metadata, including the metadata of its
 *   methods and every key of its record.
 * @throws {TypeError} When the entry is not a class.
 * @throws {Error} When the class is not decorated with `@Controller`.
 */
function controller_metadata(ctr: Ctr): ControllerMetadata {
  if (typeof ctr !== "function") {
    throw new TypeError(`Expected a controller class, got ${typeof ctr}`);
  }

  const record = read_metadata_object<ControllerRecord>(ctr);
  if (!record?.[CONTROLLER]) {
    throw new Error(
      `Class ${ctr.name} is not a controller. Did you forget @Controller?`,
    );
  }

  // Own prototype methods only (inherited methods are not collected), and
  // only those an application module attached metadata to.
  const methods = Object.entries(
    Object.getOwnPropertyDescriptors(ctr.prototype),
  )
    .filter(([name]) => name !== "constructor")
    .filter(([, descriptor]) => typeof descriptor.value === "function")
    .flatMap(([name, descriptor]): MethodMetadata[] => {
      const method = read_metadata_object<HandlersRecord>(descriptor.value);
      return method
        ? [{ name, meta: extras(method), ...handlers(method) }]
        : [];
    });

  return {
    // the other keys first: the normalized fields below always win
    ...extras(record),
    isProvider: true,
    isInjectable: true,
    isController: true,
    ...handlers(record),
    methods,
    provider: provider({
      provide: ctr,
      deps: record[DEPENDENCIES],
      factory: class_factory(ctr),
    }),
  } satisfies ControllerMetadata;
}

/**
 * Normalize a `providers` entry.
 *
 * @param p The entry: an `@Injectable` class, or a provider object. Provider
 *   objects are taken as they are.
 * @returns The normalized declaration: {@link InjectableMetadata} for a class,
 *   {@link ProviderMetadata} for a provider object.
 * @throws {Error} When the entry is a class that is not decorated with
 *   `@Injectable` (or `@Module` / `@Controller`, which are injectable too).
 */
function provider_metadata(
  p: Provider | Ctr,
): ProviderMetadata | InjectableMetadata {
  if (typeof p === "function") {
    const record = read_metadata_object<InjectableRecord>(p);
    if (!record?.[INJECTABLE]) {
      throw new Error(
        `Class ${p.name} is not injectable. Did you forget @Injectable?`,
      );
    }
    return {
      isProvider: true,
      isInjectable: true,
      provider: provider({
        provide: p,
        deps: record[DEPENDENCIES],
        factory: class_factory(p),
      }),
    } satisfies InjectableMetadata;
  }
  return {
    isProvider: true,
    provider: p,
  } satisfies ProviderMetadata;
}

/**
 * Normalize a module and, first, everything it imports.
 *
 * @param mdl The module class.
 * @param modules The modules normalized so far, shared by the whole build. A
 *   module already in it is returned as is, so a module imported through
 *   several paths is normalized once.
 * @param path The chain of imports that led to `mdl`, from the root, used to
 *   detect circular imports.
 * @returns The module's normalized metadata.
 * @throws {TypeError} When `mdl` is not a class.
 * @throws {Error} When the imports are circular, when a class is not
 *   decorated with `@Module`, or when a `providers` or `controllers` entry is
 *   invalid.
 */
function module_metadata(
  mdl: Ctr,
  modules: Map<Ctr, ModuleMetadata>,
  path: Ctr[],
): ModuleMetadata {
  if (typeof mdl !== "function") {
    throw new TypeError(`Expected a module class, got ${typeof mdl}`);
  }

  // Checked before the cache: a module on the current path is still being
  // normalized, so it is not in `modules` yet.
  if (path.includes(mdl)) {
    const cycle = [...path, mdl].map((m) => m.name).join(" → ");
    throw new Error(`Circular dependency detected: ${cycle}`);
  }

  const known = modules.get(mdl);
  if (known) {
    return known;
  }

  const record = read_metadata_object<ModuleRecord>(mdl);
  if (!record?.[MODULE]) {
    throw new Error(
      `Class ${mdl.name} is not a module. Did you forget @Module?`,
    );
  }

  const moduleMeta: ModuleMetadata = {
    // the record's other keys first: the normalized fields below always win
    ...extras(record),
    isModule: true,
    isInjectable: true,
    isProvider: true,
    ...handlers(record),
    exports: record[EXPORTS],
    imports: record[IMPORTS].map((imp) =>
      module_metadata(imp, modules, [...path, mdl])
    ),
    providers: record[PROVIDERS].map(provider_metadata),
    controllers: record[CONTROLLERS].map(controller_metadata),
    provider: provider({
      provide: mdl,
      deps: record[DEPENDENCIES],
      factory: class_factory(mdl),
    }),
  };

  modules.set(mdl, moduleMeta);
  return moduleMeta;
}

/**
 * Read and normalize the metadata of an application, starting from its root
 * module.
 *
 * @param ctr The root module class.
 * @returns The metadata graph: the root module and every module it imports,
 *   directly or not. In `modules`, imported modules come before the modules
 *   that import them, and the root comes last.
 * @throws {Error} On any invalid declaration (see {@link module_metadata}).
 *
 * @example
 * ```ts
 * const graph = build_meta_graph(AppModule);
 * graph.root.providers; // the normalized providers of AppModule
 * ```
 */
export function build_meta_graph(ctr: Ctr): MetadataGraph {
  const modules = new Map<Ctr, ModuleMetadata>();
  const root = module_metadata(ctr, modules, []);
  return { modules, root };
}
