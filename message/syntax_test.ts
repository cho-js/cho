/**
 * The decorators of `@chojs/message`, applied with decorator **syntax**, end
 * to end.
 *
 * Every other test applies decorators as plain function calls. This file is
 * the exception: it checks that the syntax itself works on each runtime's own
 * decorator implementation (Deno, Bun, and Node.js through `tsx`), which no
 * function call can show.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { standard_schema } from "@chojs/core/utils/test_utils";
import {
  Args,
  Catch,
  ChoMessage,
  type ChoMessageArg,
  ChoMessageClient,
  type ChoMessageContext,
  type ChoMessageMiddlewareFn,
  ChoMessageReply,
  type ChoValidator,
  contract,
  Controller,
  Doc,
  Header,
  Injectable,
  Key,
  type Linked,
  type Linker,
  localSender,
  Middlewares,
  Module,
  provider,
  ReplyError,
  type Route,
  Subscribe,
  token,
  validate,
  Value,
} from "./mod.ts";

const seen: string[] = [];

const SHOP = token<string>("shop");

@Injectable([SHOP])
class Mailer {
  constructor(readonly shop: string) {}
  confirm(order: { id: string }) {
    seen.push(`mail from ${this.shop} for ${order.id}`);
  }
}

@Injectable()
class Audit {
  async handle(ctx: ChoMessageContext, next: () => Promise<void>) {
    seen.push(`audit ${ctx.topic}`);
    await next();
  }
}

const once: ChoMessageMiddlewareFn = (ctx, next) => {
  if (ctx.headers["seen"] === "yes") {
    seen.push(`dropped ${ctx.key}`);
    return; // handled before: skip the handler
  }
  return next();
};

@Catch((error, ctx) => {
  seen.push(`controller caught ${error} on ${ctx.topic}`);
})
@Middlewares(Audit)
@Controller({ topic: "orders", dependencies: [Mailer] })
class OrdersController {
  constructor(readonly mailer: Mailer) {}

  @Middlewares(once)
  @Subscribe("created")
  created(ctx: ChoMessageContext) {
    this.mailer.confirm(ctx.json<{ id: string }>());
  }

  @Subscribe("cancelled")
  async cancelled(ctx: ChoMessageContext) {
    await Promise.resolve();
    seen.push(`cancelled ${ctx.key}`);
  }

  @Catch((error) => {
    seen.push(`handler caught ${error}`);
    return error instanceof SyntaxError;
  })
  @Subscribe("refunded")
  refunded(ctx: ChoMessageContext) {
    ctx.json();
    throw new Error("no refunds");
  }

  @Subscribe("lost")
  lost() {
    throw new Error("lost");
  }

  helper() {}
}

@Controller()
class PaymentsController {
  @Subscribe("payments-settled")
  settled(ctx: ChoMessageContext) {
    seen.push(`settled ${ctx.text()}`);
  }
}

@Module({ topic: "billing", controllers: [PaymentsController] })
class BillingModule {}

@Module({
  topic: "shop",
  imports: [BillingModule],
  providers: [
    provider({ provide: SHOP, factory: () => "acme" }),
    Mailer,
    Audit,
  ],
  controllers: [OrdersController],
})
class App {}

/** A linker that keeps its messages in memory. */
class MemoryLinker implements Linker<Map<string, Route>> {
  link(routes: readonly Route[]): Linked<Map<string, Route>> {
    const topics = new Map<string, Route>();
    return {
      instance: topics,
      start: () => {
        for (const route of routes) {
          topics.set(route.topic, route);
        }
        return Promise.resolve();
      },
      stop: () => {
        topics.clear();
        return Promise.resolve();
      },
    };
  }
}

