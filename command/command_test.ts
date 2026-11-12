/**
 * Tests for `command.ts`: creating a `ChoCommand` and running it, in both
 * modes, end to end through the injector.
 *
 * `console.log` and `console.error` are captured (see `capture`), so the tests
 * check what a user would see and keep the test output clean.
 *
 * Failures without an error handler are printed to stderr as
 * `Error: <message>`; the tests check the exit code and, where it matters,
 * what was printed.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Catch,
  Controller,
  Injectable,
  Module,
  provider,
  set_error_handler,
} from "@chojs/core/di";
import type { Ctr } from "@chojs/core/di";
import type { ChoArgs } from "./args.ts";
import type { ChoCommandContext } from "./context.ts";
import { ChoCommand } from "./command.ts";
import { Action, Main } from "./decorators.ts";
import { capture, legacy, with_env } from "@chojs/core/utils/test_utils";

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
    copy(ctx: ChoCommandContext) {
      calls.push([`copy:${this.service.label}`, ctx.args]);
    }
    fail() {
      throw new Error("copy failed");
    }
    code(ctx: ChoCommandContext) {
      return Number(ctx.args._[0]); // positionals are strings
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
    run(ctx: ChoCommandContext) {
      calls.push(["run", ctx.args]);
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
      await app.run(["code", "256"]), // capped: 256 would read as success
    ]);
    assert.deepEqual(result, [0, 2, 255, 255]);
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

  it("defaults the name, and reports no version when none is set", async () => {
    const app = ChoCommand.create(main_app([]));

    const { result, output } = await capture(() => app.run(["--version"]));
    assert.equal(result, 0);
    assert.deepEqual(output.log, ["chojs (no version)"]);
  });

  it('prints a version that is an empty string or "0"', async () => {
    for (const version of ["", "0"]) {
      const app = ChoCommand.create(main_app([]), { name: "fs", version });
      const { output } = await capture(() => app.run(["--version"]));
      assert.deepEqual(output.log, [`fs version ${version}`]);
    }
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
function error_app(
  error: unknown,
  handler: (err: unknown, args?: unknown) => unknown,
): Ctr {
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

  it("passes the context of the run as the second argument", async () => {
    const seen: unknown[] = [];
    const app = ChoCommand.create(error_app(new Error("boom"), (err, ctx) => {
      seen.push(
        err,
        (ctx as ChoCommandContext).args,
        (ctx as ChoCommandContext).command,
      );
      return 4;
    }));

    const { result } = await capture(() => app.run(["fail", "--force"]));
    assert.equal(result, 4);
    assert.equal((seen[0] as Error).message, "boom");
    assert.deepEqual(seen[1], { _: [], force: true });
    assert.equal(seen[2], "fail");
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

describe("ChoCommand.run, failures without a usable handler", () => {
  it("prints the error to stderr and exits 1 without an error handler", async () => {
    const app = ChoCommand.create(actions_app([]));

    const { result, output } = await capture(() => app.run(["fail"]));
    assert.equal(result, 1);
    assert.deepEqual(output.error, ["Error: copy failed"]);
  });

  it("prints a non-Error throw with String()", async () => {
    class Cli {
      run() {
        throw 42;
      }
    }
    legacy(Main(), Cli, "run");
    Controller()(Cli);
    class App {}
    Module({ controllers: [Cli] })(App);

    const { result, output } = await capture(() =>
      ChoCommand.create(App).run([])
    );
    assert.equal(result, 1);
    assert.deepEqual(output.error, ["Error: 42"]);
  });

  it("reports a command method that the instance replaced", async () => {
    class Cli {
      constructor() {
        // an own property shadows the decorated prototype method
        Object.defineProperty(this, "run", { value: "not a function" });
      }
      run() {}
    }
    legacy(Main(), Cli, "run");
    Controller()(Cli);
    class App {}
    Module({ controllers: [Cli] })(App);

    const { result, output } = await capture(() =>
      ChoCommand.create(App).run([])
    );
    assert.equal(result, 1);
    assert.deepEqual(output.error, [
      "Error: Method 'run' is not a function on controller 'Cli'.",
    ]);
  });

  it("calls a class error handler's handle with the error and the context", async () => {
    const seen: unknown[] = [];
    class OnError {
      handle(error: unknown, ctx: ChoCommandContext) {
        seen.push(error, ctx.args);
        return 5;
      }
    }
    Injectable()(OnError);
    class Cli {
      run() {
        throw new Error("boom");
      }
    }
    legacy(Main(), Cli, "run");
    legacy(Catch(OnError), Cli, "run");
    Controller()(Cli);
    class App {}
    Module({ providers: [OnError], controllers: [Cli] })(App);

    const { result, output } = await capture(() =>
      ChoCommand.create(App).run(["x", "--flag"])
    );
    assert.equal(result, 5);
    assert.deepEqual(output.error, []);
    assert.equal((seen[0] as Error).message, "boom");
    assert.deepEqual(seen[1], { _: ["x"], flag: true });
  });

  it("prints the error and exits 2 when a class error handler fails", async () => {
    // The injector cannot create the handler: its constructor throws.
    class OnError {
      constructor() {
        throw new Error("no reporter");
      }
      handle() {
        return 5;
      }
    }
    Injectable()(OnError);
    class Cli {
      run() {
        throw new Error("boom");
      }
    }
    legacy(Main(), Cli, "run");
    legacy(Catch(OnError), Cli, "run");
    Controller()(Cli);
    class App {}
    Module({ providers: [OnError], controllers: [Cli] })(App);

    const { result, output } = await capture(() =>
      ChoCommand.create(App).run([])
    );
    assert.equal(result, 2);
    assert.deepEqual(output.error, ["Error: boom"]);
  });
});

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

describe("ChoCommand.run, what it creates", () => {
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

  it("does not create the controller's module", async () => {
    const created: unknown[] = [];
    const app = ChoCommand.create(module_app(created));

    const { result } = await capture(() => app.run([]));
    assert.equal(result, 0);
    assert.equal(created.length, 0);
  });

  it("creates a setup provider before the controller, once", async () => {
    const events: string[] = [];
    class Setup {}
    class Cli {
      constructor() {
        events.push("controller");
      }
      run() {
        events.push("run");
      }
    }
    legacy(Main(), Cli, "run");
    Controller({ dependencies: [Setup] })(Cli);
    class App {}
    Module({
      providers: [
        provider({
          provide: Setup,
          factory: async () => {
            await Promise.resolve();
            events.push("setup");
            return new Setup();
          },
        }),
      ],
      controllers: [Cli],
    })(App);
    const app = ChoCommand.create(App);

    await capture(async () => {
      await app.run([]);
      await app.run([]);
    });
    assert.deepEqual(events, ["setup", "controller", "run", "run"]);
  });
});

describe("ChoCommand, debug logging", () => {
  const OFF = { CHO_DEBUG: undefined, CHO_DEBUGLOG: undefined };
  const ON = { ...OFF, CHO_DEBUGLOG: "cho:command" };

  /** Create the app of `actions_app` with the given environment. */
  function create(vars: Record<string, string | undefined>): ChoCommand {
    let app!: ChoCommand;
    with_env(vars, () => {
      app = ChoCommand.create(actions_app([]));
    });
    return app;
  }

  it("logs nothing unless the cho:command context is enabled", async () => {
    const { output } = await capture(async () => {
      const app = create(OFF);
      await app.run(["copy"]);
    });
    assert.deepEqual(output.error, []);
  });

  it("logs the commands, each run and its exit code", async () => {
    const { output } = await capture(async () => {
      const app = create(ON);
      await app.run(["code", "3"]);
    });
    const logs = output.error.map(String).join(" ");
    assert.match(
      logs,
      /actions mode: copy \(Files\.copy\), fail \(Files\.fail\), code \(Files\.code\)/,
    );
    assert.match(logs, /cho:command run code,3/);
    assert.match(logs, /code \(Files\.code\) exited 3/);
  });

  it("logs a failing command as an error", async () => {
    const { output } = await capture(async () => {
      const app = create(ON);
      await app.run(["fail"]);
    });
    const logs = output.error.map(String).join(" ");
    assert.match(logs, /ERROR fail failed: Error: copy failed/);
  });
});

