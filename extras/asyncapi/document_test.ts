/**
 * Tests for `document.ts`: the AsyncAPI document of a message application,
 * from its graph.
 *
 * Decorators are applied as plain function calls.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  contract,
  Controller,
  Doc,
  Header,
  Key,
  Middlewares,
  Module,
  validate,
  Value,
} from "@chojs/message";
import { legacy, loose } from "@chojs/core/utils/test_utils";
import { asyncApiDocument } from "./document.ts";
import {
  args,
  type Class,
  controller,
  create,
  create_both,
  feature,
  plain,
  standard,
  subscribe,
} from "./testing.ts";

const INFO = { title: "Shop", version: "1.0.0" };

const ORDER = {
  type: "object",
  properties: { id: { type: "number" } },
  required: ["id"],
};
const PRICE = { type: "object", properties: { cents: { type: "integer" } } };

/** The document of the controllers, with no option but `info`. */
async function document_of(controllers: Class[], prefix = "") {
  const app = await create(feature(controllers), prefix);
  return asyncApiDocument(app, { info: INFO });
}

describe("asyncApiDocument, the document", () => {
  it("is AsyncAPI 3.0.0, with the info, and nothing it has not", async () => {
    const document = await document_of([
      controller("OrdersController", "orders", { created: ["created"] }),
    ]);
    assert.deepEqual(document, {
      asyncapi: "3.0.0",
      info: INFO,
      channels: {
        "orders.created": {
          address: "orders.created",
          messages: { message: { name: "orders.created" } },
        },
      },
      operations: {
        "OrdersController.created": {
          action: "receive",
          channel: { $ref: "#/channels/orders.created" },
          messages: [{ $ref: "#/channels/orders.created/messages/message" }],
          tags: [{ name: "Orders" }],
        },
      },
    });
  });

  it("is a new plain object each time, that can be changed and written as JSON", async () => {
    const app = await create(
      feature([controller("Orders", "orders", { created: ["created"] })]),
    );
    const info = { ...INFO, contact: { name: "Ada" } };
    const first = asyncApiDocument(app, { info });
    const second = asyncApiDocument(app, { info });
    assert.notEqual(first, second);
    first.info.contact!.name = "changed";
    assert.equal(info.contact.name, "Ada");
    assert.equal(second.info.contact!.name, "Ada");
    assert.deepEqual(JSON.parse(JSON.stringify(second)), second);
  });

  it("writes the options that are for the whole document", async () => {
    const app = await create(feature([]));
    const servers = {
      production: {
        host: "kafka.example.com:9092",
        protocol: "kafka",
        description: "The production broker",
        security: [{ type: "plain" }],
      },
    };
    const document = asyncApiDocument(app, {
      info: INFO,
      id: "urn:example:shop",
      servers,
      tags: { orders: "The orders of the shop" },
      externalDocs: { url: "https://example.com/docs" },
    });
    assert.equal(document.id, "urn:example:shop");
    assert.deepEqual(document.servers, servers);
    assert.notEqual(document.servers!.production, servers.production);
    assert.deepEqual(document.info, {
      ...INFO,
      tags: [{ name: "orders", description: "The orders of the shop" }],
      externalDocs: { url: "https://example.com/docs" },
    });
    assert.deepEqual([document.channels, document.operations], [{}, {}]);
    assert.equal("components" in document, false);
  });
});

