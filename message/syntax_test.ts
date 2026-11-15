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
import {
  Catch,
  ChoMessage,
  type ChoMessageContext,
  type ChoMessageMiddlewareFn,
  Controller,
  Injectable,
  type Linked,
  type Linker,
  Middlewares,
  Module,
  provider,
  type Route,
  Subscribe,
  token,
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
