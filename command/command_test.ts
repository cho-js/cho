/**
 * Tests for `command.ts`: creating a `ChoCommand` and running it, in both
 * modes, end to end through the injector.
 *
 * `console.log` and `console.error` are captured (see `capture`), so the tests
 * check what a user would see and keep the test output clean.
 *
 * Failures are reported through the `cho` debug logger, which only writes when
 * `CHO_DEBUG` / `CHO_DEBUGLOG` enable it. The tests check the exit code, not
 * stderr, so they pass with or without debug logging.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Catch,
  Controller,
  Injectable,
  Module,
  set_error_handler,
} from "@chojs/core/di";
import type { Ctr } from "@chojs/core/di";
import type { ChoArgs } from "./args.ts";
import { ChoCommand } from "./command.ts";
import { Action, Main } from "./decorators.ts";
import { capture, legacy } from "@chojs/core/utils/test_utils";

/** Every call a handler received: the handler's name and its arguments. */
type Calls = [string, ChoArgs][];

/**
 * A multi-command app with `copy`, `fail` and `code` actions, whose controller
 * depends on an injectable service.
 */
function actions_app(calls: Calls, created: unknown[] = []): Ctr {
  class Service {
    readonly label = "service";
  }
  Injectable()(Service);

  class Files {
    readonly service: Service;
    constructor(service: Service) {
      this.service = service;
      created.push(this);
    }
    copy(args: ChoArgs) {
      calls.push([`copy:${this.service.label}`, args]);
    }
    fail() {
      throw new Error("copy failed");
    }
    code(args: ChoArgs) {
      return args._[0];
    }
  }
  legacy(Action("copy"), Files, "copy");
  legacy(Action("fail"), Files, "fail");
  legacy(Action("code"), Files, "code");
  Controller({ dependencies: [Service] })(Files);

  class App {}
  Module({ controllers: [Files], providers: [Service] })(App);
  return App;
}

/** A single-command app whose main handler records its arguments. */
function main_app(calls: Calls): Ctr {
  class Cli {
    run(args: ChoArgs) {
      calls.push(["run", args]);
    }
  }
  legacy(Main(), Cli, "run");
  Controller()(Cli);
  class App {}
  Module({ controllers: [Cli] })(App);
  return App;
}

describe("ChoCommand.create", () => {
  it("throws on a misconfigured application", () => {
    class Web {}
    Controller()(Web);
    class App {}
    Module({ controllers: [Web] })(App);

    assert.throws(() => ChoCommand.create(App), {
      message: "No @Main or @Action methods found in the application",
    });
  });

  it("does not create any controller", () => {
    const created: unknown[] = [];
    ChoCommand.create(actions_app([], created));
    assert.equal(created.length, 0);
  });
});

describe("ChoCommand.run, main mode", () => {
  it("runs main with every argument and exits 0", async () => {
    const calls: Calls = [];
    const app = ChoCommand.create(main_app(calls));

    const { result, output } = await capture(() =>
      app.run(["a", "b", "--flag"])
    );
    assert.equal(result, 0);
    assert.deepEqual(calls, [["run", { _: ["a", "b"], flag: true }]]);
    assert.deepEqual(output, { log: [], error: [] });
  });

  it("runs main without arguments", async () => {
    const calls: Calls = [];
    const app = ChoCommand.create(main_app(calls));

    const { result } = await capture(() => app.run([]));
    assert.equal(result, 0);
    assert.deepEqual(calls, [["run", { _: [] }]]);
  });
});

