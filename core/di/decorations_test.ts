/**
 * Tests for `decorations.ts`: the functions behind the DI decorators, which
 * validate the decorator options and write the class records.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decorated_method,
  decorated_target,
  set_controller,
  set_error_handler,
  set_injectable,
  set_middlewares,
  set_module,
} from "./decorations.ts";
import { read_metadata_object } from "./metadata.ts";
import { provider, token } from "./tokens.ts";
import type { Any, ChoMiddlewareFn } from "./types.ts";

const ALREADY_DECORATED =
  "class is already decorated with @Injectable, @Module or @Controller";
const BAD_DEPENDENCY =
  "all dependencies must be classes, symbols or injection tokens";

/** Bypass the option types, to pass the invalid values JS callers can. */
const loose = (value: unknown): Any => value;

describe("set_injectable", () => {
  it("writes an injectable record with the dependencies", () => {
    class Logger {}
    const PORT = token<number>("PORT");
    const CACHE = Symbol("cache");
    abstract class Base {}
    class Foo {}
    set_injectable(Foo, { dependencies: [Logger, PORT, CACHE, Base] });
    assert.deepEqual(read_metadata_object(Foo), {
      isInjectable: true,
      dependencies: [Logger, PORT, CACHE, Base],
    });
  });

  it("writes to a decorator metadata object", () => {
    const metadata = {};
    set_injectable(metadata, { dependencies: [] });
    assert.deepEqual(read_metadata_object(metadata), {
      isInjectable: true,
      dependencies: [],
    });
  });

  it("does not keep a reference to the given dependencies array", () => {
    class Logger {}
    class Foo {}
    const dependencies: Any[] = [Logger];
    set_injectable(Foo, { dependencies });
    dependencies.push(Logger);
    assert.deepEqual(read_metadata_object(Foo), {
      isInjectable: true,
      dependencies: [Logger],
    });
  });

  for (
    const [name, value, shown] of [
      ["a string", "Logger", '"Logger"'],
      ["a number", 42, "42"],
      ["undefined", undefined, "undefined"],
      ["null", null, "null"],
      ["an empty object", {}, "{}"],
      ["an object", { name: "Logger", deps: [] }, "{ name, deps }"],
      ["an array", [1, 2], "array(2)"],
      // String() throws on these two; the error must still be reported.
      ["an object without a prototype", Object.create(null), "{}"],
      [
        "an object whose toString throws",
        {
          toString() {
            throw new Error("boom");
          },
        },
        "{ toString }",
      ],
    ] as const
  ) {
    it(`throws on a dependency that is ${name}`, () => {
      class Foo {}
      assert.throws(
        () => set_injectable(Foo, { dependencies: [loose(value)] }),
        { message: `${BAD_DEPENDENCY}: ${shown}` },
      );
    });
  }

  it("throws when the dependencies are not an array", () => {
    class Logger {}
    class Foo {}
    assert.throws(() => set_injectable(Foo, { dependencies: loose(Logger) }), {
      message: "dependencies must be an array, got Logger",
    });
    assert.throws(() => set_injectable(Foo, { dependencies: loose(null) }), {
      message: "dependencies must be an array, got null",
    });
    assert.equal(read_metadata_object(Foo), undefined);
  });

  it("writes nothing when a dependency is invalid", () => {
    class Logger {}
    class Foo {}
    assert.throws(() =>
      set_injectable(Foo, { dependencies: [Logger, loose("x")] })
    );
    assert.equal(read_metadata_object(Foo), undefined);
  });

  it("throws when the target is already injectable", () => {
    class Foo {}
    set_injectable(Foo, { dependencies: [] });
    assert.throws(() => set_injectable(Foo, { dependencies: [] }), {
      message: ALREADY_DECORATED,
    });
  });

  it("throws on an already decorated metadata object", () => {
    const metadata = {};
    set_injectable(metadata, { dependencies: [] });
    assert.throws(() => set_injectable(metadata, { dependencies: [] }), {
      message: ALREADY_DECORATED,
    });
  });

  it("checks for a previous decorator before validating dependencies", () => {
    class Foo {}
    set_injectable(Foo, { dependencies: [] });
    assert.throws(() => set_injectable(Foo, { dependencies: [loose("x")] }), {
      message: ALREADY_DECORATED,
    });
  });

  it("does not see the record of a parent class", () => {
    class Base {}
    set_injectable(Base, { dependencies: [] });
    class Sub extends Base {}
    set_injectable(Sub, { dependencies: [] });
    assert.deepEqual(read_metadata_object(Sub), {
      isInjectable: true,
      dependencies: [],
    });
  });
});

