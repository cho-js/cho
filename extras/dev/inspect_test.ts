/**
 * Tests for `inspect.ts`: the model of an application, read from the metadata
 * of its decorators, with nothing created.
 *
 * Decorators are applied as plain function calls.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Catch,
  configure,
  Controller,
  Injectable,
  Injector,
  Middlewares,
  Module,
  provider,
  token,
} from "@chojs/core";
import { isChoError } from "@chojs/core";
import { loose } from "@chojs/core/utils/test_utils";
import { inspect } from "./inspect.ts";
import { type Class, named, shop, web_app } from "./testing.ts";
import type { ChoDevGraph, ChoDevNode } from "./types.ts";

/** The edges of a model, as lines of text. */
const lines = (graph: ChoDevGraph): string[] =>
  graph.edges.map((edge) => `${edge.kind} ${edge.from} -> ${edge.to}`);

/** The node of an id. */
function node_of(graph: ChoDevGraph, id: string): ChoDevNode {
  const node = graph.nodes.find((other) => other.id === id);
  assert.ok(node, `no node ${id}`);
  return node;
}

/** A module of providers, with what it imports and exports. */
function module_of(
  name: string,
  options: Record<string, unknown> = {},
): Class {
  const module = named(name);
  Module(loose(options))(module);
  return module;
}

/** An injectable class, with its dependencies. */
function injectable(name: string, dependencies: unknown[] = []): Class {
  const made = named(name);
  Injectable(loose(dependencies))(loose(made));
  return made;
}

