/**
 * {@link inspect}: reads an application into a model, from the metadata its
 * decorators wrote.
 *
 * Nothing is created: no instance, no factory call, no connection. A root
 * module class is enough.
 *
 * @module
 */

import { type Ctr, isChoError, type Token } from "@chojs/core";
import {
  build_dependency_graph,
  build_meta_graph,
  type ControllerMetadata,
  type DependencyGraph,
  type MetadataGraph,
  type ModuleMetadata,
  type ProviderMetadata,
} from "@chojs/core/di";
import { describe } from "@chojs/core/utils";
import { dev_error } from "./errors.ts";
import {
  command_record,
  http_record,
  join_path,
  join_topic,
  level,
  message_record,
  order_events,
  socket_record,
} from "./records.ts";
import type {
  ChoDevApplication,
  ChoDevEdge,
  ChoDevEndpoint,
  ChoDevGraph,
  ChoDevInjector,
  ChoDevNode,
  ChoDevTarget,
} from "./types.ts";

type Rec = Readonly<Record<PropertyKey, unknown>>;

const is_object = (value: unknown): value is Rec =>
  typeof value === "object" && value !== null;

/** Whether a value is a model {@link inspect} made. */
export function is_graph(value: unknown): value is ChoDevGraph {
  return is_object(value) && typeof value["root"] === "string" &&
    Array.isArray(value["nodes"]) && Array.isArray(value["edges"]);
}

/** Whether a value has the two graphs of an injector. */
function is_injector(value: unknown): value is ChoDevInjector {
  if (!is_object(value)) {
    return false;
  }
  const { meta, graph } = value;
  return is_object(meta) && meta["modules"] instanceof Map &&
    is_object(meta["root"]) && is_object(graph) &&
    graph["modules"] instanceof Map;
}

/** What a target gives: the metadata, and the linked graph when there is one. */
type Source = {
  meta: MetadataGraph;
  /** `undefined` when the dependencies could not be linked. */
  graph: DependencyGraph | undefined;
  error: ChoDevGraph["error"];
  app: ChoDevApplication | undefined;
};

/**
 * Read the graphs of a target.
 *
 * @param caller The function that was called, for the error message.
 * @param target A root module class, an injector or an application.
 * @returns Its metadata graph, and its dependency graph or why there is none.
 * @throws {ChoError} When the target is none of the three, or when the
 *   metadata of the module is invalid.
 */
function read_target(caller: string, target: unknown): Source {
  if (typeof target === "function") {
    const meta = build_meta_graph(target as Ctr);
    try {
      return {
        meta,
        graph: build_dependency_graph(meta),
        error: null,
        app: undefined,
      };
    } catch (error) {
      // A mistake in the wiring is what a developer came to look at: the
      // application is drawn with it.
      if (!isChoError(error)) {
        throw error;
      }
      return {
        meta,
        graph: undefined,
        error: { code: String(error.code), message: error.message },
        app: undefined,
      };
    }
  }
  if (is_injector(target)) {
    return {
      meta: target.meta,
      graph: target.graph,
      error: null,
      app: undefined,
    };
  }
  if (is_object(target) && is_injector(target["injector"])) {
    const app = target as ChoDevApplication;
    return {
      meta: app.injector.meta,
      graph: app.injector.graph,
      error: null,
      app,
    };
  }
  throw dev_error(
    "CHO_DEV_INVALID_TARGET",
    `${caller}: expected a root module class, an injector or an application, got ${
      describe(target)
    }`,
  );
}

/** Gives each node an id that no other node has. */
class Ids {
  readonly #taken = new Map<string, number>();

