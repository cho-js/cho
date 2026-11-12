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
 * The result is the input of the dependency graph (`dependency-graph.ts`),
 * which resolves every dependency to the provider that satisfies it.
 *
 * @module
 */

import type { Ctr, Factory, Provider, Token } from "./types.ts";
import type {
  ControllerDescriptor,
  InjectableDescriptor,
  ModuleDescriptor,
} from "./metadata.ts";
import { read_metadata_object } from "./metadata.ts";
import { provider } from "./tokens.ts";

// Types
// -----------------------------------------------------------------------------

/**
 * Metadata that an application module attached to a method of a controller,
 * such as the description of a CLI command.
 */
export type MethodMetadata = {
  /** The method name. */
  name: string;
  /** The metadata record attached to the method. */
  meta: Record<string, unknown>;
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
 * Besides the keys below, it keeps every other key of the controller's record
 * as is: the extra `@Controller` options and what other decorators wrote on
 * the class (such as `errorHandler` from `@Catch`, `middlewares` from
 * `@Middlewares`, or an application module's own keys). The DI system ignores
 * them; they are for the application module that invokes the controller.
 */
export type ControllerMetadata = InjectableMetadata & {
  /** Marks the declaration as a controller. */
  isController: true;
  /**
   * The controller's methods that carry metadata, in declaration order.
   * Methods without metadata are left out.
   */
  methods: readonly MethodMetadata[];
  /** Any other key of the controller's record, as is. */
  readonly [key: string]: unknown;
};

/**
 * A normalized `@Module` class, with everything it declares.
 *
 * Besides the keys below, it keeps every other key of the module's record as
 * is: the extra `@Module` options and what other decorators wrote on the class
 * (such as `errorHandler` from `@Catch` or `middlewares` from `@Middlewares`).
 * The DI system ignores them; they are for the application module.
 */
export type ModuleMetadata = InjectableMetadata & {
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
 * Normalize a `controllers` entry.
 *
 * @param ctr The entry: must be a `@Controller` class.
 * Every key of the controller's record is kept, so the application module can
 * read its options. The normalized keys are set after them, so a record key
 * can never override them (an option named `isController` or `provider`, for
 * example).
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

  const meta = read_metadata_object<ControllerDescriptor>(ctr);
  if (!meta?.isController) {
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
    .map(([name, descriptor]) => ({
      name,
      meta: read_metadata_object(descriptor.value),
    }))
    .filter(({ meta }) => meta !== undefined) as MethodMetadata[];

  return {
    // the user's options first: the normalized keys below always win
    ...meta,
    isProvider: true,
    isInjectable: true,
    isController: true,
    methods,
    provider: provider({
      provide: ctr,
      deps: meta.dependencies,
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
    const meta = read_metadata_object<InjectableDescriptor>(p);
    if (!meta?.isInjectable) {
      throw new Error(
        `Class ${p.name} is not injectable. Did you forget @Injectable?`,
      );
    }
    return {
      isProvider: true,
      isInjectable: true,
      provider: provider({
        provide: p,
        deps: meta.dependencies,
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

  const meta = read_metadata_object<ModuleDescriptor>(mdl);
  if (!meta?.isModule) {
    throw new Error(
      `Class ${mdl.name} is not a module. Did you forget @Module?`,
    );
  }

  const moduleMeta: ModuleMetadata = {
    // the record's other keys first: the normalized keys below always win
    ...meta,
    isModule: true,
    isInjectable: true,
    isProvider: true,
    exports: meta.exports,
    imports: meta.imports.map((imp) =>
      module_metadata(imp, modules, [...path, mdl])
    ),
    providers: meta.providers.map(provider_metadata),
    controllers: meta.controllers.map(controller_metadata),
    provider: provider({
      provide: mdl,
      deps: meta.dependencies,
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