describe("inspect", () => {
  it("lists the modules, the root first, each with what it declares", () => {
    const graph = inspect(shop().App);
    assert.equal(graph.root, "App");
    assert.equal(graph.error, null);
    assert.deepEqual(graph.nodes.map((node) => node.id), [
      "App",
      "UsersModule",
      "UsersModule/UsersService",
      "UsersModule/UsersController",
      "UsersModule/UsersController.list",
      "UsersModule/UsersController.get",
      "UsersModule/UsersController.create",
      "SharedModule",
      "SharedModule/InjectionToken(CONFIG)",
      "SharedModule/Logger",
      "OrdersModule",
      "OrdersModule/OrdersService",
      "OrdersModule/OrdersEvents",
      "OrdersModule/OrdersEvents.paid",
      "OrdersModule/OrdersEvents.refunded",
      "OrdersModule/OrdersFeed",
      "OrdersModule/OrdersFeed.feed",
      "ChatModule",
      "ChatModule/ChatController",
      "ChatModule/ChatController.join",
      "ToolsModule",
      "ToolsModule/Tools",
      "ToolsModule/Tools.build",
    ]);
    assert.deepEqual(node_of(graph, "App"), {
      id: "App",
      kind: "module",
      name: "App",
      module: "App",
      root: true,
      middlewares: [],
      errorHandler: null,
    });
    assert.equal(loose(node_of(graph, "UsersModule")).root, false);
  });

  it("says what imports, exports and injects what", () => {
    assert.deepEqual(lines(inspect(shop().App)), [
      "imports App -> UsersModule",
      "imports App -> OrdersModule",
      "imports App -> ChatModule",
      "imports App -> ToolsModule",
      "imports UsersModule -> SharedModule",
      "exports UsersModule -> UsersModule/UsersService",
      "injects UsersModule/UsersService -> SharedModule/Logger",
      "injects UsersModule/UsersController -> UsersModule/UsersService",
      "exports SharedModule -> SharedModule/InjectionToken(CONFIG)",
      "exports SharedModule -> SharedModule/Logger",
      "imports OrdersModule -> SharedModule",
      "imports OrdersModule -> UsersModule",
      "injects OrdersModule/OrdersService -> UsersModule/UsersService",
      "injects OrdersModule/OrdersService -> SharedModule/InjectionToken(CONFIG)",
      "injects OrdersModule/OrdersEvents -> OrdersModule/OrdersService",
    ]);
  });

  it("creates nothing: no instance, and no call of a factory", () => {
    const { App, created } = shop();
    inspect(App);
    assert.deepEqual(created, []);
  });

  it("gives plain data: JSON writes it whole", () => {
    const graph = inspect(shop().App);
    assert.deepEqual(JSON.parse(JSON.stringify(graph)), graph);
  });

  it("says what the token of a provider is", () => {
    const TOKEN = token<number>("PORT");
    const SYMBOL = Symbol("clock");
    const Logger = injectable("Logger");
    const App = module_of("App", {
      providers: [
        Logger,
        provider({ provide: TOKEN, factory: () => Promise.resolve(1) }),
        provider({ provide: SYMBOL, factory: () => Promise.resolve(2) }),
      ],
    });
    const providers = inspect(App).nodes.filter((node) =>
      node.kind === "provider"
    );
    assert.deepEqual(
      providers.map((node) => [node.name, node.token]),
      [
        ["Logger", "class"],
        ["InjectionToken(PORT)", "token"],
        ["Symbol(clock)", "symbol"],
      ],
    );
  });

  it("has the middlewares and the error handler of a module and a controller", () => {
    function auth() {}
    function log() {}
    function on_error() {}
    const Users = named("Users");
    loose(Middlewares)(auth, log)(Users);
    loose(Catch)(on_error)(Users);
    Controller({})(Users);
    const App = named("App");
    loose(Middlewares)(log)(App);
    Module({ controllers: [Users] })(App);
    const graph = inspect(App);
    const controller = loose(node_of(graph, "App/Users"));
    assert.deepEqual(controller.middlewares, ["auth", "log"]);
    assert.equal(controller.errorHandler, "on_error");
    const module = loose(node_of(graph, "App"));
    assert.deepEqual(module.middlewares, ["log"]);
    assert.equal(module.errorHandler, null);
  });

  it("has one node for each declaration: a class two modules declare is two", () => {
    const Logger = injectable("Logger");
    const A = module_of("A", { providers: [Logger] });
    const B = module_of("B", { providers: [Logger] });
    const App = module_of("App", { imports: [A, B] });
    const ids = inspect(App).nodes.map((node) => node.id);
    assert.deepEqual(ids, ["App", "A", "A/Logger", "B", "B/Logger"]);
  });

  it("gives two classes of one name two ids", () => {
    const first = module_of("Feature", { providers: [injectable("Service")] });
    const second = module_of("Feature");
    const App = module_of("App", { imports: [first, second] });
    const ids = inspect(App).nodes.map((node) => node.id);
    assert.deepEqual(ids, ["App", "Feature", "Feature/Service", "Feature#2"]);
  });

  it("follows a token a module exports again to where it is declared", () => {
    const Logger = injectable("Logger");
    const Core = module_of("Core", { providers: [Logger], exports: [Logger] });
    const Shared = module_of("Shared", { imports: [Core], exports: [Logger] });
    const Users = injectable("Users", [Logger]);
    const App = module_of("App", { imports: [Shared], providers: [Users] });
    assert.deepEqual(lines(inspect(App)), [
      "imports App -> Shared",
      "injects App/Users -> Core/Logger",
      "imports Shared -> Core",
      "exports Shared -> Core/Logger",
      "exports Core -> Core/Logger",
    ]);
  });

  it("shows a module that is injected, and a module that injects", () => {
    const Config = injectable("Config");
    const App = named("App");
    const Reader = injectable("Reader", [App]);
    Module({ providers: [Config, Reader], dependencies: [Config] })(
      loose(App),
    );
    assert.deepEqual(lines(inspect(App)), [
      "injects App -> App/Config",
      "injects App/Reader -> App",
    ]);
  });

  it("reads a module made by configure() as a module of its own", () => {
    const URL = token<string>("URL");
    const Client = injectable("Client", [URL]);
    const Library = module_of("Library", {
      providers: [
        provider({ provide: URL, factory: () => Promise.reject("not set") }),
        Client,
      ],
      exports: [Client],
    });
    const Configured = configure(loose(Library), {
      providers: [
        provider({ provide: URL, factory: () => Promise.resolve("db://") }),
      ],
      name: "Database",
    });
    const App = module_of("App", { imports: [Configured] });
    const graph = inspect(App);
    assert.deepEqual(graph.nodes.map((node) => node.id), [
      "App",
      "Database",
      // The provider that was given comes after those of the module.
      "Database/Client",
      "Database/InjectionToken(URL)",
    ]);
    assert.deepEqual(lines(graph), [
      "imports App -> Database",
      "exports Database -> Database/Client",
      "injects Database/Client -> Database/InjectionToken(URL)",
    ]);
    assert.equal(graph.error, null);
  });

  describe("a broken application", () => {
    it("is read, with its error, and a node for what is missing", () => {
      const Mailer = injectable("Mailer");
      const Orders = injectable("Orders", [Mailer]);
      const App = module_of("App", { providers: [Orders] });
      const graph = inspect(App);
      assert.equal(graph.error?.code, "CHO_CORE_UNRESOLVED_DEPENDENCY");
      assert.match(graph.error?.message ?? "", /Cannot resolve Mailer/);
      assert.deepEqual(node_of(graph, "App/?Mailer"), {
        id: "App/?Mailer",
        kind: "missing",
        name: "Mailer",
        module: "App",
      });
      assert.deepEqual(lines(graph), ["injects App/Orders -> App/?Mailer"]);
    });

    it("has one missing node for a token a module asks for twice", () => {
      const Mailer = injectable("Mailer");
      const App = module_of("App", {
        providers: [
          injectable("Orders", [Mailer]),
          injectable("Users", [Mailer]),
        ],
      });
      const missing = inspect(App).nodes.filter((node) =>
        node.kind === "missing"
      );
      assert.deepEqual(missing.map((node) => node.id), ["App/?Mailer"]);
    });

    it("still finds what the rest of the application gives", () => {
      const Logger = injectable("Logger");
      const Shared = module_of("Shared", {
        providers: [Logger],
        exports: [Logger],
      });
      const Mailer = injectable("Mailer");
      const Orders = injectable("Orders", [Logger, Mailer]);
      const App = module_of("App", { imports: [Shared], providers: [Orders] });
      assert.deepEqual(lines(inspect(App)), [
        "imports App -> Shared",
        "injects App/Orders -> Shared/Logger",
        "injects App/Orders -> App/?Mailer",
        "exports Shared -> Shared/Logger",
      ]);
    });

    it("does not choose between two imports that export one token", () => {
      const Logger = injectable("Logger");
      const A = module_of("A", { providers: [Logger], exports: [Logger] });
      const B = module_of("B", { providers: [Logger], exports: [Logger] });
      const Users = injectable("Users", [Logger]);
      const App = module_of("App", { imports: [A, B], providers: [Users] });
      const graph = inspect(App);
      assert.equal(graph.error?.code, "CHO_CORE_AMBIGUOUS_TOKEN");
      assert.ok(lines(graph).includes("injects App/Users -> App/?Logger"));
    });

    it("draws a cycle of dependencies", () => {
      const A = named("A");
      const B = named("B");
      Injectable(loose([B]))(loose(A));
      Injectable(loose([A]))(loose(B));
      const App = module_of("App", { providers: [A, B] });
      const graph = inspect(App);
      assert.equal(graph.error?.code, "CHO_CORE_CIRCULAR_DEPENDENCY");
      assert.deepEqual(lines(graph), [
        "injects App/A -> App/B",
        "injects App/B -> App/A",
      ]);
    });

    it("throws the error of the core when the metadata itself is invalid", () => {
      assert.throws(
        () => inspect(named("NotAModule")),
        (error) => isChoError(error, "CHO_CORE_NOT_A_MODULE"),
      );
      const NotInjectable = named("Plain");
      const App = module_of("App", { providers: [NotInjectable] });
      assert.throws(
        () => inspect(App),
        (error) => isChoError(error, "CHO_CORE_NOT_INJECTABLE"),
      );
    });
  });

  describe("the target", () => {
    it("is an injector too: the model is the one of its root module", () => {
      const { App, created } = shop();
      assert.deepEqual(inspect(new Injector(App)), inspect(App));
      assert.deepEqual(created, []);
    });

    it("is an application too, which adds its prefix and its mounted routes", async () => {
      const { App } = shop();
      const app = await web_app(App, "api");
      app.mount("GET", "health", () => "ok", { name: "health check" });
      const graph = inspect(app);
      const list = loose(node_of(graph, "UsersModule/UsersController.list"));
      assert.equal(list.path, "/api/v1/users");
      assert.deepEqual(graph.nodes.at(-1), {
        id: "App/GET /health",
        kind: "endpoint",
        name: "GET /health",
        module: "App",
        controller: null,
        handler: "health check",
        type: "http",
        method: "GET",
        path: "/health",
        middlewares: [],
        errorHandler: null,
        mounted: true,
      });
      await app.close();
    });

    it("is a model too, which is returned as it is", () => {
      const graph = inspect(shop().App);
      assert.equal(inspect(graph), graph);
    });

    it("is nothing else: CHO_DEV_INVALID_TARGET", () => {
      for (const target of [null, undefined, 5, "App", {}, { injector: {} }]) {
        assert.throws(
          () => inspect(loose(target)),
          (error) =>
            isChoError(error, "CHO_DEV_INVALID_TARGET") &&
            /^inspect\(\): expected a root module class, an injector or an application, got /
              .test(error.message),
        );
      }
    });
  });
});
