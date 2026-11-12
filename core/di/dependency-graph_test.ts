/**
 * Tests for `dependency-graph.ts`: module scopes, dependency linking and the
 * build checks (exports, ambiguity, duplicates, missing dependencies, cycles).
 *
 * Decorators are applied as plain function calls (see `decorators_test.ts`).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Controller, Injectable, Module } from "./decorators.ts";
import { build_dependency_graph } from "./dependency-graph.ts";
import { build_meta_graph, type ModuleMetadata } from "./metadata-graph.ts";
import { provider, token } from "./tokens.ts";
import type { Ctr, Provider, Token } from "./types.ts";

/** Build the dependency graph of a root module. */
function graph(root: Ctr) {
  return build_dependency_graph(build_meta_graph(root));
}

/** A provider object for `token` with a constant value. */
function value(provide: Token, v: unknown = provide): Provider {
  return provider({ provide, factory: () => Promise.resolve(v) });
}

describe("build_dependency_graph", () => {
  describe("scopes", () => {
    it("creates one scope per module, imports first, root last", () => {
      class Shared {}
      Module()(Shared);
      class Left {}
      Module({ imports: [Shared] })(Left);
      class Right {}
      Module({ imports: [Shared] })(Right);
      class App {}
      Module({ imports: [Left, Right] })(App);

      const { root, modules } = graph(App);
      assert.equal(root.ctr, App);
      assert.deepEqual([...modules.keys()], [Shared, Left, Right, App]);
      assert.deepEqual(root.imports.map((s) => s.ctr), [Left, Right]);
    });

    it("shares the scope of a module imported through several paths", () => {
      class Shared {}
      Module()(Shared);
      class Left {}
      Module({ imports: [Shared] })(Left);
      class Right {}
      Module({ imports: [Shared] })(Right);
      class App {}
      Module({ imports: [Left, Right] })(App);

      const { root } = graph(App);
      assert.equal(root.imports[0]!.imports[0], root.imports[1]!.imports[0]);
    });

    it("puts the module itself, its providers and its controllers in its scope", () => {
      class Db {}
      Injectable()(Db);
      class Cli {}
      Controller()(Cli);
      const URL = token("url");
      class App {}
      Module({ providers: [Db, value(URL)], controllers: [Cli] })(App);

      const { root } = graph(App);
      assert.deepEqual(
        new Set(root.visible.keys()),
        new Set<Token>([App, Db, URL, Cli]),
      );
    });

    it("adds the tokens imports export, and only those", () => {
      const PUBLIC = token("public");
      const PRIVATE = token("private");
      class Lib {}
      Module({ providers: [value(PUBLIC), value(PRIVATE)], exports: [PUBLIC] })(
        Lib,
      );
      class App {}
      Module({ imports: [Lib] })(App);

      const { root, modules } = graph(App);
      assert.equal(
        root.visible.get(PUBLIC),
        modules.get(Lib)!.visible.get(PUBLIC),
      );
      assert.equal(root.visible.has(PRIVATE), false);
      assert.equal(root.visible.has(Lib), false); // the module class is not exported
    });

    it("lets a module's own declaration shadow an imported token", () => {
      const T = token("t");
      class Lib {}
      Module({ providers: [value(T, "lib")], exports: [T] })(Lib);
      class App {}
      Module({ imports: [Lib], providers: [value(T, "own")] })(App);

      const { root } = graph(App);
      assert.equal(root.visible.get(T)!.owner, App);
    });
  });

  describe("nodes", () => {
    it("creates one node per declaration, owned by the declaring module", () => {
      class Db {}
      Injectable()(Db);
      class App {}
      Module({ providers: [Db] })(App);

      const { root } = graph(App);
      const db = root.visible.get(Db)!;
      assert.equal(db.token, Db);
      assert.equal(db.owner, App);
      assert.equal(db.meta, root.meta.providers[0]);
      assert.equal(root.visible.get(App)!.meta, root.meta);
    });

    it("creates two nodes for the same class declared in two modules", () => {
      class Db {}
      Injectable()(Db);
      class A {}
      Module({ providers: [Db] })(A);
      class B {}
      Module({ providers: [Db] })(B);
      class App {}
      Module({ imports: [A, B] })(App);

      const { modules } = graph(App);
      const a = modules.get(A)!.visible.get(Db)!;
      const b = modules.get(B)!.visible.get(Db)!;
      assert.notEqual(a, b);
      assert.equal(a.owner, A);
      assert.equal(b.owner, B);
    });

    it("links dependencies to the nodes that provide them, in order", () => {
      class Logger {}
      Injectable()(Logger);
      const PORT = token("port");
      class Server {}
      Injectable([PORT, Logger])(Server);
      class App {}
      Module({
        providers: [Logger, value(PORT), Server],
        dependencies: [Server],
      })(
        App,
      );

      const { root } = graph(App);
      assert.deepEqual(root.visible.get(Server)!.deps, [
        root.visible.get(PORT),
        root.visible.get(Logger),
      ]);
      assert.deepEqual(root.visible.get(App)!.deps, [root.visible.get(Server)]);
      assert.deepEqual(root.visible.get(Logger)!.deps, []);
    });

    it("links controllers' dependencies too", () => {
      class Logger {}
      Injectable()(Logger);
      class Cli {}
      Controller({ dependencies: [Logger] })(Cli);
      class App {}
      Module({ providers: [Logger], controllers: [Cli] })(App);

      const { root } = graph(App);
      assert.deepEqual(root.visible.get(Cli)!.deps, [root.visible.get(Logger)]);
    });

    it("treats a provider object without deps as having none", () => {
      const T = token("t");
      // A provider written in plain JavaScript can omit `deps`.
      const bare = { provide: T, factory: () => Promise.resolve(1) };
      class App {}
      Module({ providers: [bare as unknown as Provider] })(App);

      assert.deepEqual(graph(App).root.visible.get(T)!.deps, []);
    });
  });

  describe("dependency scope", () => {
    it("resolves an exported provider's dependencies in its own module", () => {
      class Config {}
      Injectable()(Config);
      class Db {}
      Injectable([Config])(Db);
      class DbModule {}
      Module({ providers: [Config, Db], exports: [Db] })(DbModule); // Config stays private
      class App {}
      Module({ imports: [DbModule] })(App);

      const { modules } = graph(App);
      const dbScope = modules.get(DbModule)!;
      assert.deepEqual(dbScope.visible.get(Db)!.deps, [
        dbScope.visible.get(Config),
      ]);
    });

    it("does not rewire a shared node when an importer declares the same token", () => {
      class Config {}
      Injectable()(Config);
      class Db {}
      Injectable([Config])(Db);
      class DbModule {}
      Module({ providers: [Config, Db], exports: [Db] })(DbModule);
      class App {}
      Module({ imports: [DbModule], providers: [Config] })(App);

      const { root, modules } = graph(App);
      const db = root.visible.get(Db)!;
      assert.equal(db.deps[0], modules.get(DbModule)!.visible.get(Config));
      assert.notEqual(db.deps[0], root.visible.get(Config));
    });

    it("throws when a dependency is not in the scope, naming the argument", () => {
      class Missing {}
      class Logger {}
      Injectable()(Logger);
      class Service {}
      Injectable([Logger, Missing])(Service);
      class App {}
      Module({ providers: [Logger, Service] })(App);

      assert.throws(() => graph(App), {
        message:
          "Cannot resolve Missing (argument #1) of Service in module App. " +
          "Provide it there or import a module that exports it.",
      });
    });

    it("does not let a module see what the modules importing it provide", () => {
      const T = token("t");
      class NeedsT {}
      Injectable([T])(NeedsT);
      class Child {}
      Module({ providers: [NeedsT] })(Child);
      class Parent {}
      Module({ imports: [Child], providers: [value(T)] })(Parent);

      assert.throws(() => graph(Parent), {
        message:
          "Cannot resolve InjectionToken(t) (argument #0) of NeedsT in module Child. " +
          "Provide it there or import a module that exports it.",
      });
    });
  });

  describe("exports", () => {
    it("re-exports a token the module imports", () => {
      const T = token("t");
      class Lib {}
      Module({ providers: [value(T)], exports: [T] })(Lib);
      class Facade {}
      Module({ imports: [Lib], exports: [T] })(Facade);
      class App {}
      Module({ imports: [Facade] })(App);

      const { root, modules } = graph(App);
      assert.equal(root.visible.get(T), modules.get(Lib)!.visible.get(T));
    });

    it("lets a module export itself", () => {
      class Lib {}
      Module({ exports: [Lib] })(Lib);
      class App {}
      Module({ imports: [Lib] })(App);

      const { root } = graph(App);
      assert.equal(root.visible.get(Lib)!.owner, Lib);
    });

    it("throws when a module exports a token it neither provides nor imports, naming that module", () => {
      const T = token("t");
      class Lib {}
      Module({ exports: [T] })(Lib);
      class App {}
      Module({ imports: [Lib] })(App);

      assert.throws(() => graph(App), {
        message:
          "Module Lib exports InjectionToken(t), which it neither provides nor imports.",
      });
    });

    it("checks the root module's exports too", () => {
      class Db {}
      class App {}
      Module({ exports: [Db] })(App);

      assert.throws(() => graph(App), {
        message:
          "Module App exports Db, which it neither provides nor imports.",
      });
    });

    it("throws when a module re-exports a whole imported module", () => {
      class Lib {}
      Module()(Lib);
      class Facade {}
      Module({ imports: [Lib], exports: [Lib] })(Facade);

      assert.throws(() => graph(Facade), {
        message: "Module Facade exports the imported module Lib. " +
          "Re-exporting a module is not supported; export the tokens you need instead.",
      });
    });
  });

  describe("ambiguous tokens", () => {
    /** Two modules that each provide and export their own `T`. */
    function two_exporters() {
      const T = token("t");
      class X1 {}
      Module({ providers: [value(T, "x1")], exports: [T] })(X1);
      class X2 {}
      Module({ providers: [value(T, "x2")], exports: [T] })(X2);
      return { T, X1, X2 };
    }

    it("throws when an ambiguous token is injected", () => {
      const { T, X1, X2 } = two_exporters();
      class NeedsT {}
      Injectable([T])(NeedsT);
      class App {}
      Module({ imports: [X1, X2], providers: [NeedsT] })(App);

      assert.throws(() => graph(App), {
        message:
          "InjectionToken(t) is ambiguous in module App: X1, X2 export different instances of it. " +
          "Provide InjectionToken(t) in App to choose which one to use.",
      });
    });

    it("throws when an ambiguous token is exported", () => {
      const { T, X1, X2 } = two_exporters();
      class App {}
      Module({ imports: [X1, X2], exports: [T] })(App);

      assert.throws(() => graph(App), {
        message: /^InjectionToken\(t\) is ambiguous in module App: X1, X2 /,
      });
    });

    it("lists every module that exports it", () => {
      const { T, X1, X2 } = two_exporters();
      class X3 {}
      Module({ providers: [value(T, "x3")], exports: [T] })(X3);
      class App {}
      Module({ imports: [X1, X2, X3], exports: [T] })(App);

      assert.throws(() => graph(App), {
        message: /ambiguous in module App: X1, X2, X3 export/,
      });
    });

    it("leaves an unused ambiguous token out of the scope, without throwing", () => {
      const { T, X1, X2 } = two_exporters();
      class App {}
      Module({ imports: [X1, X2] })(App);

      assert.equal(graph(App).root.visible.has(T), false);
    });

    it("lets the module settle it by declaring the token itself", () => {
      const { T, X1, X2 } = two_exporters();
      class NeedsT {}
      Injectable([T])(NeedsT);
      class App {}
      Module({ imports: [X1, X2], providers: [value(T, "own"), NeedsT] })(App);

      const { root } = graph(App);
      assert.equal(root.visible.get(NeedsT)!.deps[0], root.visible.get(T));
      assert.equal(root.visible.get(T)!.owner, App);
    });

    it("does not treat the same node exported by two imports as ambiguous", () => {
      const T = token("t");
      class Shared {}
      Module({ providers: [value(T)], exports: [T] })(Shared);
      class ViaA {}
      Module({ imports: [Shared], exports: [T] })(ViaA);
      class ViaB {}
      Module({ imports: [Shared], exports: [T] })(ViaB);
      class NeedsT {}
      Injectable([T])(NeedsT);
      class App {}
      Module({ imports: [ViaA, ViaB], providers: [NeedsT] })(App);

      const { root, modules } = graph(App);
      assert.equal(root.visible.get(T), modules.get(Shared)!.visible.get(T));
    });
  });

  describe("duplicate declarations", () => {
    it("throws on a token listed twice in providers", () => {
      const T = token("t");
      class App {}
      Module({ providers: [value(T, 1), value(T, 2)] })(App);

      assert.throws(() => graph(App), {
        message: "InjectionToken(t) is declared more than once in module App " +
          "(as a provider and as a provider). Declare each token once.",
      });
    });

    it("throws on a provider and a controller with the same token", () => {
      class Cli {}
      Controller()(Cli);
      class App {}
      Module({ providers: [value(Cli)], controllers: [Cli] })(App);

      assert.throws(() => graph(App), {
        message: "Cli is declared more than once in module App " +
          "(as a provider and as a controller). Declare each token once.",
      });
    });

    it("throws on a controller listed twice", () => {
      class Cli {}
      Controller()(Cli);
      class App {}
      Module({ controllers: [Cli, Cli] })(App);

      assert.throws(() => graph(App), {
        message: "Cli is declared more than once in module App " +
          "(as a controller and as a controller). Declare each token once.",
      });
    });

    it("throws on a provider whose token is the module class", () => {
      class App {}
      Module({ providers: [value(App)] })(App);

      assert.throws(() => graph(App), {
        message: "App is declared more than once in module App " +
          "(as a provider and as the module itself). Declare each token once.",
      });
    });
  });

  describe("cycles", () => {
    it("throws on a cycle between providers, with its path", () => {
      class A {}
      class B {}
      class C {}
      Injectable([B])(A);
      Injectable([C])(B);
      Injectable([A])(C);
      class App {}
      Module({ providers: [A, B, C] })(App);

      assert.throws(() => graph(App), {
        message: "Circular dependency detected in module App: A → B → C → A",
      });
    });

    it("throws on a module that depends on itself", () => {
      class App {}
      Module({ dependencies: [App] })(App);

      assert.throws(() => graph(App), {
        message: "Circular dependency detected in module App: App → App",
      });
    });

    it("throws on a cycle through the module class", () => {
      class NeedsModule {}
      class App {}
      Injectable([App])(NeedsModule);
      Module({ providers: [NeedsModule], dependencies: [NeedsModule] })(App);

      assert.throws(() => graph(App), {
        message:
          "Circular dependency detected in module App: NeedsModule → App → NeedsModule",
      });
    });

    it("throws on circular imports in a hand-built metadata graph", () => {
      // build_meta_graph rejects circular imports first; the dependency graph
      // checks them again so it is safe on any input.
      class A {}
      class B {}
      const imports_of_a: ModuleMetadata[] = [];
      const module_of = (
        ctr: Ctr,
        imports: ModuleMetadata[],
      ): ModuleMetadata => ({
        isModule: true,
        isInjectable: true,
        isProvider: true,
        imports,
        exports: [],
        providers: [],
        controllers: [],
        middlewares: [],
        errorHandler: undefined,
        provider: value(ctr),
      });
      const a = module_of(A, imports_of_a);
      const b = module_of(B, [a]);
      imports_of_a.push(b);

      assert.throws(
        () => build_dependency_graph({ root: a, modules: new Map() }),
        { message: "Circular dependency detected: A → B → A" },
      );
    });
  });
});