describe("asyncApiDocument, the channels and the operations", () => {
  it("joins the four levels of a topic, the prefix first", async () => {
    const Orders = controller("Orders", "orders", {
      created: ["created"],
      all: [""],
    });
    const app = await create(feature([Orders], "shop"), "staging");
    const document = asyncApiDocument(app, { info: INFO });
    assert.deepEqual(Object.keys(document.channels), [
      "staging.shop.orders.created",
      "staging.shop.orders",
    ]);
    assert.equal(
      document.channels["staging.shop.orders"]!.address,
      "staging.shop.orders",
    );
    assert.deepEqual(document.operations["Orders.all"]!.channel, {
      $ref: "#/channels/staging.shop.orders",
    });
  });

  it("names an operation by its controller and its method, or by its operationId", async () => {
    const document = await document_of([
      controller("Orders", "orders", {
        created: ["created"],
        price: ["price", loose(Doc({ operationId: "getPrice" }))],
      }),
    ]);
    assert.deepEqual(Object.keys(document.operations), [
      "Orders.created",
      "getPrice",
    ]);
  });

  it("writes the summary and the description of a handler", async () => {
    const document = await document_of([
      controller("Orders", "orders", {
        created: [
          "created",
          loose(Doc({ summary: "An order", description: "It was created." })),
        ],
      }),
    ]);
    const operation = document.operations["Orders.created"]!;
    assert.equal(operation.summary, "An order");
    assert.equal(operation.description, "It was created.");
  });

  it("adds up the tags of the feature, the controller and the handler, each once", async () => {
    const Orders = controller("Orders", "orders", {
      created: ["created", loose(Doc({ tags: ["events", "shop"] }))],
      price: ["price"],
    });
    Doc({ tags: ["orders"] })(Orders);
    const Feature = feature([Orders]);
    Doc({ tags: ["shop"] })(Feature);
    const app = await create(Feature);
    const { operations } = asyncApiDocument(app, { info: INFO });
    assert.deepEqual(operations["Orders.created"]!.tags, [
      { name: "shop" },
      { name: "orders" },
      { name: "events" },
    ]);
    assert.deepEqual(operations["Orders.price"]!.tags, [
      { name: "shop" },
      { name: "orders" },
    ]);
  });

  it("tags a handler with no tag by its controller, without a Controller suffix", async () => {
    const { operations } = await document_of([
      controller("OrdersController", "a", { one: ["one"] }),
      controller("Payments", "b", { one: ["one"] }),
      controller("Controller", "c", { one: ["one"] }),
    ]);
    assert.deepEqual(
      Object.values(operations).map((operation) => operation.tags),
      [[{ name: "Orders" }], [{ name: "Payments" }], [{ name: "Controller" }]],
    );
  });

  it("leaves out what is hidden: a handler, a controller, a feature", async () => {
    const Orders = controller("Orders", "orders", {
      created: ["created"],
      secret: ["secret", loose(Doc({ hidden: true }))],
    });
    const Internal = controller("Internal", "internal", { ping: ["ping"] });
    Doc({ hidden: true })(Internal);
    const Hidden = feature([controller("Jobs", "jobs", { run: ["run"] })]);
    Doc({ hidden: true })(Hidden);
    class App {}
    Module({ imports: [Hidden], controllers: [Orders, Internal] })(App);
    const document = asyncApiDocument(await create(App), { info: INFO });
    assert.deepEqual(Object.keys(document.channels), ["orders.created"]);
    assert.deepEqual(Object.keys(document.operations), ["Orders.created"]);
  });

  it("refuses two operations with one id", async () => {
    const One = controller("Orders", "one", { created: ["created"] });
    const Two = controller("Orders", "two", { created: ["created"] });
    const app = await create(feature([One, Two]));
    assert.throws(() => asyncApiDocument(app, { info: INFO }), {
      code: "CHO_ASYNCAPI_DUPLICATE_OPERATION_ID",
      message:
        'asyncApiDocument(): the operation id "Orders.created" is used by Orders.created and Orders.created',
    });
    const named = await create(feature([
      controller("Orders", "one", { created: ["created"] }),
      controller("Payments", "two", {
        paid: ["paid", loose(Doc({ operationId: "Orders.created" }))],
      }),
    ]));
    assert.throws(() => asyncApiDocument(named, { info: INFO }), {
      code: "CHO_ASYNCAPI_DUPLICATE_OPERATION_ID",
      message:
        'asyncApiDocument(): the operation id "Orders.created" is used by Orders.created and Payments.paid',
    });
  });

  it("reads the consumers of a web application, made on its injector", async () => {
    const { web, app } = await create_both(
      feature([controller("Orders", "orders", { created: ["created"] })]),
    );
    const document = asyncApiDocument(app, { info: INFO });
    assert.deepEqual(Object.keys(document.channels), ["orders.created"]);
    await app.close();
    await web.close();
  });
});

