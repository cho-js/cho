/**
 * Tests for `@Doc`: what it records, what it refuses, and what the graph of
 * an application exposes of it.
 *
 * Decorators are applied as plain function calls, so the tests run on every
 * runtime. The decorator syntax is checked in `syntax_test.ts`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { read_method_metadata } from "@chojs/core/di";
import {
  legacy,
  loose,
  standard_schema,
  tc39,
  tc39_record,
} from "@chojs/core/utils/test_utils";
import { contract } from "./contract.ts";
import { Controller, Doc, Module, Subscribe } from "./decorators.ts";
import { is_contract } from "./graph.ts";
import { DOC, doc_of } from "./keys.ts";
import { ChoMessage } from "./message.ts";

/** A validator: every value is valid. */
const Price = standard_schema<number>((value) => ({ value: value as number }));

describe("@Doc", () => {
  it("writes its options on a class and on a method, on both decorator shapes", () => {
    const options = { summary: "An order was created", tags: ["orders"] };
    function created() {}
    tc39(Doc(options), created, "created");
    assert.deepEqual(
      doc_of(tc39_record(created, "created") as object),
      options,
    );

    class Orders {
      created() {}
    }
    legacy(Doc(options), Orders, "created");
    assert.deepEqual(
      (read_method_metadata(Orders, "created") as Record<symbol, unknown>)[DOC],
      options,
    );
    assert.ok(
      Object.isFrozen(doc_of(read_method_metadata(Orders, "created")!)),
    );
  });

  it("takes every option of a handler, and the two of a class", () => {
    class Orders {
      price() {}
    }
    legacy(
      Doc({
        summary: "The price of an order",
        description: "In cents.",
        reply: { description: "The price", schema: Price },
        operationId: "getPrice",
        tags: ["prices"],
        hidden: false,
      }),
      Orders,
      "price",
    );
    Doc({ tags: ["orders"], hidden: true })(Orders);
    Doc({})(class Empty {});
    Doc({ reply: {} });
  });

  it("rejects an unknown option, those of the @Doc of @chojs/web included", () => {
    for (const key of ["tag", "deprecated", "responses", "security"]) {
      assert.throws(() => Doc(loose({ [key]: true })), {
        code: "CHO_CORE_UNKNOWN_OPTION",
        message:
          `@Doc(): unknown option "${key}". Known options: description, hidden, operationId, reply, summary, tags`,
      });
    }
  });

  it("rejects the options of a handler on a class", () => {
    class Orders {}
    for (const key of ["summary", "description", "reply", "operationId"]) {
      const value = key === "reply" ? {} : "x";
      assert.throws(() => Doc(loose({ [key]: value }))(Orders), {
        code: "CHO_MESSAGE_INVALID_OPTION",
        message:
          `@Doc(): option "${key}" is for a handler, not for a class (class Orders)`,
      });
    }
  });

  it("rejects an operationId that is not a string with something in it", () => {
    for (const operationId of ["", 7, null]) {
      assert.throws(() => Doc(loose({ operationId })), {
        code: "CHO_MESSAGE_INVALID_OPTION",
        message: /^@Doc\(\): operationId must be a non-empty string, got /,
      });
    }
  });

  it("rejects a reply that is not an object of a description and a schema", () => {
    for (const reply of ["The price", null, [], Price && 7]) {
      assert.throws(() => Doc(loose({ reply })), {
        code: "CHO_MESSAGE_INVALID_OPTION",
        message: /^@Doc\(\): reply must be an object, such as /,
      });
    }
    assert.throws(() => Doc(loose({ reply: { contentType: "text/plain" } })), {
      code: "CHO_CORE_UNKNOWN_OPTION",
      message:
        '@Doc(): reply: unknown option "contentType". Known options: description, schema',
    });
    for (const schema of ["number", {}, null]) {
      assert.throws(() => Doc(loose({ reply: { schema } })), {
        code: "CHO_MESSAGE_INVALID_OPTION",
        message: /^@Doc\(\): the schema of reply must be a validator /,
      });
    }
  });

  it("rejects a second @Doc", () => {
    class Orders {
      created() {}
    }
    Doc({ tags: ["a"] })(Orders);
    assert.throws(() => Doc({ tags: ["b"] })(Orders), {
      code: "CHO_MESSAGE_DUPLICATE_DECORATOR",
      message: "Cannot add @Doc() to class Orders: it already has one.",
    });
    legacy(Doc({ summary: "a" }), Orders, "created");
    assert.throws(() => legacy(Doc({ summary: "b" }), Orders, "created"), {
      code: "CHO_MESSAGE_DUPLICATE_DECORATOR",
      message: "Cannot add @Doc() to method created: it already has one.",
    });
  });
});

