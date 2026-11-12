/**
 * Tests for `graph.ts`: how `command_graph` picks the mode and rejects
 * misconfigured applications.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Controller, Injector, Module } from "@chojs/core/di";
import type { Ctr } from "@chojs/core/di";
import { Action, Help, Main } from "./decorators.ts";
import { command_graph } from "./graph.ts";
import { ALIAS, command_record } from "./keys.ts";
import { legacy } from "@chojs/core/utils/test_utils";

/** The `[controller, method]` pairs of a graph, by name. */
function names(app: Ctr): [string, string, unknown][] {
  return command_graph(new Injector(app)).actions.map(([node, method]) => [
    (node.token as Ctr).name,
    method.name,
    command_record(method.meta)[ALIAS],
  ]);
}

describe("command_graph", () => {
  it("is in main mode with exactly one @Main", () => {
    class Cli {
      run() {}
    }
    legacy(Main(), Cli, "run");
    Controller()(Cli);
    class App {}
    Module({ controllers: [Cli] })(App);

    const graph = command_graph(new Injector(App));
    assert.equal(graph.mode, "main");
    assert.deepEqual(names(App), [["Cli", "run", "main"]]);
  });

  it("is in actions mode with @Action methods, across controllers", () => {
    class Files {
      copy() {}
      remove() {}
    }
    legacy(Action("cp"), Files, "copy");
    legacy(Action("rm"), Files, "remove");
    Controller()(Files);
    class Net {
      get() {}
    }
    legacy(Action("get"), Net, "get");
    Controller()(Net);
    class App {}
    Module({ controllers: [Files, Net] })(App);

    const graph = command_graph(new Injector(App));
    assert.equal(graph.mode, "actions");
    assert.deepEqual(names(App), [
      ["Files", "copy", "cp"],
      ["Files", "remove", "rm"],
      ["Net", "get", "get"],
    ]);
  });

  it("collects controllers of imported modules", () => {
    class Files {
      copy() {}
    }
    legacy(Action("cp"), Files, "copy");
    Controller()(Files);
    class FilesModule {}
    Module({ controllers: [Files] })(FilesModule);
    class Net {
      get() {}
    }
    legacy(Action("get"), Net, "get");
    Controller()(Net);
    class App {}
    Module({ imports: [FilesModule], controllers: [Net] })(App);

    assert.deepEqual(
      names(App).map(([, , alias]) => alias).sort(),
      ["cp", "get"],
    );
  });

  it("ignores controllers and methods without a command", () => {
    class Web {
      index() {}
    }
    legacy(Help("not a command"), Web, "index");
    Controller()(Web);
    class Cli {
      run() {}
      helper() {}
    }
    legacy(Action("run"), Cli, "run");
    Controller()(Cli);
    class App {}
    Module({ controllers: [Web, Cli] })(App);

    assert.deepEqual(names(App), [["Cli", "run", "run"]]);
  });

  it("rejects an application without commands", () => {
    class Web {
      index() {}
    }
    Controller()(Web);
    class App {}
    Module({ controllers: [Web] })(App);

    assert.throws(() => command_graph(new Injector(App)), {
      message: "No @Main or @Action methods found in the application",
    });
  });

  it("rejects mixing @Main and @Action", () => {
    class Cli {
      main() {}
      other() {}
    }
    legacy(Main(), Cli, "main");
    legacy(Action("other"), Cli, "other");
    Controller()(Cli);
    class App {}
    Module({ controllers: [Cli] })(App);

    assert.throws(() => command_graph(new Injector(App)), {
      message:
        "Mixing @Main and @Action methods in the same application is not allowed",
    });
  });

  it("rejects more than one @Main", () => {
    class A {
      run() {}
    }
    legacy(Main(), A, "run");
    Controller()(A);
    class B {
      run() {}
    }
    legacy(Main(), B, "run");
    Controller()(B);
    class App {}
    Module({ controllers: [A, B] })(App);

    assert.throws(() => command_graph(new Injector(App)), {
      message: "Multiple @Main methods in the same application is not allowed",
    });
  });

  it("rejects a duplicate action name in one controller", () => {
    class Cli {
      a() {}
      b() {}
    }
    legacy(Action("x"), Cli, "a");
    legacy(Action("x"), Cli, "b");
    Controller()(Cli);
    class App {}
    Module({ controllers: [Cli] })(App);

    assert.throws(() => command_graph(new Injector(App)), {
      message: 'Duplicate @Action("x"): declared on Cli.a and Cli.b',
    });
  });

  it("rejects a duplicate action name across modules", () => {
    class A {
      run() {}
    }
    legacy(Action("x"), A, "run");
    Controller()(A);
    class AModule {}
    Module({ controllers: [A] })(AModule);
    class B {
      run() {}
    }
    legacy(Action("x"), B, "run");
    Controller()(B);
    class App {}
    Module({ imports: [AModule], controllers: [B] })(App);

    assert.throws(() => command_graph(new Injector(App)), {
      message:
        /^Duplicate @Action\("x"\): declared on [AB]\.run and [AB]\.run$/,
    });
  });
});