describe("decorator syntax", () => {
  it("declares the topics of an application", async () => {
    const app = await ChoMessage.create(App, { prefix: "staging" });
    assert.deepEqual(
      app.routes.map((route) => `${route.topic} -> ${route.name}`).sort(),
      [
        "staging.billing.payments-settled -> PaymentsController.settled",
        "staging.shop.orders.cancelled -> OrdersController.cancelled",
        "staging.shop.orders.created -> OrdersController.created",
        "staging.shop.orders.lost -> OrdersController.lost",
        "staging.shop.orders.refunded -> OrdersController.refunded",
      ],
    );
    await app.close();
  });

  it("handles messages through middlewares, handlers and error handlers", async () => {
    seen.length = 0;
    await using app = await ChoMessage.create(App);

    await app.handle("shop.orders.created", { value: '{"id":"42"}' });
    await app.handle("shop.orders.created", {
      key: "43",
      headers: { seen: "yes" },
    });
    await app.handle("shop.orders.cancelled", { key: "44" });
    await app.handle("billing.payments-settled", { value: "9.99" });
    assert.deepEqual(seen, [
      "audit shop.orders.created",
      "mail from acme for 42",
      "audit shop.orders.created",
      "dropped 43",
      "audit shop.orders.cancelled",
      "cancelled 44",
      "settled 9.99",
    ]);
  });

  it("settles a failed message with the nearest error handler", async () => {
    seen.length = 0;
    await using app = await ChoMessage.create(App);

    // not JSON: the handler's own @Catch returns true, the message is handled
    await app.handle("shop.orders.refunded", { value: "{" });
    // another error: it returns false, the message failed
    await assert.rejects(
      app.handle("shop.orders.refunded", { value: "{}" }),
      { message: "no refunds" },
    );
    // the controller's @Catch returns nothing: the message failed
    await assert.rejects(app.handle("shop.orders.lost"), { message: "lost" });

    assert.equal(
      seen.filter((line) => line.startsWith("handler caught")).length,
      2,
    );
    assert.deepEqual(
      seen.at(-1),
      "controller caught Error: lost on shop.orders.lost",
    );
  });

  it("delivers the messages of a linker", async () => {
    seen.length = 0;
    const app = await ChoMessage.create(App, { linker: new MemoryLinker() });
    const topics = app.linked.instance;
    assert.equal(topics.size, 0);
    await app.start();
    assert.equal(topics.size, 5);

    await topics.get("shop.orders.cancelled")!.handle({ key: "7" }, {
      offset: 1,
    });
    assert.deepEqual(seen, ["audit shop.orders.cancelled", "cancelled 7"]);

    await app.close();
    assert.equal(topics.size, 0);
  });
});

type NewOrder = { id: number; items: string[] };

/** A validator that gives a `NewOrder`, or throws. */
const NewOrder: ChoValidator<NewOrder> = {
  parse(value) {
    const { id, items } = (value ?? {}) as Record<string, unknown>;
    if (!Number.isInteger(Number(id)) || !Array.isArray(items)) {
      throw new Error("not an order");
    }
    return { id: Number(id), items: items.map(String) };
  },
};

/** An argument of the application's own. */
const Topic: ChoMessageArg<string> = (ctx) => ctx.topic;

