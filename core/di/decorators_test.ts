/**
 * Tests for `decorators.ts`: the records `@Injectable`, `@Module`,
 * `@Controller`, `@Middlewares` and `@Catch` write.
 *
 * Decorators are applied as plain function calls, `Injectable()(Foo)`, so the
 * tests run on any runtime, including Node's built-in TypeScript support,
 * which has no decorator syntax. A call without a context is the legacy / Bun
 * decorator path; the TC39 path is covered by passing a `context` explicitly.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Catch,
  Controller,
  Injectable,
  Middlewares,
  Module,
} from "./decorators.ts";
import { legacy, loose, tc39 } from "../utils/test_utils.ts";
import { read_metadata_object } from "./metadata.ts";
import { provider, token } from "./tokens.ts";
import type { ChoMiddlewareFn } from "./types.ts";

/** A TC39 class decorator context, with its own metadata object. */
function tc39_context(): ClassDecoratorContext {
  return {
    kind: "class",
    name: "Decorated",
    metadata: {},
    addInitializer: () => {},
  };
}

const ALREADY_DECORATED =
  "class is already decorated with @Injectable, @Module or @Controller";

describe("@Injectable", () => {
  it("marks a class injectable, with no dependencies by default", () => {
    class Foo {}
    Injectable()(Foo);
    assert.deepEqual(read_metadata_object(Foo), {
      isInjectable: true,
      dependencies: [],
    });
  });

  it("stores the dependencies, in order", () => {
    class Logger {}
    const PORT = token<number>("PORT");
    const CACHE = Symbol("cache");
    class Server {}
    Injectable([Logger, PORT, CACHE])(Server);
    assert.deepEqual(read_metadata_object(Server), {
      isInjectable: true,
      dependencies: [Logger, PORT, CACHE],
    });
  });

  it("writes to context.metadata with TC39 decorators, not to the class", () => {
    class Foo {}
    const context = tc39_context();
    Injectable()(Foo, context);
    assert.deepEqual(read_metadata_object(context.metadata), {
      isInjectable: true,
      dependencies: [],
    });
    assert.equal(read_metadata_object(Foo), undefined);
  });

  it("throws when the class already has a DI decorator", () => {
    class A {}
    Injectable()(A);
    assert.throws(() => Injectable()(A), {
      message: ALREADY_DECORATED,
    });

    class B {}
    Module()(B);
    assert.throws(() => Injectable()(B), {
      message: ALREADY_DECORATED,
    });

    class C {}
    Controller()(C);
    assert.throws(() => Injectable()(C), {
      message: ALREADY_DECORATED,
    });
  });

  it("throws on a second decorator with TC39 decorators", () => {
    class Foo {}
    const context = tc39_context();
    Injectable()(Foo, context);
    assert.throws(() => Injectable()(Foo, context), {
      message: ALREADY_DECORATED,
    });
  });
});

describe("@Module", () => {
  it("rejects an option that would turn the module into a controller", () => {
    class App {}
    assert.throws(() => Module(loose({ isController: true }))(App), {
      message:
        '"isController" is a reserved option name: the DI decorators set it',
    });
  });

  it("marks a class as an injectable module, every field defaulting to []", () => {
    class App {}
    Module()(App);
    assert.deepEqual(read_metadata_object(App), {
      isInjectable: true,
      isModule: true,
      dependencies: [],
      imports: [],
      exports: [],
      providers: [],
      controllers: [],
    });
  });

  it("stores the given options", () => {
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
    Module({
      dependencies: [Logger],
      imports: [DbModule],
      providers: [Db, apiUrl],
      controllers: [Cli],
      exports: [Db, API_URL],
    })(App);
    assert.deepEqual(read_metadata_object(App), {
      isInjectable: true,
      isModule: true,
      dependencies: [Logger],
      imports: [DbModule],
      exports: [Db, API_URL],
      providers: [Db, apiUrl],
      controllers: [Cli],
    });
  });

  it("stores extra options without duplicating dependencies", () => {
    class Logger {}
    class App {}
    Module({ dependencies: [Logger], route: "api" })(App);
    assert.deepEqual(read_metadata_object(App), {
      isInjectable: true,
      isModule: true,
      dependencies: [Logger],
      route: "api",
      imports: [],
      exports: [],
      providers: [],
      controllers: [],
    });
  });

  it("writes to context.metadata with TC39 decorators", () => {
    class App {}
    const context = tc39_context();
    Module()(App, context);
    assert.equal(
      read_metadata_object<{ isModule: true }>(context.metadata)?.isModule,
      true,
    );
    assert.equal(read_metadata_object(App), undefined);
  });

  it("throws when the class already has a DI decorator", () => {
    class A {}
    Injectable()(A);
    assert.throws(() => Module()(A), {
      message: ALREADY_DECORATED,
    });

    class B {}
    Module()(B);
    assert.throws(() => Module()(B), {
      message: ALREADY_DECORATED,
    });
  });
});

