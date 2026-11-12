/**
 * The dependency graph: every declaration of an application, linked to the
 * declarations it depends on.
 *
 * {@link build_dependency_graph} turns the metadata graph into a graph of
 * {@link DependencyNode}s, one per declaration (provider, controller or module),
 * grouped by module in {@link ModuleScope}s. Each node's dependencies are
 * resolved, once, to the nodes that provide them, so creating instances later
 * needs no lookups: the injector only follows `deps`.
 *
 * ## Scope rules
 *
 * Each module has a scope: the tokens it can inject (`ModuleScope.visible`).
 *
 * - **What a module sees.** Its own declarations (providers, controllers and
 *   the module class itself), plus the tokens its direct imports export.
 *   Tokens an import does not export stay private to it.
 * - **Own declarations win.** A token the module declares shadows the same
 *   token exported by an import. This is how a module overrides an imported
 *   provider.
 * - **Where dependencies resolve.** Always in the scope of the module that
 *   declares the node, never in the scope of a module that imports it. An
 *   exported provider keeps the dependencies of its own module, so a module
 *   imported by many others is one set of nodes, shared by all of them.
 * - **What a module exports.** Any token in its scope: one it declares, or one
 *   it imports (a re-export). Exporting a whole imported module is not
 *   supported.
 *
 * ## Checks
 *
 * The build throws, naming the module at fault, when:
 *
 * - a module declares the same token twice;
 * - a module exports a token it neither declares nor imports;
 * - a token is **ambiguous**: two imports export different nodes for it, and
 *   the module injects or exports it without declaring it itself;
 * - a dependency is not in the scope of the module that declares the node;
 * - dependencies form a cycle.
 *
 * @module
 */

import type { Ctr, Token } from "./types.ts";
import type {
  ControllerMetadata,
  MetadataGraph,
  ModuleMetadata,
  ProviderMetadata,
} from "./metadata-graph.ts";
import { describe } from "../utils/describe.ts";

// Types
// -----------------------------------------------------------------------------

/**
 * One declaration of the application: a provider, a controller or a module,
 * declared in one module.
 *
 * A node stands for a single instance: the injector creates at most one value
 * per node. The same class declared in two modules is two nodes, and two
 * instances.
 *
 * @typeParam M The kind of declaration the node was built from.
 */
export class DependencyNode<M extends ProviderMetadata = ProviderMetadata> {
  /** The token the node provides. */
  readonly token: Token;
  /** The normalized declaration: its provider holds the factory. */
  readonly meta: M;
  /**
   * The module that declares the node. Its dependencies were resolved in this
   * module's scope.
   */
  readonly owner: Ctr;
  /**
   * The nodes that provide the dependencies, in the order the factory
   * receives them. Set while the graph is built.
   */
  readonly deps: readonly DependencyNode[] = [];

  /**
   * Create an unlinked node. Its `deps` are set when the graph is built.
   *
   * @param meta The normalized declaration.
   * @param owner The module that declares it.
   */
  constructor(meta: M, owner: Ctr) {
    this.token = meta.provider.provide;
    this.meta = meta;
    this.owner = owner;
  }

  /**
   * Whether the node was built from a `@Controller` class, so that its `meta`
   * is a {@link ControllerMetadata}.
   */
  is_controller(): this is DependencyNode<ControllerMetadata> {
    return "isController" in this.meta && this.meta.isController === true;
  }
}

/**
 * A module of the application, with its scope: everything it can inject.
 *
 * A module imported through several paths is one scope, shared by all its
 * importers.
 */
export class ModuleScope {
  /** The module class. */
  readonly ctr: Ctr;
  /** The module's normalized metadata. */
  readonly meta: ModuleMetadata;
  /** The scopes of the imported modules, in `imports` order. */
  readonly imports: readonly ModuleScope[];
  /**
   * Every token this module can inject, mapped to the node that provides it:
   * its own declarations (the module itself included) and the tokens its
   * imports export. Ambiguous tokens are left out.
   *
   * Filled while the graph is built; read-only afterwards.
   */
  readonly visible: ReadonlyMap<Token, DependencyNode>;
  /**
   * The ambiguous tokens of this module: tokens that two or more imports
   * export as different instances, and that the module does not declare
   * itself. Each is mapped to the modules that export it. They are not in
   * {@link visible}: injecting, exporting or resolving one throws (see
   * {@link ambiguity_error}).
   *
   * Filled while the graph is built; read-only afterwards.
   */
  readonly ambiguous: ReadonlyMap<Token, readonly Ctr[]>;

  /**
   * Create a module scope with an empty `visible` table. The table is filled
   * when the graph is built.
   *
   * @param meta The module's normalized metadata.
   * @param imports The scopes of the imported modules, already built.
   */
  constructor(
    meta: ModuleMetadata,
    imports: readonly ModuleScope[],
    visible: ReadonlyMap<Token, DependencyNode>,
    ambiguous: ReadonlyMap<Token, readonly Ctr[]>,
  ) {
    this.ctr = meta.provider.provide as Ctr;
    this.meta = meta;
    this.imports = imports;
    this.visible = visible;
    this.ambiguous = ambiguous;
  }
}

