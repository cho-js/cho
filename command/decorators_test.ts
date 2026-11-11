/**
 * Tests for `decorators.ts`: the records `@Main`, `@Action` and `@Help` write,
 * and the rules they enforce.
 *
 * Every decorator is applied through both call shapes: TC39 and legacy / Bun
 * (see `@chojs/core/utils/test_utils`).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { read_metadata_object } from "@chojs/core/di";
import { Action, Help, Main } from "./decorators.ts";
import { legacy, loose, tc39 } from "@chojs/core/utils/test_utils";

const ONE_COMMAND = "A method can have at most one @Main or @Action.";

describe("@Main", () => {
  it("marks a method as main (TC39)", () => {
    function run() {}
    tc39(Main(), run, "run");
    assert.deepEqual(read_metadata_object(run), {
      isMain: true,
      name: "run",
      alias: "main",
    });
  });

  it("marks a method as main (legacy)", () => {
    class Cli {
      run() {}
    }
    legacy(Main(), Cli, "run");
    assert.deepEqual(read_metadata_object(Cli.prototype.run), {
      isMain: true,
      name: "run",
      alias: "main",
    });
  });

  it("rejects a static method", () => {
    class Cli {
      static run() {}
    }
    const message =
      "@Main() cannot decorate static method 'run': a command method must not be static";
    assert.throws(() => tc39(Main(), Cli.run, "run", { isStatic: true }), {
      name: "TypeError",
      message,
    });
    assert.throws(() => legacy(Main(), Cli, "run", { isStatic: true }), {
      name: "TypeError",
      message,
    });
  });

  it("rejects a member that is not a method", () => {
    assert.throws(
      () => Main()(loose({}), loose({ kind: "field", name: "x" })),
      { name: "TypeError", message: "@Main() can only decorate a method" },
    );
  });
});

describe("@Action", () => {
  it("marks a method as an action (TC39)", () => {
    function copy() {}
    tc39(Action("cp"), copy, "copy");
    assert.deepEqual(read_metadata_object(copy), {
      isAction: true,
      name: "copy",
      alias: "cp",
    });
  });

  it("marks a method as an action (legacy)", () => {
    class Cli {
      copy() {}
    }
    legacy(Action("cp"), Cli, "copy");
    assert.deepEqual(read_metadata_object(Cli.prototype.copy), {
      isAction: true,
      name: "copy",
      alias: "cp",
    });
  });

  it("accepts names with dashes, underscores, dots and digits", () => {
    for (const name of ["x-y", "x_y", "v1.2", "42", "a-"]) {
      const run = function run() {};
      tc39(Action(name), run, "run");
      assert.equal(
        read_metadata_object<{ alias: string }>(run)?.alias,
        name,
      );
    }
  });

  it("rejects a name that is not a non-empty string", () => {
    for (const name of ["", undefined, 1]) {
      const run = function run() {};
      assert.throws(() => tc39(Action(loose(name)), run, "run"), {
        name: "TypeError",
        message: "Action must be a non-empty string",
      });
    }
  });

  it("rejects a name with whitespace", () => {
    for (const name of ["a b", "a\tb", " a", "a\n"]) {
      const run = function run() {};
      assert.throws(() => tc39(Action(name), run, "run"), {
        name: "TypeError",
        message: `@Action(${
          JSON.stringify(name)
        }): the name must not contain whitespace`,
      });
    }
  });

  it("rejects a name starting with -", () => {
    for (const name of ["-x", "--x"]) {
      const run = function run() {};
      assert.throws(() => tc39(Action(name), run, "run"), {
        name: "TypeError",
        message: `@Action(${
          JSON.stringify(name)
        }): the name must not start with "-"`,
      });
    }
  });

  it("rejects a private method", () => {
    function run() {}
    assert.throws(() => tc39(Action("p"), run, "#p", { isPrivate: true }), {
      name: "TypeError",
      message:
        `@Action("p") cannot decorate private method '#p': a command method must be public`,
    });
  });

  it("rejects a static method", () => {
    class Cli {
      static run() {}
    }
    const message =
      `@Action("s") cannot decorate static method 'run': a command method must not be static`;
    assert.throws(
      () => tc39(Action("s"), Cli.run, "run", { isStatic: true }),
      { name: "TypeError", message },
    );
    assert.throws(() => legacy(Action("s"), Cli, "run", { isStatic: true }), {
      name: "TypeError",
      message,
    });
  });

  it("rejects a symbol-named method", () => {
    function run() {}
    assert.throws(() => tc39(Action("y"), run, Symbol("s")), {
      name: "TypeError",
      message:
        `@Action("y") cannot decorate method Symbol(s): a command method must have a string name`,
    });
  });

  it("does not write anything when it throws", () => {
    function run() {}
    assert.throws(() => tc39(Action("-x"), run, "run"));
    assert.equal(read_metadata_object(run), undefined);
  });
});

describe("one command per method", () => {
  it("rejects @Action after @Main", () => {
    function run() {}
    tc39(Main(), run, "run");
    assert.throws(() => tc39(Action("x"), run, "run"), {
      message:
        `Cannot add @Action("x") to method 'run': it already has @Main(). ${ONE_COMMAND}`,
    });
  });

  it("rejects @Main after @Action", () => {
    class Cli {
      run() {}
    }
    legacy(Action("x"), Cli, "run");
    assert.throws(() => legacy(Main(), Cli, "run"), {
      message:
        `Cannot add @Main() to method 'run': it already has @Action("x"). ${ONE_COMMAND}`,
    });
  });

  it("rejects a second @Action", () => {
    function run() {}
    tc39(Action("y"), run, "run");
    assert.throws(() => tc39(Action("x"), run, "run"), {
      message:
        `Cannot add @Action("x") to method 'run': it already has @Action("y"). ${ONE_COMMAND}`,
    });
    assert.equal(read_metadata_object<{ alias: string }>(run)?.alias, "y");
  });

  it("allows @Help with a command, in any order", () => {
    function a() {}
    tc39(Help("before"), a, "a");
    tc39(Action("a"), a, "a");
    function b() {}
    tc39(Action("b"), b, "b");
    tc39(Help("after"), b, "b");
    assert.deepEqual(read_metadata_object(a), {
      help: "before",
      isAction: true,
      name: "a",
      alias: "a",
    });
    assert.deepEqual(read_metadata_object(b), {
      isAction: true,
      name: "b",
      alias: "b",
      help: "after",
    });
  });
});

describe("@Help", () => {
  it("writes to the context's metadata on a TC39 class", () => {
    class Cli {}
    const metadata = {};
    Help("text")(Cli, loose({ kind: "class", name: "Cli", metadata }));
    assert.deepEqual(read_metadata_object(metadata), { help: "text" });
    assert.equal(read_metadata_object(Cli), undefined);
  });

  it("writes to the class on a legacy class", () => {
    class Cli {}
    Help("text")(Cli);
    assert.deepEqual(read_metadata_object(Cli), { help: "text" });
  });

  it("writes to the method (TC39 and legacy)", () => {
    function run() {}
    tc39(Help("tc39"), run, "run");
    assert.deepEqual(read_metadata_object(run), { help: "tc39" });

    class Cli {
      run() {}
    }
    legacy(Help("legacy"), Cli, "run");
    assert.deepEqual(read_metadata_object(Cli.prototype.run), {
      help: "legacy",
    });
  });

  it("allows a static or private method", () => {
    function run() {}
    tc39(Help("s"), run, "run", { isStatic: true });
    tc39(Help("p"), run, "#run", { isPrivate: true });
    assert.deepEqual(read_metadata_object(run), { help: "p" });
  });

  it("rejects an empty text", () => {
    class Cli {}
    assert.throws(() => Help("")(Cli), {
      name: "TypeError",
      message: "Help must be a non-empty string",
    });
  });
});
