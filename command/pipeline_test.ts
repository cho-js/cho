/**
 * Tests for `pipeline.ts`: middlewares, the command context and error
 * handlers, end to end through `ChoCommand`.
 *
 * Decorators are applied as plain function calls, so the tests run on every
 * runtime.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Injectable } from "@chojs/core/di";
import { capture, legacy, loose } from "@chojs/core/utils/test_utils";
import { ChoCommand } from "./command.ts";
import type { ChoCommandContext } from "./context.ts";
import {
  Action,
  Catch,
  Controller,
  Main,
  Middlewares,
  Module,
} from "./decorators.ts";
import type { ChoCommandMiddlewareFn } from "./types.ts";

type Class = new (...args: never[]) => object;

/** Run one command line, with the console captured. */
async function run(app: ChoCommand, ...argv: string[]) {
  const { result, output } = await capture(() => app.run(argv));
  return { code: result, ...output };
}

/** A middleware that records its name, then runs the rest of the chain. */
function recorder(seen: string[]) {
  return (name: string): ChoCommandMiddlewareFn => (ctx, next) => {
    seen.push(`${name} ${ctx.command}`);
    return next();
  };
}

/** A controller with one action, `name`, that runs `handler`. */
function controller(
  name: string,
  handler: (ctx: ChoCommandContext) => unknown = () => {},
) {
  class Ctrl {
    run(ctx: ChoCommandContext) {
      return handler(ctx);
    }
  }
  legacy(Action(name), Ctrl, "run");
  Controller()(Ctrl);
  return Ctrl;
}

/** A module declaring the given controllers. */
function module_of(controllers: Class[], providers: Class[] = []) {
  class Mod {}
  Module({ controllers, providers })(Mod);
  return Mod;
}

const boom = () => {
  throw new Error("boom");
};

describe("command context", () => {
  it("gives a command the args, the argv, its name and a state", async () => {
    const seen: ChoCommandContext[] = [];
    const app = ChoCommand.create(
      module_of([controller("copy", (ctx) => void seen.push(ctx))]),
    );
    const argv = ["copy", "a", "--force"];
    await run(app, ...argv);

    const [ctx] = seen;
    assert.deepEqual(ctx!.args, { _: ["a"], force: true });
    assert.deepEqual(ctx!.argv, argv);
    assert.notEqual(ctx!.argv, argv); // a copy: the caller's array is its own
    assert.equal(ctx!.command, "copy");
    assert.ok(ctx!.state instanceof Map);
  });

  it("names the single command main, and makes a new context for each run", async () => {
    const seen: ChoCommandContext[] = [];
    class Cli {
      run(ctx: ChoCommandContext) {
        seen.push(ctx);
      }
    }
    legacy(Main(), Cli, "run");
    Controller()(Cli);
    const app = ChoCommand.create(module_of([Cli]));
    await run(app, "a");
    await run(app, "b");

    assert.deepEqual(seen.map((ctx) => ctx.command), ["main", "main"]);
    assert.notEqual(seen[0], seen[1]);
    assert.notEqual(seen[0]!.state, seen[1]!.state);
  });
});

