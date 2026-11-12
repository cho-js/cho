/**
 * Tests for `metadata-graph.ts`: reading, validating and normalizing the
 * decorator records of an application.
 *
 * Decorators are applied as plain function calls (see `decorators_test.ts`).
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
import { build_meta_graph } from "./metadata-graph.ts";
import {
  add_to_metadata_object,
  method_metadata,
  write_metadata_object,
} from "./metadata.ts";
import {
  CONTROLLERS,
  DEPENDENCIES,
  ERROR_HANDLER,
  EXPORTS,
  IMPORTS,
  INJECTABLE,
  MIDDLEWARES,
  MODULE,
  PROVIDERS,
} from "./keys.ts";
import { provider, token } from "./tokens.ts";
import { legacy } from "../utils/test_utils.ts";
import type { ExtraOptions } from "./decorations.ts";
import type { Ctr } from "./types.ts";

/** A value that is not a class, typed as one to reach the runtime checks. */
const not_a_class = "NotAClass" as unknown as Ctr;

describe("build_meta_graph", () => {
  describe("modules", () => {
    it("normalizes the root module", () => {
      class Logger {}
      const TOKEN = token("t");
      class App {}
      Module({ dependencies: [Logger], exports: [TOKEN] })(App);

      const { root } = build_meta_graph(App);
      assert.equal(root.isModule, true);
      assert.equal(root.isInjectable, true);
      assert.equal(root.isProvider, true);
      assert.equal(root.provider.provide, App);
      assert.deepEqual(root.provider.deps, [Logger]);
      assert.deepEqual(root.exports, [TOKEN]);
      assert.deepEqual(root.imports, []);
      assert.deepEqual(root.providers, []);
      assert.deepEqual(root.controllers, []);
    });

    it("gives a module a factory that constructs it with its dependencies", async () => {
      class App {
        readonly args: unknown[];
        constructor(...args: unknown[]) {
          this.args = args;
        }
      }
      Module()(App);

      const app = await build_meta_graph(App).root.provider.factory(1, 2);
      assert.ok(app instanceof App);
      assert.deepEqual(app.args, [1, 2]);
    });

    it("normalizes imports, in imports order", () => {
      class A {}
      Module()(A);
      class B {}
      Module()(B);
      class App {}
      Module({ imports: [A, B] })(App);

      const { root } = build_meta_graph(App);
      assert.deepEqual(root.imports.map((m) => m.provider.provide), [A, B]);
    });

    it("reads a module imported through several paths once", () => {
      class Shared {}
      Module()(Shared);
      class Left {}
      Module({ imports: [Shared] })(Left);
      class Right {}
      Module({ imports: [Shared] })(Right);
      class App {}
      Module({ imports: [Left, Right] })(App);

      const { root, modules } = build_meta_graph(App);
      assert.equal(root.imports[0]!.imports[0], root.imports[1]!.imports[0]);
      assert.equal(modules.size, 4);
    });

    it("lists imported modules before the modules that import them, root last", () => {
      class Shared {}
      Module()(Shared);
      class Left {}
      Module({ imports: [Shared] })(Left);
      class Right {}
      Module({ imports: [Shared] })(Right);
      class App {}
      Module({ imports: [Left, Right] })(App);

      const { modules } = build_meta_graph(App);
      assert.deepEqual([...modules.keys()], [Shared, Left, Right, App]);
    });
    it("keeps the options and CHO modules' keys, not the core's keys", () => {
      const EXT = Symbol.for("test.ext");
      class App {}
      Module<ExtraOptions>({ route: "api" })(App);
      add_to_metadata_object(App, { [EXT]: "ext" });

      const { root } = build_meta_graph(App);
      assert.equal(root.options["route"], "api");
      assert.equal(root.options[EXT], "ext");
      for (const key of [MODULE, INJECTABLE, DEPENDENCIES, IMPORTS]) {
        assert.equal(key in root, false);
      }
    });

    it("exposes @Middlewares and @Catch as typed fields", () => {
      const mw = () => Promise.resolve();
      const onError = () => {};
      class App {}
      Module()(App);
      Middlewares(mw)(App);
      Catch(onError)(App);

      const { root } = build_meta_graph(App);
      assert.deepEqual(root.middlewares, [mw]);
      assert.equal(root.errorHandler, onError);
    });

    it("has no middlewares and no error handler by default", () => {
      class App {}
      Module()(App);

      const { root } = build_meta_graph(App);
      assert.deepEqual(root.middlewares, []);
      assert.equal(root.errorHandler, undefined);
    });

    it("treats options named like the typed fields as plain options", () => {
      const mw = () => Promise.resolve();
      class App {}
      Module<ExtraOptions>({
        isController: true,
        middlewares: [mw],
        errorHandler: mw,
      })(App);

      const { root } = build_meta_graph(App);
      assert.deepEqual(root.middlewares, []);
      assert.equal(root.errorHandler, undefined);
      assert.equal(root.options["isController"], true);
    });

    it("does not let a record key override the normalized keys", () => {
      class Db {}
      Injectable()(Db);
      class App {}
      Module<ExtraOptions>({
        providers: [Db],
        isProvider: "no",
        provider: "no",
      })(App);

      const { root } = build_meta_graph(App);
      assert.equal(root.isModule, true);
      assert.equal(root.isInjectable, true);
      assert.equal(root.isProvider, true);
      assert.equal(root.provider.provide, App);
      assert.equal(root.providers[0]!.provider.provide, Db);
    });
  });

  describe("providers", () => {
    it("normalizes an @Injectable class into a provider that constructs it", async () => {
      class Logger {}
      class Db {
        readonly args: unknown[];
        constructor(...args: unknown[]) {
          this.args = args;
        }
      }
      Injectable([Logger])(Db);
      class App {}
      Module({ providers: [Db] })(App);

      const [db] = build_meta_graph(App).root.providers;
      assert.equal(db!.isProvider, true);
      assert.equal("isInjectable" in db! && db.isInjectable, true);
      assert.equal(db!.provider.provide, Db);
      assert.deepEqual(db!.provider.deps, [Logger]);

      const instance = await db!.provider.factory("logger");
      assert.ok(instance instanceof Db);
      assert.deepEqual(instance.args, ["logger"]);
    });

    it("keeps a provider object as it is", () => {
      const p = provider({
        provide: token("t"),
        factory: () => Promise.resolve(1),
      });
      class App {}
      Module({ providers: [p] })(App);

      const [normalized] = build_meta_graph(App).root.providers;
      assert.equal(normalized!.provider, p);
      assert.equal("isInjectable" in normalized!, false);
    });

    it("keeps providers in order", () => {
      class A {}
      Injectable()(A);
      const B = token("B");
      class App {}
      Module({
        providers: [
          A,
          provider({ provide: B, factory: () => Promise.resolve(1) }),
        ],
      })(App);

      const { root } = build_meta_graph(App);
      assert.deepEqual(root.providers.map((p) => p.provider.provide), [A, B]);
    });

    it("accepts @Module and @Controller classes, which are injectable too", () => {
      class SomeModule {}
      Module()(SomeModule);
      class SomeController {}
      Controller()(SomeController);
      class App {}
      Module({ providers: [SomeModule, SomeController] })(App);

      const { root } = build_meta_graph(App);
      assert.deepEqual(
        root.providers.map((p) => p.provider.provide),
        [SomeModule, SomeController],
      );
    });

    it("gives classes factories that reject, rather than throw, when the constructor throws", async () => {
      class Broken {
        constructor() {
          throw new Error("boom");
        }
      }
      Injectable()(Broken);
      class App {}
      Module({ providers: [Broken] })(App);

      const factory = build_meta_graph(App).root.providers[0]!.provider.factory;
      let result: Promise<unknown> | undefined;
      assert.doesNotThrow(() => {
        result = factory();
      });
      await assert.rejects(result!, { message: "boom" });
    });
  });

  describe("controllers", () => {
    it("normalizes a @Controller class", async () => {
      class Logger {}
      class Cli {}
      Controller({ dependencies: [Logger] })(Cli);
      class App {}
      Module({ controllers: [Cli] })(App);

      const [cli] = build_meta_graph(App).root.controllers;
      assert.equal(cli!.isController, true);
      assert.equal(cli!.isInjectable, true);
      assert.equal(cli!.provider.provide, Cli);
      assert.deepEqual(cli!.provider.deps, [Logger]);
      assert.ok((await cli!.provider.factory()) instanceof Cli);
    });

    it("keeps the options and CHO modules' keys, not the core's keys", () => {
      const EXT = Symbol.for("test.ext");
      class Logger {}
      class Cli {}
      Controller<ExtraOptions, [typeof Logger]>({
        dependencies: [Logger],
        name: "cli",
        tags: ["a"],
      })(Cli);
      add_to_metadata_object(Cli, { [EXT]: "ext" });
      class App {}
      Module({ controllers: [Cli] })(App);

      const [cli] = build_meta_graph(App).root.controllers;
      assert.equal(cli!.options["name"], "cli");
      assert.deepEqual(cli!.options["tags"], ["a"]);
      assert.equal(cli!.options[EXT], "ext");
      assert.equal(DEPENDENCIES in cli!, false);
      assert.equal("dependencies" in cli!, false);
    });

    it("exposes @Middlewares and @Catch as typed fields", () => {
      const mw = () => Promise.resolve();
      const onError = () => {};
      class Cli {}
      Controller()(Cli);
      Middlewares(mw)(Cli);
      Catch(onError)(Cli);
      class App {}
      Module<ExtraOptions>({ controllers: [Cli] })(App);

      const [cli] = build_meta_graph(App).root.controllers;
      assert.deepEqual(cli!.middlewares, [mw]);
      assert.equal(cli!.errorHandler, onError);
    });

    it("exposes a method's @Middlewares and @Catch, out of its meta", () => {
      const EXT = Symbol.for("test.ext");
      const mw = () => Promise.resolve();
      const onError = () => {};
      class Cli {
        run() {}
      }
      add_to_metadata_object(Cli.prototype.run, { [EXT]: "run" });
      legacy(Middlewares(mw), Cli, "run");
      legacy(Catch(onError), Cli, "run");
      Controller<ExtraOptions>()(Cli);
      class App {}
      Module<ExtraOptions>({ controllers: [Cli] })(App);

      const [cli] = build_meta_graph(App).root.controllers;
      assert.deepEqual(cli!.methods, [{
        name: "run",
        meta: { [EXT]: "run" },
        middlewares: [mw],
        errorHandler: onError,
      }]);
      assert.equal(MIDDLEWARES in cli!.methods[0]!.meta, false);
      assert.equal(ERROR_HANDLER in cli!.methods[0]!.meta, false);
    });

    it("does not let a record key override the normalized keys", () => {
      class Cli {
        run() {}
      }
      write_metadata_object(Cli.prototype.run, { command: "run" });
      // isController and isInjectable are reserved: @Controller rejects them.
      Controller<ExtraOptions>({
        isProvider: "no",
        methods: "no",
        provider: "no",
      })(Cli);
      class App {}
      Module({ controllers: [Cli] })(App);

      const [cli] = build_meta_graph(App).root.controllers;
      assert.equal(cli!.isController, true);
      assert.equal(cli!.isInjectable, true);
      assert.equal(cli!.isProvider, true);
      assert.deepEqual(cli!.methods, [{
        name: "run",
        meta: { command: "run" },
        middlewares: [],
        errorHandler: undefined,
      }]);
      assert.equal(cli!.provider.provide, Cli);
    });

    it("collects the metadata of its own methods, in declaration order", () => {
      class Cli {
        run() {}
        help() {}
      }
      write_metadata_object(Cli.prototype.run, { command: "run" });
      write_metadata_object(Cli.prototype.help, { command: "help" });
      Controller()(Cli);
      class App {}
      Module({ controllers: [Cli] })(App);

      const [cli] = build_meta_graph(App).root.controllers;
      const none = { middlewares: [], errorHandler: undefined };
      assert.deepEqual(cli!.methods, [
        { name: "run", meta: { command: "run" }, ...none },
        { name: "help", meta: { command: "help" }, ...none },
      ]);
    });

    it("skips methods without metadata, accessors and the constructor", () => {
      class Cli {
        run() {}
        plain() {}
        get value() {
          return 1;
        }
      }
      write_metadata_object(Cli.prototype.run, { command: "run" });
      Controller()(Cli);
      class App {}
      Module({ controllers: [Cli] })(App);

      const [cli] = build_meta_graph(App).root.controllers;
      assert.deepEqual(cli!.methods.map((m) => m.name), ["run"]);
    });

    it("collects inherited methods, parents first", () => {
      class Base {
        inherited() {}
        both() {}
      }
      add_to_metadata_object(method_metadata(Base, "inherited"), { from: "b" });
      add_to_metadata_object(method_metadata(Base, "both"), { from: "b" });
      class Cli extends Base {
        own() {}
        override both() {}
      }
      add_to_metadata_object(method_metadata(Cli, "own"), { from: "c" });
      add_to_metadata_object(method_metadata(Cli, "both"), { by: "c" });
      Controller()(Cli);
      class Other extends Base {}
      Controller()(Other);
      class App {}
      Module({ controllers: [Cli, Other] })(App);

      const [cli, other] = build_meta_graph(App).root.controllers;
      assert.deepEqual(
        cli!.methods.map((m) => [m.name, m.meta]),
        [
          ["inherited", { from: "b" }],
          // the subclass's record replaces the parent's, it is not merged
          ["both", { by: "c" }],
          ["own", { from: "c" }],
        ],
      );
      // a sibling subclass is not affected
      assert.deepEqual(
        other!.methods.map((m) => [m.name, m.meta]),
        [["inherited", { from: "b" }], ["both", { from: "b" }]],
      );
    });

    it("keeps a method's record when a decorator replaces the function", () => {
      class Cli {
        run() {}
      }
      add_to_metadata_object(method_metadata(Cli, "run"), { command: "run" });
      Cli.prototype.run = function wrapper() {}; // what a wrapping decorator does
      Controller()(Cli);
      class App {}
      Module({ controllers: [Cli] })(App);

      const [cli] = build_meta_graph(App).root.controllers;
      assert.deepEqual(cli!.methods.map((m) => [m.name, m.meta]), [
        ["run", { command: "run" }],
      ]);
    });

    it("merges a record written on the method function", () => {
      class Cli {
        run() {}
      }
      write_metadata_object(Cli.prototype.run, { a: 1, b: 1 });
      add_to_metadata_object(method_metadata(Cli, "run"), { b: 2, c: 2 });
      Controller()(Cli);
      class App {}
      Module({ controllers: [Cli] })(App);

      const [cli] = build_meta_graph(App).root.controllers;
      assert.deepEqual(cli!.methods[0]!.meta, { a: 1, b: 2, c: 2 });
    });

    it("leaves out a record whose method the class does not have", () => {
      class Cli {}
      add_to_metadata_object(method_metadata(Cli, "gone"), { command: "x" });
      Controller()(Cli);
      class App {}
      Module({ controllers: [Cli] })(App);
      assert.deepEqual(build_meta_graph(App).root.controllers[0]!.methods, []);
    });
  });

  describe("errors", () => {
    it("throws when the root is not a module", () => {
      class NotAModule {}
      assert.throws(() => build_meta_graph(NotAModule), {
        message: "Class NotAModule is not a module. Did you forget @Module?",
      });
    });

    it("throws when an import is not a module", () => {
      class NotAModule {}
      Injectable()(NotAModule);
      class App {}
      Module({ imports: [NotAModule] })(App);
      assert.throws(() => build_meta_graph(App), {
        message: "Class NotAModule is not a module. Did you forget @Module?",
      });
    });

    it("throws a TypeError when the root is not a class", () => {
      assert.throws(() => build_meta_graph(not_a_class), {
        name: "TypeError",
        message: "Expected a module class, got string",
      });
    });

    it("throws a TypeError when an import is not a class", () => {
      // @Module rejects a non-class import, so write the record directly,
      // with the keys spelled out: what another copy of the package writes.
      class App {}
      write_metadata_object(App, {
        [Symbol.for("chojs.core.isInjectable")]: true,
        [Symbol.for("chojs.core.isModule")]: true,
        [Symbol.for("chojs.core.dependencies")]: [],
        [Symbol.for("chojs.core.imports")]: [not_a_class],
        [Symbol.for("chojs.core.exports")]: [],
        [Symbol.for("chojs.core.providers")]: [],
        [Symbol.for("chojs.core.controllers")]: [],
      });
      assert.throws(() => build_meta_graph(App), {
        name: "TypeError",
        message: "Expected a module class, got string",
      });
    });

    it("throws on circular imports, with the cycle", () => {
      class A {}
      class B {}
      Module({ imports: [B] })(A);
      Module({ imports: [A] })(B);
      assert.throws(() => build_meta_graph(A), {
        message: "Circular dependency detected: A → B → A",
      });
    });

    it("throws on a module that imports itself", () => {
      class A {}
      Module({ imports: [A] })(A);
      assert.throws(() => build_meta_graph(A), {
        message: "Circular dependency detected: A → A",
      });
    });

    it("throws when a provider class is not injectable", () => {
      class Plain {}
      class App {}
      Module({ providers: [Plain] })(App);
      assert.throws(() => build_meta_graph(App), {
        message: "Class Plain is not injectable. Did you forget @Injectable?",
      });
    });

    it("throws when a controller is not a @Controller", () => {
      class Service {}
      Injectable()(Service);
      class App {}
      Module({ controllers: [Service] })(App);
      assert.throws(() => build_meta_graph(App), {
        message:
          "Class Service is not a controller. Did you forget @Controller?",
      });
    });

    it("throws a TypeError when a controller entry is not a class", () => {
      // @Module rejects a non-class controller, so write the record directly.
      class App {}
      write_metadata_object(App, {
        [INJECTABLE]: true,
        [MODULE]: true,
        [DEPENDENCIES]: [],
        [IMPORTS]: [],
        [EXPORTS]: [],
        [PROVIDERS]: [],
        [CONTROLLERS]: [not_a_class],
      });
      assert.throws(() => build_meta_graph(App), {
        name: "TypeError",
        message: "Expected a controller class, got string",
      });
    });
  });
});

describe("build_meta_graph, anonymous classes", () => {
  /** A class whose name is empty, as an anonymous class expression has. */
  const anonymous = () => (() => class {})();

  it("names an anonymous class <anonymous> in every message", () => {
    const NotAModule = anonymous();
    assert.throws(() => build_meta_graph(NotAModule), {
      message: "Class <anonymous> is not a module. Did you forget @Module?",
    });

    const Plain = anonymous();
    const WithProvider = anonymous();
    Module({ providers: [Plain] })(WithProvider);
    assert.throws(() => build_meta_graph(WithProvider), {
      message:
        "Class <anonymous> is not injectable. Did you forget @Injectable?",
    });

    const Service = anonymous();
    Injectable()(Service);
    const WithController = anonymous();
    Module({ controllers: [Service] })(WithController);
    assert.throws(() => build_meta_graph(WithController), {
      message:
        "Class <anonymous> is not a controller. Did you forget @Controller?",
    });

    const A = anonymous();
    Module({ imports: [A] })(A);
    assert.throws(() => build_meta_graph(A), {
      message: "Circular dependency detected: <anonymous> → <anonymous>",
    });
  });
});
