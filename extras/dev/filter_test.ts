/**
 * Tests for `filter.ts`: the part of a model a filter keeps. The same filters
 * are given to the rules of the page (`PAGE_RULES` of `page.ts`), which must
 * keep the same part.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isChoError } from "@chojs/core";
import { engine } from "@chojs/core/utils";
import { loose } from "@chojs/core/utils/test_utils";
import { filterGraph } from "./filter.ts";
import { inspect } from "./inspect.ts";
import { PAGE_RULES } from "./page.ts";
import { shop } from "./testing.ts";
import type { ChoDevFilter, ChoDevGraph } from "./types.ts";

const ids = (graph: ChoDevGraph): string[] =>
  graph.nodes.map((node) => node.id);

const lines = (graph: ChoDevGraph): string[] =>
  graph.edges.map((edge) => `${edge.kind} ${edge.from} -> ${edge.to}`);

/** Filters that cover every rule, alone and together. */
const FILTERS: ChoDevFilter[] = [
  {},
  { kinds: ["module"] },
  { kinds: ["provider"] },
  { kinds: ["controller", "endpoint"] },
  { kinds: ["message", "ws"] },
  { kinds: [] },
  { search: "users" },
  { search: "  ORDERS  " },
  { search: "/chat" },
  { search: "build" },
  { search: "nothing has this name" },
  { around: "UsersModule/UsersService" },
  { around: "UsersModule/UsersService", depth: 0 },
  { around: "UsersModule/UsersService", depth: 2 },
  { around: "App", depth: 9 },
  { around: "ChatModule/ChatController.join" },
  { kinds: ["provider"], search: "service" },
  { kinds: ["endpoint"], around: "UsersModule/UsersController", depth: 1 },
];