describe("ChoCommand.run, actions mode", () => {
  it("runs the named action, without the action name in `_`", async () => {
    const calls: Calls = [];
    const app = ChoCommand.create(actions_app(calls));

    const { result } = await capture(() =>
      app.run(["copy", "src", "dest", "--force"])
    );
    assert.equal(result, 0);
    assert.deepEqual(calls, [
      ["copy:service", { _: ["src", "dest"], force: true }],
    ]);
  });

  it("injects the controller's dependencies and creates it once", async () => {
    const calls: Calls = [];
    const created: unknown[] = [];
    const app = ChoCommand.create(actions_app(calls, created));

    await capture(async () => {
      await app.run(["copy"]);
      await app.run(["copy"]);
    });
    assert.equal(calls.length, 2);
    assert.equal(created.length, 1);
  });

  it("runs an action with a numeric name", async () => {
    class Cli {
      run() {
        return 3;
      }
    }
    legacy(Action("42"), Cli, "run");
    Controller()(Cli);
    class App {}
    Module({ controllers: [Cli] })(App);

    const { result } = await capture(() => ChoCommand.create(App).run(["42"]));
    assert.equal(result, 3);
  });

  it("fails with 1 on an unknown action, and prints nothing", async () => {
    const calls: Calls = [];
    const app = ChoCommand.create(actions_app(calls));

    const { result, output } = await capture(() => app.run(["nope"]));
    assert.equal(result, 1);
    assert.deepEqual(output.log, []);
    assert.deepEqual(calls, []);
  });

  it("shows the global help and exits 0 when no action is given", async () => {
    const calls: Calls = [];
    const app = ChoCommand.create(actions_app(calls), { name: "fs" });

    const { result, output } = await capture(() => app.run([]));
    assert.equal(result, 0);
    assert.deepEqual(calls, []);
    assert.equal(output.log.length, 1);
    assert.match(
      output.log.join("\n"),
      /^Usage: fs <command> \[options\] \[args\]/,
    );
    assert.match(output.log.join("\n"), /\n {2}copy\n {2}fail\n {2}code\n/);
  });

  it("shows help when only flags are given", async () => {
    const calls: Calls = [];
    const app = ChoCommand.create(actions_app(calls));

    const { result } = await capture(() => app.run(["--force"]));
    assert.equal(result, 0);
    assert.deepEqual(calls, []);
  });
});

describe("ChoCommand.run, exit code", () => {
  it("fails with 1 when the handler throws, and prints nothing", async () => {
    const app = ChoCommand.create(actions_app([]));

    const { result, output } = await capture(() => app.run(["fail"]));
    assert.equal(result, 1);
    assert.deepEqual(output.log, []);
  });

  it("uses a non-negative integer the handler returns", async () => {
    const app = ChoCommand.create(actions_app([]));

    const { result } = await capture(async () => [
      await app.run(["code", "0"]),
      await app.run(["code", "2"]),
      await app.run(["code", "255"]),
    ]);
    assert.deepEqual(result, [0, 2, 255]);
  });

  it("exits 0 when the handler returns anything else", async () => {
    const app = ChoCommand.create(actions_app([]));

    const { result } = await capture(async () => [
      await app.run(["code"]), // undefined
      await app.run(["code", "-1"]), // parsed as a flag: undefined
      await app.run(["code", "1.5"]),
      await app.run(["code", "text"]),
    ]);
    assert.deepEqual(result, [0, 0, 0, 0]);
  });
});

describe("ChoCommand.run, --version and --help", () => {
  it("prints the name and version, and runs nothing", async () => {
    const calls: Calls = [];
    const app = ChoCommand.create(actions_app(calls), {
      name: "fs",
      version: "2.1.0",
    });

    const { result, output } = await capture(() =>
      app.run(["copy", "--version"])
    );
    assert.equal(result, 0);
    assert.deepEqual(output.log, ["fs version 2.1.0"]);
    assert.deepEqual(calls, []);
  });

  it("defaults the name and version", async () => {
    const app = ChoCommand.create(main_app([]));

    const { output } = await capture(() => app.run(["--version"]));
    assert.deepEqual(output.log, ["chojs version 1.0.0"]);
  });

  it("prints the command's help on --help, exits 0 and runs nothing", async () => {
    const calls: Calls = [];
    const app = ChoCommand.create(actions_app(calls));

    const { result, output } = await capture(() => app.run(["copy", "--help"]));
    assert.equal(result, 0);
    assert.deepEqual(calls, []);
    assert.equal(output.log.length, 1);
    assert.match(
      output.log.join("\n"),
      /^Usage: chojs copy \[options\] \[args\]/,
    );
  });

  it("prints the global help on --help without a command", async () => {
    const app = ChoCommand.create(actions_app([]));

    const { result, output } = await capture(() => app.run(["--help"]));
    assert.equal(result, 0);
    assert.match(output.log.join("\n"), /^Usage: chojs <command>/);
  });

  it("prints the main help on --help in main mode", async () => {
    const calls: Calls = [];
    const app = ChoCommand.create(main_app(calls), { name: "ls" });

    const { result, output } = await capture(() => app.run(["x", "--help"]));
    assert.equal(result, 0);
    assert.deepEqual(calls, []);
    assert.match(output.log.join("\n"), /^Usage: ls \[options\] \[args\]/);
  });

  it("passes -v and -h to the handler", async () => {
    // After the command name: a flag before it would take the name as its
    // value (review finding M1).
    const calls: Calls = [];
    const app = ChoCommand.create(actions_app(calls));

    const { result, output } = await capture(() =>
      app.run(["copy", "-v", "-h"])
    );
    assert.equal(result, 0);
    assert.deepEqual(output.log, []);
    assert.deepEqual(calls, [["copy:service", { _: [], v: true, h: true }]]);
  });

  it("runs the command when --help or --version is off", async () => {
    const calls: Calls = [];
    const app = ChoCommand.create(main_app(calls));

    const { result } = await capture(() =>
      app.run(["--help=false", "--no-version", "a", "--no-help"])
    );
    assert.equal(result, 0);
    assert.deepEqual(calls, [["run", { _: ["a"] }]]);
  });
});