describe("the graph of an application with @Doc", () => {
  it("has the doc of each feature, controller and handler", async () => {
    const reply = { description: "The price", schema: Price };
    class Orders {
      price() {}
      created() {}
    }
    legacy(Subscribe("price"), Orders, "price");
    legacy(Doc({ summary: "The price of an order", reply }), Orders, "price");
    legacy(Subscribe("created"), Orders, "created");
    // above and below @Controller
    Doc({ tags: ["orders"] })(Orders);
    Controller({ topic: "orders" })(Orders);
    class Feature {}
    Module({ controllers: [Orders] })(Feature);
    Doc({ hidden: true })(Feature);

    const app = await ChoMessage.create(Feature);
    const [feature] = app.graph.features;
    assert.deepEqual(feature!.doc, { hidden: true });
    const [controller] = feature!.controllers;
    assert.deepEqual(controller!.doc, { tags: ["orders"] });
    const [price, created] = controller!.methods;
    assert.deepEqual(price!.doc, { summary: "The price of an order", reply });
    // nothing declared
    assert.deepEqual(created!.doc, {});
    await app.close();
  });

  it("changes nothing in how a message is handled", async () => {
    class Orders {
      price() {
        return "not a number";
      }
    }
    legacy(Subscribe("price"), Orders, "price");
    // the schema of the reply documents: it is not run
    const never = standard_schema<number>(() => {
      throw new Error("run");
    });
    legacy(Doc({ reply: { schema: never } }), Orders, "price");
    Controller()(Orders);
    class Feature {}
    Module({ controllers: [Orders] })(Feature);
    const app = await ChoMessage.create(Feature);
    const answer = await app.handle("price", { value: "" });
    assert.equal(new TextDecoder().decode(answer!.value), "not a number");
    await app.close();
  });

  it("refuses a schema for the reply of a handler whose contract has one", async () => {
    const GetPrice = contract({ topic: "orders.price", reply: Price });
    class Orders {
      price() {}
    }
    legacy(loose(Subscribe(GetPrice)), Orders, "price");
    legacy(Doc({ reply: { schema: Price } }), Orders, "price");
    Controller()(Orders);
    class Feature {}
    Module({ controllers: [Orders] })(Feature);
    await assert.rejects(ChoMessage.create(Feature), {
      code: "CHO_MESSAGE_INVALID_OPTION",
      message:
        '@Doc() on method price of controller Orders: the schema of its reply is the one of its contract. Remove "schema" from the "reply" option',
    });
  });

  it("takes a description for the reply of a contract, and a schema when the contract has none", async () => {
    const GetPrice = contract({ topic: "price", reply: Price });
    const Created = contract({ topic: "created" });
    class Orders {
      price() {}
      created() {}
    }
    legacy(loose(Subscribe(GetPrice)), Orders, "price");
    legacy(Doc({ reply: { description: "In cents" } }), Orders, "price");
    legacy(loose(Subscribe(Created)), Orders, "created");
    legacy(Doc({ reply: { schema: Price } }), Orders, "created");
    Controller()(Orders);
    class Feature {}
    Module({ controllers: [Orders] })(Feature);
    const app = await ChoMessage.create(Feature);
    const [price, created] = app.graph.features[0]!.controllers[0]!.methods;
    assert.deepEqual(price!.doc, { reply: { description: "In cents" } });
    assert.deepEqual(created!.doc, { reply: { schema: Price } });
    await app.close();
  });
});

describe("is_contract", () => {
  it("tells a contract from what looks like one", () => {
    assert.equal(is_contract(contract({ topic: "orders.created" })), true);
    assert.equal(is_contract({ topic: "orders.created" }), false);
    assert.equal(is_contract("orders.created"), false);
    assert.equal(is_contract(null), false);
  });
});