describe("asyncApiDocument, the message of a handler", () => {
  /** The message of a handler with the given arguments. */
  async function message_of(...list: unknown[]) {
    const document = await document_of([
      controller("Orders", "orders", { created: ["created", args(...list)] }),
    ]);
    return {
      message: document.channels["orders.created"]!.messages.message!,
      document,
    };
  }

  it("has the schema of Value(v) as its payload, as JSON", async () => {
    const calls: string[] = [];
    const { message } = await message_of(Value(standard(ORDER, PRICE, calls)));
    assert.deepEqual(message, {
      name: "orders.created",
      contentType: "application/json",
      payload: ORDER,
    });
    // what is on the wire, in the dialect of AsyncAPI
    assert.deepEqual(calls, ["input draft-07"]);
  });

  it("has JSON and no payload for a Value with no schema", async () => {
    for (const value of [Value(), Value(plain())]) {
      const { message } = await message_of(value);
      assert.deepEqual(message, {
        name: "orders.created",
        contentType: "application/json",
      });
    }
  });

  it("makes an object of the properties read by their name, none required", async () => {
    const { message } = await message_of(
      Value("id", standard({ type: "number" })),
      Value("note"),
      Value("id", standard({ type: "string" })),
    );
    assert.deepEqual(message.payload, {
      type: "object",
      properties: { id: { type: "number" }, note: {} },
    });
  });

  it("takes the whole value before its properties", async () => {
    const { message } = await message_of(
      Value("id", standard({ type: "number" })),
      Value(standard(ORDER)),
    );
    assert.deepEqual(message.payload, ORDER);
  });

  it("has a property of the headers for each Header read by its name", async () => {
    const { message } = await message_of(
      Header("tenant"),
      Header("attempt", standard({ type: "integer" })),
    );
    assert.deepEqual(message, {
      name: "orders.created",
      headers: {
        type: "object",
        properties: {
          tenant: { type: "string" },
          attempt: { type: "integer" },
        },
      },
    });
  });

  it("has the schema of Header(v) as its headers, when it is an object", async () => {
    const whole = {
      type: "object",
      properties: { tenant: { type: "string", minLength: 1 } },
      required: ["tenant"],
    };
    const { message } = await message_of(
      Header(standard(whole)),
      Header("tenant"),
      Header("trace"),
    );
    assert.deepEqual(message.headers, {
      type: "object",
      properties: {
        trace: { type: "string" },
        tenant: { type: "string", minLength: 1 },
      },
      required: ["tenant"],
    });
    for (const header of [Header(), Header(standard({ type: "string" }))]) {
      assert.equal("headers" in (await message_of(header)).message, false);
    }
  });

  it("writes the key as the x-key extension", async () => {
    assert.deepEqual((await message_of(Key())).message, {
      name: "orders.created",
      "x-key": { type: "string" },
    });
    assert.deepEqual(
      (await message_of(Key(standard({ type: "string", format: "uuid" }))))
        .message["x-key"],
      { type: "string", format: "uuid" },
    );
  });

  it("says nothing of an argument of the application's own, or of no argument", async () => {
    const own = () => "tenant";
    assert.deepEqual((await message_of(own)).message, {
      name: "orders.created",
    });
    assert.deepEqual((await message_of()).message, { name: "orders.created" });
  });

  it("documents a handler that validate() does not cover the same", async () => {
    const order = Value(standard(ORDER));
    const Checked = controller("Checked", "a", { one: ["one", args(order)] });
    Middlewares(loose(validate()))(Checked);
    const Loose = controller("Loose", "b", { one: ["one", args(order)] });
    const { channels } = await document_of([Checked, Loose]);
    assert.deepEqual(
      channels["a.one"]!.messages.message!.payload,
      channels["b.one"]!.messages.message!.payload,
    );
  });

  it("moves the definitions of a schema to the components", async () => {
    const order = standard({
      type: "object",
      properties: { item: { $ref: "#/definitions/Item" } },
      definitions: { Item: { type: "object", properties: { sku: {} } } },
    });
    const { message, document } = await message_of(Value(order));
    assert.deepEqual(message.payload, {
      type: "object",
      properties: { item: { $ref: "#/components/schemas/Item" } },
    });
    assert.deepEqual(document.components, {
      schemas: { Item: { type: "object", properties: { sku: {} } } },
    });
  });

  it("converts a validator once, however many handlers use it", async () => {
    const calls: string[] = [];
    const order = Value(standard(ORDER, ORDER, calls));
    const document = await document_of([
      controller("Orders", "orders", {
        created: ["created", args(order)],
        changed: ["changed", args(order)],
      }),
    ]);
    assert.deepEqual(calls, ["input draft-07"]);
    const { messages: created } = document.channels["orders.created"]!;
    const { messages: changed } = document.channels["orders.changed"]!;
    assert.deepEqual(created.message!.payload, changed.message!.payload);
    // each use has a copy of its own
    assert.notEqual(created.message!.payload, changed.message!.payload);
  });

  it("asks toJsonSchema for a validator that gives no schema", async () => {
    const order = plain();
    const app = await create(feature([
      controller("Orders", "orders", {
        created: ["created", args(Value(order))],
      }),
    ]));
    const seen: unknown[] = [];
    const document = asyncApiDocument(app, {
      info: INFO,
      toJsonSchema: (validator, io) => {
        seen.push([validator === order, io]);
        return ORDER;
      },
    });
    assert.deepEqual(seen, [[true, "input"]]);
    assert.deepEqual(
      document.channels["orders.created"]!.messages.message!.payload,
      ORDER,
    );
  });
});

