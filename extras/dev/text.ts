/**
 * A model as the text of a drawing, for the tools that draw one:
 * {@link toMermaid} for Mermaid, which GitHub draws in a Markdown file, and
 * {@link toDot} for Graphviz.
 *
 * Both are strings: nothing is installed, and nothing is drawn here.
 *
 * @module
 */

import { filterGraph } from "./filter.ts";
import { read } from "./inspect.ts";
import type {
  ChoDevFilter,
  ChoDevGraph,
  ChoDevNode,
  ChoDevTarget,
} from "./types.ts";

/** A line between two nodes of a drawing. */
type Line = {
  /** What the line says. */
  kind: "imports" | "injects" | "handles";
  from: ChoDevNode;
  to: ChoDevNode;
};

/** A model, arranged for a drawing. */
type Drawing = {
  /** The modules, each with what it holds. */
  modules: { module: ChoDevNode; inside: ChoDevNode[] }[];
  /** The lines to draw. */
  lines: Line[];
  /** The ids of the nodes a module exports. */
  exported: Set<string>;
  /** The name of each node in the text: `n0`, `n1`, ... */
  ref: (node: ChoDevNode) => string;
};

/**
 * Arrange a model for a drawing.
 *
 * - A module holds what it declares.
 * - An `imports` and an `injects` edge is a line. An `exports` edge is not:
 *   what a module exports is marked.
 * - A controller has a line to each of its endpoints.
 * - A line between a node and the module that holds it is left out: a drawing
 *   cannot join a box to what is inside it.
 *
 * @param graph The model.
 * @returns The modules with what they hold, and the lines.
 */
function arrange(graph: ChoDevGraph): Drawing {
  const by_id = new Map(graph.nodes.map((node) => [node.id, node]));
  const refs = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const modules = graph.nodes
    .filter((node) => node.kind === "module")
    .map((module) => ({
      module,
      inside: graph.nodes.filter((node) =>
        node.module === module.id && node.id !== module.id
      ),
    }));
  const lines: Line[] = [];
  const exported = new Set<string>();
  for (const edge of graph.edges) {
    const from = by_id.get(edge.from);
    const to = by_id.get(edge.to);
    if (!from || !to) {
      continue;
    }
    if (edge.kind === "exports") {
      exported.add(to.id);
    } else if (from.module !== to.id && to.module !== from.id) {
      lines.push({ kind: edge.kind, from, to });
    }
  }
  for (const node of graph.nodes) {
    const controller = node.kind === "endpoint" && node.controller !== null
      ? by_id.get(node.controller)
      : undefined;
    if (controller) {
      lines.push({ kind: "handles", from: controller, to: node });
    }
  }
  return {
    modules,
    lines,
    exported,
    ref: (node) => `n${refs.get(node.id)}`,
  };
}

/** The model of a target, filtered when a filter is given. */
function model(
  caller: string,
  target: ChoDevTarget,
  filter: ChoDevFilter | undefined,
): ChoDevGraph {
  const graph = read(caller, target);
  return filter === undefined ? graph : filterGraph(graph, filter);
}