describe("set_module", () => {
  it("writes the module fields, each defaulting to []", () => {
    class App {}
    set_module(App, {});
    assert.deepEqual(read_metadata_object(App), {
      isModule: true,
      imports: [],
      exports: [],
      providers: [],
      controllers: [],
    });
  });

  it("does not mark the target injectable or store dependencies", () => {
    class Logger {}
    class App {}
    set_module(App, { dependencies: [Logger] });
    const record = read_metadata_object<Record<string, unknown>>(App)!;
    assert.equal("isInjectable" in record, false);
    assert.equal("dependencies" in record, false);
  });

  it("adds to the record written by set_injectable", () => {
    class Logger {}
    class Db {}
    class Cli {}
    class DbModule {}
    const API_URL = token<string>("API_URL");
    const apiUrl = provider({
      provide: API_URL,
      factory: () => Promise.resolve("url"),
    });
    class App {}
    set_injectable(App, { dependencies: [Logger] });
    set_module(App, {
      imports: [DbModule],
      providers: [Db, apiUrl],
      controllers: [Cli],
      exports: [Db, API_URL],
    });
    assert.deepEqual(read_metadata_object(App), {
      isInjectable: true,
      dependencies: [Logger],
      isModule: true,
      imports: [DbModule],
      exports: [Db, API_URL],
      providers: [Db, apiUrl],
      controllers: [Cli],
    });
  });

  it("stores any other option as is", () => {
    const auth = () => {};
    class App {}
    set_module(App, { route: "api", middlewares: [auth] });
    assert.deepEqual(read_metadata_object(App), {
      route: "api",
      middlewares: [auth],
      isModule: true,
      imports: [],
      exports: [],
      providers: [],
      controllers: [],
    });
  });

  it("does not let an option overwrite the flags", () => {
    class App {}
    set_injectable(App, { dependencies: [] });
    set_module(App, loose({ isModule: "no", isInjectable: "no" }));
    const record = read_metadata_object<Record<string, unknown>>(App)!;
    assert.equal(record["isModule"], true);
    assert.equal(record["isInjectable"], true);
  });

  for (
    const [option, value, got] of [
      ["imports", class Db {}, "Db"],
      ["controllers", "Cli", '"Cli"'],
      ["exports", token("URL"), "InjectionToken(URL)"],
      ["providers", { provide: "x" }, "{ provide }"],
    ] as const
  ) {
    it(`throws when ${option} is not an array`, () => {
      class App {}
      assert.throws(() => set_module(App, loose({ [option]: value })), {
        message: `${option} must be an array, got ${got}`,
      });
      assert.equal(read_metadata_object(App), undefined);
    });
  }

  it("throws on an import that is not a class", () => {
    class App {}
    assert.throws(() => set_module(App, { imports: [loose("Db")] }), {
      message: 'all imports must be classes: "Db"',
    });
  });

  it("throws on a controller that is not a class", () => {
    class App {}
    assert.throws(() => set_module(App, { controllers: [loose(1)] }), {
      message: "all controllers must be classes: 1",
    });
  });

  it("reports imports and controllers that String() cannot convert", () => {
    class App {}
    assert.throws(
      () => set_module(App, { imports: [loose(Object.create(null))] }),
      { message: "all imports must be classes: {}" },
    );
    assert.throws(
      () => set_module(App, { controllers: [loose({ a: 1 })] }),
      { message: "all controllers must be classes: { a }" },
    );
  });

  it("accepts classes, injection tokens and symbols as exports", () => {
    class Db {}
    const URL = token<string>("URL");
    const KEY = Symbol("key");
    class App {}
    set_module(App, { exports: [Db, URL, KEY] });
    assert.deepEqual(
      read_metadata_object<{ exports: unknown[] }>(App)?.exports,
      [Db, URL, KEY],
    );
  });

  it("throws on an export that is not a token", () => {
    class App {}
    assert.throws(() => set_module(App, { exports: [loose("Db")] }), {
      message: 'all exports must be classes, symbols or injection tokens: "Db"',
    });
  });

  it("writes nothing when an option is invalid", () => {
    class App {}
    assert.throws(() => set_module(App, { imports: [loose(null)] }));
    assert.equal(read_metadata_object(App), undefined);
  });

  describe("providers", () => {
    it("accepts classes and provider objects", () => {
      class Db {}
      const URL = token<string>("URL");
      const KEY = Symbol("key");
      const providers = [
        Db,
        provider({ provide: URL, factory: () => Promise.resolve("u") }),
        provider({
          provide: KEY,
          deps: [Db],
          factory: () => Promise.resolve(1),
        }),
        // A plain object without `deps` is accepted too.
        { provide: Db, factory: () => Promise.resolve(new Db()) },
      ];
      class App {}
      set_module(App, { providers: loose(providers) });
      assert.deepEqual(
        read_metadata_object<{ providers: unknown[] }>(App)?.providers,
        providers,
      );
    });

    const factory = () => Promise.resolve(1);
    const URL = token<string>("URL");

    for (
      const [name, value, message] of [
        ["a string", "Db", 'provider "Db" is not an object'],
        ["a number", 1, "provider 1 is not an object"],
        ["null", null, "provider null is not an object"],
        ["undefined", undefined, "provider undefined is not an object"],
        [
          "an empty object",
          {},
          'provider {} is missing the "provide" property',
        ],
        [
          "an object without provide",
          { factory, deps: [] },
          'provider { factory, deps } is missing the "provide" property',
        ],
        [
          "an object with many keys and no provide",
          { a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 },
          'provider { a, b, c, d, e, ... } is missing the "provide" property',
        ],
        [
          "an object whose provide is not a token",
          { provide: "URL", factory },
          'provider { provide, factory }: "provide" must be a class, symbol or injection token, got "URL"',
        ],
        [
          "an object without factory",
          { provide: URL },
          'provider for InjectionToken(URL) is missing the "factory" property',
        ],
        [
          "an object whose factory is not a function",
          { provide: URL, factory: 1 },
          'provider for InjectionToken(URL): "factory" must be a function, got 1',
        ],
        [
          "an object whose deps is not an array",
          { provide: URL, factory, deps: URL },
          'provider for InjectionToken(URL): "deps" must be an array, got InjectionToken(URL)',
        ],
        [
          "an object with a deps entry that is not a token",
          { provide: URL, factory, deps: [URL, "x"] },
          'provider for InjectionToken(URL): all deps must be classes, symbols or injection tokens: "x"',
        ],
        [
          "an object without a prototype",
          Object.create(null),
          'provider {} is missing the "provide" property',
        ],
        [
          "an object whose provide is an object without a prototype",
          { provide: Object.create(null), factory },
          'provider { provide, factory }: "provide" must be a class, symbol or injection token, got {}',
        ],
        [
          "an object whose factory is an object",
          { provide: URL, factory: { call: 1 } },
          'provider for InjectionToken(URL): "factory" must be a function, got { call }',
        ],
        [
          "an object whose deps is an object",
          { provide: URL, factory, deps: { 0: URL } },
          'provider for InjectionToken(URL): "deps" must be an array, got { 0 }',
        ],
        [
          "an object with a deps entry that is an object without a prototype",
          { provide: URL, factory, deps: [Object.create(null)] },
          "provider for InjectionToken(URL): all deps must be classes, symbols or injection tokens: {}",
        ],
        [
          "an object provided by a class",
          { provide: class Db {} },
          'provider for Db is missing the "factory" property',
        ],
        [
          "an object provided by a symbol",
          { provide: Symbol("key") },
          'provider for Symbol(key) is missing the "factory" property',
        ],
      ] as const
    ) {
      it(`throws on a provider that is ${name}`, () => {
        class App {}
        assert.throws(() => set_module(App, { providers: [loose(value)] }), {
          message,
        });
      });
    }

    it("treats deps: undefined as no deps", () => {
      class App {}
      const p = { provide: URL, factory, deps: undefined };
      set_module(App, { providers: [loose(p)] });
      assert.deepEqual(
        read_metadata_object<{ providers: unknown[] }>(App)?.providers,
        [p],
      );
    });
  });
});