describe("asyncApiDocument, the reply of a handler", () => {
  it("has the reply of a contract, in a channel of its own with no address", async () => {
    const GetPrice = contract({
      topic: "orders.price",
      request: standard(ORDER),
      reply: standard(PRICE, ORDER),
    });
    const document = await document_of([
      controller("Orders", "orders", { price: [GetPrice] }),
    ], "staging");
    assert.deepEqual(document.channels, {
      "staging.orders.price": {
        address: "staging.orders.price",
        messages: {
          message: {
            name: "staging.orders.price",
            contentType: "application/json",
            payload: ORDER,
          },
        },
      },
      "staging.orders.price/reply": {
        address: null,
        messages: {
          reply: {
            name: "staging.orders.price.reply",
            contentType: "application/json",
            // what the handler returns, before who asked converts it
            payload: PRICE,
          },
        },
      },
    });
    assert.deepEqual(document.operations["Orders.price"]!.reply, {
      channel: { $ref: "#/channels/staging.orders.price~1reply" },
      messages: [
        { $ref: "#/channels/staging.orders.price~1reply/messages/reply" },
      ],
    });
  });

  it("has no reply for a contract with none, and for a handler that says none", async () => {
    const Created = contract({ topic: "orders.created" });
    const document = await document_of([
      controller("Orders", "orders", { created: [Created], other: ["other"] }),
    ]);
    assert.deepEqual(Object.keys(document.channels), [
      "orders.created",
      "orders.other",
    ]);
    assert.equal("reply" in document.operations["Orders.created"]!, false);
    assert.equal("reply" in document.operations["Orders.other"]!, false);
  });

  it("has the reply @Doc declares, for a handler with no contract", async () => {
    const reply = {
      description: "The price, in cents",
      schema: standard(PRICE),
    };
    const document = await document_of([
      controller("Orders", "orders", {
        price: ["price", loose(Doc({ reply }))],
        ping: ["ping", loose(Doc({ reply: {} }))],
      }),
    ]);
    // nothing says how the reply of such a handler is encoded
    assert.deepEqual(document.channels["orders.price/reply"], {
      address: null,
      messages: {
        reply: {
          name: "orders.price.reply",
          description: "The price, in cents",
          payload: PRICE,
        },
      },
    });
    assert.deepEqual(document.channels["orders.ping/reply"], {
      address: null,
      messages: { reply: { name: "orders.ping.reply" } },
    });
    assert.ok(document.operations["Orders.ping"]!.reply);
  });

  it("adds the description of @Doc to the reply of a contract", async () => {
    const GetPrice = contract({
      topic: "orders.price",
      reply: standard(PRICE),
    });
    const document = await document_of([
      controller("Orders", "orders", {
        price: [GetPrice, loose(Doc({ reply: { description: "In cents" } }))],
      }),
    ]);
    assert.deepEqual(document.channels["orders.price/reply"]!.messages.reply, {
      name: "orders.price.reply",
      description: "In cents",
      contentType: "application/json",
      payload: PRICE,
    });
  });
});