/** A name, as the text of a Mermaid node: its entity codes, on one line. */
function mermaid_text(name: string): string {
  return name
    .replace(/[#&"<>`]/g, (char) => `#${char.charCodeAt(0)};`)
    .replace(/\s+/g, " ");
}

/** A node of a Mermaid flowchart: its shape says its kind. */
function mermaid_node(ref: string, node: ChoDevNode): string {
  const text = `"${mermaid_text(node.name)}"`;
  switch (node.kind) {
    case "module":
      return `${ref}[[${text}]]`;
    case "controller":
      return `${ref}([${text}])`;
    case "endpoint":
      return `${ref}[/${text}/]`;
    case "missing":
      return `${ref}{{${text}}}`;
    default:
      return `${ref}[${text}]`;
  }
}

/** The arrow of each kind of line, in Mermaid. */
const MERMAID_ARROWS = { imports: "==>", injects: "-->", handles: "---" };

/**
 * Write a model as a Mermaid flowchart.
 *
 * - A module is a `subgraph`, with what it declares inside. A module that
 *   holds nothing is a node.
 * - The shape of a node says its kind: a box for a provider, a rounded one
 *   for a controller, a slanted one for an endpoint, a hexagon with a dashed
 *   border for what is missing.
 * - A thick arrow is an import, a thin one a dependency (from what injects to
 *   what is injected), and a line with no arrow joins a controller to an
 *   endpoint.
 * - What a module exports has a thick border.
 *
 * GitHub draws it in a Markdown file, inside a `mermaid` code block.
 *
 * @param target A root module class, an injector, an application or a model.
 * @param filter What to keep of the model (see `filterGraph`). Default:
 *   everything.
 * @returns The text of the flowchart, with a line break at its end.
 * @throws {ChoError} When the target or the filter is invalid.
 *
 * @example
 * ```ts
 * // the modules, and what imports what
 * console.log(toMermaid(AppModule, { kinds: ["module"] }));
 * ```
 */
export function toMermaid(
  target: ChoDevTarget,
  filter?: ChoDevFilter,
): string {
  const { modules, lines, exported, ref } = arrange(
    model("toMermaid()", target, filter),
  );
  const out = ["flowchart LR"];
  const missing: string[] = [];
  for (const { module, inside } of modules) {
    if (inside.length === 0) {
      out.push(`  ${mermaid_node(ref(module), module)}`);
      continue;
    }
    out.push(`  subgraph ${ref(module)}["${mermaid_text(module.name)}"]`);
    for (const node of inside) {
      out.push(`    ${mermaid_node(ref(node), node)}`);
      if (node.kind === "missing") {
        missing.push(ref(node));
      }
    }
    out.push("  end");
  }
  for (const { kind, from, to } of lines) {
    out.push(`  ${ref(from)} ${MERMAID_ARROWS[kind]} ${ref(to)}`);
  }
  const marked = modules
    .flatMap(({ inside }) => inside)
    .filter((node) => exported.has(node.id))
    .map(ref);
  if (marked.length > 0) {
    out.push("  classDef exported stroke-width:3px");
    out.push(`  class ${marked.join(",")} exported`);
  }
  if (missing.length > 0) {
    out.push("  classDef missing stroke-dasharray:4 4");
    out.push(`  class ${missing.join(",")} missing`);
  }
  return out.join("\n") + "\n";
}

/** A name, as a quoted string of DOT. */
function dot_text(name: string): string {
  return `"${
    name
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\r?\n|\r/g, "\\n")
  }"`;
}

/** The attributes of each kind of node, in DOT. */
const DOT_SHAPES: Readonly<Record<ChoDevNode["kind"], string>> = {
  module: "shape=point, style=invis, width=0, height=0",
  provider: "shape=box",
  controller: 'shape=box, style="rounded"',
  endpoint: "shape=cds",
  missing: 'shape=hexagon, style="dashed"',
};

/** The attributes of each kind of line, in DOT. */
const DOT_LINES = {
  imports: ["style=bold"],
  injects: [],
  handles: ["arrowhead=none", "style=dotted"],
} satisfies Record<Line["kind"], string[]>;

/**
 * Write a model in DOT, the language of Graphviz.
 *
 * - A module is a `cluster`, with what it declares inside.
 * - The shape of a node says its kind: a box for a provider, a rounded one
 *   for a controller, an arrow shape for an endpoint, a dashed hexagon for
 *   what is missing.
 * - A bold arrow is an import, a plain one a dependency (from what injects to
 *   what is injected), and a dotted line joins a controller to an endpoint.
 * - What a module exports has a double border.
 *
 * @param target A root module class, an injector, an application or a model.
 * @param filter What to keep of the model (see `filterGraph`). Default:
 *   everything.
 * @returns The text of the graph, with a line break at its end.
 * @throws {ChoError} When the target or the filter is invalid.
 *
 * @example
 * ```ts
 * await Deno.writeTextFile("app.dot", toDot(AppModule));
 * // dot -Tsvg app.dot -o app.svg
 * ```
 */
export function toDot(target: ChoDevTarget, filter?: ChoDevFilter): string {
  const { modules, lines, exported, ref } = arrange(
    model("toDot()", target, filter),
  );
  const out = [
    "digraph cho {",
    "  compound=true;",
    "  rankdir=LR;",
    '  node [fontname="Helvetica", fontsize=11];',
    '  graph [fontname="Helvetica", fontsize=12];',
  ];
  for (const { module, inside } of modules) {
    out.push(`  subgraph cluster_${ref(module)} {`);
    out.push(`    label=${dot_text(module.name)};`);
    // What a line to the module is joined to: a cluster has no edge of its own.
    out.push(`    ${ref(module)} [${DOT_SHAPES.module}];`);
    for (const node of inside) {
      const attributes = [
        `label=${dot_text(node.name)}`,
        DOT_SHAPES[node.kind],
      ];
      if (exported.has(node.id)) {
        attributes.push("peripheries=2");
      }
      out.push(`    ${ref(node)} [${attributes.join(", ")}];`);
    }
    out.push("  }");
  }
  for (const { kind, from, to } of lines) {
    const attributes: string[] = [...DOT_LINES[kind]];
    if (from.kind === "module") {
      attributes.push(`ltail=cluster_${ref(from)}`);
    }
    if (to.kind === "module") {
      attributes.push(`lhead=cluster_${ref(to)}`);
    }
    const tail = attributes.length > 0 ? ` [${attributes.join(", ")}]` : "";
    out.push(`  ${ref(from)} -> ${ref(to)}${tail};`);
  }
  out.push("}");
  return out.join("\n") + "\n";
}
