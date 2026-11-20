/**
 * Tests for `text.ts`: a model as the text of a Mermaid flowchart, and of a
 * graph of Graphviz.
 *
 * Decorators are applied as plain function calls.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Injectable, isChoError, Module } from "@chojs/core";
import { loose } from "@chojs/core/utils/test_utils";
import { toDot, toMermaid } from "./text.ts";
import { type Class, named, shop } from "./testing.ts";

/**
 * A small application: `Users` of the root injects `Logger`, which `Shared`
 * declares and exports; `Empty` declares nothing.
 */
function small(logger = "Logger"): Class {
  const Logger = named(logger);
  Injectable()(Logger);
  const Shared = named("Shared");
  Module({ providers: [Logger], exports: [Logger] })(Shared);
  const Empty = named("Empty");
  Module({})(Empty);
  const Users = named("Users");
  Injectable(loose([Logger]))(loose(Users));
  const App = named("App");
  Module({ imports: [Shared, Empty], providers: [Users] })(App);
  return App;
}

/** An application with a dependency nothing gives. */
function broken(): Class {
  const Mailer = named("Mailer");
  Injectable()(Mailer);
  const Orders = named("Orders");
  Injectable(loose([Mailer]))(loose(Orders));
  const App = named("App");
  Module({ providers: [Orders] })(App);
  return App;
}

describe("toMermaid", () => {
  it("writes a flowchart: a subgraph for a module, an arrow for an edge", () => {
    assert.equal(
      toMermaid(small()),
      `flowchart LR
  subgraph n0["App"]
    n1["Users"]
  end
  subgraph n2["Shared"]
    n3["Logger"]
  end
  n4[["Empty"]]
  n0 ==> n2
  n0 ==> n4
  n1 --> n3
  classDef exported stroke-width:3px
  class n3 exported
`,
    );
  });

  it("gives each kind a shape, and a controller a line to its endpoints", () => {
    const text = toMermaid(shop().App, { search: "chat" });
    assert.equal(
      text,
      `flowchart LR
  subgraph n0["ChatModule"]
    n1(["ChatController"])
    n2[/"WS /chat/:room"/]
  end
  n1 --- n2
`,
    );
  });

  it("marks what is missing", () => {
    assert.equal(
      toMermaid(broken()),
      `flowchart LR
  subgraph n0["App"]
    n1["Orders"]
    n2{{"Mailer"}}
  end
  n1 --> n2
  classDef missing stroke-dasharray:4 4
  class n2 missing
`,
    );
  });

  it("leaves out a line between a node and the module that holds it", () => {
    const App = named("App");
    const Reader = named("Reader");
    Injectable(loose([App]))(loose(Reader));
    Module({ providers: [Reader] })(App);
    assert.equal(
      toMermaid(App),
      'flowchart LR\n  subgraph n0["App"]\n    n1["Reader"]\n  end\n',
    );
  });

  it("writes a name as text, whatever it holds", () => {
    const text = toMermaid(small('a "b" <c> #d `e`\n&f'));
    assert.ok(
      text.includes('n3["a #34;b#34; #60;c#62; #35;d #96;e#96; #38;f"]'),
      text,
    );
  });

  it("keeps what a filter keeps", () => {
    assert.equal(
      toMermaid(small(), { kinds: ["module"] }),
      `flowchart LR
  n0[["App"]]
  n1[["Shared"]]
  n2[["Empty"]]
  n0 ==> n1
  n0 ==> n2
`,
    );
  });

  it("refuses a target and a filter that are not valid", () => {
    assert.throws(
      () => toMermaid(loose(null)),
      (error) =>
        isChoError(error, "CHO_DEV_INVALID_TARGET") &&
        error.message.startsWith("toMermaid():"),
    );
    assert.throws(
      () => toMermaid(small(), loose({ kinds: ["nothing"] })),
      (error) => isChoError(error, "CHO_DEV_INVALID_OPTION"),
    );
  });
});

describe("toDot", () => {
  it("writes a graph: a cluster for a module, an arrow for an edge", () => {
    assert.equal(
      toDot(small()),
      `digraph cho {
  compound=true;
  rankdir=LR;
  node [fontname="Helvetica", fontsize=11];
  graph [fontname="Helvetica", fontsize=12];
  subgraph cluster_n0 {
    label="App";
    n0 [shape=point, style=invis, width=0, height=0];
    n1 [label="Users", shape=box];
  }
  subgraph cluster_n2 {
    label="Shared";
    n2 [shape=point, style=invis, width=0, height=0];
    n3 [label="Logger", shape=box, peripheries=2];
  }
  subgraph cluster_n4 {
    label="Empty";
    n4 [shape=point, style=invis, width=0, height=0];
  }
  n0 -> n2 [style=bold, ltail=cluster_n0, lhead=cluster_n2];
  n0 -> n4 [style=bold, ltail=cluster_n0, lhead=cluster_n4];
  n1 -> n3;
}
`,
    );
  });

  it("gives each kind a shape, and a controller a line to its endpoints", () => {
    const text = toDot(shop().App, { search: "chat" });
    assert.ok(
      text.includes('n1 [label="ChatController", shape=box, style="rounded"];'),
    );
    assert.ok(text.includes('n2 [label="WS /chat/:room", shape=cds];'));
    assert.ok(text.includes("n1 -> n2 [arrowhead=none, style=dotted];"));
  });

  it("marks what is missing", () => {
    assert.ok(
      toDot(broken()).includes(
        'n2 [label="Mailer", shape=hexagon, style="dashed"];',
      ),
    );
  });

  it("writes a name as a string, whatever it holds", () => {
    const text = toDot(small('a "b" \\c\nd'));
    assert.ok(
      text.includes('n3 [label="a \\"b\\" \\\\c\\nd", shape=box'),
      text,
    );
  });

  it("refuses a target that is not valid", () => {
    assert.throws(
      () => toDot(loose(5)),
      (error) =>
        isChoError(error, "CHO_DEV_INVALID_TARGET") &&
        error.message.startsWith("toDot():"),
    );
  });
});