/**
 * A multi-command app whose `fail` action throws `error` and has `handler` as
 * its error handler. `ok` has no error handler and throws too.
 */
function error_app(error: unknown, handler: (err: unknown) => unknown): Ctr {
  class Cli {
    fail() {
      throw error;
    }
    ok() {
      throw error;
    }
  }
  legacy(Action("fail"), Cli, "fail");
  set_error_handler(Cli.prototype.fail, handler);
  legacy(Action("ok"), Cli, "ok");
  Controller()(Cli);
  class App {}
  Module({ controllers: [Cli] })(App);
  return App;
}

describe("ChoCommand.run, error handler", () => {
  it("calls the action's error handler with the error", async () => {
    const error = new Error("boom");
    const seen: unknown[] = [];
    const app = ChoCommand.create(error_app(error, (err) => {
      seen.push(err);
    }));

    const { result } = await capture(() => app.run(["fail"]));
    assert.equal(result, 1);
    assert.deepEqual(seen, [error]);
  });

  it("uses a non-negative integer the error handler returns", async () => {
    const app = ChoCommand.create(error_app(new Error("boom"), () => 3));

    const { result } = await capture(() => app.run(["fail"]));
    assert.equal(result, 3);
  });

  it("exits 1 when the error handler returns anything else", async () => {
    for (const ret of [undefined, -1, 1.5, "2", null]) {
      const app = ChoCommand.create(error_app(new Error("boom"), () => ret));

      const { result } = await capture(() => app.run(["fail"]));
      assert.equal(result, 1, `error handler returned ${String(ret)}`);
    }
  });

  it("passes a non-Error throw as is", async () => {
    const seen: unknown[] = [];
    const app = ChoCommand.create(error_app("text", (err) => {
      seen.push(err);
      return 4;
    }));

    const { result } = await capture(() => app.run(["fail"]));
    assert.equal(result, 4);
    assert.deepEqual(seen, ["text"]);
  });

  it("does not use another action's error handler", async () => {
    let called = false;
    const app = ChoCommand.create(error_app(new Error("boom"), () => {
      called = true;
      return 3;
    }));

    const { result } = await capture(() => app.run(["ok"]));
    assert.equal(result, 1);
    assert.equal(called, false);
  });
});

/** Error handlers that record which one handled the error. */
type Handled = string[];

/**
 * An app with two controllers whose actions all throw:
 *
 * - `Cli`, with a `@Catch` on the class when `controller` is set:
 *   - `own`, with its own `@Catch` when `method` is set;
 *   - `plain`, without one;
 * - `Other`, without any error handler: `other`.
 *
 * Each handler records its name in `handled` and returns its exit code.
 */
function catch_app(
  handled: Handled,
  { method, controller }: { method?: number; controller?: number },
): Ctr {
  const handler = (name: string, code: number) => () => {
    handled.push(name);
    return code;
  };
  class Cli {
    own() {
      throw new Error("own");
    }
    plain() {
      throw new Error("plain");
    }
  }
  legacy(Action("own"), Cli, "own");
  if (method !== undefined) {
    legacy(Catch(handler("method", method)), Cli, "own");
  }
  legacy(Action("plain"), Cli, "plain");
  Controller()(Cli);
  if (controller !== undefined) {
    Catch(handler("controller", controller))(Cli);
  }

  class Other {
    other() {
      throw new Error("other");
    }
  }
  legacy(Action("other"), Other, "other");
  Controller()(Other);

  class App {}
  Module({ controllers: [Cli, Other] })(App);
  return App;
}