describe("filterGraph", () => {
  it("keeps the whole model when no rule is given", () => {
    const graph = inspect(shop().App);
    assert.deepEqual(filterGraph(graph), graph);
    assert.deepEqual(filterGraph(graph, {}), graph);
    assert.notEqual(filterGraph(graph), graph);
  });

  it("keeps the kinds that are asked for", () => {
    const { App } = shop();
    const modules = filterGraph(App, { kinds: ["module"] });
    assert.deepEqual(ids(modules), [
      "App",
      "UsersModule",
      "SharedModule",
      "OrdersModule",
      "ChatModule",
      "ToolsModule",
    ]);
    assert.deepEqual(lines(modules), [
      "imports App -> UsersModule",
      "imports App -> OrdersModule",
      "imports App -> ChatModule",
      "imports App -> ToolsModule",
      "imports UsersModule -> SharedModule",
      "imports OrdersModule -> SharedModule",
      "imports OrdersModule -> UsersModule",
    ]);
  });

  it("keeps the module of a node, and the controller of an endpoint", () => {
    const { App } = shop();
    assert.deepEqual(ids(filterGraph(App, { kinds: ["ws"] })), [
      "ChatModule",
      "ChatModule/ChatController",
      "ChatModule/ChatController.join",
    ]);
    assert.deepEqual(ids(filterGraph(App, { kinds: ["message", "command"] })), [
      "OrdersModule",
      "OrdersModule/OrdersEvents",
      "OrdersModule/OrdersEvents.paid",
      "OrdersModule/OrdersEvents.refunded",
      "ToolsModule",
      "ToolsModule/Tools",
      "ToolsModule/Tools.build",
    ]);
  });

  it("keeps every type of endpoint for the kind endpoint", () => {
    const kept = filterGraph(shop().App, { kinds: ["endpoint"] });
    const endpoints = kept.nodes.filter((node) => node.kind === "endpoint");
    assert.equal(endpoints.length, 8);
  });

  it("finds a text in a name, a path, a topic, a command or a handler", () => {
    const { App } = shop();
    assert.deepEqual(ids(filterGraph(App, { search: "/chat" })), [
      "ChatModule",
      "ChatModule/ChatController",
      "ChatModule/ChatController.join",
    ]);
    assert.deepEqual(ids(filterGraph(App, { search: "refunded" })), [
      "OrdersModule",
      "OrdersModule/OrdersEvents",
      "OrdersModule/OrdersEvents.refunded",
    ]);
    assert.deepEqual(ids(filterGraph(App, { search: "LOGGER" })), [
      "SharedModule",
      "SharedModule/Logger",
    ]);
  });

  it("finds everything a module declares by the name of the module", () => {
    assert.deepEqual(ids(filterGraph(shop().App, { search: "toolsmod" })), [
      "ToolsModule",
      "ToolsModule/Tools",
      "ToolsModule/Tools.build",
    ]);
  });

  it("keeps a node and what is within some steps of it", () => {
    const { App } = shop();
    const service = "UsersModule/UsersService";
    assert.deepEqual(ids(filterGraph(App, { around: service, depth: 0 })), [
      "UsersModule",
      service,
    ]);
    // What it injects, what injects it, and what exports it.
    assert.deepEqual(ids(filterGraph(App, { around: service })), [
      "UsersModule",
      service,
      "UsersModule/UsersController",
      "SharedModule",
      "SharedModule/Logger",
      "OrdersModule",
      "OrdersModule/OrdersService",
    ]);
    // A step goes between a controller and its endpoints.
    const two = ids(filterGraph(App, { around: service, depth: 2 }));
    assert.ok(two.includes("UsersModule/UsersController.list"));
    assert.ok(two.includes("OrdersModule/OrdersEvents"));
    assert.ok(!two.includes("OrdersModule/OrdersEvents.paid"));
  });

  it("keeps an edge when both its ends are kept", () => {
    const kept = filterGraph(shop().App, { kinds: ["provider"] });
    assert.deepEqual(lines(kept), [
      "imports UsersModule -> SharedModule",
      "exports UsersModule -> UsersModule/UsersService",
      "injects UsersModule/UsersService -> SharedModule/Logger",
      "exports SharedModule -> SharedModule/InjectionToken(CONFIG)",
      "exports SharedModule -> SharedModule/Logger",
      "imports OrdersModule -> SharedModule",
      "imports OrdersModule -> UsersModule",
      "injects OrdersModule/OrdersService -> UsersModule/UsersService",
      "injects OrdersModule/OrdersService -> SharedModule/InjectionToken(CONFIG)",
    ]);
  });

  it("does not change the model it is given, and keeps its root and its error", () => {
    const graph = inspect(shop().App);
    const before = JSON.stringify(graph);
    const kept = filterGraph(graph, { search: "chat" });
    assert.equal(JSON.stringify(graph), before);
    assert.equal(kept.root, "App");
    assert.equal(kept.error, null);
  });

  it("refuses a node the model has not: CHO_DEV_UNKNOWN_NODE", () => {
    assert.throws(
      () => filterGraph(shop().App, { around: "UsersModule/Nobody" }),
      (error) =>
        isChoError(error, "CHO_DEV_UNKNOWN_NODE") &&
        error.message ===
          'filterGraph(): the graph has no node "UsersModule/Nobody"',
    );
  });

  it("refuses a rule it does not know, and a rule that is not valid", () => {
    const { App } = shop();
    assert.throws(
      () => filterGraph(App, loose({ kind: ["module"] })),
      (error) =>
        isChoError(error, "CHO_CORE_UNKNOWN_OPTION") &&
        /^filterGraph\(\): unknown option "kind". Known options: around, depth, kinds, search$/
          .test(error.message),
    );
    const invalid: [unknown, RegExp][] = [
      [null, /expected a filter/],
      [["module"], /expected a filter/],
      [{ kinds: "module" }, /"kinds" must be an array/],
      [{ kinds: ["service"] }, /unknown kind "service"/],
      [{ search: 5 }, /"search" must be a string/],
      [{ around: 5 }, /"around" must be the id of a node/],
      [{ depth: -1 }, /"depth" must be a whole number/],
      [{ depth: 1.5 }, /"depth" must be a whole number/],
    ];
    for (const [filter, message] of invalid) {
      assert.throws(
        () => filterGraph(App, loose(filter)),
        (error) =>
          isChoError(error, "CHO_DEV_INVALID_OPTION") &&
          message.test(error.message),
        JSON.stringify(filter),
      );
    }
  });
});

describe("the rules of the page", {
  // The text of the rules is evaluated, which Workers do not allow.
  skip: engine() === "workerd" && "this runtime does not evaluate code",
}, () => {
  const filter_graph = new Function(
    `${PAGE_RULES}; return filter_graph;`,
  )() as (graph: ChoDevGraph, filter: ChoDevFilter) => ChoDevGraph;

  it("keep what filterGraph keeps, for every filter", () => {
    const graph = inspect(shop().App);
    for (const filter of FILTERS) {
      assert.deepEqual(
        filter_graph(graph, filter),
        filterGraph(graph, filter),
        JSON.stringify(filter),
      );
    }
  });

  it("keep what filterGraph keeps of a broken application", () => {
    const graph: ChoDevGraph = {
      ...inspect(shop().App),
      error: { code: "CHO_CORE_UNRESOLVED_DEPENDENCY", message: "broken" },
    };
    graph.nodes.push({
      id: "App/?Mailer",
      kind: "missing",
      name: "Mailer",
      module: "App",
    });
    for (const filter of FILTERS) {
      assert.deepEqual(
        filter_graph(graph, filter),
        filterGraph(graph, filter),
        JSON.stringify(filter),
      );
    }
  });

  it("show everything for a node the model has not", () => {
    const graph = inspect(shop().App);
    assert.deepEqual(filter_graph(graph, { around: "Nobody" }), graph);
  });
});