describe("asyncApiDocument, what the application sends", () => {
  const Shipped = contract({
    topic: "orders.shipped",
    request: standard(ORDER),
  });
  const GetStock = contract({
    topic: "stock.get",
    request: standard(ORDER),
    reply: standard(PRICE),
  });

  it("has a send operation for each contract of the sends option", async () => {
    const app = await create(feature([]), "staging");
    const document = asyncApiDocument(app, {
      info: INFO,
      sends: { orderShipped: Shipped, getStock: GetStock },
    });
    assert.deepEqual(document.operations, {
      orderShipped: {
        action: "send",
        channel: { $ref: "#/channels/staging.orders.shipped" },
        messages: [
          { $ref: "#/channels/staging.orders.shipped/messages/message" },
        ],
      },
      getStock: {
        action: "send",
        channel: { $ref: "#/channels/staging.stock.get" },
        messages: [{ $ref: "#/channels/staging.stock.get/messages/message" }],
        reply: {
          channel: { $ref: "#/channels/staging.stock.get~1reply" },
          messages: [
            { $ref: "#/channels/staging.stock.get~1reply/messages/reply" },
          ],
        },
      },
    });
    assert.deepEqual(document.channels["staging.orders.shipped"], {
      address: "staging.orders.shipped",
      messages: {
        message: {
          name: "staging.orders.shipped",
          contentType: "application/json",
          payload: ORDER,
        },
      },
    });
    assert.deepEqual(
      document.channels["staging.stock.get/reply"]!.messages.reply!.payload,
      PRICE,
    );
  });

  it("has JSON and no payload for a contract with no request", async () => {
    const app = await create(feature([]));
    const document = asyncApiDocument(app, {
      info: INFO,
      sends: { ping: contract({ topic: "ping" }) },
    });
    assert.deepEqual(document.channels.ping!.messages.message, {
      name: "ping",
      contentType: "application/json",
    });
  });

  it("has one channel, and two operations, for a topic that is handled and sent", async () => {
    const app = await create(feature([
      controller("Stock", "", { get: [GetStock] }),
    ]));
    const document = asyncApiDocument(app, {
      info: INFO,
      sends: { getStock: GetStock },
    });
    assert.deepEqual(Object.keys(document.channels), [
      "stock.get",
      "stock.get/reply",
    ]);
    assert.deepEqual(
      Object.values(document.operations).map((operation) => [
        operation.action,
        operation.channel.$ref,
        operation.reply?.channel.$ref,
      ]),
      [
        ["receive", "#/channels/stock.get", "#/channels/stock.get~1reply"],
        ["send", "#/channels/stock.get", "#/channels/stock.get~1reply"],
      ],
    );
  });

  it("refuses a name a handler has, as the id of its operation", async () => {
    const app = await create(feature([
      controller("Orders", "orders", {
        shipped: ["sent", loose(Doc({ operationId: "orderShipped" }))],
      }),
    ]));
    assert.throws(
      () =>
        asyncApiDocument(app, { info: INFO, sends: { orderShipped: Shipped } }),
      {
        code: "CHO_ASYNCAPI_DUPLICATE_OPERATION_ID",
        message:
          'asyncApiDocument(): the operation id "orderShipped" is used by Orders.shipped and "orderShipped" of the "sends" option',
      },
    );
  });
});