describe("set_controller", () => {
  it("adds isController to the record written by set_injectable", () => {
    class Logger {}
    class Cli {}
    set_injectable(Cli, { dependencies: [Logger] });
    set_controller(Cli, { dependencies: [Logger] });
    assert.deepEqual(read_metadata_object(Cli), {
      isInjectable: true,
      isController: true,
      dependencies: [Logger],
    });
  });

  it("does not store the dependencies a second time", () => {
    class Logger {}
    class Cli {}
    set_controller(Cli, { dependencies: [Logger] });
    assert.deepEqual(read_metadata_object(Cli), { isController: true });
  });

  it("stores any other option as is", () => {
    class Cli {}
    const meta = { nested: true };
    set_controller(Cli, { name: "cli", tags: ["a"], meta });
    const record = read_metadata_object<Record<string, unknown>>(Cli)!;
    assert.deepEqual(record, {
      isController: true,
      name: "cli",
      tags: ["a"],
      meta,
    });
    assert.equal(record["meta"], meta);
  });

  it("writes to a decorator metadata object", () => {
    const metadata = {};
    set_controller(metadata, {});
    assert.deepEqual(read_metadata_object(metadata), { isController: true });
  });
});

// Decorator call shapes
// -----------------------------------------------------------------------------

/** A TC39 decorator context of the given kind, with its own metadata object. */
function context_of(
  kind: "class" | "method" | "field" | "getter",
  name: string | symbol = "run",
  flags: { static?: boolean; private?: boolean } = {},
): Any {
  return {
    kind,
    name,
    static: flags.static ?? false,
    private: flags.private ?? false,
    metadata: {},
    addInitializer: () => {},
  };
}