describe("ChoCommand.run, error handler lookup", () => {
  it("uses the method's handler before the controller's", async () => {
    const handled: Handled = [];
    const app = ChoCommand.create(
      catch_app(handled, { method: 2, controller: 3 }),
    );

    const { result } = await capture(() => app.run(["own"]));
    assert.equal(result, 2);
    assert.deepEqual(handled, ["method"]);
  });

  it("falls back to the controller's handler", async () => {
    const handled: Handled = [];
    const app = ChoCommand.create(
      catch_app(handled, { method: 2, controller: 3 }),
    );

    const { result } = await capture(() => app.run(["plain"]));
    assert.equal(result, 3);
    assert.deepEqual(handled, ["controller"]);
  });

  it("uses the controller's handler for every action without one", async () => {
    const handled: Handled = [];
    const app = ChoCommand.create(catch_app(handled, { controller: 3 }));

    const { result } = await capture(async () => [
      await app.run(["own"]),
      await app.run(["plain"]),
    ]);
    assert.deepEqual(result, [3, 3]);
    assert.deepEqual(handled, ["controller", "controller"]);
  });

  it("does not use another controller's handler", async () => {
    const handled: Handled = [];
    const app = ChoCommand.create(
      catch_app(handled, { method: 2, controller: 3 }),
    );

    const { result } = await capture(() => app.run(["other"]));
    assert.equal(result, 1);
    assert.deepEqual(handled, []);
  });

  it("falls back to the default without any handler", async () => {
    const handled: Handled = [];
    const app = ChoCommand.create(catch_app(handled, {}));

    const { result } = await capture(async () => [
      await app.run(["own"]),
      await app.run(["plain"]),
    ]);
    assert.deepEqual(result, [1, 1]);
    assert.deepEqual(handled, []);
  });

  it("uses the controller's handler when the controller fails to be created", async () => {
    const handled: Handled = [];
    class Cli {
      constructor() {
        throw new Error("no config");
      }
      run() {}
    }
    legacy(Action("run"), Cli, "run");
    Controller()(Cli);
    Catch(() => {
      handled.push("controller");
      return 5;
    })(Cli);
    class App {}
    Module({ controllers: [Cli] })(App);

    const { result } = await capture(() => ChoCommand.create(App).run(["run"]));
    assert.equal(result, 5);
    assert.deepEqual(handled, ["controller"]);
  });
});

describe("ChoCommand.run, parseOptions", () => {
  it("parses the command line with the given options", async () => {
    const calls: Calls = [];
    const app = ChoCommand.create(actions_app(calls), {
      parseOptions: { boolean: ["force"], string: ["name"] },
    });

    const { result } = await capture(() =>
      app.run(["--force", "copy", "--name", "42"])
    );
    assert.equal(result, 0);
    assert.deepEqual(calls, [[
      "copy:service",
      { _: [], force: true, name: "42" },
    ]]);
  });

  it("keeps --help <command> working with declared booleans", async () => {
    const calls: Calls = [];
    const app = ChoCommand.create(actions_app(calls), {
      parseOptions: { boolean: ["force"] },
    });

    const { result, output } = await capture(() => app.run(["--help", "copy"]));
    assert.equal(result, 0);
    assert.deepEqual(calls, []);
    assert.match(
      output.log.join("\n"),
      /^Usage: chojs copy \[options\] \[args\]/,
    );
  });
});

describe("ChoCommand.run, initModule", () => {
  /** An app whose root module records when it is created. */
  function module_app(created: unknown[]): Ctr {
    class Cli {
      run() {}
    }
    legacy(Main(), Cli, "run");
    Controller()(Cli);
    class App {
      constructor() {
        created.push(this);
      }
    }
    Module({ controllers: [Cli] })(App);
    return App;
  }

  it("does not create the controller's module by default", async () => {
    const created: unknown[] = [];
    const app = ChoCommand.create(module_app(created));

    const { result } = await capture(() => app.run([]));
    assert.equal(result, 0);
    assert.equal(created.length, 0);
  });

  it("creates the controller's module first with initModule", async () => {
    const created: unknown[] = [];
    const app = ChoCommand.create(module_app(created), { initModule: true });

    const { result } = await capture(async () => [
      await app.run([]),
      await app.run([]),
    ]);
    assert.deepEqual(result, [0, 0]);
    assert.equal(created.length, 1);
  });
});
