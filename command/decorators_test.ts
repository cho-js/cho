/**
 * Tests for `decorators.ts`: the records `@Main`, `@Action` and `@Help` write,
 * and the rules they enforce.
 *
 * Every decorator is applied through both call shapes: TC39 and legacy / Bun
 * (see `@chojs/core/utils/test_utils`).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  read_metadata_object,
  read_method_metadata,
  token,
} from "@chojs/core/di";
import { Action, Controller, Help, Main, Module } from "./decorators.ts";
import { ACTION, ALIAS, HELP, MAIN } from "./keys.ts";
import { legacy, loose, tc39, tc39_record } from "@chojs/core/utils/test_utils";

const ONE_COMMAND = "A method can have at most one @Main or @Action.";

describe("@Main", () => {
  it("marks a method as main (TC39)", () => {
    function run() {}
    tc39(Main(), run, "run");
    assert.deepEqual(tc39_record(run), {
      [MAIN]: true,
      [ALIAS]: "main",
    });
  });

  it("marks a method as main (legacy)", () => {
    class Cli {
      run() {}
    }
    legacy(Main(), Cli, "run");
    assert.deepEqual(read_method_metadata(Cli, "run"), {
      [MAIN]: true,
      [ALIAS]: "main",
    });
  });

  it("rejects a static method", () => {
    class Cli {
      static run() {}
    }
    const message =
      "@Main() cannot decorate static method 'run': a command method must not be static";
    assert.throws(() => tc39(Main(), Cli.run, "run", { isStatic: true }), {
      code: "CHO_COMMAND_INVALID_TARGET",
      message,
    });
    assert.throws(() => legacy(Main(), Cli, "run", { isStatic: true }), {
      code: "CHO_COMMAND_INVALID_TARGET",
      message,
    });
  });

  it("rejects a member that is not a method", () => {
    assert.throws(
      () => Main()(loose({}), loose({ kind: "field", name: "x" })),
      {
        code: "CHO_CORE_INVALID_TARGET",
        message: "@Main() can only decorate a method",
      },
    );
  });
});

describe("@Action", () => {
  it("marks a method as an action (TC39)", () => {
    function copy() {}
    tc39(Action("cp"), copy, "copy");
    assert.deepEqual(tc39_record(copy), {
      [ACTION]: true,
      [ALIAS]: "cp",
    });
  });

  it("marks a method as an action (legacy)", () => {
    class Cli {
      copy() {}
    }
    legacy(Action("cp"), Cli, "copy");
    assert.deepEqual(read_method_metadata(Cli, "copy"), {
      [ACTION]: true,
      [ALIAS]: "cp",
    });
  });

  it("accepts names with dashes, underscores, dots and digits", () => {
    for (const name of ["x-y", "x_y", "v1.2", "42", "a-"]) {
      const run = function run() {};
      tc39(Action(name), run, "run");
      assert.equal(
        (tc39_record(run) as { [ALIAS]: string })[ALIAS],
        name,
      );
    }
  });

  it("rejects a name that is not a non-empty string", () => {
    for (const name of ["", undefined, 1]) {
      const run = function run() {};
      assert.throws(() => tc39(Action(loose(name)), run, "run"), {
        code: "CHO_COMMAND_INVALID_ARGUMENT",
        message: "Action must be a non-empty string",
      });
    }
  });

  it("rejects a name with whitespace", () => {
    for (const name of ["a b", "a\tb", " a", "a\n"]) {
      const run = function run() {};
      assert.throws(() => tc39(Action(name), run, "run"), {
        code: "CHO_COMMAND_INVALID_ARGUMENT",
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
        code: "CHO_COMMAND_INVALID_ARGUMENT",
        message: `@Action(${
          JSON.stringify(name)
        }): the name must not start with "-"`,
      });
    }
  });

  it("rejects a private method", () => {
    function run() {}
    assert.throws(() => tc39(Action("p"), run, "#p", { isPrivate: true }), {
      code: "CHO_COMMAND_INVALID_TARGET",
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
      { code: "CHO_COMMAND_INVALID_TARGET", message },
    );
    assert.throws(() => legacy(Action("s"), Cli, "run", { isStatic: true }), {
      code: "CHO_COMMAND_INVALID_TARGET",
      message,
    });
  });

  it("rejects a symbol-named method", () => {
    function run() {}
    assert.throws(() => tc39(Action("y"), run, Symbol("s")), {
      code: "CHO_COMMAND_INVALID_TARGET",
      message:
        `@Action("y") cannot decorate method Symbol(s): a command method must have a string name`,
    });
  });

  it("does not write anything when it throws", () => {
    function run() {}
    assert.throws(() => tc39(Action("-x"), run, "run"), {
      code: "CHO_COMMAND_INVALID_ARGUMENT",
    });
    assert.equal(tc39_record(run), undefined);
  });
});

describe("one command per method", () => {
  it("rejects @Action after @Main", () => {
    function run() {}
    tc39(Main(), run, "run");
    assert.throws(() => tc39(Action("x"), run, "run"), {
      code: "CHO_COMMAND_DUPLICATE_DECORATOR",
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
      code: "CHO_COMMAND_DUPLICATE_DECORATOR",
      message:
        `Cannot add @Main() to method 'run': it already has @Action("x"). ${ONE_COMMAND}`,
    });
  });

  it("rejects a second @Action", () => {
    function run() {}
    tc39(Action("y"), run, "run");
    assert.throws(() => tc39(Action("x"), run, "run"), {
      code: "CHO_COMMAND_DUPLICATE_DECORATOR",
      message:
        `Cannot add @Action("x") to method 'run': it already has @Action("y"). ${ONE_COMMAND}`,
    });
    assert.equal((tc39_record(run) as { [ALIAS]: string })[ALIAS], "y");
  });

  it("allows @Help with a command, in any order", () => {
    function a() {}
    tc39(Help("before"), a, "a");
    tc39(Action("a"), a, "a");
    function b() {}
    tc39(Action("b"), b, "b");
    tc39(Help("after"), b, "b");
    assert.deepEqual(tc39_record(a), {
      [HELP]: "before",
      [ACTION]: true,
      [ALIAS]: "a",
    });
    assert.deepEqual(tc39_record(b), {
      [ACTION]: true,
      [ALIAS]: "b",
      [HELP]: "after",
    });
  });
});

describe("@Help", () => {
  it("writes to the context's metadata on a TC39 class", () => {
    class Cli {}
    const metadata = {};
    Help("text")(Cli, loose({ kind: "class", name: "Cli", metadata }));
    assert.deepEqual(read_metadata_object(metadata), { [HELP]: "text" });
    assert.equal(read_metadata_object(Cli), undefined);
  });

  it("writes to the class on a TC39 class without context.metadata", () => {
    // compiled TC39 decorators on a runtime without Symbol.metadata
    class Cli {}
    Help("text")(
      Cli,
      loose({ kind: "class", name: "Cli", metadata: undefined }),
    );
    assert.deepEqual(read_metadata_object(Cli), { [HELP]: "text" });
  });

  it("writes to the class on a legacy class", () => {
    class Cli {}
    Help("text")(Cli);
    assert.deepEqual(read_metadata_object(Cli), { [HELP]: "text" });
  });

  it("writes to the method (TC39 and legacy)", () => {
    function run() {}
    tc39(Help("tc39"), run, "run");
    assert.deepEqual(tc39_record(run), { [HELP]: "tc39" });

    class Cli {
      run() {}
    }
    legacy(Help("legacy"), Cli, "run");
    assert.deepEqual(read_method_metadata(Cli, "run"), {
      [HELP]: "legacy",
    });
  });

  it("rejects a static, private or symbol-named method: its help is never read", () => {
    function run() {}
    assert.throws(() => tc39(Help("s"), run, "run", { isStatic: true }), {
      code: "CHO_CORE_INVALID_TARGET",
      message:
        "@Help() cannot decorate static method run: only public, non-static methods with a string name are supported",
    });
    assert.throws(() => tc39(Help("p"), run, "#run", { isPrivate: true }), {
      code: "CHO_CORE_INVALID_TARGET",
      message: /^@Help\(\) cannot decorate private method #run:/,
    });
    assert.throws(() => tc39(Help("y"), run, Symbol("run")), {
      code: "CHO_CORE_INVALID_TARGET",
      message: /^@Help\(\) cannot decorate symbol-named method Symbol\(run\):/,
    });
    assert.equal(read_metadata_object(run), undefined);
  });

  it("rejects an empty text", () => {
    class Cli {}
    assert.throws(() => Help("")(Cli), {
      code: "CHO_COMMAND_INVALID_ARGUMENT",
      message: "Help must be a non-empty string",
    });
  });
});

const NAME = token<string>("NAME");

describe("@Module and @Controller", () => {
  it("accept the core's options", () => {
    class Disk {}
    class Files {}
    Controller({ dependencies: [Disk] })(Files);
    class App {}
    Module({ controllers: [Files] })(App);
    assert.ok(read_metadata_object(Files));
    assert.ok(read_metadata_object(App));
  });

  it("reject any other option, in the types and at runtime", () => {
    assert.throws(
      // @ts-expect-error `deps` is not an option: it is `dependencies`
      () => Controller({ deps: [] })(class {}),
      {
        code: "CHO_CORE_UNKNOWN_OPTION",
        message:
          '@Controller(): unknown option "deps". Known options: dependencies',
      },
    );
    assert.throws(
      // @ts-expect-error a command module has no route
      () => Module({ route: "x" })(class {}),
      {
        code: "CHO_CORE_UNKNOWN_OPTION",
        message: /^@Module\(\): unknown option "route"/,
      },
    );
  });

  it("check the dependencies against the constructor", () => {
    class Disk {
      read() {}
    }
    class Files {
      constructor(readonly disk: Disk) {}
    }
    // Type-only: never called.
    const _check = () => {
      Controller({ dependencies: [Disk] })(Files);
      // @ts-expect-error the constructor needs a Disk
      Controller()(Files);
      // @ts-expect-error a string is not a Disk
      Controller({ dependencies: [NAME] })(Files);
    };
  });
});

describe("command flags", () => {
  const FLAGS = Symbol.for("chojs.command.flags");
  const flags_of = (fn: () => void) =>
    (tc39_record(fn, "run") as Record<symbol, unknown> | undefined)?.[FLAGS];

  it("are stored by @Action and @Main, only when declared", () => {
    const flags = { boolean: ["force"], alias: { f: "force" } };
    const with_flags = function run() {};
    tc39(Action("copy", flags), with_flags, "run");
    assert.deepEqual(flags_of(with_flags), flags);

    const main = function run() {};
    tc39(Main(flags), main, "run");
    assert.deepEqual(flags_of(main), flags);

    const without = function run() {};
    tc39(Action("ls"), without, "run");
    assert.equal(FLAGS in (tc39_record(without, "run") as object), false);
  });

  for (
    const [flags, error] of [
      ["force", {
        code: "CHO_COMMAND_INVALID_FLAGS",
        message: /the flags must be an object/,
      }],
      [["force"], {
        code: "CHO_COMMAND_INVALID_FLAGS",
        message: /the flags must be an object/,
      }],
      [
        { booleans: ["force"] },
        {
          code: "CHO_CORE_UNKNOWN_OPTION",
          message: /unknown option "booleans"\. Known options: boolean, string/,
        },
      ],
      [
        { boolean: "force" },
        {
          code: "CHO_COMMAND_INVALID_FLAGS",
          message: /"boolean" must be an array of flag names/,
        },
      ],
      [
        { string: ["mode", ""] },
        {
          code: "CHO_COMMAND_INVALID_FLAGS",
          message: /"string" must be an array of flag names/,
        },
      ],
      [
        { alias: ["f"] },
        {
          code: "CHO_COMMAND_INVALID_FLAGS",
          message: /"alias" must be an object/,
        },
      ],
      [
        { boolean: ["help"] },
        {
          code: "CHO_COMMAND_RESERVED_FLAG",
          message: /the flag "help" is reserved by the application/,
        },
      ],
      [
        { alias: { v: "version" } },
        {
          code: "CHO_COMMAND_RESERVED_FLAG",
          message: /the flag "version" is reserved by the application/,
        },
      ],
    ] as const
  ) {
    it(`reject ${JSON.stringify(flags)}`, () => {
      const run = function run() {};
      assert.throws(() => tc39(Action("x", loose(flags)), run, "run"), error);
      assert.throws(() => tc39(Main(loose(flags)), run, "run"), error);
      assert.equal(tc39_record(run, "run"), undefined);
    });
  }

  it("name the decorator in the message", () => {
    assert.throws(
      () => tc39(Action("copy", loose(1)), () => {}, "run"),
      {
        code: "CHO_COMMAND_INVALID_FLAGS",
        message: '@Action("copy"): the flags must be an object',
      },
    );
  });
});
