/**
 * The injector: creates the instances of an application.
 *
 * An {@link Injector} is created for a root module. Its constructor builds and
 * validates the whole dependency graph, synchronously, so every wiring error
 * (a missing provider, a circular dependency, ...) is thrown right away.
 * Instances are created later, asynchronously:
 *
 * - {@link Injector.init} creates every module with everything it declares,
 *   imported modules first;
 * - {@link Injector.resolve} creates one token's value, and what it depends on.
 *
 * Each declaration is created at most once per injector, and its value is
 * shared by everything that depends on it.
 *
 * {@link Injector.dispose} releases what was created, in reverse order. The
 * injector never calls it itself: when the application ends is decided by
 * what runs it (a CHO module such as `@chojs/web`, or the application).
 *
 * ## Debug logging
 *
 * The injector logs to the `cho:di` debug context (see `debuglog`): enable it
 * with `CHO_DEBUG=1`, `CHO_DEBUGLOG=cho:di` or `CHO_DEBUGLOG=cho:*`. It logs
 * the modules of the graph once it is built, each module's initialization,
 * each `resolve()` call, and each declaration it creates, with timings and
 * failures. Each injector reads the environment when it is created.
 *
 * @module
 */

import type { Ctr, Provider, Token } from "./types.ts";
import {
  build_meta_graph,
  type ControllerMetadata,
  type MetadataGraph,
} from "./metadata-graph.ts";
import {
  ambiguity_error,
  build_dependency_graph,
  type DependencyGraph,
  type DependencyNode,
  type ModuleScope,
} from "./dependency-graph.ts";
import { describe } from "../utils/describe.ts";
import { type Debuglog, debuglog } from "../utils/debuglog.ts";

export type { DependencyGraph, DependencyNode, MetadataGraph, ModuleScope };

/**
 * The well-known symbols of explicit resource management, with the fallback
 * transpilers use on runtimes that do not have them yet.
 */
const AsyncDispose: symbol = Symbol.asyncDispose ??
  Symbol.for("Symbol.asyncDispose");
const Dispose: symbol = Symbol.dispose ?? Symbol.for("Symbol.dispose");

/** The error of `resolve()` and `init()` once the injector is disposed. */
const DISPOSED = "The injector is disposed";

/** Options of {@link Injector}. */
export type InjectorOptions = {
  /**
   * Providers that replace the declared providers of the same token, in every
   * module that declares one. For tests: swap a database, a clock or a remote
   * service for a fake, deep inside the module graph, without changing any
   * module.
   *
   * - An override replaces `providers` entries only (classes and provider
   *   objects), not controllers or modules.
   * - Its `deps` are resolved in the scope of the module that declares the
   *   provider it replaces, like any provider.
   * - An override that replaces nothing is an error.
   *
   * @example
   * ```ts
   * const injector = new Injector(App, {
   *   overrides: [provider({ provide: Db, factory: () => new FakeDb() })],
   * });
   * ```
   */
  overrides?: readonly Provider[];
};
/**
 * Creates and holds the instances of an application.
 *
 * Instances belong to the injector: two injectors created for the same root
 * module share nothing.
 *
 * Creation is memoized: each node's promise is stored before anything is
 * awaited, so concurrent and later requests for the same node share one
 * creation, and one instance. A failed creation is memoized too: every later
 * request for the node, or for anything that depends on it, gets the same
 * error. There is no retry: an application that must not run half-created
 * calls `init()` at startup and stops if it rejects.
 *
 * Every instance is a singleton of its injector, by design: request data
 * belongs to the request's context, not to the DI. Every dependency is
 * required.
 *
 * @example
 * ```ts
 * const injector = new Injector(AppModule);
 * await injector.init(); // create everything, imports first
 * const users = await injector.resolve(UserService);
 * ```
 */
export class Injector {
  /**
   * The normalized metadata of the application: every module reachable from
   * the root, read and validated by the constructor.
   */
  readonly meta: MetadataGraph;
  /** The dependency graph of the application, built by the constructor. */
  readonly graph: DependencyGraph;

  /** The creation of each node, started at most once. */
  readonly #instances = new Map<DependencyNode, Promise<unknown>>();

