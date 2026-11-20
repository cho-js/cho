/**
 * {@link graphPage}: the graph of an application as one HTML page, that
 * filters by kind and by search, and shows what a node is related to.
 *
 * The model is inside the page. The drawing is made in the browser by
 * Cytoscape.js, with the layered layout of ELK: the page loads them from a CDN.
 *
 * @module
 */

import { assert_known_options } from "@chojs/core/di";
import { describe } from "@chojs/core/utils";
import { dev_error } from "./errors.ts";
import { read } from "./inspect.ts";
import type { ChoDevTarget } from "./types.ts";

/**
 * The version of each library {@link graphPage} loads. They are exact: a page
 * does not change until the package does.
 */
export const PAGE_VERSIONS = {
  /** Cytoscape.js draws the graph: the package `cytoscape`. */
  cytoscape: "3.34.0",
  /** ELK lays it out: the package `elkjs`. */
  elkjs: "0.9.3",
  /** What gives a graph of Cytoscape.js to ELK: the package `cytoscape-elk`. */
  "cytoscape-elk": "2.4.0",
} as const;

/** The file of each library, inside its package. */
const FILES = {
  cytoscape: "dist/cytoscape.min.js",
  elkjs: "lib/elk.bundled.js",
  "cytoscape-elk": "dist/cytoscape-elk.js",
} as const satisfies Record<keyof typeof PAGE_VERSIONS, string>;

/** The options of {@link graphPage}. */
export type GraphPageOptions = {
  /** The title of the page. Default: the name of the root module. */
  title?: string;
  /**
   * Where the three files of the libraries are, for who hosts them: the page
   * loads `cytoscape.min.js`, `elk.bundled.js` and `cytoscape-elk.js` from
   * there. Default: the CDN, each at its exact version.
   */
  assets?: string;
};

/** The names of the options, for the error of an unknown one. */
export const PAGE_OPTIONS = ["assets", "title"];

/**
 * Check the options of the page.
 *
 * @param caller The function that was called, for the error message.
 * @param options The options.
 * @param known The names of the options the caller takes.
 * @throws {ChoError} When an option is unknown, or is not a string.
 */
export function assert_page_options(
  caller: string,
  options: unknown,
  known: readonly string[] = PAGE_OPTIONS,
): asserts options is GraphPageOptions {
  if (typeof options !== "object" || options === null) {
    throw dev_error(
      "CHO_DEV_INVALID_OPTION",
      `${caller}: expected options, such as { title: "My application" }, got ${
        describe(options)
      }`,
    );
  }
  assert_known_options(caller, options, known);
  for (const name of PAGE_OPTIONS) {
    const value = (options as Record<string, unknown>)[name];
    if (value !== undefined && typeof value !== "string") {
      throw dev_error(
        "CHO_DEV_INVALID_OPTION",
        `${caller}: "${name}" must be a string, got ${describe(value)}`,
      );
    }
  }
}