describe("@Args, with decorator syntax", () => {
  @Middlewares(validate())
  @Controller({ topic: "orders" })
  class Orders {
    @Subscribe("created")
    @Args(Value(NewOrder), Key(), Header("tenant"), Topic)
    created(
      order: NewOrder,
      key: string | undefined,
      tenant: string | undefined,
      topic: string,
      ctx: ChoMessageContext,
    ) {
      return { order, key, tenant, topic, attempt: ctx.headers["attempt"] };
    }

    @Args(Value<{ id: string }>("order"), Header())
    @Subscribe("cancelled")
    cancelled(
      order: { id: string },
      headers: Readonly<Record<string, string>>,
    ) {
      return [order.id, Object.keys(headers)];
    }

    @Subscribe("plain") // no @Args: the context alone
    plain(ctx: ChoMessageContext) {
      return ctx.text();
    }
  }

  @Module({ controllers: [Orders] })
  class OrdersApp {}

  const reply_of = async (
    topic: string,
    message: Parameters<
      ChoMessage<unknown>["handle"]
    >[1],
  ) => {
    const app = await ChoMessage.create(OrdersApp);
    const reply = await app.handle(topic, message);
    return reply && JSON.parse(new TextDecoder().decode(reply.value));
  };

  it("calls a handler with the values of its arguments, validated", async () => {
    assert.deepEqual(
      await reply_of("orders.created", {
        value: '{"id":"7","items":[1,2]}',
        key: "k1",
        headers: { tenant: "acme", attempt: "2" },
      }),
      {
        order: { id: 7, items: ["1", "2"] },
        key: "k1",
        tenant: "acme",
        topic: "orders.created",
        attempt: "2",
      },
    );
    assert.deepEqual(
      await reply_of("orders.cancelled", {
        value: '{"order":{"id":"9"}}',
        headers: { a: "1" },
      }),
      ["9", ["a"]],
    );
    assert.equal(await reply_of("orders.plain", { value: '"text"' }), "text");
  });

  it("fails a message that is not valid", async () => {
    await assert.rejects(
      reply_of("orders.created", { value: '{"id":"x"}' }),
      { code: "CHO_MESSAGE_INVALID_MESSAGE" },
    );
  });

  it("checks the parameters against the arguments, at compile time", () => {
    // Type-only: never called, so the classes are never defined.
    const _check = () => {
      class Wrong {
        // @ts-expect-error the validator gives a NewOrder
        @Args(Value(NewOrder))
        @Subscribe("a")
        a(_order: { id: string }) {}

        // @ts-expect-error a key can be undefined
        @Args(Key())
        @Subscribe("b")
        b(_key: string) {}

        // @ts-expect-error the context comes last
        @Args(Key())
        @Subscribe("c")
        c(_ctx: ChoMessageContext, _key: string | undefined) {}

        // @ts-expect-error without a validator, the value is unknown
        @Args(Value())
        @Subscribe("d")
        d(_order: NewOrder) {}

        // @ts-expect-error a header is a string, or undefined
        @Args(Header("attempt"))
        @Subscribe("e")
        e(_attempt: number) {}

        // @ts-expect-error a parameter with no argument
        @Args(Key())
        @Subscribe("f")
        f(
          _key: string | undefined,
          _order: NewOrder,
          _ctx: ChoMessageContext,
        ) {}

        // A handler can leave the context out, and take a wider type.
        @Args(Value(NewOrder), Key())
        @Subscribe("g")
        g(_order: { id: number }, _key: unknown) {}

        // A type given by hand is a promise of the caller.
        @Args(Value<NewOrder>(), Value<number>("id"))
        @Subscribe("h")
        h(_order: NewOrder, _id: number, _ctx: ChoMessageContext) {}
      }
      return Wrong;
    };
    assert.equal(typeof _check, "function");
  });
});

type Price = { id: number; price: number };

/** A validator that gives a `Price`, or throws. */
const IsPrice: ChoValidator<Price> = {
  parse(value) {
    const { id, price } = (value ?? {}) as Record<string, unknown>;
    if (typeof id !== "number" || typeof price !== "number") {
      throw new Error("not a price");
    }
    return { id, price };
  },
};

const GetPrice = contract({
  topic: "shop.orders.price",
  request: NewOrder,
  reply: IsPrice,
});
const OrderCreated = contract({
  topic: "shop.orders.created",
  request: NewOrder,
});
const Echo = contract<string, string>({ topic: "shop.echo" });

