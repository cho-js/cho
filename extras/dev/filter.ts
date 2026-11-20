/**
 * {@link filterGraph}: keeps a part of a model, by kind, by search, or by what
 * is near a node.
 *
 * The page of `page.ts` filters in the browser, with rules of its own script.
 * They are these rules, written a second time: a test gives both the same
 * models and the same filters, and compares what they keep.
 *
 * @module
 */

import { assert_known_options } from "@chojs/core/di";
import { describe } from "@chojs/core/utils";
import { dev_error } from "./errors.ts";
import { read } from "./inspect.ts";
import type {
  ChoDevFilter,
  ChoDevGraph,
  ChoDevNode,
  ChoDevTarget,
} from "./types.ts";

/** The names of the rules, for the error of an unknown one. */
const RULES = ["around", "depth", "kinds", "search"];

/** Every kind of node, and every type of endpoint: what `kinds` can name. */
export const KINDS: readonly string[] = [
  "module",
  "provider",
  "controller",
  "endpoint",
  "missing",
  "http",
  "sse",
  "ws",
  "message",
  "command",
];

/**
 * Check a filter.
 *
 * @param caller The function that was called, for the error message.
 * @param filter The filter.
 * @throws {ChoError} When it is not an object, when a rule is unknown, or
 *   when a rule has a value it cannot have.
 */
export function assert_filter(
  caller: string,
  filter: unknown,
): asserts filter is ChoDevFilter {
  const invalid = (what: string) =>
    dev_error("CHO_DEV_INVALID_OPTION", `${caller}: ${what}`);
  if (typeof filter !== "object" || filter === null || Array.isArray(filter)) {
    throw invalid(
      `expected a filter, such as { kinds: ["module"] }, got ${
        describe(filter)
      }`,
    );
  }
  assert_known_options(caller, filter, RULES);
  const { kinds, search, around, depth } = filter as Record<string, unknown>;
  if (kinds !== undefined) {
    if (!Array.isArray(kinds)) {
      throw invalid(`"kinds" must be an array, got ${describe(kinds)}`);
    }
    for (const kind of kinds) {
      if (!KINDS.includes(kind)) {
        throw invalid(
          `unknown kind ${describe(kind)}. Known kinds: ${KINDS.join(", ")}`,
        );
      }
    }
  }
  if (search !== undefined && typeof search !== "string") {
    throw invalid(`"search" must be a string, got ${describe(search)}`);
  }
  if (around !== undefined && typeof around !== "string") {
    throw invalid(`"around" must be the id of a node, got ${describe(around)}`);
  }
  if (
    depth !== undefined &&
    (typeof depth !== "number" || !Number.isInteger(depth) || depth < 0)
  ) {
    throw invalid(
      `"depth" must be a whole number, 0 or more, got ${describe(depth)}`,
    );
  }
}

/**
 * Keep a part of a model.
 *
 * - `kinds`: the kinds of nodes, and the types of endpoints, to keep.
 * - `search`: a text, found with no regard to case in the name of a node, in
 *   its path, its topic or its command, or in the name of its module. So the
 *   name of a module finds everything the module declares.
 * - `around` and `depth`: one node, and what is within some steps of it. A
 *   step follows an edge, in either direction, or goes between a controller
 *   and one of its endpoints.
 *
 * A node must pass every rule that is given. A node that is kept keeps its
 * module, and an endpoint its controller, whatever the rules say of them. An
 * edge is kept when both its ends are.
 *
 * @param target A model, or anything `inspect` reads.
 * @param filter The rules. Default: none, and the whole model is kept.
 * @returns A new model; the one given does not change.
 * @throws {ChoError} When a rule is unknown or invalid, or when `around` is
 *   not the id of a node of the model.
 *
 * @example
 * ```ts
 * // the modules alone, and what imports what
 * filterGraph(AppModule, { kinds: ["module"] });
 * // UsersService, what it injects and what injects it
 * filterGraph(AppModule, { around: "UsersModule/UsersService" });
 * ```
 */
export function filterGraph(
  target: ChoDevTarget,
  filter: ChoDevFilter = {},
): ChoDevGraph {
  const graph = read("filterGraph()", target);
  assert_filter("filterGraph()", filter);
  const { kinds, around, depth = 1 } = filter;
  const search = (filter.search ?? "").trim().toLowerCase();
  const by_id = new Map(graph.nodes.map((node) => [node.id, node]));

  let near: Set<string> | undefined;
  if (around !== undefined) {
    if (!by_id.has(around)) {
      throw dev_error(
        "CHO_DEV_UNKNOWN_NODE",
        `filterGraph(): the graph has no node ${describe(around)}`,
      );
    }
    near = nodes_near(graph, around, depth);
  }

  const passes = (node: ChoDevNode): boolean => {
    if (
      kinds && !kinds.includes(node.kind) &&
      !(node.kind === "endpoint" && kinds.includes(node.type))
    ) {
      return false;
    }
    if (search !== "" && !matches(node, by_id, search)) {
      return false;
    }
    return !near || near.has(node.id);
  };

  const kept = new Set<string>();
  for (const node of graph.nodes) {
    if (passes(node)) {
      kept.add(node.id);
      kept.add(node.module);
      if (node.kind === "endpoint" && node.controller !== null) {
        kept.add(node.controller);
      }
    }
  }
  return {
    root: graph.root,
    nodes: graph.nodes.filter((node) => kept.has(node.id)),
    edges: graph.edges.filter((edge) =>
      kept.has(edge.from) && kept.has(edge.to)
    ),
    error: graph.error,
  };
}

/**
 * Whether a search finds a node.
 *
 * @param node The node.
 * @param by_id The nodes of the model, by id: the module of the node is
 *   looked up there.
 * @param search The text, trimmed and in lower case.
 * @returns `true` when the text is in one of the names of the node.
 */
function matches(
  node: ChoDevNode,
  by_id: ReadonlyMap<string, ChoDevNode>,
  search: string,
): boolean {
  const texts = [node.name, by_id.get(node.module)?.name];
  if (node.kind === "endpoint") {
    texts.push(node.path, node.topic, node.command, node.handler);
  }
  return texts.some((text) =>
    text !== undefined && text.toLowerCase().includes(search)
  );
}

/**
 * The nodes within some steps of a node.
 *
 * @param graph The model.
 * @param start The id of the node.
 * @param depth The number of steps.
 * @returns The ids of the node and of those near it.
 */
function nodes_near(
  graph: ChoDevGraph,
  start: string,
  depth: number,
): Set<string> {
  const next = new Map<string, string[]>();
  const link = (a: string, b: string): void => {
    next.set(a, [...(next.get(a) ?? []), b]);
    next.set(b, [...(next.get(b) ?? []), a]);
  };
  for (const edge of graph.edges) {
    link(edge.from, edge.to);
  }
  for (const node of graph.nodes) {
    if (node.kind === "endpoint" && node.controller !== null) {
      link(node.id, node.controller);
    }
  }
  const near = new Set([start]);
  let edge_of_search = [start];
  for (let step = 0; step < depth && edge_of_search.length > 0; step++) {
    const reached: string[] = [];
    for (const id of edge_of_search) {
      for (const other of next.get(id) ?? []) {
        if (!near.has(other)) {
          near.add(other);
          reached.push(other);
        }
      }
    }
    edge_of_search = reached;
  }
  return near;
}