/** A text, safe between two tags and inside a quoted attribute. */
function escape_html(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Where each library is loaded from. */
function script_urls(assets: string | undefined): string[] {
  const names = Object.keys(FILES) as (keyof typeof FILES)[];
  if (assets !== undefined) {
    const base = assets.replace(/\/+$/, "");
    return names.map((name) => `${base}/${FILES[name].split("/").pop()}`);
  }
  return names.map((name) =>
    `https://cdn.jsdelivr.net/npm/${name}@${PAGE_VERSIONS[name]}/${FILES[name]}`
  );
}

/**
 * The rules of the filter, as the page runs them: plain JavaScript, with no
 * use of the document. They are the rules of `filterGraph` (`filter.ts`),
 * written a second time for the browser; a test evaluates this text and
 * compares the two.
 */
export const PAGE_RULES = String.raw`
function node_matches(node, by_id, search) {
  var module = by_id.get(node.module);
  var texts = [node.name, module && module.name];
  if (node.kind === "endpoint") {
    texts.push(node.path, node.topic, node.command, node.handler);
  }
  return texts.some(function (text) {
    return typeof text === "string" && text.toLowerCase().indexOf(search) !== -1;
  });
}

function nodes_near(graph, start, depth) {
  var next = new Map();
  function link(a, b) {
    next.set(a, (next.get(a) || []).concat([b]));
    next.set(b, (next.get(b) || []).concat([a]));
  }
  graph.edges.forEach(function (edge) { link(edge.from, edge.to); });
  graph.nodes.forEach(function (node) {
    if (node.kind === "endpoint" && node.controller !== null) {
      link(node.id, node.controller);
    }
  });
  var near = new Set([start]);
  var front = [start];
  for (var step = 0; step < depth && front.length > 0; step++) {
    var reached = [];
    front.forEach(function (id) {
      (next.get(id) || []).forEach(function (other) {
        if (!near.has(other)) {
          near.add(other);
          reached.push(other);
        }
      });
    });
    front = reached;
  }
  return near;
}

function filter_graph(graph, filter) {
  var kinds = filter.kinds;
  var search = (filter.search || "").trim().toLowerCase();
  var depth = filter.depth === undefined ? 1 : filter.depth;
  var by_id = new Map(graph.nodes.map(function (node) { return [node.id, node]; }));
  var near = filter.around !== undefined && by_id.has(filter.around)
    ? nodes_near(graph, filter.around, depth)
    : null;
  function passes(node) {
    if (kinds && kinds.indexOf(node.kind) === -1 &&
        !(node.kind === "endpoint" && kinds.indexOf(node.type) !== -1)) {
      return false;
    }
    if (search !== "" && !node_matches(node, by_id, search)) {
      return false;
    }
    return !near || near.has(node.id);
  }
  var kept = new Set();
  graph.nodes.forEach(function (node) {
    if (passes(node)) {
      kept.add(node.id);
      kept.add(node.module);
      if (node.kind === "endpoint" && node.controller !== null) {
        kept.add(node.controller);
      }
    }
  });
  return {
    root: graph.root,
    nodes: graph.nodes.filter(function (node) { return kept.has(node.id); }),
    edges: graph.edges.filter(function (edge) {
      return kept.has(edge.from) && kept.has(edge.to);
    }),
    error: graph.error
  };
}
`;

/** What the page does with the model: the drawing, the filter, the details. */
const PAGE_UI = String.raw`
(function () {
  var graph = JSON.parse(document.getElementById("cho-graph").textContent);
  var by_id = new Map(graph.nodes.map(function (node) { return [node.id, node]; }));
  function $(id) { return document.getElementById(id); }

  // What the page shows. It is kept in the hash of the address.
  var state = {
    q: "", hide: false, deps: true,
    off: new Set(), selected: null, focus: null, depth: 1
  };
  // The types of endpoints the application has: a switch for each, when it
  // has more than one.
  var TYPE_NAMES = { http: "HTTP", sse: "SSE", ws: "WebSocket", message: "Messages", command: "Commands" };
  var TYPES = Object.keys(TYPE_NAMES).filter(function (type) {
    return graph.nodes.some(function (node) { return node.kind === "endpoint" && node.type === type; });
  });
  if (TYPES.length < 2) TYPES = [];
  TYPES.forEach(function (type) {
    var label = document.createElement("label");
    var box = document.createElement("input");
    box.type = "checkbox";
    box.id = "kind-" + type;
    label.appendChild(box);
    label.appendChild(document.createTextNode(TYPE_NAMES[type]));
    $("types").appendChild(label);
  });
  var SWITCHES = ["provider", "controller", "endpoint"].concat(TYPES);

  function read_hash() {
    var params = new URLSearchParams(location.hash.slice(1));
    state.q = params.get("q") || "";
    state.hide = params.get("hide") === "1";
    state.deps = params.get("deps") !== "0";
    state.off = new Set((params.get("off") || "").split(",").filter(function (kind) {
      return SWITCHES.indexOf(kind) !== -1;
    }));
    state.selected = by_id.has(params.get("s")) ? params.get("s") : null;
    state.focus = by_id.has(params.get("f")) ? params.get("f") : null;
    var depth = parseInt(params.get("d") || "1", 10);
    state.depth = depth >= 0 && depth <= 9 ? depth : 1;
  }

  function write_hash() {
    var params = new URLSearchParams();
    if (state.q) params.set("q", state.q);
    if (state.hide) params.set("hide", "1");
    if (!state.deps) params.set("deps", "0");
    if (state.off.size) params.set("off", Array.from(state.off).join(","));
    if (state.selected) params.set("s", state.selected);
    if (state.focus) { params.set("f", state.focus); params.set("d", String(state.depth)); }
    var hash = params.toString();
    history.replaceState(null, "", hash ? "#" + hash : location.pathname + location.search);
  }

  function search_text() { return state.q.trim().toLowerCase(); }

  // The part of the model the switches, the search and the focus keep.
  function shown() {
    var kinds = ["module", "missing"];
    ["provider", "controller"].forEach(function (kind) {
      if (!state.off.has(kind)) kinds.push(kind);
    });
    if (!state.off.has("endpoint")) {
      var on = TYPES.filter(function (type) { return !state.off.has(type); });
      // Every type, or the types that are left on.
      if (on.length === TYPES.length) kinds.push("endpoint"); else kinds = kinds.concat(on);
    }
    var filter = { kinds: kinds };
    if (state.hide) filter.search = state.q;
    if (state.focus) { filter.around = state.focus; filter.depth = state.depth; }
    return filter_graph(graph, filter);
  }

  function color(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function label_width(node) {
    // The point of an endpoint takes a part of its width.
    var point = node.data("kind") === "endpoint" ? 22 : 0;
    return Math.max(48, node.data("label").length * 7.2 + 20 + point);
  }

  function style() {
    return [
      { selector: "node", style: {
        "label": "data(label)", "font-size": 12, "font-family": "ui-sans-serif, system-ui, sans-serif",
        "color": color("--text"), "text-valign": "center", "text-halign": "center",
        "shape": "round-rectangle", "width": label_width, "height": 30,
        "background-color": color("--provider"), "border-width": 1, "border-color": color("--line")
      } },
      { selector: "node[kind = 'controller']", style: { "background-color": color("--controller") } },
      { selector: "node[kind = 'endpoint']", style: {
        "background-color": color("--endpoint"), "shape": "tag", "font-family": "ui-monospace, monospace", "font-size": 11
      } },
      { selector: "node[kind = 'missing']", style: {
        "background-color": color("--surface"), "border-style": "dashed", "border-width": 2,
        "border-color": color("--danger"), "color": color("--danger")
      } },
      { selector: "node[kind = 'module']", style: {
        "background-color": color("--module"), "border-color": color("--module-line"), "border-width": 1.5,
        "font-weight": "bold", "font-size": 13, "shape": "round-rectangle"
      } },
      { selector: "node:parent", style: {
        "text-valign": "top", "text-halign": "center", "text-margin-y": -4,
        "padding": 14, "background-opacity": 0.55
      } },
      { selector: "node.exported", style: { "border-width": 3, "border-style": "double", "border-color": color("--accent") } },
      { selector: "edge", style: {
        "curve-style": "bezier", "width": 1.2, "line-color": color("--edge"),
        "target-arrow-color": color("--edge"), "target-arrow-shape": "triangle", "arrow-scale": 0.9
      } },
      { selector: "edge[kind = 'imports']", style: {
        "width": 2.6, "line-color": color("--module-line"), "target-arrow-color": color("--module-line")
      } },
      { selector: "edge[kind = 'handles']", style: { "line-style": "dotted", "target-arrow-shape": "none" } },
      { selector: ".hit", style: { "border-width": 3, "border-color": color("--accent"), "border-style": "solid" } },
      { selector: ".dim", style: { "opacity": 0.16 } },
      { selector: "node.picked", style: { "border-width": 4, "border-color": color("--accent"), "border-style": "solid" } },
      { selector: "edge.lit", style: {
        "width": 2.6, "line-color": color("--accent"), "target-arrow-color": color("--accent"), "z-index": 9
      } }
    ];
  }

  // The model as the elements of the drawing. A module holds what it
  // declares; an endpoint is joined to its controller by a line.
  function elements(part) {
    var ids = new Set(part.nodes.map(function (node) { return node.id; }));
    var exported = new Set();
    part.edges.forEach(function (edge) { if (edge.kind === "exports") exported.add(edge.to); });
    var out = [];
    part.nodes.forEach(function (node) {
      var data = { id: node.id, label: node.name, kind: node.kind };
      if (node.kind !== "module") data.parent = node.module;
      out.push({ group: "nodes", data: data, classes: exported.has(node.id) ? "exported" : "" });
    });
    var count = 0;
    function line(kind, from, to) {
      out.push({ group: "edges", data: { id: "e" + count++, source: from, target: to, kind: kind } });
    }
    part.edges.forEach(function (edge) {
      var from = by_id.get(edge.from), to = by_id.get(edge.to);
      if (edge.kind === "exports") return;
      if (edge.kind === "injects" && !state.deps) return;
      // A box cannot be joined to what is inside it.
      if (from.module === to.id || to.module === from.id) return;
      line(edge.kind, edge.from, edge.to);
    });
    part.nodes.forEach(function (node) {
      if (node.kind === "endpoint" && node.controller !== null && ids.has(node.controller)) {
        line("handles", node.controller, node.id);
      }
    });
    return out;
  }

  var cy = null;

  function draw(fit) {
    var part = shown();
    if (state.selected && !part.nodes.some(function (node) { return node.id === state.selected; })) {
      state.selected = null;
    }
    $("count").textContent = part.nodes.length + " of " + graph.nodes.length + " nodes";
    if (cy) {
      cy.elements().remove();
      cy.add(elements(part));
      cy.layout({
        name: "elk", fit: fit, padding: 30, animate: false, nodeDimensionsIncludeLabels: true,
        useElkEdgeGeometry: true, elkEdgeRadius: 8,
        elk: {
          "algorithm": "layered",
          "elk.direction": "RIGHT",
          "elk.hierarchyHandling": "INCLUDE_CHILDREN",
          "elk.spacing.nodeNode": 22,
          "elk.layered.spacing.nodeNodeBetweenLayers": 56,
          "elk.spacing.edgeNode": 18,
          "elk.padding": "[top=30,left=16,bottom=16,right=16]"
        }
      }).run();
    }
    mark();
    details();
    write_hash();
  }

  // Light what the search finds and what is next to the selection.
  function mark() {
    if (!cy) return;
    var search = search_text();
    cy.elements().removeClass("hit dim picked lit");
    if (state.selected) {
      var picked = cy.getElementById(state.selected);
      var lit = picked.closedNeighborhood().union(picked.ancestors());
      if (picked.isParent()) lit = lit.union(picked.descendants());
      cy.elements().not(lit).addClass("dim");
      picked.addClass("picked");
      picked.connectedEdges().addClass("lit");
    } else if (search !== "" && !state.hide) {
      cy.nodes().forEach(function (ele) {
        var node = by_id.get(ele.id());
        if (node_matches(node, by_id, search)) ele.addClass("hit");
        else if (!ele.isParent()) ele.addClass("dim");
      });
      cy.edges().addClass("dim");
    }
  }

  function el(tag, text, class_name) {
    var out = document.createElement(tag);
    if (text !== undefined) out.textContent = text;
    if (class_name) out.className = class_name;
    return out;
  }

  function select(id) {
    state.selected = id;
    // A node the filter hides is shown with what is near it.
    if (cy && id && cy.getElementById(id).empty()) {
      state.focus = id;
      draw(true);
      return;
    }
    mark();
    details();
    write_hash();
    if (cy && id) {
      var picked = cy.getElementById(id);
      if (!picked.empty()) cy.animate({ center: { eles: picked } }, { duration: 200 });
    }
  }

  function node_button(id) {
    var node = by_id.get(id);
    var button = el("button", node ? node.name : id, "link");
    button.type = "button";
    if (node) {
      button.appendChild(el("span", node.kind === "endpoint" ? node.type : node.kind, "tag"));
    }
    button.addEventListener("click", function () { select(id); });
    return button;
  }

  function list(parent, title, ids) {
    if (ids.length === 0) return;
    parent.appendChild(el("h3", title + " (" + ids.length + ")"));
    var ul = el("ul");
    ids.forEach(function (id) {
      var li = el("li");
      li.appendChild(node_button(id));
      ul.appendChild(li);
    });
    parent.appendChild(ul);
  }

  function field(parent, name, value) {
    if (value === undefined || value === null || value === "") return;
    var row = el("p", undefined, "field");
    row.appendChild(el("span", name, "name"));
    row.appendChild(el("span", String(value), "value"));
    parent.appendChild(row);
  }

  function edges_of(kind, id, end) {
    var other = end === "from" ? "to" : "from";
    return graph.edges
      .filter(function (edge) { return edge.kind === kind && edge[end] === id; })
      .map(function (edge) { return edge[other]; });
  }

  // The side of the page: the selected node, or what the search finds.
  function details() {
    var side = $("details");
    side.textContent = "";
    var node = state.selected ? by_id.get(state.selected) : null;
    if (!node) {
      var search = search_text();
      if (search === "") {
        side.appendChild(el("p", "Select a node to see what it is related to.", "hint"));
        side.appendChild(el("p", "Thick arrows are imports. Thin arrows go from what injects to what is injected. A double border marks what a module exports.", "hint"));
        return;
      }
      var found = graph.nodes.filter(function (other) { return node_matches(other, by_id, search); });
      list(side, "Matches", found.slice(0, 200).map(function (other) { return other.id; }));
      if (found.length === 0) side.appendChild(el("p", "Nothing matches.", "hint"));
      return;
    }
    side.appendChild(el("h2", node.name));
    var kind = node.kind === "endpoint" ? node.type + " endpoint" : node.kind;
    side.appendChild(el("p", kind + (node.root ? ", the root" : "") + (node.mounted ? ", mounted" : ""), "kind"));

    var actions = el("p", undefined, "actions");
    var only = el("button", state.focus === node.id ? "Show everything" : "Only this and what is near", "action");
    only.type = "button";
    only.addEventListener("click", function () {
      state.focus = state.focus === node.id ? null : node.id;
      draw(true);
    });
    actions.appendChild(only);
    if (state.focus === node.id) {
      var steps = el("select");
      steps.setAttribute("aria-label", "Steps");
      [1, 2, 3, 4].forEach(function (n) {
        var option = el("option", n + (n === 1 ? " step" : " steps"));
        option.value = String(n);
        option.selected = n === state.depth;
        steps.appendChild(option);
      });
      steps.addEventListener("change", function () {
        state.depth = parseInt(steps.value, 10);
        draw(true);
      });
      actions.appendChild(steps);
    }
    side.appendChild(actions);

    if (node.kind !== "module") {
      side.appendChild(el("h3", "Module"));
      var p = el("p");
      p.appendChild(node_button(node.module));
      side.appendChild(p);
    }
    if (node.kind === "endpoint") {
      field(side, "Method", node.method);
      field(side, "Path", node.path);
      field(side, "Topic", node.topic);
      field(side, "Command", node.command);
      field(side, "Handler", node.handler);
      field(side, "Events", node.events && node.events.join(", "));
      if (node.controller) list(side, "Controller", [node.controller]);
    }
    if (node.kind === "provider") field(side, "Token", node.token);
    if (node.middlewares && node.middlewares.length) field(side, "Middlewares", node.middlewares.join(", "));
    field(side, "Error handler", node.errorHandler);

    if (node.kind === "module") {
      list(side, "Imports", edges_of("imports", node.id, "from"));
      list(side, "Imported by", edges_of("imports", node.id, "to"));
      list(side, "Exports", edges_of("exports", node.id, "from"));
      list(side, "Declares", graph.nodes.filter(function (other) {
        return other.module === node.id && other.id !== node.id && other.kind !== "endpoint";
      }).map(function (other) { return other.id; }));
    }
    if (node.kind === "controller") {
      list(side, "Endpoints", graph.nodes.filter(function (other) {
        return other.kind === "endpoint" && other.controller === node.id;
      }).map(function (other) { return other.id; }));
    }
    list(side, "Injects", edges_of("injects", node.id, "from"));
    list(side, "Injected by", edges_of("injects", node.id, "to"));
    list(side, "Exported by", edges_of("exports", node.id, "to"));
  }

  function sync_controls() {
    $("search").value = state.q;
    $("hide").checked = state.hide;
    $("deps").checked = state.deps;
    SWITCHES.forEach(function (kind) { $("kind-" + kind).checked = !state.off.has(kind); });
    TYPES.forEach(function (type) { $("kind-" + type).disabled = state.off.has("endpoint"); });
  }

  read_hash();
  sync_controls();

  if (graph.error) {
    $("error").hidden = false;
    $("error-code").textContent = graph.error.code;
    $("error-message").textContent = graph.error.message;
  }

  if (typeof cytoscape === "function" && typeof ELK === "function") {
    cy = cytoscape({
      container: $("cy"), style: style(),
      minZoom: 0.08, maxZoom: 3, boxSelectionEnabled: false
    });
    cy.on("tap", "node", function (event) { select(event.target.id()); });
    cy.on("tap", function (event) { if (event.target === cy) select(null); });
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", function () {
      cy.style(style());
    });
  } else {
    $("cy").appendChild(el("p", "The drawing needs Cytoscape.js and ELK, and they could not be loaded. The search and the details still work.", "hint"));
  }

  var timer = null;
  $("search").addEventListener("input", function () {
    state.q = $("search").value;
    clearTimeout(timer);
    timer = setTimeout(function () {
      if (state.hide) draw(false); else { mark(); details(); write_hash(); }
    }, 120);
  });
  $("hide").addEventListener("change", function () { state.hide = $("hide").checked; draw(true); });
  $("deps").addEventListener("change", function () { state.deps = $("deps").checked; draw(false); });
  SWITCHES.forEach(function (kind) {
    $("kind-" + kind).addEventListener("change", function () {
      if ($("kind-" + kind).checked) state.off.delete(kind); else state.off.add(kind);
      sync_controls();
      draw(true);
    });
  });
  $("fit").addEventListener("click", function () { if (cy) cy.fit(undefined, 30); });
  $("reset").addEventListener("click", function () {
    state = { q: "", hide: false, deps: true, off: new Set(), selected: null, focus: null, depth: 1 };
    sync_controls();
    draw(true);
  });
  document.addEventListener("keydown", function (event) {
    var typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
    if (event.key === "/" && !typing) { event.preventDefault(); $("search").focus(); }
    if (event.key === "Escape") { if (typing) document.activeElement.blur(); else select(null); }
  });
  window.addEventListener("hashchange", function () { read_hash(); sync_controls(); draw(true); });

  draw(true);
})();
`;

const STYLE = `
:root {
  color-scheme: light dark;
  --page: #f6f7f9; --surface: #ffffff; --text: #1c2330; --muted: #5d6778;
  --line: #c9d0db; --edge: #8793a5; --accent: #d9480f; --danger: #c92a2a;
  --module: #e8edf5; --module-line: #4c6a9c; --provider: #ffffff;
  --controller: #e3f2e6; --endpoint: #fff1dc;
}
@media (prefers-color-scheme: dark) {
  :root {
    --page: #14171c; --surface: #1c2027; --text: #e6e9ef; --muted: #9aa5b5;
    --line: #3a4352; --edge: #6f7b8d; --accent: #ff8a4c; --danger: #ff8787;
    --module: #232a36; --module-line: #7fa2d9; --provider: #2a303a;
    --controller: #22382a; --endpoint: #3d3222;
  }
}
* { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body {
  display: flex; flex-direction: column; background: var(--page); color: var(--text);
  font: 14px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
header {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px;
  padding: 10px 16px; background: var(--surface); border-bottom: 1px solid var(--line);
}
h1 { margin: 0; font-size: 16px; }
header label { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
#search {
  flex: 1 1 200px; max-width: 320px; padding: 6px 10px; font: inherit; color: inherit;
  background: var(--page); border: 1px solid var(--line); border-radius: 6px;
}
#types { display: contents; color: var(--muted); }
.swatch { width: 11px; height: 11px; border: 1px solid var(--line); border-radius: 3px; }
button, select {
  font: inherit; color: inherit; background: var(--page);
  border: 1px solid var(--line); border-radius: 6px; padding: 5px 10px; cursor: pointer;
}
:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
#count { color: var(--muted); font-variant-numeric: tabular-nums; }
#error {
  margin: 0; padding: 8px 16px; background: var(--surface); color: var(--danger);
  border-bottom: 1px solid var(--danger);
}
#error code { font-weight: 600; margin-right: 8px; }
main { flex: 1; display: flex; min-height: 0; }
#cy { flex: 1; min-width: 0; position: relative; }
#cy > .hint { padding: 24px; }
aside {
  flex: 0 0 300px; overflow: auto; padding: 14px 16px;
  background: var(--surface); border-left: 1px solid var(--line);
}
aside h2 { margin: 0; font-size: 16px; overflow-wrap: anywhere; }
aside h3 {
  margin: 16px 0 4px; font-size: 11px; font-weight: 600; color: var(--muted);
  text-transform: uppercase; letter-spacing: 0.06em;
}
aside ul { list-style: none; margin: 0; padding: 0; }
aside p { margin: 4px 0; }
.kind, .hint { color: var(--muted); }
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin: 10px 0 0; }
.field { display: flex; gap: 8px; }
.field .name { flex: 0 0 96px; color: var(--muted); }
.field .value { overflow-wrap: anywhere; font-family: ui-monospace, monospace; font-size: 13px; }
.link {
  display: flex; justify-content: space-between; align-items: baseline; gap: 8px; width: 100%;
  padding: 3px 6px; border: 0; background: none; text-align: left; overflow-wrap: anywhere;
}
.link:hover { background: var(--page); }
.tag { flex: none; color: var(--muted); font-size: 11px; }
@media (max-width: 720px) {
  main { flex-direction: column; }
  aside { flex: 0 0 40%; border-left: 0; border-top: 1px solid var(--line); }
}
`;

/**
 * Make the page of an application: its graph, drawn, with a filter by kind,
 * a search, and the details of the node that is selected.
 *
 * It is one HTML file, with the model inside it: write it to a file and open
 * it, or serve it. It reads the metadata of the application: nothing is
 * created.
 *
 * On the page:
 *
 * - a module is a box that holds what it declares; a thick arrow is an
 *   import, a thin one goes from what injects to what is injected, and a
 *   dotted line joins a controller to its endpoints;
 * - the switches hide the providers, the controllers, the endpoints or the
 *   dependencies;
 * - the search lights what it finds, by name, path, topic or module, or
 *   hides the rest;
 * - a node that is selected shows what it injects, what injects it and what
 *   exports it, and can be shown alone with what is near it;
 * - the address of the page keeps all of it, so a view can be sent.
 *
 * The drawing is made by Cytoscape.js and ELK, loaded from a CDN at the
 * versions of {@link PAGE_VERSIONS}: the page needs the network, unless
 * `assets` says where the files are. No name of the application is written
 * as HTML.
 *
 * @param target A root module class, an injector, an application or a model.
 * @param options `title` and `assets`.
 * @returns The HTML of the page.
 * @throws {ChoError} When the target or an option is invalid.
 *
 * @example
 * ```ts
 * await Deno.writeTextFile("graph.html", graphPage(AppModule));
 * ```
 */
export function graphPage(
  target: ChoDevTarget,
  options: GraphPageOptions = {},
): string {
  const graph = read("graphPage()", target);
  assert_page_options("graphPage()", options);
  const root = graph.nodes.find((node) => node.id === graph.root);
  const title = escape_html(options.title ?? root?.name ?? "Application");
  // "<" is written as an escape: a name cannot close the script element.
  const data = JSON.stringify(graph).replace(/</g, "\\u003c");
  const scripts = script_urls(options.assets)
    .map((url) => `<script src="${escape_html(url)}"></script>`)
    .join("\n");
  const kind = (id: string, name: string) =>
    `<label><input type="checkbox" id="kind-${id}" checked><span class="swatch" style="background: var(--${id})"></span>${name}</label>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
<h1>${title}</h1>
<input id="search" type="search" placeholder="Search: a name, a path, a topic (/)" aria-label="Search">
${kind("provider", "Providers")}
${kind("controller", "Controllers")}
${kind("endpoint", "Endpoints")}
<span id="types"></span>
<label><input type="checkbox" id="deps" checked>Dependencies</label>
<label><input type="checkbox" id="hide">Hide what does not match</label>
<button type="button" id="fit">Fit</button>
<button type="button" id="reset">Reset</button>
<span id="count" role="status"></span>
</header>
<p id="error" role="alert" hidden><code id="error-code"></code><span id="error-message"></span></p>
<main>
<div id="cy" aria-label="The graph of the application"></div>
<aside id="details" aria-live="polite"></aside>
</main>
<script type="application/json" id="cho-graph">${data}</script>
${scripts}
<script>${PAGE_RULES}${PAGE_UI}</script>
</body>
</html>
`;
}