describe("middlewares", () => {
  it("run the module's, the controller's, then the method's, around the command", async () => {
    const seen: string[] = [];
    const mw = recorder(seen);
    class Files {
      copy() {
        seen.push("command");
      }
    }
    legacy(Action("copy"), Files, "copy");
    legacy(Middlewares(mw("method")), Files, "copy");
    Controller()(Files);
    Middlewares(mw("controller-1"), mw("controller-2"))(Files);
    const App = module_of([Files]);
    Middlewares(mw("module"))(App);

    assert.equal((await run(ChoCommand.create(App), "copy")).code, 0);
    assert.deepEqual(seen, [
      "module copy",
      "controller-1 copy",
      "controller-2 copy",
      "method copy",
      "command",
    ]);
  });

  it("never run for a command of another controller or module", async () => {
    const seen: string[] = [];
    const mw = recorder(seen);
    class A {
      a() {}
      plain() {}
    }
    legacy(Action("a"), A, "a");
    legacy(Middlewares(mw("A.a")), A, "a");
    legacy(Action("plain"), A, "plain");
    Controller()(A);
    const Guarded = controller("guarded");
    Middlewares(mw("Guarded"))(Guarded);
    const ModA = module_of([A, Guarded]);
    const ModB = module_of([controller("b")]);
    Middlewares(mw("ModB"))(ModB);
    class App {}
    Module({ imports: [ModA, ModB] })(App);
    const app = ChoCommand.create(App);

    await run(app, "plain");
    assert.deepEqual(seen, []);
    await run(app, "a");
    await run(app, "guarded");
    await run(app, "b");
    assert.deepEqual(seen, ["A.a a", "Guarded guarded", "ModB b"]);
  });

  it("can stop before the command with an exit code", async () => {
    let ran = false;
    const Ctrl = controller("rm", () => {
      ran = true;
    });
    Middlewares((ctx) => ctx.args.yes ? undefined : 3, (_ctx, next) => next())(
      Ctrl,
    );
    const app = ChoCommand.create(module_of([Ctrl]));

    assert.equal((await run(app, "rm")).code, 3);
    assert.equal(ran, false);
  });

  it("can replace the exit code, or pass it on by returning nothing", async () => {
    const Ctrl = controller("x", () => 4);
    const replace: ChoCommandMiddlewareFn = async (_ctx, next) =>
      (await next()) + 1;
    const quiet: ChoCommandMiddlewareFn = async (_ctx, next) => {
      await next();
    };
    Middlewares(quiet, replace, quiet)(Ctrl);
    assert.equal(
      (await run(ChoCommand.create(module_of([Ctrl])), "x")).code,
      5,
    );
  });

  it("caps an exit code a middleware returns", async () => {
    const Ctrl = controller("x");
    Middlewares(() => 300)(Ctrl);
    assert.equal(
      (await run(ChoCommand.create(module_of([Ctrl])), "x")).code,
      255,
    );
  });

  it("share the state of the context with the command", async () => {
    const Ctrl = controller("who", (ctx) => {
      console.log(ctx.state.get("user"));
    });
    Middlewares((ctx, next) => {
      ctx.state.set("user", "ada");
      return next();
    })(Ctrl);
    const { log } = await run(ChoCommand.create(module_of([Ctrl])), "who");
    assert.deepEqual(log, ["ada"]);
  });

  for (
    const [title, middleware, message] of [
      [
        "returns nothing without calling next",
        function lost() {},
        "Error: middleware lost returned no exit code: return an exit code or call next()",
      ],
      [
        "returns something that is not an exit code",
        function wrong() {
          return "1";
        },
        "Error: middleware wrong must return an exit code or nothing, got string",
      ],
      [
        "returns a negative number",
        function negative() {
          return -1;
        },
        "Error: middleware negative must return an exit code or nothing, got number",
      ],
      [
        "calls next twice",
        async function twice(_ctx: unknown, next: () => Promise<number>) {
          await next();
          return next();
        },
        "Error: middleware twice: next() called more than once",
      ],
    ] as const
  ) {
    it(`fail the run when one ${title}`, async () => {
      const Ctrl = controller("x");
      Middlewares(loose(middleware))(Ctrl);
      const { code, error } = await run(
        ChoCommand.create(module_of([Ctrl])),
        "x",
      );
      assert.equal(code, 1);
      assert.deepEqual(error, [message]);
    });
  }

  it("can be classes, created with their dependencies on the first run only", async () => {
    const created: string[] = [];
    class Clock {
      constructor() {
        created.push("Clock");
      }
      now = 42;
    }
    Injectable()(Clock);
    class Timing {
      constructor(readonly clock: Clock) {
        created.push("Timing");
      }
      handle(ctx: ChoCommandContext, next: () => Promise<number>) {
        ctx.state.set("started", this.clock.now);
        return next();
      }
    }
    Injectable([Clock])(Timing);
    const Ctrl = controller("t", (ctx) => {
      console.log(ctx.state.get("started"));
    });
    Middlewares(Timing)(Ctrl);
    const Other = controller("other");
    const app = ChoCommand.create(module_of([Ctrl, Other], [Clock, Timing]));

    assert.deepEqual(created, []);
    await run(app, "other");
    await run(app, "--help");
    assert.deepEqual(created, []);
    assert.deepEqual((await run(app, "t")).log, ["42"]);
    await run(app, "t");
    assert.deepEqual(created, ["Clock", "Timing"]);
  });

  it("do not run for --help, --version, no action or an unknown action", async () => {
    const seen: string[] = [];
    const Ctrl = controller("x");
    Middlewares(recorder(seen)("mw"))(Ctrl);
    const App = module_of([Ctrl]);
    Middlewares(recorder(seen)("module"))(App);
    Catch(() => {
      seen.push("catch");
    })(App);
    const app = ChoCommand.create(App, {
      onError: () => {
        seen.push("onError");
      },
    });

    for (const argv of [["--help"], ["x", "--help"], ["--version"], []]) {
      assert.equal((await run(app, ...argv)).code, 0);
    }
    const unknown = await run(app, "nope");
    assert.equal(unknown.code, 1);
    assert.deepEqual(unknown.error, [
      "Error: Action 'nope' not found. Use --help for usage information.",
    ]);
    assert.deepEqual(seen, []);
  });
});