/** The legacy / Bun arguments of a method decorator: prototype, name, descriptor. */
function legacy_args(
  ctr: Any,
  name: string,
): [object, string, PropertyDescriptor] {
  return [
    ctr.prototype,
    name,
    Object.getOwnPropertyDescriptor(ctr.prototype, name)!,
  ];
}

describe("decorated_method", () => {
  it("finds a TC39 method: the method itself and the context's name", () => {
    function run() {}
    assert.deepEqual(decorated_method("@X()", run, context_of("method")), {
      fn: run,
      name: "run",
      static: false,
      private: false,
    });
  });

  it("keeps a symbol name", () => {
    function run() {}
    const key = Symbol("run");
    const method = decorated_method(
      "@X()",
      run,
      context_of("method", key),
    );
    assert.equal(method.name, key);
  });

  it("finds a legacy method: the descriptor's value and the given name", () => {
    class Cli {
      run() {}
    }
    assert.deepEqual(decorated_method("@X()", ...legacy_args(Cli, "run")), {
      fn: Cli.prototype.run,
      name: "run",
      static: false,
      private: false,
    });
  });

  it("tells a TC39 static or private method", () => {
    function run() {}
    const stat = decorated_method(
      "@X()",
      run,
      context_of("method", "run", { static: true }),
    );
    assert.equal(stat.static, true);
    assert.equal(stat.private, false);
    const priv = decorated_method(
      "@X()",
      run,
      context_of("method", "#run", { private: true }),
    );
    assert.equal(priv.static, false);
    assert.equal(priv.private, true);
    assert.equal(priv.name, "#run");
  });

  it("tells a legacy static method: the target is the class", () => {
    class Cli {
      static run() {}
    }
    const method = decorated_method(
      "@X()",
      Cli,
      "run",
      Object.getOwnPropertyDescriptor(Cli, "run"),
    );
    assert.deepEqual(method, {
      fn: Cli.run,
      name: "run",
      static: true,
      private: false,
    });
  });

  it("rejects a TC39 member that is not a method", () => {
    for (const kind of ["class", "field", "getter"] as const) {
      assert.throws(
        () => decorated_method("@X()", loose(() => {}), context_of(kind)),
        { name: "TypeError", message: "@X() can only decorate a method" },
      );
    }
  });

  it("rejects a legacy member that is not a method", () => {
    class Cli {
      get value() {
        return 1;
      }
    }
    assert.throws(
      () => decorated_method("@X()", ...legacy_args(Cli, "value")),
      { name: "TypeError", message: "@X() can only decorate a method" },
    );
    assert.throws(
      () => decorated_method("@X()", Cli.prototype, "field", undefined),
      { name: "TypeError", message: "@X() can only decorate a method" },
    );
  });
});

describe("decorated_target", () => {
  it("returns the context's metadata object for a TC39 class", () => {
    class Cli {}
    const context = context_of("class", "Cli");
    assert.equal(decorated_target("@X()", Cli, context), context.metadata);
  });

  it("returns the class for a legacy class", () => {
    class Cli {}
    assert.equal(decorated_target("@X()", Cli), Cli);
  });

  it("returns the method for a TC39 method", () => {
    function run() {}
    assert.equal(decorated_target("@X()", run, context_of("method")), run);
  });

  it("returns the method for a legacy method", () => {
    class Cli {
      run() {}
    }
    assert.equal(
      decorated_target("@X()", ...legacy_args(Cli, "run")),
      Cli.prototype.run,
    );
  });

  it("rejects anything else", () => {
    assert.throws(() => decorated_target("@X()", {}), {
      name: "TypeError",
      message: "@X() can only decorate a class or a method",
    });
    assert.throws(
      () => decorated_target("@X()", loose(undefined), context_of("field")),
      { name: "TypeError", message: "@X() can only decorate a method" },
    );
  });
});

