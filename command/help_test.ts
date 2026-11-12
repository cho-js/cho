/**
 * Tests for `help.ts`: the help text built from the `@Help` records, in both
 * modes.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Controller, Injector, Module } from "@chojs/core/di";
import type { Ctr } from "@chojs/core/di";
import { Action, Help, Main } from "./decorators.ts";
import { command_graph } from "./graph.ts";
import { format_help } from "./help.ts";
import { legacy } from "@chojs/core/utils/test_utils";

const OPTIONS = [
  "Options:",
  "  --help     Show this help",
  "  --version  Show the version",
].join("\n");

function help(app: Ctr, route: string, name = "app"): string {
  return format_help(command_graph(new Injector(app)), name, route);
}

/** A single-command app, with or without `@Help` texts. */
function main_app(
  { ctrlHelp, mainHelp }: { ctrlHelp?: string; mainHelp?: string } = {},
): Ctr {
  class Cli {
    run() {}
  }
  if (mainHelp) legacy(Help(mainHelp), Cli, "run");
  legacy(Main(), Cli, "run");
  Controller()(Cli);
  if (ctrlHelp) Help(ctrlHelp)(Cli);
  class App {}
  Module({ controllers: [Cli] })(App);
  return App;
}

/**
 * A multi-command app: `Files` (with `@Help`) has `copy` and `rm`, `Net`
 * (without `@Help`) has `get`.
 */
function actions_app(): Ctr {
  class Files {
    copy() {}
    remove() {}
  }
  legacy(Help("Copy a file\nThe destination is overwritten."), Files, "copy");
  legacy(Action("copy"), Files, "copy");
  legacy(Help("Delete a file"), Files, "remove");
  legacy(Action("rm"), Files, "remove");
  Controller()(Files);
  Help("File system commands")(Files);

  class Net {
    get() {}
  }
  legacy(Action("get"), Net, "get");
  Controller()(Net);

  class App {}
  Module({ controllers: [Files, Net] })(App);
  return App;
}

describe("format_help, main mode", () => {
  it("shows the usage, the controller's help, then the method's", () => {
    const app = main_app({ ctrlHelp: "List files", mainHelp: "Lists a dir" });
    assert.equal(
      help(app, "main", "ls"),
      [
        "Usage: ls [options] [args]",
        "List files",
        "Lists a dir",
        OPTIONS,
      ].join("\n\n"),
    );
  });

  it("leaves out the missing help texts", () => {
    assert.equal(
      help(main_app(), "main"),
      ["Usage: app [options] [args]", OPTIONS].join("\n\n"),
    );
  });

  it("shows the same help whatever the route", () => {
    const app = main_app({ mainHelp: "Lists a dir" });
    assert.equal(help(app, ""), help(app, "main"));
    assert.equal(help(app, "nope"), help(app, "main"));
  });

  it("finds the controller's help in either decorator order", () => {
    class Cli {
      run() {}
    }
    legacy(Main(), Cli, "run");
    Help("List files")(Cli); // before @Controller
    Controller()(Cli);
    class App {}
    Module({ controllers: [Cli] })(App);
    assert.match(help(App, "main"), /\n\nList files\n\n/);
  });
});

describe("format_help, actions mode", () => {
  it("shows the commands, grouped by controller", () => {
    assert.equal(
      help(actions_app(), "", "fs"),
      [
        "Usage: fs <command> [options] [args]",
        [
          "File system commands:",
          "  copy  Copy a file",
          "  rm    Delete a file",
        ].join("\n"),
        ["Commands:", "  get"].join("\n"),
        OPTIONS,
        "Run 'fs <command> --help' for help on a command.",
      ].join("\n\n"),
    );
  });

  it("shows the global help for an unknown command", () => {
    const app = actions_app();
    assert.equal(help(app, "nope"), help(app, ""));
  });

  it("shows the full help of a command", () => {
    assert.equal(
      help(actions_app(), "copy", "fs"),
      [
        "Usage: fs copy [options] [args]",
        "Copy a file\nThe destination is overwritten.",
        OPTIONS,
      ].join("\n\n"),
    );
  });

  it("shows a command without help", () => {
    assert.equal(
      help(actions_app(), "get", "fs"),
      ["Usage: fs get [options] [args]", OPTIONS].join("\n\n"),
    );
  });

  it("shows the help of an action named main", () => {
    class Cli {
      main() {}
      other() {}
    }
    legacy(Help("The main action"), Cli, "main");
    legacy(Action("main"), Cli, "main");
    legacy(Action("other"), Cli, "other");
    Controller()(Cli);
    class App {}
    Module({ controllers: [Cli] })(App);
    assert.equal(
      help(App, "main"),
      ["Usage: app main [options] [args]", "The main action", OPTIONS].join(
        "\n\n",
      ),
    );
  });

  it("merges controllers with the same heading, in graph order", () => {
    class A {
      a() {}
    }
    legacy(Action("a"), A, "a");
    Controller()(A);
    class B {
      bb() {}
    }
    legacy(Action("bb"), B, "bb");
    Controller()(B);
    Help("Group")(B);
    class C {
      c() {}
    }
    legacy(Action("c"), C, "c");
    Controller()(C);
    class App {}
    Module({ controllers: [A, B, C] })(App);
    assert.match(
      help(App, ""),
      /\n\nCommands:\n {2}a\n {2}c\n\nGroup:\n {2}bb\n\n/,
    );
  });
});
