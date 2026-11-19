/**
 * Tests for `configure` of `@chojs/core`, with a feature module of
 * `@chojs/message`: a module of a library, given its settings by an
 * application.
 *
 * Decorators are applied as plain function calls, so the tests run on every
 * runtime.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { legacy } from "@chojs/core/utils/test_utils";
import {
  ChoMessage,
  configure,
  Controller,
  Injectable,
  Module,
  provider,
  Subscribe,
  token,
} from "./mod.ts";

const PREFIX = token<string>("PREFIX");

describe("a feature made by configure", () => {
  it("handles the topics of the module, with the settings given", async () => {
    class Labels {
      constructor(readonly prefix: string) {}
    }
    Injectable([PREFIX])(Labels);
    class Orders {
      constructor(readonly labels: Labels) {}
      label() {
        return `${this.labels.prefix}-42`;
      }
    }
    legacy(Subscribe("label"), Orders, "label");
    Controller({ topic: "orders", dependencies: [Labels] })(Orders);
    class OrdersModule {}
    Module({
      topic: "shop",
      providers: [
        provider({ provide: PREFIX, factory: () => "default" }),
        Labels,
      ],
      controllers: [Orders],
    })(OrdersModule);

    const Configured = configure(OrdersModule, {
      providers: [provider({ provide: PREFIX, factory: () => "given" })],
    });
    class App {}
    Module({ imports: [Configured] })(App);
    const app = await ChoMessage.create(App);
    assert.deepEqual(app.routes.map((route) => route.topic), [
      "shop.orders.label",
    ]);
    const reply = await app.handle("shop.orders.label");
    assert.equal(new TextDecoder().decode(reply?.value), "given-42");
    await app.close();

    // The module of the library still has its default.
    class Plain {}
    Module({ imports: [OrdersModule] })(Plain);
    const plain = await ChoMessage.create(Plain);
    const other = await plain.handle("shop.orders.label");
    assert.equal(new TextDecoder().decode(other?.value), "default-42");
    await plain.close();
  });
});
