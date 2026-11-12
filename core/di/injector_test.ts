/**
 * Tests for `injector.ts`: creating instances with `resolve` and `init`.
 *
 * Decorators are applied as plain function calls (see `decorators_test.ts`).
 * Parallelism is tested by counting how many factories run at the same time,
 * not by measuring durations, so the tests do not depend on timing.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Controller, Injectable, Module } from "./decorators.ts";
import { Injector } from "./injector.ts";
import { provider, token } from "./tokens.ts";
import type { Ctr, Provider, Token } from "./types.ts";
import { capture, with_env } from "../utils/test_utils.ts";

/** Resolve after `ms` milliseconds. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A provider object for `provide` with a constant value. */
function value(provide: Token, v: unknown = provide): Provider {
  return provider({ provide, factory: () => Promise.resolve(v) });
}

/**
 * Tracks how many factories run at the same time. `run` takes a few
 * milliseconds, so factories started in parallel overlap, and sequential ones
 * do not.
 */
function concurrency() {
  let running = 0;
  let max = 0;
  return {
    /** The highest number of `run` calls in flight at once. */
    get max() {
      return max;
    },
    /** Simulate an asynchronous factory that returns `result`. */
    async run<T>(result: T): Promise<T> {
      running++;
      max = Math.max(max, running);
      await sleep(10);
      running--;
      return result;
    },
  };
}

/** Await a promise expected to reject, and return its error. */
async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    return error as Error;
  }
  assert.fail("expected the promise to reject");
}