/**
 * The error for using an ambiguous token of a module, or `undefined` when the
 * token is not ambiguous there.
 *
 * Used both when the graph is built (injecting or exporting the token) and by
 * `Injector.resolve`, so the two report it the same way.
 *
 * @param scope The module the token is looked up in.
 * @param token The token.
 * @returns The error to throw, naming the modules that export the token.
 */
export function ambiguity_error(
  scope: ModuleScope,
  token: Token,
): Error | undefined {
  const exporters = scope.ambiguous.get(token);
  if (!exporters) {
    return undefined;
  }
  const name = describe(token);
  return new Error(
    `${name} is ambiguous in module ${describe(scope.ctr)}: ` +
      `${
        exporters.map(describe).join(", ")
      } export different instances of it. ` +
      `Provide ${name} in ${describe(scope.ctr)} to choose which one to use.`,
  );
}

/** The dependency graph of an application. */
export type DependencyGraph = {
  /** The root module. */
  root: ModuleScope;
  /**
   * Every module of the application, by class. Imported modules come before
   * the modules that import them, and the root comes last.
   */
  modules: ReadonlyMap<Ctr, ModuleScope>;
};

// Build
// -----------------------------------------------------------------------------

/**
 * Throw if the dependencies of the given nodes form a cycle.
 *
 * Runs a depth-first search that follows `deps`. Reaching a node that is on
 * the current path closes a cycle, which is reported with its path.
 *
 * @param nodes The nodes to start from. Every node reachable from them is
 *   checked.
 * @throws {Error} On a cycle, e.g.
 *   `Circular dependency detected in module M: A → B → A`.
 */
function assert_acyclic(nodes: Iterable<DependencyNode>): void {
  const done = new Set<DependencyNode>();
  const path: DependencyNode[] = [];
  const visit = (n: DependencyNode): void => {
    if (done.has(n)) return;
    const at = path.indexOf(n);
    if (at !== -1) {
      const cycle = [...path.slice(at), n].map((x) => describe(x.token)).join(
        " → ",
      );
      throw new Error(
        `Circular dependency detected in module ${describe(n.owner)}: ${cycle}`,
      );
    }
    path.push(n);
    n.deps.forEach(visit);
    path.pop();
    done.add(n);
  };
  for (const n of nodes) visit(n);
}

/**
 * Build the scope of a module and, first, the scopes of everything it imports.
 *
 * The steps, in order:
 *
 * 1. build the imported modules;
 * 2. take the tokens the imports export, and detect ambiguous ones;
 * 3. declare the module's own nodes, and reject duplicates;
 * 4. check the module's exports;
 * 5. link the dependencies of the module's own nodes;
 * 6. check the module's own nodes for cycles.
 *
 * @param meta The module's normalized metadata.
 * @param scopes The scopes built so far, shared by the whole build. A module
 *   already in it is returned as is, so a module imported through several
 *   paths is built once.
 * @param path The chain of imports that led to this module, from the root,
 *   used to detect circular imports.
 * @returns The module's scope.
 * @throws {Error} On any failed check (see the module documentation).
 */