describe("asyncApiDocument, mistakes", () => {
  it("needs a message application", () => {
    for (const not_one of [undefined, null, {}, { graph: {} }, "app"]) {
      assert.throws(() => asyncApiDocument(loose(not_one), { info: INFO }), {
        code: "CHO_ASYNCAPI_INVALID_OPTION",
        message:
          /^asyncApiDocument\(\): expected a message application, made by ChoMessage\.create or ChoMessage\.from, got /,
      });
    }
  });

  it("needs options, with the title and the version of info", async () => {
    const app = await create(feature([]));
    for (const none of [undefined, null, "Shop", []]) {
      assert.throws(() => asyncApiDocument(app, loose(none)), {
        code: "CHO_ASYNCAPI_INVALID_OPTION",
        message:
          'asyncApiDocument(): expected options, such as { info: { title: "My application", version: "1.0.0" } }',
      });
    }
    for (
      const info of [
        undefined,
        "Shop",
        {},
        { title: "Shop" },
        { version: "1.0.0" },
        { title: "", version: "1.0.0" },
        { title: "Shop", version: 1 },
      ]
    ) {
      assert.throws(() => asyncApiDocument(app, loose({ info })), {
        code: "CHO_ASYNCAPI_INVALID_OPTION",
        message:
          'asyncApiDocument(): the "info" option is required: { title: "My application", version: "1.0.0" }',
      });
    }
  });

  it("refuses an unknown option, and names the known ones", async () => {
    const app = await create(feature([]));
    assert.throws(
      () => asyncApiDocument(app, loose({ info: INFO, security: [] })),
      {
        code: "CHO_CORE_UNKNOWN_OPTION",
        message:
          'asyncApiDocument(): unknown option "security". Known options: externalDocs, id, info, sends, servers, tags, toJsonSchema',
      },
    );
  });

  it("refuses a server with no host or no protocol", async () => {
    const app = await create(feature([]));
    assert.throws(
      () => asyncApiDocument(app, loose({ info: INFO, servers: ["kafka"] })),
      {
        code: "CHO_ASYNCAPI_INVALID_OPTION",
        message:
          /^asyncApiDocument\(\): the "servers" option is an object of servers, by name, such as /,
      },
    );
    for (
      const server of [
        "kafka:9092",
        { host: "kafka:9092" },
        { protocol: "kafka" },
        { host: "", protocol: "kafka" },
      ]
    ) {
      assert.throws(
        () =>
          asyncApiDocument(
            app,
            loose({ info: INFO, servers: { main: server } }),
          ),
        {
          code: "CHO_ASYNCAPI_INVALID_OPTION",
          message:
            'asyncApiDocument(): the server "main" needs a host and a protocol: { host: "kafka:9092", protocol: "kafka" }',
        },
      );
    }
  });

  it("refuses what is not a contract in the sends option", async () => {
    const app = await create(feature([]));
    assert.throws(
      () => asyncApiDocument(app, loose({ info: INFO, sends: ["orders"] })),
      {
        code: "CHO_ASYNCAPI_INVALID_OPTION",
        message:
          /^asyncApiDocument\(\): the "sends" option is an object of contracts, by the id of the operation, such as /,
      },
    );
    for (const sent of ["orders.shipped", { topic: "orders.shipped" }, null]) {
      assert.throws(
        () =>
          asyncApiDocument(
            app,
            loose({ info: INFO, sends: { shipped: sent } }),
          ),
        {
          code: "CHO_ASYNCAPI_INVALID_OPTION",
          message:
            /^asyncApiDocument\(\): "shipped" of the "sends" option must be a contract, made by contract\(\), got /,
        },
      );
    }
  });

  it("uses a handler whose class was decorated by hand", async () => {
    class Orders {
      created() {}
    }
    legacy(subscribe("created"), Orders, "created");
    Controller({ topic: "orders" })(Orders);
    const document = await document_of([Orders]);
    assert.deepEqual(Object.keys(document.operations), ["Orders.created"]);
  });
});
