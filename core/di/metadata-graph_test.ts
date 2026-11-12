/**
 * Tests for `metadata-graph.ts`: reading, validating and normalizing the
 * decorator records of an application.
 *
 * Decorators are applied as plain function calls (see `decorators_test.ts`).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Controller, Injectable, Module } from "./decorators.ts";
import { build_meta_graph } from "./metadata-graph.ts";
import { read_metadata_object, write_metadata_object } from "./metadata.ts";
import { provider, token } from "./tokens.ts";
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
    it("keeps every other key of the module's record", () => {
      const onError = () => {};
      class App {}
      Module({ route: "api" })(App);
      write_metadata_object(App, {
        ...read_metadata_object<Record<string, unknown>>(App),
        errorHandler: onError,
      });

      const { root } = build_meta_graph(App);
      assert.equal(root["route"], "api");
      assert.equal(root["errorHandler"], onError);
    });

    it("does not let a record key override the normalized keys", () => {
      class Db {}
      Injectable()(Db);
      class App {}
      Module({
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

    it("keeps every other key of the controller's record", () => {
      class Logger {}
      const onError = () => {};
      class Cli {}
      Controller({ dependencies: [Logger], name: "cli", tags: ["a"] })(Cli);
      write_metadata_object(Cli, {
        ...read_metadata_object<Record<string, unknown>>(Cli),
        errorHandler: onError,
      });
      class App {}
      Module({ controllers: [Cli] })(App);

      const [cli] = build_meta_graph(App).root.controllers;
      assert.equal(cli!["name"], "cli");
      assert.deepEqual(cli!["tags"], ["a"]);
      assert.equal(cli!["errorHandler"], onError);
      assert.deepEqual(cli!["dependencies"], [Logger]);
    });

    it("does not let a record key override the normalized keys", () => {
      class Cli {
        run() {}
      }
      write_metadata_object(Cli.prototype.run, { command: "run" });
      Controller({
        isController: "no",
        isInjectable: "no",
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
      assert.deepEqual(cli!.methods, [
        { name: "run", meta: { command: "run" } },
        { name: "help", meta: { command: "help" } },
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

    it("does not collect inherited methods", () => {
      class Base {
        inherited() {}
      }
      write_metadata_object(Base.prototype.inherited, { command: "x" });
      class Cli extends Base {}
      Controller()(Cli);
      class App {}
      Module({ controllers: [Cli] })(App);

      const [cli] = build_meta_graph(App).root.controllers;
      assert.deepEqual(cli!.methods, []);
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
      // @Module rejects a non-class import, so write the record directly.
      class App {}
      write_metadata_object(App, {
        isInjectable: true,
        isModule: true,
        dependencies: [],
        imports: [not_a_class],
        exports: [],
        providers: [],
        controllers: [],
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
        isInjectable: true,
        isModule: true,
        dependencies: [],
        imports: [],
        exports: [],
        providers: [],
        controllers: [not_a_class],
      });
      assert.throws(() => build_meta_graph(App), {
        name: "TypeError",
        message: "Expected a controller class, got string",
      });
    });
  });
});
