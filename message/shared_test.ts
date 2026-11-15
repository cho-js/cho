/**
 * Tests for one module graph with two applications: a `ChoWeb`, and a
 * `ChoMessage` made from its injector (`ChoMessage.from`). They share their
 * instances, and each sees its own controllers.
 *
 * Decorators are applied as plain function calls, so the tests run on every
 * runtime.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Injectable } from "@chojs/core/di";
import { legacy } from "@chojs/core/utils/test_utils";
import {
  ChoWeb,
  type ChoWebContext,
  Controller as WebController,
  Get,
  Middlewares as WebMiddlewares,
  Module as WebModule,
} from "@chojs/web";
import type { ChoMessageContext } from "./context.ts";
import { Controller, Middlewares, Module, Subscribe } from "./decorators.ts";
import { ChoMessage } from "./message.ts";

/** One module graph: a store, a web controller and a message controller. */
function shop(log: string[] = []) {
  class Store {
    readonly paid = new Set<string>();
    constructor() {
      log.push("Store created");
    }
    [Symbol.dispose]() {
      log.push("Store disposed");
    }
  }
  Injectable()(Store);

  // GET /orders/:id, of @chojs/web
  class OrdersController {
    constructor(readonly store: Store) {}
    get(ctx: ChoWebContext) {
      return { id: ctx.params.id, paid: this.store.paid.has(ctx.params.id!) };
    }
  }
  legacy(Get(":id"), OrdersController, "get");
  WebMiddlewares(async (ctx, next) => {
    log.push(`web ${ctx.url.pathname}`);
    return await next();
  })(OrdersController);
  WebController({ route: "orders", dependencies: [Store] })(OrdersController);

  // the topic payments.settled, of @chojs/message
  class PaymentsController {
    constructor(readonly store: Store) {}
    settled(ctx: ChoMessageContext) {
      this.store.paid.add(ctx.json<{ order: string }>().order);
    }
  }
  legacy(Subscribe("settled"), PaymentsController, "settled");
  Middlewares(async (ctx, next) => {
    log.push(`message ${ctx.topic}`);
    await next();
  })(PaymentsController);
  Controller({ topic: "payments", dependencies: [Store] })(PaymentsController);

  class App {}
  WebModule({
    route: "v1",
    providers: [Store],
    controllers: [OrdersController, PaymentsController],
  })(App);
  return { App, Store };
}

describe("a web application and a message application on one injector", () => {
  it("shares the instances: what a message changes, a request sees", async () => {
    const log: string[] = [];
    const web = await ChoWeb.create(shop(log).App);
    const messages = await ChoMessage.from(web.injector);

    const paid = async () =>
      (await (await web.handler(new Request("http://localhost/v1/orders/42")))
        .json()).paid;
    assert.equal(await paid(), false);
    await messages.handle("payments.settled", { value: '{"order":"42"}' });
    assert.equal(await paid(), true);

    assert.equal(log.filter((line) => line === "Store created").length, 1);
    await messages.close();
    await web.close();
  });

  it("gives each application its own controllers", async () => {
    const web = await ChoWeb.create(shop().App);
    const messages = await ChoMessage.from(web.injector);

    assert.deepEqual(
      web.routes.map((route) => `${route.method} ${route.path}`),
      ["GET /v1/orders/:id"],
    );
    // the module is declared with the @Module of @chojs/web: its route is not
    // a topic, and the message controller has no feature level
    assert.deepEqual(messages.routes.map((route) => route.topic), [
      "payments.settled",
    ]);
    await messages.close();
    await web.close();
  });

  it("keeps the middlewares of a controller to its own application", async () => {
    const log: string[] = [];
    const web = await ChoWeb.create(shop(log).App);
    const messages = await ChoMessage.from(web.injector);
    log.length = 0;

    await web.handler(new Request("http://localhost/v1/orders/1"));
    await messages.handle("payments.settled", { value: '{"order":"1"}' });
    assert.deepEqual(log, ["web /v1/orders/1", "message payments.settled"]);
    await messages.close();
    await web.close();
  });

  it("lets the owner dispose: closing the message application disposes nothing", async () => {
    const log: string[] = [];
    const web = await ChoWeb.create(shop(log).App);
    const messages = await ChoMessage.from(web.injector);

    await messages.close();
    assert.ok(!log.includes("Store disposed"));
    // the web application still answers
    const response = await web.handler(
      new Request("http://localhost/v1/orders/42"),
    );
    assert.equal(response.status, 200);

    await web.close();
    assert.equal(log.filter((line) => line === "Store disposed").length, 1);
  });

  it("takes the feature topic of a module declared with its own @Module", async () => {
    class Stock {
      low() {}
    }
    legacy(Subscribe("low"), Stock, "low");
    Controller({ topic: "stock" })(Stock);
    class WarehouseModule {}
    Module({ topic: "warehouse", controllers: [Stock] })(WarehouseModule);

    const { App } = shop();
    class Root {}
    WebModule({ imports: [App, WarehouseModule] })(Root);

    const web = await ChoWeb.create(Root);
    const messages = await ChoMessage.from(web.injector, { prefix: "staging" });
    assert.deepEqual(messages.routes.map((route) => route.topic).sort(), [
      "staging.payments.settled",
      "staging.warehouse.stock.low",
    ]);
    assert.equal(web.routes.length, 1);
    await messages.close();
    await web.close();
  });

  it("works the other way around: a message application owns the injector", async () => {
    const log: string[] = [];
    const messages = await ChoMessage.create(shop(log).App);
    await messages.handle("payments.settled", { value: '{"order":"7"}' });
    await messages.close();
    assert.equal(log.filter((line) => line === "Store disposed").length, 1);
  });
});