describe("@Subscribe(contract), with decorator syntax", () => {
  const created: NewOrder[] = [];

  @Doc({ tags: ["orders"] })
  @Middlewares(validate())
  @Controller({ topic: "orders" })
  class Orders {
    @Doc({ summary: "The price of an order", reply: { description: "Cents" } })
    @Subscribe(GetPrice)
    price(order: NewOrder, ctx: ChoMessageContext): Price {
      if (order.id === 404) {
        throw new ReplyError(404, "Not Found");
      }
      return {
        id: order.id,
        price: order.items.length * 10 + ctx.value.length * 0,
      };
    }

    @Subscribe(OrderCreated)
    async created(order: NewOrder) {
      await Promise.resolve();
      created.push(order);
    }
  }

  @Controller()
  class Tools {
    @Subscribe(Echo)
    echo(text: string) {
      return new ChoMessageReply(text.toUpperCase(), {
        headers: { length: String(text.length) },
      });
    }
  }

  @Module({ topic: "shop", controllers: [Orders, Tools] })
  class Shop {}

  it("keeps what @Doc declares, on a class and on a method", async () => {
    const app = await ChoMessage.create(Shop);
    const [orders] = app.graph.features[0]!.controllers;
    assert.deepEqual(orders!.doc, { tags: ["orders"] });
    assert.deepEqual(orders!.methods[0]!.doc, {
      summary: "The price of an order",
      reply: { description: "Cents" },
    });
    await app.close();
  });

  it("handles the topic of each contract, and answers a client with typed replies", async () => {
    const app = await ChoMessage.create(Shop, { prefix: "staging" });
    assert.deepEqual(app.routes.map((route) => route.topic).sort(), [
      "staging.shop.echo",
      "staging.shop.orders.created",
      "staging.shop.orders.price",
    ]);
    const client = new ChoMessageClient(localSender(app), {
      prefix: "staging",
    });

    const price: Price = await client.request(GetPrice, {
      id: 7,
      items: ["a", "b"],
    });
    assert.deepEqual(price, { id: 7, price: 20 });

    const echo: string = await client.request(Echo, "hello");
    assert.equal(echo, "HELLO");

    await client.publish(OrderCreated, { id: 8, items: [] });
    assert.deepEqual(created, [{ id: 8, items: [] }]);

    await assert.rejects(
      client.request(GetPrice, { id: 404, items: [] }),
      { name: "ReplyError", code: 404, message: "Not Found" },
    );
  });

  it("checks the handler, and what a client sends, at compile time", () => {
    // Type-only: never called, so the classes are never defined.
    const _check = async (client: ChoMessageClient) => {
      class Wrong {
        // @ts-expect-error the request is a NewOrder
        @Subscribe(GetPrice)
        a(_order: { id: string }): Price {
          return { id: 1, price: 1 };
        }

        // @ts-expect-error the reply is a Price
        @Subscribe(GetPrice)
        b(_order: NewOrder) {
          return { id: 1 };
        }

        // @ts-expect-error a contract with a reply does not return nothing
        @Subscribe(GetPrice)
        c(_order: NewOrder) {}

        // @ts-expect-error the context comes after the request
        @Subscribe(GetPrice)
        d(_ctx: ChoMessageContext, _order: NewOrder): Price {
          return { id: 1, price: 1 };
        }

        // @ts-expect-error a contract with no reply does not return a value
        @Subscribe(OrderCreated)
        e(_order: NewOrder) {
          return 42;
        }

        // A handler can leave its parameters out, and be asynchronous.
        @Subscribe(GetPrice)
        f(): Promise<Price> {
          return Promise.resolve({ id: 1, price: 1 });
        }

        // A reply with headers is always accepted.
        @Subscribe(GetPrice)
        g(_order: NewOrder) {
          return new ChoMessageReply({ id: 1, price: 1 });
        }
      }

      // @ts-expect-error the value is a NewOrder
      await client.request(GetPrice, { id: "7" });
      // @ts-expect-error a contract with a request needs a value
      await client.request(GetPrice);
      // @ts-expect-error the reply is a Price, not a string
      const _text: string = await client.request(GetPrice, {
        id: 1,
        items: [],
      });
      // @ts-expect-error the value is a NewOrder
      await client.publish(OrderCreated, "order");
      // The reply of a contract with none is undefined.
      const _none: undefined = await client.request(OrderCreated, {
        id: 1,
        items: [],
      });
      return [Wrong, _text, _none];
    };
    assert.equal(typeof _check, "function");
  });
});

/** What who asks sends: the note can be left out. */
type Draft = { id: number; note?: string };
/** What the handler receives: the validator gave the note a default. */
type Placed = { id: number; note: string };
/** What the handler returns: a price in cents. */
type Cents = { cents: number };
/** What who asks receives: the validator converted it. */
type Amount = { amount: number };

/** Gives a draft its default note: its input and its output differ. */
const PlacedOrder = standard_schema<Placed, Draft>((value) => {
  const draft = value as Partial<Draft> | null;
  return typeof draft?.id === "number"
    ? { value: { note: "none", ...draft } as Placed }
    : { issues: [{ message: "Expected a number", path: ["id"] }] };
});

/** Converts cents to an amount. */
const AmountOf = standard_schema<Amount, Cents>((value) => ({
  value: { amount: (value as Cents).cents / 100 },
}));

