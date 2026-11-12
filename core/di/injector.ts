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

import type { Ctr, Token } from "./types.ts";
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
 * Creates and holds the instances of an application.
 *
 * Instances belong to the injector: two injectors created for the same root
 * module share nothing.
 *
 * Creation is memoized: each node's promise is stored before anything is
 * awaited, so concurrent and later requests for the same node share one
 * creation, and one instance. A failed creation is memoized too: every later
 * request for the node, or for anything that depends on it, gets the same
 * error. There is no retry.
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
   * The `cho:di` debug logger. Created per injector, not when the module is
   * loaded, so it follows `set_env` and the environment at creation time.
   */
  readonly #log: Debuglog;

  /**
   * Build and validate the dependency graph of an application. Nothing is
   * created yet.
   *
   * @param root The root module class.
   * @throws {Error} On any invalid declaration or wiring error, such as a
   *   class without its decorator, a dependency that is not provided, an
   *   ambiguous or duplicate token, or a circular dependency.
   */
  constructor(root: Ctr) {
    this.#log = debuglog("cho:di");
    const done = this.#log.start();
    try {
      this.meta = build_meta_graph(root);
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
   *   `Failed to create X in module M`, with the original error as `cause`.
   */
  async init(): Promise<void> {
    await this.#init_module(this.graph.root);
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
   *   ambiguous there (two imports export different instances of it), or
   *   when a factory fails (`Failed to create X in module M`, with `cause`).
   *
   * @example
   * ```ts
   * const users = await injector.resolve(UserService);
   * const url = await injector.resolve(API_URL); // string
   * const cli = await injector.resolve(Cli, CliModule); // in CliModule's scope
   * ```
   */
  resolve<T>(token: Token<T>, module?: Ctr): Promise<T> {
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
   * @param node The node to create.
   * @returns The node's value.
   */
  #instantiate(node: DependencyNode): Promise<unknown> {
    let instance = this.#instances.get(node);
    if (!instance) {
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
    const yielded = new WeakSet<ModuleScope>();
    for (const scope of this.graph.modules.values()) {
      if (!yielded.has(scope)) {
        yielded.add(scope);
        yield scope;
      }
    }
  }

  /**
   * The controllers of the application, each once: for each module (see
   * {@link modules}), the controller nodes of its scope. A controller that a
   * module exports is visible in the modules that import it too, but is
   * yielded once, from its first module.
   *
   * Application modules use it to find their entry points, and create a
   * controller with `resolve(node.token, node.owner)`.
   *
   * @returns An iterator over the controller nodes.
   */
  *controllers(): IterableIterator<DependencyNode<ControllerMetadata>> {
    const yielded = new WeakSet<DependencyNode>();
    for (const module of this.modules()) {
      for (const node of module.visible.values()) {
        if (node.isController() && !yielded.has(node)) {
          yielded.add(node);
          yield node as DependencyNode<ControllerMetadata>;
        }
      }
    }
  }
}