  /**
   * @param wanted The readable id.
   * @returns It, or it with a number when it is taken: `"Users#2"`.
   */
  take(wanted: string): string {
    const count = (this.#taken.get(wanted) ?? 0) + 1;
    this.#taken.set(wanted, count);
    return count === 1 ? wanted : this.take(`${wanted}#${count}`);
  }
}

const names = (list: readonly unknown[]): string[] => list.map(describe);

const name_or_null = (value: unknown): string | null =>
  value === undefined ? null : describe(value);

const token_kind = (token: Token): "class" | "token" | "symbol" =>
  typeof token === "function"
    ? "class"
    : typeof token === "symbol"
    ? "symbol"
    : "token";

/**
 * Read an application into a model: its modules, their providers and
 * controllers, its endpoints, and what imports, exports and injects what.
 *
 * It reads the metadata the decorators wrote, and nothing else: no instance
 * is created and no factory runs. A dependency is resolved by the core, so an
 * edge leads to the provider an injector would use.
 *
 * An application whose dependencies cannot be linked (a dependency nothing
 * provides, a token two imports export, a cycle) is read too. Its model has
 * the `error` an injector would throw, and each dependency is found where it
 * most likely is: in the module, then among what its imports export. What is
 * found nowhere is a node of kind `"missing"`.
 *
 * @param target A root module class. An injector or an application is read
 *   too; an application adds its global prefix and its mounted routes. A
 *   model is returned as it is.
 * @returns The model: plain data, that `JSON.stringify` writes whole.
 * @throws {ChoError} When the target is not one of those
 *   (`CHO_DEV_INVALID_TARGET`), or when the metadata itself is invalid: a
 *   class without its decorator, circular imports (the error of the core).
 *
 * @example
 * ```ts
 * const graph = inspect(AppModule);
 * graph.nodes.filter((node) => node.kind === "module").map((node) => node.name);
 * ```
 */
export function inspect(target: ChoDevTarget): ChoDevGraph {
  return read("inspect()", target);
}

/**
 * {@link inspect}, for the functions that take a target: the error of an
 * invalid one names the function that was called.
 *
 * @param caller The function that was called.
 * @param target The target.
 * @returns The model.
 */
export function read(caller: string, target: unknown): ChoDevGraph {
  if (is_graph(target)) {
    return target;
  }
  const { meta, graph, error, app } = read_target(caller, target);
  const ids = new Ids();
  const nodes: ChoDevNode[] = [];
  const edges: ChoDevEdge[] = [];

  // The modules, the root first, each before what it imports.
  const modules: ModuleMetadata[] = [];
  const visit = (module: ModuleMetadata): void => {
    if (!modules.includes(module)) {
      modules.push(module);
      module.imports.forEach(visit);
    }
  };
  visit(meta.root);

  // Every id first: an edge can lead to a module that comes later.
  const module_ids = new Map<ModuleMetadata, string>();
  const declared = new Map<ModuleMetadata, Map<Token, string>>();
  for (const module of modules) {
    const id = ids.take(describe(module.provider.provide));
    module_ids.set(module, id);
    const own = new Map<Token, string>([[module.provider.provide, id]]);
    for (const { provider } of [...module.providers, ...module.controllers]) {
      // A token a broken module declares twice is one node: the first.
      if (!own.has(provider.provide)) {
        own.set(
          provider.provide,
          ids.take(`${id}/${describe(provider.provide)}`),
        );
      }
    }
    declared.set(module, own);
  }

  /** Where a module finds a token, as the core linked it. */
  const linked = (module: ModuleMetadata, token: Token): string | undefined => {
    const node = graph?.modules.get(module.provider.provide as Ctr)?.visible
      .get(token);
    const owner = node && meta.modules.get(node.owner);
    return owner && declared.get(owner)?.get(node.token);
  };
  /**
   * Where a module most likely finds a token, when the core could not link
   * the application: among what it declares, then among what its imports
   * export. A token two imports export as two declarations is not found.
   */
  const guessed = (
    module: ModuleMetadata,
    token: Token,
  ): string | undefined => {
    const own = declared.get(module)?.get(token);
    if (own !== undefined) {
      return own;
    }
    const found = new Set<string>();
    for (const imported of module.imports) {
      if (imported.exports.includes(token)) {
        const id = guessed(imported, token);
        if (id !== undefined) {
          found.add(id);
        }
      }
    }
    return found.size === 1 ? [...found][0] : undefined;
  };
  const resolve = graph ? linked : guessed;

  const drawn = new Set<string>();
  const edge = (kind: ChoDevEdge["kind"], from: string, to: string): void => {
    const key = `${kind}\n${from}\n${to}`;
    if (!drawn.has(key)) {
      drawn.add(key);
      edges.push({ kind, from, to });
    }
  };

  const web_prefix = level(is_object(app?.graph) ? app.graph["route"] : "");
  const message_prefix = level(is_object(app?.graph) ? app.graph["topic"] : "");

  for (const module of modules) {
    const id = module_ids.get(module)!;
    const own = declared.get(module)!;
    const emitted = new Set<string>([id]);
    nodes.push({
      id,
      kind: "module",
      name: describe(module.provider.provide),
      module: id,
      root: module === meta.root,
      middlewares: names(module.middlewares),
      errorHandler: name_or_null(module.errorHandler),
    });

    for (const { provider } of module.providers) {
      const provider_id = own.get(provider.provide)!;
      if (!emitted.has(provider_id)) {
        emitted.add(provider_id);
        nodes.push({
          id: provider_id,
          kind: "provider",
          name: describe(provider.provide),
          module: id,
          token: token_kind(provider.provide),
        });
      }
    }

    for (const controller of module.controllers) {
      const controller_id = own.get(controller.provider.provide)!;
      if (emitted.has(controller_id)) {
        continue;
      }
      emitted.add(controller_id);
      nodes.push({
        id: controller_id,
        kind: "controller",
        name: describe(controller.provider.provide),
        module: id,
        middlewares: names(controller.middlewares),
        errorHandler: name_or_null(controller.errorHandler),
      });
      nodes.push(
        ...endpoints_of(module, controller, {
          ids,
          module_id: id,
          controller_id,
          web_prefix,
          message_prefix,
        }),
      );
    }

    // What the module asks for and nothing gives: one node for each token.
    const missing = new Map<Token, string>();
    const target_of = (token: Token): string => {
      const found = resolve(module, token) ?? missing.get(token);
      if (found !== undefined) {
        return found;
      }
      const name = describe(token);
      const missing_id = ids.take(`${id}/?${name}`);
      missing.set(token, missing_id);
      nodes.push({ id: missing_id, kind: "missing", name, module: id });
      return missing_id;
    };

    for (const imported of module.imports) {
      edge("imports", id, module_ids.get(imported)!);
    }
    for (const token of module.exports) {
      edge("exports", id, target_of(token));
    }
    const declarations: readonly ProviderMetadata[] = [
      module,
      ...module.providers,
      ...module.controllers,
    ];
    for (const { provider } of declarations) {
      const from = own.get(provider.provide)!;
      // `deps` can be missing on a provider object written in plain JavaScript.
      for (const dependency of provider.deps ?? []) {
        edge("injects", from, target_of(dependency));
      }
    }
  }

  const root = module_ids.get(meta.root)!;
  nodes.push(...mounted_routes(app, nodes, root, ids));
  return { root, nodes, edges, error };
}

/** What {@link endpoints_of} needs to know about where a controller is. */
type Place = {
  ids: Ids;
  module_id: string;
  controller_id: string;
  web_prefix: string;
  message_prefix: string;
};

/**
 * The endpoints of a controller: its methods that a decorator of
 * `@chojs/web`, `@chojs/message` or `@chojs/command` marked.
 *
 * @param module The module that declares the controller.
 * @param controller The controller.
 * @param place The ids of the two, and the prefixes of the application.
 * @returns The endpoints, in the order of the methods.
 */
function endpoints_of(
  module: ModuleMetadata,
  controller: ControllerMetadata,
  place: Place,
): ChoDevEndpoint[] {
  const { ids, module_id, controller_id } = place;
  const events = order_events(
    controller.methods.flatMap((method) => socket_record(method.meta) ?? []),
  );
  const out: ChoDevEndpoint[] = [];
  for (const method of controller.methods) {
    const make = (
      name: string,
      fields: Pick<
        ChoDevEndpoint,
        "type" | "method" | "path" | "topic" | "command" | "events"
      >,
    ): void => {
      out.push({
        id: ids.take(`${controller_id}.${method.name}`),
        kind: "endpoint",
        name,
        module: module_id,
        controller: controller_id,
        handler: method.name,
        ...fields,
        middlewares: names([
          ...module.middlewares,
          ...controller.middlewares,
          ...method.middlewares,
        ]),
        errorHandler: name_or_null(
          method.errorHandler ?? controller.errorHandler ??
            module.errorHandler,
        ),
        mounted: false,
      });
    };

    const http = http_record(method.meta);
    if (http) {
      const path = join_path([
        place.web_prefix,
        level(module.options["route"]),
        level(controller.options["route"]),
        http.route,
      ]);
      const verb = http.type === "http" ? http.method : http.type.toUpperCase();
      make(`${verb} ${path}`, {
        type: http.type,
        method: http.method,
        path,
        ...(http.type === "ws" ? { events } : {}),
      });
    }

    const message = message_record(method.meta);
    if (message) {
      // A contract has the whole topic of its handler: the topics of the
      // module and of the controller are the start of it already.
      const topic = join_topic(
        message.whole ? [place.message_prefix, message.topic] : [
          place.message_prefix,
          level(module.options["topic"]),
          level(controller.options["topic"]),
          message.topic,
        ],
      );
      make(topic, { type: "message", topic });
    }

    const command = command_record(method.meta);
    if (command !== undefined) {
      make(command, { type: "command", command });
    }
  }
  return out;
}

/**
 * The routes that were mounted on an application (`app.mount`): those of its
 * routes that no controller declares.
 *
 * @param app The application, when the target is one.
 * @param nodes The nodes read so far.
 * @param root The id of the root module: a mounted route is shown in it.
 * @param ids The ids taken so far.
 * @returns An endpoint for each mounted route, with no controller.
 */
function mounted_routes(
  app: ChoDevApplication | undefined,
  nodes: readonly ChoDevNode[],
  root: string,
  ids: Ids,
): ChoDevEndpoint[] {
  const routes = app?.routes;
  if (!Array.isArray(routes)) {
    return [];
  }
  const declared = new Set(
    nodes.flatMap((node) =>
      node.kind === "endpoint" && node.path !== undefined
        ? [`${node.method} ${node.path}`]
        : []
    ),
  );
  const out: ChoDevEndpoint[] = [];
  for (const route of routes as readonly unknown[]) {
    if (
      !is_object(route) || typeof route["method"] !== "string" ||
      typeof route["path"] !== "string"
    ) {
      continue;
    }
    const { method, path } = route;
    if (declared.has(`${method} ${path}`)) {
      continue;
    }
    const socket = route["socket"] === true;
    const handler = typeof route["name"] === "string"
      ? route["name"]
      : "mounted";
    out.push({
      id: ids.take(`${root}/${method} ${path}`),
      kind: "endpoint",
      name: `${socket ? "WS" : method} ${path}`,
      module: root,
      controller: null,
      handler,
      type: socket ? "ws" : "http",
      method,
      path,
      middlewares: [],
      errorHandler: null,
      mounted: true,
    });
  }
  return out;
}