describe("@Controller", () => {
  it("rejects an option that would turn the controller into a module", () => {
    class Cli {}
    assert.throws(() => Controller(loose({ isModule: true }))(Cli), {
      message: '"isModule" is a reserved option name: the DI decorators set it',
    });
  });

  it("marks a class as an injectable controller, with no dependencies by default", () => {
    class Cli {}
    Controller()(Cli);
    assert.deepEqual(read_metadata_object(Cli), {
      isInjectable: true,
      isController: true,
      dependencies: [],
    });
  });

  it("stores the dependencies", () => {
    class Logger {}
    class Cli {}
    Controller({ dependencies: [Logger] })(Cli);
    assert.deepEqual(read_metadata_object(Cli), {
      isInjectable: true,
      isController: true,
      dependencies: [Logger],
    });
  });

  it("stores any other option as is, for application modules", () => {
    class Cli {}
    Controller({ name: "cli", description: "the CLI" })(Cli);
    assert.deepEqual(read_metadata_object(Cli), {
      isInjectable: true,
      isController: true,
      name: "cli",
      description: "the CLI",
      dependencies: [],
    });
  });

  it("throws when the class already has a DI decorator", () => {
    class A {}
    Injectable()(A);
    assert.throws(() => Controller()(A), {
      message: ALREADY_DECORATED,
    });
  });
});

describe("inheritance", () => {
  it("a subclass of a decorated class is not decorated", () => {
    class Base {}
    Injectable()(Base);
    class Sub extends Base {}
    assert.equal(read_metadata_object(Sub), undefined);
  });

  it("a subclass can get its own DI decorator", () => {
    class Logger {}
    class Base {}
    Injectable()(Base);
    class Sub extends Base {}
    Injectable([Logger])(Sub);
    assert.deepEqual(read_metadata_object(Sub), {
      isInjectable: true,
      dependencies: [Logger],
    });
    assert.deepEqual(read_metadata_object(Base), {
      isInjectable: true,
      dependencies: [],
    });
  });
});