// Middlewares and error handlers
// -----------------------------------------------------------------------------

describe("set_middlewares", () => {
  const a: ChoMiddlewareFn = (_ctx, next) => next();
  const b: ChoMiddlewareFn = (_ctx, next) => next();
  const c: ChoMiddlewareFn = (_ctx, next) => next();

  it("writes the middlewares, in order", () => {
    function run() {}
    set_middlewares(run, [a, b]);
    assert.deepEqual(read_metadata_object(run), { middlewares: [a, b] });
  });

  it("accepts classes", () => {
    class Auth {}
    function run() {}
    set_middlewares(run, [Auth]);
    assert.deepEqual(read_metadata_object(run), { middlewares: [Auth] });
  });

  it("puts a later call first: decorators are applied bottom up", () => {
    function run() {}
    set_middlewares(run, [c]); // the lower decorator
    set_middlewares(run, [a, b]); // the upper decorator
    assert.deepEqual(read_metadata_object(run), { middlewares: [a, b, c] });
  });

  it("keeps the rest of the record", () => {
    class Cli {}
    set_injectable(Cli, { dependencies: [] });
    set_middlewares(Cli, [a]);
    assert.deepEqual(read_metadata_object(Cli), {
      isInjectable: true,
      dependencies: [],
      middlewares: [a],
    });
  });

  it("accepts an empty list", () => {
    function run() {}
    set_middlewares(run, []);
    assert.deepEqual(read_metadata_object(run), { middlewares: [] });
  });

  it("writes to a decorator metadata object", () => {
    const metadata = {};
    set_middlewares(metadata, [a]);
    assert.deepEqual(read_metadata_object(metadata), { middlewares: [a] });
  });

  it("rejects a middleware that is not a function", () => {
    for (
      const [value, shown] of [
        ["auth", '"auth"'],
        [{ run: a }, "{ run }"],
        [null, "null"],
        [1, "1"],
      ] as const
    ) {
      const run = function run() {};
      assert.throws(() => set_middlewares(run, [a, loose(value)]), {
        message: `all middlewares must be functions: ${shown}`,
      });
      assert.equal(read_metadata_object(run), undefined);
    }
  });

  it("rejects a list that is not an array", () => {
    function run() {}
    assert.throws(() => set_middlewares(run, loose(a)), {
      message: /^middlewares must be an array, got /,
    });
    assert.equal(read_metadata_object(run), undefined);
  });
});

describe("set_error_handler", () => {
  it("writes a handler function", () => {
    const handler = () => 2;
    function run() {}
    set_error_handler(run, handler);
    assert.deepEqual(read_metadata_object(run), { errorHandler: handler });
  });

  it("writes a handler class", () => {
    class Handler {}
    class Cli {}
    set_error_handler(Cli, Handler);
    assert.deepEqual(read_metadata_object(Cli), { errorHandler: Handler });
  });

  it("keeps the rest of the record", () => {
    const handler = () => {};
    class Cli {}
    set_injectable(Cli, { dependencies: [] });
    set_error_handler(Cli, handler);
    assert.deepEqual(read_metadata_object(Cli), {
      isInjectable: true,
      dependencies: [],
      errorHandler: handler,
    });
  });

  it("writes to a decorator metadata object", () => {
    const handler = () => {};
    const metadata = {};
    set_error_handler(metadata, handler);
    assert.deepEqual(read_metadata_object(metadata), {
      errorHandler: handler,
    });
  });

  it("rejects a handler that is not a function or a class", () => {
    for (
      const [value, shown] of [
        ["handler", '"handler"'],
        [{ handle: () => {} }, "{ handle }"],
        [undefined, "undefined"],
      ] as const
    ) {
      const run = function run() {};
      assert.throws(() => set_error_handler(run, loose(value)), {
        message: `the error handler must be a function or a class: ${shown}`,
      });
      assert.equal(read_metadata_object(run), undefined);
    }
  });

  it("rejects a second handler, keeping the first", () => {
    const first = () => 1;
    function run() {}
    set_error_handler(run, first);
    assert.throws(() => set_error_handler(run, () => 2), {
      message: "an error handler is already set (one @Catch per target)",
    });
    assert.deepEqual(read_metadata_object(run), { errorHandler: first });
  });
});