describe("Injector", () => {
  describe("constructor", () => {
    it("builds the dependency graph of the root module", () => {
      class App {}
      Module()(App);
      assert.equal(new Injector(App).graph.root.ctr, App);
    });

    it("throws wiring errors synchronously", () => {
      class Missing {}
      class Service {}
      Injectable([Missing])(Service);
      class App {}
      Module({ providers: [Service] })(App);
      assert.throws(() => new Injector(App), {
        message: /^Cannot resolve Missing/,
      });
    });

    it("creates nothing", () => {
      const log: string[] = [];
      class Db {
        constructor() {
          log.push("Db");
        }
      }
      Injectable()(Db);
      class App {
        constructor() {
          log.push("App");
        }
      }
      Module({ providers: [Db] })(App);

      new Injector(App);
      assert.deepEqual(log, []);
    });
  });

  describe("resolve", () => {
    it("creates a class with its dependencies", async () => {
      class Config {}
      Injectable()(Config);
      class Db {
        readonly config: Config;
        constructor(config: Config) {
          this.config = config;
        }
      }
      Injectable([Config])(Db);
      class App {}
      Module({ providers: [Config, Db] })(App);

      const db = await new Injector(App).resolve(Db);
      assert.ok(db instanceof Db);
      assert.ok(db.config instanceof Config);
    });

    it("resolves injection tokens and symbols to their provider's value", async () => {
      const URL = token<string>("url");
      const CACHE = Symbol("cache");
      class App {}
      Module({
        providers: [value(URL, "https://example.com"), value(CACHE, 42)],
      })(
        App,
      );

      const injector = new Injector(App);
      assert.equal(await injector.resolve(URL), "https://example.com");
      assert.equal(await injector.resolve(CACHE), 42);
    });

    it("resolves the module class itself, with its dependencies", async () => {
      class Db {}
      Injectable()(Db);
      class App {
        readonly db: Db;
        constructor(db: Db) {
          this.db = db;
        }
      }
      Module({ providers: [Db], dependencies: [Db] })(App);

      const app = await new Injector(App).resolve(App);
      assert.ok(app instanceof App);
      assert.ok(app.db instanceof Db);
    });

    it("returns the same instance every time", async () => {
      class Db {}
      Injectable()(Db);
      class App {}
      Module({ providers: [Db] })(App);

      const injector = new Injector(App);
      assert.equal(await injector.resolve(Db), await injector.resolve(Db));
    });

    it("shares one creation between concurrent calls", async () => {
      let created = 0;
      const T = token<object>("t");
      class App {}
      Module({
        providers: [provider({
          provide: T,
          factory: async () => {
            created++;
            await sleep(5);
            return {};
          },
        })],
      })(App);

      const injector = new Injector(App);
      const [a, b, c] = await Promise.all([
        injector.resolve(T),
        injector.resolve(T),
        injector.resolve(T),
      ]);
      assert.equal(created, 1);
      assert.equal(a, b);
      assert.equal(b, c);
    });

    it("creates a dependency shared by several nodes once", async () => {
      let created = 0;
      class Shared {
        constructor() {
          created++;
        }
      }
      Injectable()(Shared);
      class Left {
        readonly shared: Shared;
        constructor(shared: Shared) {
          this.shared = shared;
        }
      }
      Injectable([Shared])(Left);
      class Right {
        readonly shared: Shared;
        constructor(shared: Shared) {
          this.shared = shared;
        }
      }
      Injectable([Shared])(Right);
      class Top {
        readonly left: Left;
        readonly right: Right;
        constructor(left: Left, right: Right) {
          this.left = left;
          this.right = right;
        }
      }
      Injectable([Left, Right])(Top);
      class App {}
      Module({ providers: [Shared, Left, Right, Top] })(App);

      const top = await new Injector(App).resolve(Top);
      assert.equal(created, 1);
      assert.equal(top.left.shared, top.right.shared);
    });

    it("creates independent dependencies in parallel", async () => {
      const tracker = concurrency();
      const A = token<string>("a");
      const B = token<string>("b");
      class Both {}
      Injectable([A, B])(Both);
      class App {}
      Module({
        providers: [
          provider({ provide: A, factory: () => tracker.run("a") }),
          provider({ provide: B, factory: () => tracker.run("b") }),
          Both,
        ],
      })(App);

      await new Injector(App).resolve(Both);
      assert.equal(tracker.max, 2);
    });

    it("passes dependencies to the factory in declared order", async () => {
      const A = token<string>("a");
      const B = token<string>("b");
      const AB = token<string>("ab");
      class App {}
      Module({
        providers: [
          // B resolves first, but must still be the second argument.
          provider({ provide: A, factory: () => sleep(10).then(() => "a") }),
          value(B, "b"),
          provider({
            provide: AB,
            deps: [A, B],
            factory: (a, b) => Promise.resolve(a + b),
          }),
        ],
      })(App);

      assert.equal(await new Injector(App).resolve(AB), "ab");
    });

    it("creates only what the token needs", async () => {
      const log: string[] = [];
      class Used {
        constructor() {
          log.push("Used");
        }
      }
      Injectable()(Used);
      class Unused {
        constructor() {
          log.push("Unused");
        }
      }
      Injectable()(Unused);
      class App {}
      Module({ providers: [Used, Unused] })(App);

      await new Injector(App).resolve(Used);
      assert.deepEqual(log, ["Used"]);
    });

    it("resolves in the scope of the given module", async () => {
      class Db {}
      Injectable()(Db);
      class DbModule {}
      Module({ providers: [Db], exports: [Db] })(DbModule);
      class Cli {
        readonly db: Db;
        constructor(db: Db) {
          this.db = db;
        }
      }
      Controller({ dependencies: [Db] })(Cli);
      class Feature {}
      Module({ imports: [DbModule], controllers: [Cli] })(Feature);
      class App {}
      Module({ imports: [Feature] })(App);

      const injector = new Injector(App);
      await assert.rejects(injector.resolve(Cli), {
        message: "Cli is not visible in module App",
      });
      const cli = await injector.resolve(Cli, Feature);
      assert.ok(cli instanceof Cli);
      assert.ok(cli.db instanceof Db);
    });

    it("rejects, rather than throws, when the token is not visible", async () => {
      class Missing {}
      class App {}
      Module()(App);

      const injector = new Injector(App);
      let result: Promise<unknown> | undefined;
      assert.doesNotThrow(() => {
        result = injector.resolve(Missing);
      });
      await assert.rejects(result!, {
        message: "Missing is not visible in module App",
      });
    });

    it("rejects, rather than throws, for a value String() cannot convert", async () => {
      class App {}
      Module()(App);

      const injector = new Injector(App);
      let result: Promise<unknown> | undefined;
      assert.doesNotThrow(() => {
        result = injector.resolve(Object.create(null));
      });
      await assert.rejects(result!, {
        message: "[object Object] is not visible in module App",
      });
    });

    it("does not see a token an import keeps private", async () => {
      class Config {}
      Injectable()(Config);
      class Lib {}
      Module({ providers: [Config] })(Lib);
      class App {}
      Module({ imports: [Lib] })(App);

      await assert.rejects(new Injector(App).resolve(Config), {
        message: "Config is not visible in module App",
      });
    });

    it("reports an ambiguous token as ambiguous, not as not visible", async () => {
      const T = token<string>("T");
      class X1 {}
      Module({
        providers: [
          provider({ provide: T, factory: () => Promise.resolve("1") }),
        ],
        exports: [T],
      })(X1);
      class X2 {}
      Module({
        providers: [
          provider({ provide: T, factory: () => Promise.resolve("2") }),
        ],
        exports: [T],
      })(X2);
      class App {}
      Module({ imports: [X1, X2] })(App);

      const injector = new Injector(App); // nothing injects T: no error yet
      let result: Promise<unknown> | undefined;
      assert.doesNotThrow(() => {
        result = injector.resolve(T);
      });
      await assert.rejects(result!, {
        message:
          "InjectionToken(T) is ambiguous in module App: X1, X2 export different instances of it. " +
          "Provide InjectionToken(T) in App to choose which one to use.",
      });
    });

    it("rejects when the module is not part of the application", async () => {
      class Db {}
      Injectable()(Db);
      class Other {}
      Module({ providers: [Db] })(Other);
      class App {}
      Module()(App);

      await assert.rejects(new Injector(App).resolve(Db, Other), {
        message: "Other is not part of this application",
      });
    });
  });

  describe("failures", () => {
    it("wraps a factory error with the token and module, keeping the cause", async () => {
      const cause = new Error("db down");
      const T = token("t");
      class App {}
      Module({
        providers: [
          provider({ provide: T, factory: () => Promise.reject(cause) }),
        ],
      })(App);

      const error = await rejection(new Injector(App).resolve(T));
      assert.equal(
        error.message,
        "Failed to create InjectionToken(t) in module App",
      );
      assert.equal(error.cause, cause);
    });

    it("treats a throwing constructor like a failing factory", async () => {
      class Broken {
        constructor() {
          throw new Error("boom");
        }
      }
      Injectable()(Broken);
      class App {}
      Module({ providers: [Broken] })(App);

      const error = await rejection(new Injector(App).resolve(Broken));
      assert.equal(error.message, "Failed to create Broken in module App");
      assert.equal((error.cause as Error).message, "boom");
    });

    it("fails a dependent with the original error, naming the node that failed", async () => {
      const T = token("t");
      class UsesT {}
      Injectable([T])(UsesT);
      class App {}
      Module({
        providers: [
          provider({
            provide: T,
            factory: () => Promise.reject(new Error("down")),
          }),
          UsesT,
        ],
      })(App);

      const injector = new Injector(App);
      const fromDependent = await rejection(injector.resolve(UsesT));
      const direct = await rejection(injector.resolve(T));
      assert.equal(
        fromDependent.message,
        "Failed to create InjectionToken(t) in module App",
      );
      assert.equal(fromDependent, direct);
    });

    it("does not retry: later calls get the same error, the factory runs once", async () => {
      let calls = 0;
      const T = token("t");
      class App {}
      Module({
        providers: [provider({
          provide: T,
          factory: () => {
            calls++;
            return Promise.reject(new Error("down"));
          },
        })],
      })(App);

      const injector = new Injector(App);
      const first = await rejection(injector.resolve(T));
      const second = await rejection(injector.resolve(T));
      assert.equal(first, second);
      assert.equal(calls, 1);
    });
  });

  describe("init", () => {
    it("creates every module, provider and controller, used or not", async () => {
      const log: string[] = [];
      class Unused {
        constructor() {
          log.push("Unused");
        }
      }
      Injectable()(Unused);
      class Cli {
        constructor() {
          log.push("Cli");
        }
      }
      Controller()(Cli);
      class Lib {
        constructor() {
          log.push("Lib");
        }
      }
      Module({ providers: [Unused] })(Lib);
      class App {
        constructor() {
          log.push("App");
        }
      }
      Module({ imports: [Lib], controllers: [Cli] })(App);

      await new Injector(App).init();
      assert.deepEqual(new Set(log), new Set(["Unused", "Cli", "Lib", "App"]));
      assert.equal(log.length, 4);
    });

    it("initializes imported modules before the modules that import them", async () => {
      const log: string[] = [];
      const SLOW = token("slow");
      class Core {
        constructor() {
          log.push("Core");
        }
      }
      // Core is slow to initialize: an importer that did not wait would log first.
      Module({
        providers: [provider({
          provide: SLOW,
          factory: async () => {
            await sleep(20);
            log.push("Core.slow");
          },
        })],
      })(Core);
      class FeatureService {
        constructor() {
          log.push("FeatureService");
        }
      }
      Injectable()(FeatureService); // does not depend on anything from Core
      class Feature {
        constructor() {
          log.push("Feature");
        }
      }
      Module({ imports: [Core], providers: [FeatureService] })(Feature);
      class App {
        constructor() {
          log.push("App");
        }
      }
      Module({ imports: [Feature] })(App);

      await new Injector(App).init();
      const at = (name: string) => log.indexOf(name);
      const core = Math.max(at("Core"), at("Core.slow"));
      const feature = [at("Feature"), at("FeatureService")];
      assert.ok(feature.every((i) => i > core), log.join(" → "));
      assert.ok(feature.every((i) => i < at("App")), log.join(" → "));
    });

    it("initializes a module imported through several paths once", async () => {
      let created = 0;
      class Shared {
        constructor() {
          created++;
        }
      }
      Module()(Shared);
      class Left {}
      Module({ imports: [Shared] })(Left);
      class Right {}
      Module({ imports: [Shared] })(Right);
      class App {}
      Module({ imports: [Left, Right] })(App);

      await new Injector(App).init();
      assert.equal(created, 1);
    });

    it("initializes independent modules in parallel", async () => {
      const tracker = concurrency();
      class M1 {}
      Module({
        providers: [provider({
          provide: token("1"),
          factory: () => tracker.run(1),
        })],
      })(M1);
      class M2 {}
      Module({
        providers: [provider({
          provide: token("2"),
          factory: () => tracker.run(2),
        })],
      })(M2);
      class App {}
      Module({ imports: [M1, M2] })(App);

      await new Injector(App).init();
      assert.equal(tracker.max, 2);
    });

    it("can be called more than once, and concurrently, creating everything once", async () => {
      let created = 0;
      class Db {
        constructor() {
          created++;
        }
      }
      Injectable()(Db);
      class App {}
      Module({ providers: [Db] })(App);

      const injector = new Injector(App);
      await Promise.all([injector.init(), injector.init()]);
      await injector.init();
      assert.equal(created, 1);
    });

    it("shares instances with resolve", async () => {
      let created = 0;
      class Db {
        constructor() {
          created++;
        }
      }
      Injectable()(Db);
      class App {}
      Module({ providers: [Db] })(App);

      const injector = new Injector(App);
      const before = await injector.resolve(Db);
      await injector.init();
      const after = await injector.resolve(Db);
      assert.equal(before, after);
      assert.equal(created, 1);
    });

    it("rejects with the wrapped error when a factory fails", async () => {
      const T = token("t");
      class Lib {}
      Module({
        providers: [provider({
          provide: T,
          factory: () => Promise.reject(new Error("down")),
        })],
      })(Lib);
      class App {}
      Module({ imports: [Lib] })(App);

      const error = await rejection(new Injector(App).init());
      assert.equal(
        error.message,
        "Failed to create InjectionToken(t) in module Lib",
      );
      assert.equal((error.cause as Error).message, "down");
    });
  });

  describe("isolation", () => {
    it("two injectors for the same root share no instances", async () => {
      class Db {}
      Injectable()(Db);
      class App {}
      Module({ providers: [Db] })(App);

      const a = await new Injector(App).resolve(Db);
      const b = await new Injector(App).resolve(Db);
      assert.notEqual(a, b);
    });
  });
});