describe("ChoCommand, closing and overrides", () => {
  /** An app whose `name` action prints the name of its `Db`. */
  function db_app(log: string[]) {
    class Db {
      name = "real";
      [Symbol.dispose]() {
        log.push(`closed ${this.name}`);
      }
    }
    Injectable()(Db);
    class Cli {
      constructor(readonly db: Db) {}
      name() {
        console.log(this.db.name);
      }
    }
    legacy(Action("name"), Cli, "name");
    Controller({ dependencies: [Db] })(Cli);
    class App {}
    Module({ providers: [Db], controllers: [Cli] })(App);
    return { App, Db };
  }

  it("keeps instances between runs, and disposes them on close()", async () => {
    const log: string[] = [];
    const app = ChoCommand.create(db_app(log).App);
    await capture(async () => {
      await app.run(["name"]);
      await app.run(["name"]);
    });
    assert.deepEqual(log, []);
    await app.close();
    await app.close();
    assert.deepEqual(log, ["closed real"]);
  });

  it("fails a run after close(), with exit code 1", async () => {
    const app = ChoCommand.create(db_app([]).App);
    await app.close();
    const { result, output } = await capture(() => app.run(["name"]));
    assert.equal(result, 1);
    assert.deepEqual(output.error, ["Error: The injector is disposed"]);
  });

  it("replaces providers with the overrides option", async () => {
    const { App, Db } = db_app([]);
    const app = ChoCommand.create(App, {
      overrides: [
        provider({
          provide: Db,
          factory: () => ({ name: "fake" }) as InstanceType<typeof Db>,
        }),
      ],
    });
    const { output } = await capture(() => app.run(["name"]));
    assert.deepEqual(output.log, ["fake"]);
  });
});

describe("ChoCommand, declared flags", () => {
  /** `copy` declares flags; `ls` does not. Both report their args. */
  function app(seen: ChoArgs[]) {
    class Files {
      copy(ctx: ChoCommandContext) {
        seen.push(ctx.args);
      }
      list(ctx: ChoCommandContext) {
        seen.push(ctx.args);
      }
    }
    legacy(
      Action("copy", {
        boolean: ["force"],
        string: ["mode"],
        alias: { f: "force" },
      }),
      Files,
      "copy",
    );
    legacy(Action("ls"), Files, "list");
    Controller()(Files);
    class App {}
    Module({ controllers: [Files] })(App);
    return ChoCommand.create(App, { name: "fs" });
  }

  it("parses each command with its own flags", async () => {
    const seen: ChoArgs[] = [];
    const fs = app(seen);
    await fs.run(["copy", "-f", "007", "--mode", "0755", "b"]);
    await fs.run(["-v", "ls", "dir"]);
    assert.deepEqual(seen, [
      { _: ["007", "b"], f: true, force: true, mode: "0755" },
      { _: ["dir"], v: true },
    ]);
  });

  it("lists a command's flags in its help", async () => {
    const { output } = await capture(() => app([]).run(["copy", "--help"]));
    assert.match(output.log.join("\n"), /-f, --force\n {2}--mode <value>/);
  });
});