const PlaceOrder = contract({
  topic: "shop.orders.place",
  request: PlacedOrder,
  reply: AmountOf,
});

describe("a contract whose validators convert", () => {
  const placed: Placed[] = [];

  @Middlewares(validate())
  @Controller()
  class Orders {
    // receives what the request validator gives, returns what the reply
    // validator takes
    @Subscribe(PlaceOrder)
    place(order: Placed): Cents {
      placed.push(order);
      return { cents: order.id * 150 };
    }
  }

  @Module({ controllers: [Orders] })
  class Shop {}

  it("gives each side its own types, and its own values", async () => {
    const app = await ChoMessage.create(Shop);
    const client = new ChoMessageClient(localSender(app));
    // sends what the request validator takes, receives what the reply
    // validator gives
    const amount: Amount = await client.request(PlaceOrder, { id: 3 });
    assert.deepEqual(amount, { amount: 4.5 });
    assert.deepEqual(placed, [{ id: 3, note: "none" }]);

    await client.publish(PlaceOrder, { id: 4, note: "fragile" });
    assert.deepEqual(placed[1], { id: 4, note: "fragile" });
  });

  it("checks each side against its own type, at compile time", () => {
    // Type-only: never called, so the classes are never defined.
    const _check = async (client: ChoMessageClient) => {
      class Wrong {
        // @ts-expect-error the handler returns cents, not an amount
        @Subscribe(PlaceOrder)
        a(_order: Placed): Amount {
          return { amount: 1 };
        }

        // @ts-expect-error the handler receives a note that is always there
        @Subscribe(PlaceOrder)
        b(_order: { id: number; note: number }): Cents {
          return { cents: 1 };
        }

        // The note is a string, so a handler can read it as one.
        @Subscribe(PlaceOrder)
        c(order: Placed): Cents {
          return { cents: order.note.length };
        }
      }

      // @ts-expect-error who asks receives an amount, not cents
      const _cents: Cents = await client.request(PlaceOrder, { id: 1 });
      // @ts-expect-error the id is needed
      await client.request(PlaceOrder, { note: "no id" });
      // @ts-expect-error a note is a string
      await client.publish(PlaceOrder, { id: 1, note: 5 });
      // The note can be left out, and given.
      await client.publish(PlaceOrder, { id: 1 });
      const _amount: Amount = await client.request(PlaceOrder, {
        id: 1,
        note: "gift",
      });
      return [Wrong, _cents, _amount];
    };
    assert.equal(typeof _check, "function");
  });

  it("types both sides by what a validator gives when it does not say what it takes", () => {
    // A schema written by hand, a parse method and a schema that converts
    // anything take `unknown`: what they give is what is sent and returned.
    const Loose = contract({
      topic: "shop.loose",
      request: standard_schema<Placed>((value) => ({ value: value as Placed })),
      reply: { parse: (value: unknown) => value as Amount },
    });
    const _check = async (client: ChoMessageClient) => {
      class Handler {
        @Subscribe(Loose)
        a(order: Placed): Amount {
          return { amount: order.id };
        }

        // @ts-expect-error the reply is an amount
        @Subscribe(Loose)
        b(_order: Placed) {
          return "anything";
        }
      }
      // @ts-expect-error the value is a placed order, not anything
      await client.request(Loose, "anything");
      const _amount: Amount = await client.request(Loose, {
        id: 1,
        note: "",
      });
      return [Handler, _amount];
    };
    assert.equal(typeof _check, "function");
  });
});

// What the types refuse. Nothing here runs.
(() => {
  // @ts-expect-error an unknown option
  @Controller({ route: "orders" })
  class WrongOption {}

  // @ts-expect-error the constructor wants a Mailer, not a number
  @Controller({ topic: "bad", dependencies: [Mailer] })
  class WrongDependency {
    constructor(readonly limit: number) {}
  }

  class WrongTopic {
    // @ts-expect-error a topic is a string
    @Subscribe(42)
    run() {}
  }

  // @ts-expect-error overrides are not an option of from
  ChoMessage.from(null!, { overrides: [] });

  return [WrongOption, WrongDependency, WrongTopic];
});
