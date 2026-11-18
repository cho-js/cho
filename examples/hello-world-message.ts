#!/usr/bin/env -S deno run --allow-all
/**
 * A message application with `@chojs/message`, and no broker to install: the
 * linker of this file keeps its messages in memory.
 *
 * - `OrdersController` handles the topics `shop.orders.created` and
 *   `shop.orders.cancelled`.
 * - `MemoryLinker` is a broker adapter in forty lines: it shows what an
 *   adapter does. It subscribes each route to its topic, acknowledges a
 *   message that was handled, and decides what a message that failed leads
 *   to: here, two more tries, then the dead letters.
 *
 * Run it: it sends four messages, and prints what happened to each.
 *
 * @module
 */
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
  type Route,
  Subscribe,
} from "@chojs/message";

type Order = { id: string; email: string };

/** A message of the memory broker. */
type Message = { topic: string; value: string; key?: string; tries: number };

/** A broker in memory: a queue, and the routes that read it. */
export class MemoryBroker {
  readonly dead: Message[] = [];
  readonly #queue: Message[] = [];
  readonly #routes = new Map<string, Route>();
  #reading: Promise<void> | undefined;

  subscribe(route: Route) {
    this.#routes.set(route.topic, route);
  }

  /** Send a message. It is handled later, in order. */
  publish(topic: string, value: unknown, key?: string) {
    this.#queue.push({
      topic,
      value: JSON.stringify(value),
      ...(key === undefined ? {} : { key }),
      tries: 0,
    });
    this.#reading ??= this.#read();
  }

  /** Resolves when every message was handled, or is dead. */
  async idle() {
    await this.#reading;
  }

  async #read() {
    await Promise.resolve(); // let the sender go on first
    for (let message; (message = this.#queue.shift());) {
      const route = this.#routes.get(message.topic);
      if (!route) {
        continue; // nobody subscribed: a broker would not deliver it
      }
      try {
        // The message, as plain data, and the broker's own message. What it
        // resolves with is the reply of the handler: this broker has no
        // replies, so it is not read.
        await route.handle(message, message);
        // handled: acknowledged, so it is not delivered again
      } catch {
        // failed: what happens next is the adapter's decision
        if (++message.tries < 3) {
          this.#queue.push(message);
        } else {
          this.dead.push(message);
        }
      }
    }
    this.#reading = undefined;
  }
}

/** The adapter of the memory broker. */
export class MemoryLinker implements Linker<MemoryBroker> {
  link(routes: readonly Route[]): Linked<MemoryBroker> {
    const broker = new MemoryBroker();
    return {
      instance: broker,
      start: () => {
        routes.forEach((route) => broker.subscribe(route));
        return Promise.resolve();
      },
      stop: () => broker.idle(),
    };
  }
}

@Injectable()
export class Mailer {
  confirm(order: Order) {
    if (!order.email.includes("@")) {
      throw new Error(`cannot write to ${order.email}`);
    }
    console.log(`  mail to ${order.email}: order ${order.id} is confirmed`);
  }
}

/** Logs each message, and how long it took. */
const timing: ChoMessageMiddlewareFn = async (ctx, next) => {
  const start = performance.now();
  try {
    await next();
  } finally {
    const tries = (ctx.native as Message).tries + 1;
    console.log(
      `${ctx.topic} key=${ctx.key} try=${tries} ${
        (performance.now() - start).toFixed(1)
      }ms`,
    );
  }
};

@Middlewares(timing)
@Controller({ topic: "orders", dependencies: [Mailer] })
export class OrdersController {
  constructor(readonly mailer: Mailer) {}

  // shop.orders.created
  // A value that is not an order will never be one: the error handler
  // settles the message as handled, so that it is not tried again.
  @Catch((error, ctx) => {
    if (error instanceof TypeError) {
      console.log(`  dropped ${ctx.key}: ${error.message}`);
      return true;
    }
    // anything else: the message failed, and the broker tries it again
  })
  @Subscribe("created")
  created(ctx: ChoMessageContext) {
    const order = ctx.json<Order>();
    if (typeof order?.email !== "string") {
      throw new TypeError("an order has an email");
    }
    this.mailer.confirm(order);
  }

  // shop.orders.cancelled
  @Subscribe("cancelled")
  cancelled(ctx: ChoMessageContext) {
    console.log(`  order ${ctx.json<Order>().id} is cancelled`);
  }
}

@Module({ topic: "shop", providers: [Mailer], controllers: [OrdersController] })
export class AppModule {}

const app = await ChoMessage.create(AppModule, { linker: new MemoryLinker() });
await app.start();
console.log("subscribed to:", app.routes.map((route) => route.topic));

const broker = app.linked.instance;
broker.publish(
  "shop.orders.created",
  { id: "1", email: "ada@example.com" },
  "1",
);
broker.publish("shop.orders.created", { id: "2" }, "2"); // dropped
broker.publish("shop.orders.created", { id: "3", email: "nowhere" }, "3"); // fails
broker.publish("shop.orders.cancelled", { id: "1" }, "1");

// Finishes the messages in hand, disconnects, and releases the instances.
await app.close();
console.log("dead letters:", broker.dead.map((message) => message.key));