describe("inherited commands", () => {
  it("keep their action when an override only adds to them", async () => {
    const seen: string[] = [];
    const mw = recorder(seen);
    class Base {
      sync() {
        return 1;
      }
    }
    legacy(Action("sync"), Base, "sync");
    legacy(Middlewares(mw("base")), Base, "sync");
    class Files extends Base {
      override sync() {
        return 2;
      }
    }
    legacy(Middlewares(mw("files")), Files, "sync"); // adds; the action stays
    Controller()(Files);
    const app = ChoCommand.create(module_of([Files]));

    assert.equal((await run(app, "sync")).code, 2);
    assert.deepEqual(seen, ["base sync", "files sync"]);
  });
});

describe("error handlers", () => {
  const tag = (level: string, code: number) =>
  (
    error: unknown,
    ctx: ChoCommandContext,
  ) => {
    console.log(`${level}: ${(error as Error).message} in ${ctx.command}`);
    return code;
  };

  it("use the nearest: the method's, the controller's, the module's, then onError", async () => {
    class Own {
      run() {
        boom();
      }
      other() {
        boom();
      }
    }
    legacy(Action("run"), Own, "run");
    legacy(Catch(tag("method", 11)), Own, "run");
    legacy(Action("other"), Own, "other");
    Controller()(Own);
    Catch(tag("controller", 12))(Own);
    const Covered = module_of([Own, controller("bare", boom)]);
    Catch(tag("module", 13))(Covered);
    const Uncovered = module_of([controller("free", boom)]);
    class App {}
    Module({ imports: [Covered, Uncovered] })(App);
    const app = ChoCommand.create(App, { onError: tag("app", 14) });

    const result = async (name: string) => {
      const { code, log } = await run(app, name);
      return [code, ...log];
    };
    assert.deepEqual(await result("run"), [11, "method: boom in run"]);
    assert.deepEqual(await result("other"), [12, "controller: boom in other"]);
    assert.deepEqual(await result("bare"), [13, "module: boom in bare"]);
    assert.deepEqual(await result("free"), [14, "app: boom in free"]);
  });

  it("handle an error thrown by a middleware", async () => {
    const Ctrl = controller("x");
    Middlewares(boom)(Ctrl);
    Catch(() => 7)(Ctrl);
    const { code, error } = await run(
      ChoCommand.create(module_of([Ctrl])),
      "x",
    );
    assert.equal(code, 7);
    assert.deepEqual(error, []);
  });

  it("handle a middleware class that cannot be created", async () => {
    class Broken {
      constructor() {
        throw new Error("no clock");
      }
      handle() {}
    }
    Injectable()(Broken);
    const Ctrl = controller("x");
    Middlewares(Broken)(Ctrl);
    let seen: unknown;
    Catch((error) => {
      seen = error;
      return 9;
    })(Ctrl);
    const { code } = await run(
      ChoCommand.create(module_of([Ctrl], [Broken])),
      "x",
    );
    assert.equal(code, 9);
    assert.equal(
      (seen as Error).message,
      "Failed to create Broken in module Mod",
    );
  });

  it("give 1 when the error handler returns anything but an exit code", async () => {
    const Ctrl = controller("x", boom);
    Catch(() => "handled")(Ctrl);
    assert.equal(
      (await run(ChoCommand.create(module_of([Ctrl])), "x")).code,
      1,
    );
  });

  it("can be the onError class, created in the scope of the root module", async () => {
    class Reporter {
      seen: string[] = [];
    }
    Injectable()(Reporter);
    class OnError {
      constructor(readonly reporter: Reporter) {}
      handle(error: unknown, ctx: ChoCommandContext) {
        console.log(`reported ${(error as Error).message} in ${ctx.command}`);
        return 6;
      }
    }
    Injectable([Reporter])(OnError);
    class App {}
    Module({
      imports: [module_of([controller("x", boom)])],
      providers: [Reporter, OnError],
    })(App);

    const { code, log } = await run(
      ChoCommand.create(App, { onError: OnError }),
      "x",
    );
    assert.deepEqual([code, ...log], [6, "reported boom in x"]);
  });

  it("print the original error and give 2 when the error handler fails", async () => {
    const Ctrl = controller("x", boom);
    Catch(() => {
      throw new Error("handler failed");
    })(Ctrl);
    const { code, error } = await run(
      ChoCommand.create(module_of([Ctrl])),
      "x",
    );
    assert.equal(code, 2);
    assert.deepEqual(error, ["Error: boom"]);
  });
});

