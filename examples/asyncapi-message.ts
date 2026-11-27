#!/usr/bin/env -S deno run --allow-all
/**
 * The documentation of the consumers of an application, with
 * `@chojs/asyncapi`, and no broker to install.
 *
 * - `OrdersController` handles three topics. Two of them have a contract: one
 *   object that says the topic of a message, what it holds and what is
 *   replied. The third has its arguments, and `@Doc` says what it replies.
 * - The application is a web application first: `ChoWeb.create`. Its
 *   consumers are made on the same injector, with `ChoMessage.from`, so the
 *   two share one set of instances.
 * - `asyncApi` mounts the AsyncAPI document of the consumers on the web
 *   application, and a page that shows it. The page is made by the package:
 *   it loads nothing, and runs no script.
 *
 *   | Route                         | Answers      |
 *   | ----------------------------- | ------------ |
 *   | `GET /asyncapi`               | the page     |
 *   | `GET /asyncapi/asyncapi.json` | the document |
 *
 * The validators are written by hand, to need no library: `schema` gives a
 * Standard Schema, as `@chojs/message` wants, that also says its JSON Schema
 * (Standard JSON Schema). The schemas of Zod and of ArkType are both.
 *
 * There is no broker here, so the application is not started. With one, give
 * `ChoMessage.from` a linker, such as `KafkaLinker` of `@chojs/vendor-kafka`,
 * and call `app.start()`.
 *
 * Run it, and open http://localhost:8083/asyncapi
 *
 * @module
 */
import { ChoWeb, Module } from "@chojs/web";
import { serve } from "@chojs/web/serve";
import {
  Args,
  ChoMessage,
  contract,
  Controller,
  Doc,
  Header,
  Middlewares,
  type StandardJSONSchemaV1,
  type StandardSchemaV1,
  Subscribe,
  validate,
  Value,
} from "@chojs/message";
import { asyncApi } from "@chojs/asyncapi";

type Order = { id: string; items: string[] };
type OrderId = { id: string };
type Price = { id: string; cents: number };

/**
 * A validator that says its own JSON Schema. A schema library does both from
 * one declaration: with Zod, `z.object({ id: z.string() })` is enough.
 *
 * `check` says what is wrong with a value, or nothing when it is valid.
 */
function schema<T>(
  json: Record<string, unknown>,
  check: (value: Record<string, unknown>) => string | undefined,
): StandardSchemaV1<T, T> & StandardJSONSchemaV1<T, T> {
  return {
    "~standard": {
      version: 1,
      vendor: "example",
      validate: (value) => {
        const message = check((value ?? {}) as Record<string, unknown>);
        return message === undefined
          ? { value: value as T }
          : { issues: [{ message }] };
      },
      jsonSchema: { input: () => json, output: () => json },
    },
  };
}

const OrderSchema = schema<Order>(
  {
    type: "object",
    properties: {
      id: { type: "string", description: "The id of the order." },
      items: {
        type: "array",
        items: { type: "string" },
        minItems: 1,
        description: "What was ordered.",
      },
    },
    required: ["id", "items"],
  },
  (order) =>
    typeof order.id === "string" && Array.isArray(order.items)
      ? undefined
      : "An order has an id, and a list of items",
);

const OrderIdSchema = schema<OrderId>({
  type: "object",
  properties: { id: { type: "string" } },
  required: ["id"],
}, (order) => typeof order.id === "string" ? undefined : "An id is a string");

const PriceSchema = schema<Price>(
  {
    type: "object",
    properties: {
      id: { type: "string" },
      cents: { type: "integer", minimum: 0 },
    },
    required: ["id", "cents"],
  },
  (price) =>
    typeof price.cents === "number" ? undefined : "A price is in cents",
);

// The contracts: what this application and the other services share.

/** An order was created: no reply. */
const OrderCreated = contract({
  topic: "shop.orders.created",
  request: OrderSchema,
});

/** The price of an order: who asks gets a reply. */
const GetPrice = contract({
  topic: "shop.orders.price",
  request: OrderIdSchema,
  reply: PriceSchema,
});

/** What this application sends, when an order leaves. */
const OrderShipped = contract({
  topic: "shop.orders.shipped",
  request: OrderIdSchema,
});

@Doc({ tags: ["orders"] })
@Middlewares(validate())
@Controller({ topic: "shop.orders" })
class OrdersController {
  readonly #orders = new Map<string, Order>();

  @Doc({
    summary: "An order was created",
    description: "Keeps the order, for its price to be asked later.",
  })
  @Subscribe(OrderCreated)
  created(order: Order) {
    this.#orders.set(order.id, order);
    console.log(`order ${order.id}: ${order.items.length} item(s)`);
  }

  @Doc({
    summary: "The price of an order",
    reply: { description: "Ten cents for each item of the order." },
  })
  @Subscribe(GetPrice)
  price(asked: OrderId): Price {
    const order = this.#orders.get(asked.id);
    return { id: asked.id, cents: (order?.items.length ?? 0) * 10 };
  }

  // No contract: the topic, the arguments, and what `@Doc` says of the reply.
  @Doc({
    summary: "An order was cancelled",
    reply: {
      description: "Whether there was such an order.",
      schema: schema<boolean>({ type: "boolean" }, () => undefined),
    },
  })
  @Subscribe("cancelled")
  @Args(Value(OrderIdSchema), Header("reason"))
  cancelled(order: OrderId, reason: string | undefined) {
    console.log(`order ${order.id} cancelled: ${reason ?? "no reason"}`);
    return this.#orders.delete(order.id);
  }
}

@Module({ controllers: [OrdersController] })
export class AppModule {}

// The web application first: the consumers are made on its injector.
const web = await ChoWeb.create(AppModule);
const app = await ChoMessage.from(web.injector);

asyncApi(web, app, {
  info: {
    title: "Shop",
    version: "1.0.0",
    // shown as it is written: the page does not render Markdown
    description: "An example of @chojs/asyncapi.",
  },
  servers: {
    local: {
      host: "localhost:9092",
      protocol: "kafka",
      description: "The broker of a developer. This example does not need it.",
    },
  },
  tags: { orders: "The orders of the shop" },
  // The graph knows what the application handles, and not what it sends.
  sends: { orderShipped: OrderShipped },
});

// With no broker, a message is given to its handler by hand.
await app.handle("shop.orders.created", {
  value: JSON.stringify({ id: "42", items: ["tea", "cup"] }),
});
const reply = await app.handle("shop.orders.price", {
  value: JSON.stringify({ id: "42" }),
});
console.log("the price:", new TextDecoder().decode(reply?.value));

const server = await serve(web.handler, { port: 8083 });
console.log(`http://localhost:${server.port}/asyncapi`);
for (const route of web.routes) {
  console.log(`  ${route.method} ${route.path}`);
}