describe("@Middlewares", () => {
  const a: ChoMiddlewareFn = (_ctx, next) => next();
  const b: ChoMiddlewareFn = (_ctx, next) => next();
  const c: ChoMiddlewareFn = (_ctx, next) => next();

  it("writes the middlewares on a TC39 class's metadata object", () => {
    class Cli {}
    const context = tc39_context();
    Middlewares(a, b)(Cli, context);
    assert.deepEqual(read_metadata_object(context.metadata), {
      middlewares: [a, b],
    });
  });

  it("writes the middlewares on a legacy class", () => {
    class Cli {}
    Middlewares(a)(Cli);
    assert.deepEqual(read_metadata_object(Cli), { middlewares: [a] });
  });

  it("writes the middlewares on a method (TC39 and legacy)", () => {
    function run() {}
    tc39(Middlewares(a), run, "run");
    assert.deepEqual(read_metadata_object(run), { middlewares: [a] });

    class Cli {
      run() {}
    }
    legacy(Middlewares(b), Cli, "run");
    assert.deepEqual(read_metadata_object(Cli.prototype.run), {
      middlewares: [b],
    });
  });

  it("keeps stacked decorators in source order", () => {
    // @Middlewares(a, b)
    // @Middlewares(c)
    // run() {}
    function run() {}
    tc39(Middlewares(c), run, "run"); // the lower one is applied first
    tc39(Middlewares(a, b), run, "run");
    assert.deepEqual(read_metadata_object(run), { middlewares: [a, b, c] });
  });

  it("combines with @Controller, in either order", () => {
    class Above {}
    const above = tc39_context();
    Controller()(Above, above);
    Middlewares(a)(Above, above);
    class Below {}
    const below = tc39_context();
    Middlewares(a)(Below, below);
    Controller()(Below, below);

    for (const context of [above, below]) {
      assert.deepEqual(read_metadata_object(context.metadata), {
        isInjectable: true,
        dependencies: [],
        isController: true,
        middlewares: [a],
      });
    }
  });

  it("rejects a middleware that is not a function", () => {
    class Cli {}
    assert.throws(() => Middlewares(a, loose("auth"))(Cli), {
      message: 'all middlewares must be functions: "auth"',
    });
  });

  it("rejects a member that is not a class or a method", () => {
    assert.throws(
      () => Middlewares(a)(loose(undefined), loose({ kind: "field" })),
      {
        name: "TypeError",
        message: "@Middlewares() can only decorate a method",
      },
    );
  });
});

describe("@Catch", () => {
  const handler = () => 2;

  it("writes the handler on a TC39 class's metadata object", () => {
    class Cli {}
    const context = tc39_context();
    Catch(handler)(Cli, context);
    assert.deepEqual(read_metadata_object(context.metadata), {
      errorHandler: handler,
    });
  });

  it("writes the handler on a legacy class", () => {
    class Cli {}
    Catch(handler)(Cli);
    assert.deepEqual(read_metadata_object(Cli), { errorHandler: handler });
  });

  it("writes the handler on a method (TC39 and legacy)", () => {
    function run() {}
    tc39(Catch(handler), run, "run");
    assert.deepEqual(read_metadata_object(run), { errorHandler: handler });

    class Cli {
      run() {}
    }
    legacy(Catch(handler), Cli, "run");
    assert.deepEqual(read_metadata_object(Cli.prototype.run), {
      errorHandler: handler,
    });
  });

  it("accepts an injectable class", () => {
    class Handler {}
    Injectable()(Handler);
    function run() {}
    tc39(Catch(Handler), run, "run");
    assert.deepEqual(read_metadata_object(run), { errorHandler: Handler });
  });

  it("combines with @Controller and @Middlewares", () => {
    const mw: ChoMiddlewareFn = (_ctx, next) => next();
    class Cli {}
    const context = tc39_context();
    Catch(handler)(Cli, context);
    Middlewares(mw)(Cli, context);
    Controller()(Cli, context);
    assert.deepEqual(read_metadata_object(context.metadata), {
      errorHandler: handler,
      middlewares: [mw],
      isInjectable: true,
      dependencies: [],
      isController: true,
    });
  });

  it("rejects a second @Catch on the same target", () => {
    function run() {}
    tc39(Catch(handler), run, "run");
    assert.throws(() => tc39(Catch(() => 3), run, "run"), {
      message: "an error handler is already set (one @Catch per target)",
    });
  });

  it("allows a @Catch on the class and on its method", () => {
    class Cli {
      run() {}
    }
    const other = () => 3;
    Catch(handler)(Cli);
    legacy(Catch(other), Cli, "run");
    assert.equal(
      read_metadata_object<{ errorHandler: unknown }>(Cli)?.errorHandler,
      handler,
    );
    assert.equal(
      read_metadata_object<{ errorHandler: unknown }>(Cli.prototype.run)
        ?.errorHandler,
      other,
    );
  });

  it("rejects a handler that is not a function or a class", () => {
    class Cli {}
    assert.throws(() => Catch(loose("handler"))(Cli), {
      message: 'the error handler must be a function or a class: "handler"',
    });
    assert.equal(read_metadata_object(Cli), undefined);
  });
});