describe("validation, when the application is created", () => {
  class NoHandle {}

  it("rejects a middleware class without a handle method", () => {
    const Ctrl = controller("x");
    Middlewares(loose(NoHandle))(Ctrl);
    assert.throws(() => ChoCommand.create(module_of([Ctrl])), {
      message: "Middleware class NoHandle must implement 'handle' method.",
    });
  });

  it("rejects an error handler class without a handle method, at every level", () => {
    const on_method = controller("x");
    legacy(Catch(loose(NoHandle)), on_method, "run");
    const on_controller = controller("x");
    Catch(loose(NoHandle))(on_controller);
    const on_module = module_of([controller("x")]);
    Catch(loose(NoHandle))(on_module);
    for (
      const App of [
        module_of([on_method]),
        module_of([on_controller]),
        on_module,
      ]
    ) {
      assert.throws(() => ChoCommand.create(App), {
        message: "Error handler class NoHandle must implement 'handle' method.",
      });
    }
  });

  it("rejects an onError that is not a function or a usable class", () => {
    const App = module_of([controller("x")]);
    assert.throws(() => ChoCommand.create(App, { onError: loose("handler") }), {
      message:
        "Invalid error handler \"handler\": must be a function or a class with a 'handle' method.",
    });
    assert.throws(() => ChoCommand.create(App, { onError: loose(NoHandle) }), {
      message: "Error handler class NoHandle must implement 'handle' method.",
    });
  });

  it("rejects a middleware class the injector cannot find", () => {
    class Timing {
      handle(_ctx: unknown, next: () => Promise<number>) {
        return next();
      }
    }
    Injectable()(Timing);
    const Ctrl = controller("x");
    Middlewares(Timing)(Ctrl);
    // not a provider of the controller's module
    assert.throws(() => ChoCommand.create(module_of([Ctrl])), {
      message:
        "Middleware class Timing is not visible in module Mod. Provide it there or import a module that exports it.",
    });
    // provided: fine
    assert.doesNotThrow(() => ChoCommand.create(module_of([Ctrl], [Timing])));
  });

  it("accepts a middleware class exported by an imported module", async () => {
    const seen: string[] = [];
    class Timing {
      handle(ctx: ChoCommandContext, next: () => Promise<number>) {
        seen.push(ctx.command);
        return next();
      }
    }
    Injectable()(Timing);
    class Shared {}
    Module({ providers: [Timing], exports: [Timing] })(Shared);
    const Ctrl = controller("x");
    Middlewares(Timing)(Ctrl);
    class App {}
    Module({ imports: [Shared], controllers: [Ctrl] })(App);

    assert.equal((await run(ChoCommand.create(App), "x")).code, 0);
    assert.deepEqual(seen, ["x"]);
  });

  it("rejects an error handler class the injector cannot find, at every level", () => {
    const make = () => {
      class OnError {
        handle() {
          return 2;
        }
      }
      Injectable()(OnError);
      return OnError;
    };
    const message = (module: string) => ({
      message:
        `Error handler class OnError is not visible in module ${module}. Provide it there or import a module that exports it.`,
    });

    const A = make();
    const on_method = controller("x");
    legacy(Catch(A), on_method, "run");
    assert.throws(
      () => ChoCommand.create(module_of([on_method])),
      message("Mod"),
    );

    const B = make();
    const on_controller = controller("x");
    Catch(B)(on_controller);
    assert.throws(
      () => ChoCommand.create(module_of([on_controller])),
      message("Mod"),
    );

    const C = make();
    const on_module = module_of([controller("x")]);
    Catch(C)(on_module);
    assert.throws(() => ChoCommand.create(on_module), message("Mod"));

    // onError is created in the root module's scope, not the controller's
    const D = make();
    const Feature = module_of([controller("x")], [D]);
    class Root {}
    Module({ imports: [Feature] })(Root);
    assert.throws(
      () => ChoCommand.create(Root, { onError: D }),
      message("Root"),
    );
  });

  it("rejects a class that two imports export as different instances", () => {
    class Timing {
      handle(_ctx: unknown, next: () => Promise<number>) {
        return next();
      }
    }
    Injectable()(Timing);
    const exporting = () => {
      class Exporter {}
      Module({ providers: [Timing], exports: [Timing] })(Exporter);
      return Exporter;
    };
    const Ctrl = controller("x");
    Middlewares(Timing)(Ctrl);
    class App {}
    Module({ imports: [exporting(), exporting()], controllers: [Ctrl] })(App);

    assert.throws(() => ChoCommand.create(App), {
      message:
        "Middleware class Timing is ambiguous in module App: several of its imports export it. Provide it there to choose one.",
    });
  });

  it("creates nothing", () => {
    let created = 0;
    class Counted {
      constructor() {
        created++;
      }
      handle() {}
    }
    Injectable()(Counted);
    const Ctrl = controller("x");
    Middlewares(Counted)(Ctrl);
    Catch(Counted)(Ctrl);
    ChoCommand.create(module_of([Ctrl], [Counted]), { onError: Counted });
    assert.equal(created, 0);
  });
});