  /** The initialization of each module, started at most once. */
  readonly #modules = new Map<ModuleScope, Promise<void>>();

  /**
   * The nodes whose value was created, in the order they were: a node always
   * comes after the nodes it depends on. `dispose()` goes through it backwards.
   */
  readonly #created: [DependencyNode, unknown][] = [];

  /** The disposal, once `dispose()` was called. */
  #disposal: Promise<void> | undefined;

  /**
   * The `cho:di` debug logger. Created per injector, not when the module is
   * loaded, so it follows `set_env` and the environment at creation time.
   */
  readonly #log: Debuglog;

  /**
   * Build and validate the dependency graph of an application. Nothing is
   * created yet.
   *
   * @param root The root module class.
   * @param options The options: `overrides`, for tests.
   * @throws {Error} On any invalid declaration or wiring error, such as a
   *   class without its decorator, a dependency that is not provided, an
   *   ambiguous or duplicate token, or a circular dependency; and on an
   *   override that is invalid or replaces nothing.
   */
  constructor(root: Ctr, options: InjectorOptions = {}) {
    this.#log = debuglog("cho:di");
    const done = this.#log.start();
    try {
      this.meta = build_meta_graph(root, options.overrides);
      this.graph = build_dependency_graph(this.meta);
    } catch (error) {
      this.#log.error(`invalid graph of ${describe(root)}:`, error);
      throw error;
    }
    if (this.#log.enabled) {
      for (const scope of this.modules()) {
        const declared = [...scope.visible.values()].filter((node) =>
          node.owner === scope.ctr
        );
        const imports = scope.imports.map((imp) => describe(imp.ctr));
        this.#log(
          `module ${describe(scope.ctr)}: ${declared.length} declarations` +
            (imports.length ? `, imports ${imports.join(", ")}` : ""),
        );
      }
      done(
        `graph of ${describe(root)} built: ${this.graph.modules.size} modules`,
      );
    }
  }

  /**
   * Create every module with everything it declares: its providers, its
   * controllers and the module itself.
   *
   * A module is initialized only after all the modules it imports are, so
   * imported modules are always ready first. Modules that do not depend on
   * each other are initialized in parallel. Within a module, each node is
   * created after its own dependencies.
   *
   * This is part of the application lifecycle and should be called before
   * any `resolve()`. It is not strictly necessary, since `resolve()` creates
   * what it needs, but it creates everything eagerly, so any error surfaces at
   * startup. It is safe to call more than once, or while `resolve()` calls are
   * in flight: nothing is created twice.
   *
   * @returns A promise that resolves when everything is created.
   * @throws {Error} (as a rejection) When a factory fails:
   *   `Failed to create X in module M`, with the original error as `cause`;
   *   and when the injector is disposed.
   */
  async init(): Promise<void> {
    if (this.#disposal) {
      throw new Error(DISPOSED);
    }
    await this.#init_module(this.graph.root);
  }

  /**
   * Release everything the injector created.
   *
   * It waits for the creations in flight, then goes through the created
   * values in reverse creation order, so a value is always disposed before
   * what it depends on. A value is disposed by its own
   * `[Symbol.asyncDispose]()` or, without one, `[Symbol.dispose]()`: the
   * standard methods of explicit resource management (`using`). Values that
   * have neither are skipped. A value provided under several tokens is
   * disposed once.
   *
   * ```ts
   * @Injectable()
   * class Db {
   *   async [Symbol.asyncDispose]() {
   *     await this.connection.close();
   *   }
   * }
   * ```
   *
   * The injector never disposes on its own: call this when the application
   * ends (CHO modules do, in their `close()`). Disposal is final: afterwards
   * `resolve()` and `init()` reject, and an `init()` that was still running
   * creates nothing more. Calling it again returns the same disposal.
   *
   * A value that fails to dispose does not stop the others.
   *
   * @returns A promise that resolves when every value is disposed.
   * @throws {AggregateError} (as a rejection) When values failed to dispose:
   *   one `Failed to dispose X in module M` error for each, with the original
   *   error as `cause`.
   *
   * @example
   * ```ts
   * const injector = new Injector(App);
   * try {
   *   await injector.init();
   *   // ... run the application
   * } finally {
   *   await injector.dispose();
   * }
   * ```
   *
   * @example With `await using`
   * ```ts
   * await using injector = new Injector(App);
   * const users = await injector.resolve(UserService);
   * // disposed when the block ends
   * ```
   */
  dispose(): Promise<void> {
    return this.#disposal ??= this.#dispose();
  }

  /** Dispose the injector at the end of an `await using` block. */
  [Symbol.asyncDispose](): Promise<void> {
    return this.dispose();
  }

  /** What `dispose()` does, once. */
  async #dispose(): Promise<void> {
    const done = this.#log.start();
    // This is the whole set: a creation in flight already asked for its
    // dependencies (see `#create`), and `#instantiate` starts nothing new
    // once the disposal has begun, not even for an `init()` still running.
    await Promise.allSettled(this.#instances.values());

    const disposed = new Set<unknown>();
    const errors: Error[] = [];
    for (const [node, value] of this.#created.reverse()) {
      if (
        (typeof value !== "object" && typeof value !== "function") ||
        value === null || disposed.has(value)
      ) {
        continue;
      }
      disposed.add(value);
      const holder = value as Record<symbol, unknown>;
      const method = holder[AsyncDispose] ?? holder[Dispose];
      if (typeof method !== "function") {
        continue;
      }
      const name = `${describe(node.token)} in module ${describe(node.owner)}`;
      try {
        await method.call(value);
        this.#log(`disposed ${name}`);
      } catch (cause) {
        this.#log.error(`failed to dispose ${name}:`, cause);
        errors.push(new Error(`Failed to dispose ${name}`, { cause }));
      }
    }
    this.#created.length = 0;
    done("disposed");
    if (errors.length > 0) {
      throw new AggregateError(
        errors,
        `Failed to dispose ${errors.length} of the injector's instances`,
      );
    }
  }

  /**
   * Get the value of a token, creating it, and what it depends on, if needed.
   *
   * The token is looked up in the scope of a module: what that module declares
   * and what its imports export. It defaults to the root module.
   *
   * Every failure, a failed lookup included, is reported as a rejected
   * promise: the method never throws synchronously.
   *
   * @typeParam T The value type, inferred from the token.
   * @param token The token to resolve.
   * @param module The module whose scope is searched. Defaults to the root.
   * @returns The value of the token. The same value for every call.
   * @throws {Error} (as a rejection) When `module` is not part of the
   *   application, when the token is not visible in its scope, when it is
   *   ambiguous there (two imports export different instances of it), when
   *   a factory fails (`Failed to create X in module M`, with `cause`), or
   *   when the injector is disposed.
   *
   * @example
   * ```ts
   * const users = await injector.resolve(UserService);
   * const url = await injector.resolve(API_URL); // string
   * const cli = await injector.resolve(Cli, CliModule); // in CliModule's scope
   * ```
   */
  resolve<T>(token: Token<T>, module?: Ctr): Promise<T> {
    if (this.#disposal) {
      return this.#reject(new Error(DISPOSED));
    }
    const scope = module ? this.graph.modules.get(module) : this.graph.root;
    if (!scope) {
      return this.#reject(
        new Error(`${describe(module)} is not part of this application`),
      );
    }
    this.#log(`resolve ${describe(token)} in module ${describe(scope.ctr)}`);
    const node = scope.visible.get(token);
    if (!node) {
      return this.#reject(
        ambiguity_error(scope, token) ??
          new Error(
            `${describe(token)} is not visible in module ${
              describe(scope.ctr)
            }`,
          ),
      );
    }
    return this.#instantiate(node) as Promise<T>;
  }

  /**
   * Log a failed lookup of `resolve()`, and reject with it.
   *
   * @param error The error.
   * @returns A promise rejected with the error.
   */
  #reject(error: Error): Promise<never> {
    this.#log.error(`resolve failed: ${error.message}`);
    return Promise.reject(error);
  }

  /**
   * Start initializing a module, or return the initialization already
   * started.
   *
   * Same pattern as `#instantiate`: the promise is stored
   * synchronously, so a module imported by several modules is initialized
   * once, even when they reach it at the same time.
   *
   * @param scope The module to initialize.
   * @returns The module's initialization.
   */
  #init_module(scope: ModuleScope): Promise<void> {
    let ready = this.#modules.get(scope);
    if (!ready) {
      ready = this.#create_module(scope);
      this.#modules.set(scope, ready);
    }
    return ready;
  }

  /**
   * Initialize a module: its imports first, then every node it declares.
   *
   * @param scope The module to initialize.
   */
  async #create_module(scope: ModuleScope): Promise<void> {
    // Imports first: a module is never created before the modules it imports.
    // Imports form a DAG (circular imports are rejected when the graph is
    // built), so this recursion ends. Sibling imports initialize in parallel.
    await Promise.all(scope.imports.map((imp) => this.#init_module(imp)));
    const done = this.#log.start();

    // Then everything this module declares. `visible` also holds the nodes of
    // imported modules, so keep only the nodes this module owns.
    // `#instantiate` creates each one after its own dependencies.
    const declared = [...scope.visible.values()].filter((node) =>
      node.owner === scope.ctr
    );
    await Promise.all(declared.map((node) => this.#instantiate(node)));
    done(`module ${describe(scope.ctr)} initialized`);
  }

  /**
   * Start creating a node, or return the creation already started.
   *
   * The promise is stored before anything is awaited, so concurrent requests
   * for the node share one creation. This relies on the graph being acyclic:
   * a node is never requested again while its own creation is being set up.
   *
   * Once the injector is disposed, a node that was not started is not
   * created: the request rejects.
   *
   * @param node The node to create.
   * @returns The node's value.
   */
  #instantiate(node: DependencyNode): Promise<unknown> {
    let instance = this.#instances.get(node);
    if (!instance) {
      // Disposal is final. An `init()` that is still running asks for a
      // module's nodes only once its imports are ready, which can be after
      // `dispose()` was called: creating them then would leave instances
      // that nothing disposes.
      if (this.#disposal) {
        return Promise.reject(new Error(DISPOSED));
      }
      instance = this.#create(node);
      this.#instances.set(node, instance);
    }
    return instance;
  }

  /**
   * Create a node: create its dependencies in parallel, then call its factory
   * with their values, in order.
   *
   * A failing factory is wrapped in an error that names the node and its
   * module. A failing dependency is passed through as is, so the error names
   * the node that actually failed.
   *
   * @param node The node to create.
   * @returns The value returned by the factory.
   * @throws {Error} (as a rejection) `Failed to create X in module M`, with the
   *   factory's error as `cause`.
   */
  async #create(node: DependencyNode): Promise<unknown> {
    const args = await Promise.all(
      node.deps.map((dep) => this.#instantiate(dep)),
    );
    const name = `${describe(node.token)} in module ${describe(node.owner)}`;
    const done = this.#log.start();
    try {
      const value = await node.meta.provider.factory(...args);
      this.#created.push([node, value]);
      done(`created ${name}`);
      return value;
    } catch (cause) {
      this.#log.error(`failed to create ${name}:`, cause);
      throw new Error(`Failed to create ${name}`, { cause });
    }
  }

  /**
   * The modules of the application, each once, in post-order: imported
   * modules before the modules that import them, the root last.
   *
   * @returns An iterator over the module scopes.
   */
  *modules(): IterableIterator<ModuleScope> {
    yield* this.graph.modules.values();
  }

  /**
   * The controllers of the application, each once, from the module that
   * declares it: for each module (see {@link modules}), the controllers it
   * declares, in `controllers` order. A controller that a module exports is
   * visible in the modules that import it too, but belongs to its own.
   *
   * Application modules use it to find their entry points, and create a
   * controller with `resolve(node.token, node.owner)`.
   *
   * @returns An iterator over the controller nodes.
   */
  *controllers(): IterableIterator<DependencyNode<ControllerMetadata>> {
    for (const module of this.modules()) {
      for (const node of module.visible.values()) {
        if (node.owner === module.ctr && node.is_controller()) {
          yield node;
        }
      }
    }
  }
}
