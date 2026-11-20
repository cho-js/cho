/**
 * Tests for `endpoints.ts`: the endpoints of an application, read from the
 * records of the real decorators of `@chojs/web`, `@chojs/message` and
 * `@chojs/command`, and compared with the routes of a created application.
 *
 * Decorators are applied as plain function calls.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Catch, isChoError } from "@chojs/core";
import { Controller, Get, Module } from "@chojs/web";
import { Controller as CommandController, Main } from "../../command/mod.ts";
import { capture, legacy, loose } from "@chojs/core/utils/test_utils";
import { endpoints, formatEndpoints, printEndpoints } from "./endpoints.ts";
import { inspect } from "./inspect.ts";
import { message_app, named, shop, web_app } from "./testing.ts";

const TABLE = `HTTP
GET   /v1/users      UsersController.list    UsersModule   auth
GET   /v1/users/:id  UsersController.get     UsersModule   auth
POST  /v1/users      UsersController.create  UsersModule   auth, audit
SSE   /feed          OrdersFeed.feed         OrdersModule
WS    /chat/:room    ChatController.join     ChatModule

MESSAGE
orders.paid      OrdersEvents.paid      OrdersModule
orders.refunded  OrdersEvents.refunded  OrdersModule

COMMAND
build  Tools.build  ToolsModule`;

describe("endpoints", () => {
  it("lists every endpoint, in the order they are declared", () => {
    const list = endpoints(shop().App);
    assert.deepEqual(
      list.map((endpoint) => [endpoint.type, endpoint.name, endpoint.handler]),
      [
        ["http", "GET /v1/users", "list"],
        ["http", "GET /v1/users/:id", "get"],
        ["http", "POST /v1/users", "create"],
        ["message", "orders.paid", "paid"],
        ["message", "orders.refunded", "refunded"],
        ["sse", "SSE /feed", "feed"],
        ["ws", "WS /chat/:room", "join"],
        ["command", "build", "build"],
      ],
    );
  });

  it("gives an HTTP endpoint its method, its path and where it is declared", () => {
    const [list] = endpoints(shop().App);
    assert.deepEqual(list, {
      id: "UsersModule/UsersController.list",
      kind: "endpoint",
      name: "GET /v1/users",
      module: "UsersModule",
      controller: "UsersModule/UsersController",
      handler: "list",
      type: "http",
      method: "GET",
      path: "/v1/users",
      middlewares: ["auth"],
      errorHandler: null,
      mounted: false,
    });
  });

  it("gives a socket the events its controller handles, in order", () => {
    const socket = endpoints(shop().App).find((endpoint) =>
      endpoint.type === "ws"
    );
    assert.equal(socket?.method, "GET");
    assert.equal(socket?.path, "/chat/:room");
    assert.deepEqual(socket?.events, ["open", "message"]);
  });

  it("gives a topic, a contract and a command what they declare", () => {
    const list = endpoints(shop().App);
    const paid = list.find((endpoint) => endpoint.handler === "paid");
    assert.equal(paid?.topic, "orders.paid");
    // The topic of a contract is whole: the topic of the controller is the
    // start of it, and is not added again.
    const refunded = list.find((endpoint) => endpoint.handler === "refunded");
    assert.equal(refunded?.topic, "orders.refunded");
    const build = list.find((endpoint) => endpoint.type === "command");
    assert.equal(build?.command, "build");
  });

  it("names @Main main", () => {
    const Cli = named("Cli");
    Object.assign(Cli.prototype, { run() {} });
    legacy(loose(Main()), Cli, "run");
    CommandController({})(Cli);
    const App = named("App");
    Module({ controllers: [Cli] })(App);
    const [main] = endpoints(App);
    assert.equal(main?.type, "command");
    assert.equal(main?.command, "main");
    assert.equal(main?.name, "main");
  });

  it("lists the middlewares of the module, the controller and the method", () => {
    const create = endpoints(shop().App).find((endpoint) =>
      endpoint.handler === "create"
    );
    assert.deepEqual(create?.middlewares, ["auth", "audit"]);
  });

  it("names the nearest error handler", () => {
    function of_method() {}
    function of_controller() {}
    function of_module() {}
    const make = (on: "method" | "controller" | "module" | "none") => {
      const Users = named("Users");
      Object.assign(Users.prototype, { list() {} });
      legacy(Get(""), Users, "list");
      if (on === "method") {
        legacy(loose(Catch)(of_method), Users, "list");
      }
      if (on === "method" || on === "controller") {
        loose(Catch)(of_controller)(Users);
      }
      Controller({})(Users);
      const App = named("App");
      if (on !== "none") {
        loose(Catch)(of_module)(App);
      }
      Module({ controllers: [Users] })(App);
      return endpoints(App)[0]?.errorHandler;
    };
    assert.equal(make("method"), "of_method");
    assert.equal(make("controller"), "of_controller");
    assert.equal(make("module"), "of_module");
    assert.equal(make("none"), null);
  });

  it("creates nothing", () => {
    const { App, created } = shop();
    endpoints(App);
    formatEndpoints(App);
    assert.deepEqual(created, []);
  });

  describe("of an application", () => {
    it("are the routes of a web application, prefix and mounted routes included", async () => {
      const app = await web_app(shop().App, "api");
      app.mount("GET", "health", () => "ok");
      const paths = endpoints(app)
        .filter((endpoint) => endpoint.path !== undefined)
        .map((endpoint) => `${endpoint.method} ${endpoint.path}`);
      assert.deepEqual(
        paths,
        app.routes.map((route) => `${route.method} ${route.path}`),
      );
      const mounted = endpoints(app).filter((endpoint) => endpoint.mounted);
      assert.deepEqual(mounted.map((endpoint) => endpoint.name), [
        "GET /health",
      ]);
      await app.close();
    });

    it("are the topics of a message application, with its prefix", async () => {
      const app = await message_app(shop().App, "shop");
      const topics = endpoints(app)
        .filter((endpoint) => endpoint.type === "message")
        .map((endpoint) => endpoint.topic);
      assert.deepEqual(topics, app.routes.map((route) => route.topic));
      assert.deepEqual(topics, ["shop.orders.paid", "shop.orders.refunded"]);
      // The prefix of a message application is not one of its paths.
      assert.equal(endpoints(app)[0]?.path, "/v1/users");
      await app.close();
    });
  });
});

describe("formatEndpoints", () => {
  it("writes a table, a part for each kind of application", () => {
    assert.equal(formatEndpoints(shop().App), TABLE);
  });

  it("shows the types that are asked for", () => {
    assert.equal(
      formatEndpoints(shop().App, { types: ["ws", "command"] }),
      "HTTP\nWS  /chat/:room  ChatController.join  ChatModule\n\n" +
        "COMMAND\nbuild  Tools.build  ToolsModule",
    );
  });

  it("says where a mounted route is from", async () => {
    const App = named("App");
    Module({})(App);
    const app = await web_app(App);
    app.mount("GET", "health", () => "ok", { name: "health check" });
    assert.equal(
      formatEndpoints(app),
      "HTTP\nGET  /health  health check  (mounted)",
    );
    await app.close();
  });

  it("says when there is nothing to show", () => {
    const App = named("App");
    Module({})(App);
    assert.equal(formatEndpoints(App), "No endpoints.");
    assert.equal(
      formatEndpoints(shop().App, { types: [] }),
      "No endpoints.",
    );
  });

  it("takes a model that was read before", () => {
    assert.equal(formatEndpoints(inspect(shop().App)), TABLE);
  });

  it("refuses an option it does not know, and a type it does not know", () => {
    const { App } = shop();
    assert.throws(
      () => formatEndpoints(App, loose({ kinds: ["http"] })),
      (error) =>
        isChoError(error, "CHO_CORE_UNKNOWN_OPTION") &&
        /^formatEndpoints\(\): unknown option "kinds"/.test(error.message),
    );
    assert.throws(
      () => formatEndpoints(App, loose({ types: ["grpc"] })),
      (error) =>
        isChoError(error, "CHO_DEV_INVALID_OPTION") &&
        /unknown type "grpc". Known types: http, sse, ws, message, command/
          .test(error.message),
    );
    assert.throws(
      () => formatEndpoints(App, loose({ types: "http" })),
      (error) => isChoError(error, "CHO_DEV_INVALID_OPTION"),
    );
    assert.throws(
      () => formatEndpoints(App, loose(null)),
      (error) => isChoError(error, "CHO_DEV_INVALID_OPTION"),
    );
    assert.throws(
      () => formatEndpoints(loose(7)),
      (error) =>
        isChoError(error, "CHO_DEV_INVALID_TARGET") &&
        error.message.startsWith("formatEndpoints():"),
    );
  });
});

describe("printEndpoints", () => {
  it("writes the table with console.log", async () => {
    const { App } = shop();
    const { output } = await capture(() => printEndpoints(App));
    assert.deepEqual(output.log, [TABLE]);
    assert.deepEqual(output.error, []);
  });

  it("names itself in the error of an invalid target", () => {
    assert.throws(
      () => printEndpoints(loose("App")),
      (error) =>
        isChoError(error, "CHO_DEV_INVALID_TARGET") &&
        error.message.startsWith("printEndpoints():"),
    );
  });
});