function build_module_scope(
  meta: ModuleMetadata,
  scopes: Map<Ctr, ModuleScope>,
  path: readonly Ctr[],
): ModuleScope {
  const ctr = meta.provider.provide as Ctr;

  // `build_meta_graph` already rejects circular imports; this keeps the
  // function safe on its own. A module on the current path is still being
  // built, so it is not in `scopes` yet: check the path first.
  if (path.includes(ctr)) {
    const cycle = [...path, ctr].map(describe).join(" → ");
    throw new Error(`Circular dependency detected: ${cycle}`);
  }

  const built = scopes.get(ctr);
  if (built) {
    return built;
  }

  // 1. Imports
  // ---------------------------------------------------------------------------
  // Built first, so their exports are known.
  const imports = meta.imports.map((imp) =>
    build_module_scope(imp, scopes, [...path, ctr])
  );
  // The two tables of the scope. The builder fills them; the scope, and
  // everything that reads the graph afterwards, only sees them read-only.
  const visible = new Map<Token, DependencyNode>();
  const ambiguous = new Map<Token, readonly Ctr[]>();
  const scope = new ModuleScope(meta, imports, visible, ambiguous);

  // 2. Imported tokens
  // ---------------------------------------------------------------------------
  // Each import already checked its own exports when it was built (step 4),
  // so every exported token is in the import's `visible`.
  //
  // Ambiguity check: two imports may export the same token.
  // - Both pass on the same node (e.g. both re-export a token of a shared
  //   module): it is one instance, there is nothing to choose.
  // - They pass on different nodes: picking one would silently depend on the
  //   order of `imports`. The token is ambiguous instead: it is left out of
  //   `visible` and kept in `ambiguous`, and injecting, exporting or
  //   resolving it throws (see `ambiguity_error`), unless this module
  //   declares the token itself (step 3).
  const candidates = new Map<Token, Map<DependencyNode, Ctr>>(); // token → node → exporting module
  for (const imported of imports) {
    for (const token of imported.meta.exports) {
      const nodes = candidates.get(token) ?? new Map<DependencyNode, Ctr>();
      nodes.set(imported.visible.get(token)!, imported.ctr);
      candidates.set(token, nodes);
    }
  }

  for (const [token, nodes] of candidates) {
    if (nodes.size === 1) {
      visible.set(token, nodes.keys().next().value!);
    } else {
      ambiguous.set(token, [...nodes.values()]);
    }
  }

  // 3. Own declarations
  // ---------------------------------------------------------------------------
  // Providers, controllers and the module itself. They shadow imported tokens.
  //
  // Duplicate check: a module can declare each token only once. Otherwise the
  // later declaration would silently replace the earlier one in `visible`,
  // leaving the earlier node linked but unreachable. This also catches a
  // controller, or the module class, sharing a token with a provider.
  // (Shadowing an *imported* token is fine: that is how overriding works.)
  const declared: DependencyNode[] = [];
  const declaredAs = new Map<Token, string>(); // token → how this module declared it
  const declare_node = (node: DependencyNode, as: string): void => {
    const previous = declaredAs.get(node.token);
    if (previous) {
      throw new Error(
        `${describe(node.token)} is declared more than once in module ${
          describe(ctr)
        } ` +
          `(as ${previous} and as ${as}). Declare each token once.`,
      );
    }
    declaredAs.set(node.token, as);
    visible.set(node.token, node);
    declared.push(node);
  };

  for (const provider of meta.providers) {
    declare_node(new DependencyNode(provider, ctr), "a provider");
  }
  for (const controller of meta.controllers) {
    declare_node(new DependencyNode(controller, ctr), "a controller");
  }
  // The module itself is in its own scope, so it can be created and injected.
  declare_node(new DependencyNode(meta, ctr), "the module itself");

  // A token this module declares shadows the imported ones, so declaring it
  // is how a module settles an ambiguous token.
  for (const node of declared) {
    ambiguous.delete(node.token);
  }

  /**
   * Find a token in this module's scope. An ambiguous token throws here, when
   * it is actually injected or exported, rather than resolving to a guess.
   */
  const lookup = (token: Token): DependencyNode | undefined => {
    const error = ambiguity_error(scope, token);
    if (error) {
      throw error;
    }
    return visible.get(token);
  };

  // 4. Exports
  // ---------------------------------------------------------------------------
  // Checked once, here in the exporting module, so importers can rely on them
  // (step 2) and errors name the module at fault.
  for (const token of meta.exports) {
    if (lookup(token)) {
      continue;
    }
    const isImportedModule = imports.some((imp) => imp.ctr === token);
    throw new Error(
      isImportedModule
        ? `Module ${describe(ctr)} exports the imported module ${
          describe(token)
        }. ` +
          `Re-exporting a module is not supported; export the tokens you need instead.`
        : `Module ${describe(ctr)} exports ${
          describe(token)
        }, which it neither provides nor imports.`,
    );
  }

  // 5. Link
  // ---------------------------------------------------------------------------
  // Only the nodes this module declares. Imported nodes were linked in their
  // own module; linking them again here would resolve their dependencies in
  // the wrong scope.
  for (const node of declared) {
    // `deps` can be missing on a provider object written in plain JavaScript.
    // The one place a node's dependencies are set: `deps` is read-only for
    // everything else.
    (node as { deps: readonly DependencyNode[] }).deps = (
      node.meta.provider.deps ?? []
    ).map((dep, i) => {
      const resolved = lookup(dep);
      if (!resolved) {
        throw new Error(
          `Cannot resolve ${describe(dep)} (argument #${i}) of ${
            describe(node.token)
          } ` +
            `in module ${
              describe(ctr)
            }. Provide it there or import a module that exports it.`,
        );
      }
      return resolved;
    });
  }

  // 6. Cycles
  // ---------------------------------------------------------------------------
  // Imported nodes were checked in their own module and cannot depend back on
  // this one, so a new cycle can only run through this module's nodes.
  assert_acyclic(declared);

  scopes.set(ctr, scope);
  return scope;
}

/**
 * Build the dependency graph of an application from its metadata graph.
 *
 * @param metaGraph The metadata graph, from `build_meta_graph`.
 * @returns The dependency graph: one scope per module, every dependency linked
 *   to the node that provides it.
 * @throws {Error} When a check fails (see the module documentation).
 *
 * @example
 * ```ts
 * const graph = build_dependency_graph(build_meta_graph(AppModule));
 * graph.root.visible.get(UserService)?.deps; // the nodes UserService needs
 * ```
 */
export function build_dependency_graph(
  metaGraph: MetadataGraph,
): DependencyGraph {
  const modules = new Map<Ctr, ModuleScope>();
  const root = build_module_scope(metaGraph.root, modules, []);
  return { root, modules };
}