describe("Injector, debug logging", () => {
  /** An app whose root imports `Db`, with one provider each. */
  function app() {
    class Logger {}
    Injectable()(Logger);
    class Db {}
    Module({ providers: [Logger], exports: [Logger] })(Db);
    class Users {}
    Injectable([Logger])(Users);
    class App {}
    Module({ imports: [Db], providers: [Users] })(App);
    return { App, Users };
  }

  /** Create an injector with the given environment, then run `fn`. */
  async function logged(
    vars: Record<string, string | undefined>,
    root: Ctr,
    fn: (injector: Injector) => Promise<unknown>,
  ): Promise<string> {
    const { output } = await capture(async () => {
      let injector!: Injector;
      with_env(vars, () => {
        injector = new Injector(root);
      });
      await fn(injector);
    });
    return output.error.map(String).join(" ");
  }

  const OFF = { CHO_DEBUG: undefined, CHO_DEBUGLOG: undefined };

  it("logs nothing unless the cho:di context is enabled", async () => {
    const { App, Users } = app();
    const logs = await logged(OFF, App, (injector) => injector.resolve(Users));
    assert.equal(logs, "");
  });

  for (
    const vars of [{ CHO_DEBUGLOG: "cho:di" }, { CHO_DEBUGLOG: "cho:*" }, {
      CHO_DEBUG: "1",
    }]
  ) {
    it(`logs with ${JSON.stringify(vars)}`, async () => {
      const { App, Users } = app();
      const logs = await logged(
        { ...OFF, ...vars },
        App,
        (injector) => injector.resolve(Users),
      );
      assert.match(logs, /cho:di/);
    });
  }

  it("logs the graph, resolve calls, creations and module initialization", async () => {
    const { App, Users } = app();
    const logs = await logged(
      { ...OFF, CHO_DEBUGLOG: "cho:di" },
      App,
      async (injector) => {
        await injector.resolve(Users);
        await injector.init();
      },
    );
    for (
      const expected of [
        "module Db: 2 declarations",
        "module App: 2 declarations, imports Db",
        "graph of App built: 2 modules",
        "resolve Users in module App",
        "created Logger in module Db",
        "created Users in module App",
        "module Db initialized",
        "module App initialized",
      ]
    ) {
      assert.ok(logs.includes(expected), `missing "${expected}" in: ${logs}`);
    }
  });

  it("logs failures as errors", async () => {
    class Broken {
      constructor() {
        throw new Error("no config");
      }
    }
    Injectable()(Broken);
    class App {}
    Module({ providers: [Broken] })(App);
    const logs = await logged(
      { ...OFF, CHO_DEBUGLOG: "cho:di" },
      App,
      async (injector) => {
        await injector.resolve(Symbol("missing")).catch(() => {});
        await injector.resolve(Broken).catch(() => {});
      },
    );
    assert.ok(
      logs.includes(
        "ERROR resolve failed: Symbol(missing) is not visible in module App",
      ),
      logs,
    );
    assert.ok(
      logs.includes("ERROR failed to create Broken in module App:"),
      logs,
    );
    assert.ok(logs.includes("no config"), logs);
  });

  it("logs an invalid graph, and still throws", async () => {
    class NotAModule {}
    const { output } = await capture(() =>
      with_env({ ...OFF, CHO_DEBUGLOG: "cho:di" }, () => {
        assert.throws(() => new Injector(NotAModule), {
          message: "Class NotAModule is not a module. Did you forget @Module?",
        });
      })
    );
    const logs = output.error.map(String).join(" ");
    assert.ok(logs.includes("ERROR invalid graph of NotAModule:"), logs);
  });
});
