#!/usr/bin/env -S deno run --allow-all
/**
 * Two sides of a contract, on NATS, with `@chojs/message` and
 * `@chojs/vendor-nats`: a service that answers, and a client that asks.
 *
 * - `GetPrice` is the contract: the topic, the request and the reply. The
 *   handler and the client take their types, and their validators, from it.
 * - `PricesController` handles it. What it returns is the reply; a
 *   `ReplyError` says what who asked is told.
 * - The application is one queue group, `shop`: start this file twice, and
 *   each request is answered by one of the two.
 * - The file then asks its own service, with a `ChoMessageClient`, and
 *   prints the answers.
 *
 * It needs a NATS server (`NATS_URL`, `localhost:4222` by default):
 *
 * ```sh
 * docker run -d --rm -p 4222:4222 nats:2
 * deno run --allow-all examples/nats-reply.ts
 * npx tsx examples/nats-reply.ts
 * bun examples/nats-reply.ts
 * ```
 *
 * @module
 */
import {
  ChoMessage,
  ChoMessageClient,
  type ChoValidator,
  contract,
  Controller,
  engine,
  env,
  isChoError,
  isReplyError,
  Middlewares,
  Module,
  ReplyError,
  Subscribe,
  validate,
} from "@chojs/message";
import { NatsLinker } from "@chojs/vendor-nats";

// The transport of the runtime: Deno has its own, on JSR; the one of
// Node.js serves Bun too. An application imports the one it runs on.
const { connect } = engine() === "deno"
  ? await import("@nats-io/transport-deno")
  : await import("@nats-io/transport-node");

const servers = env("NATS_URL") ?? "localhost:4222";

type Order = { id: number };
type Price = { id: number; price: number };

/**
 * A validator is a Standard Schema, as the schemas of Zod, Valibot and
 * ArkType are. This one is written by hand, to need no library: `validate`
 * gives the value, or the issues of a value that is not valid.
 */
const IsOrder: ChoValidator<Order> = {
  "~standard": {
    version: 1,
    vendor: "example",
    validate(value) {
      const id = (value as { id?: unknown } | null)?.id;
      return typeof id === "number"
        ? { value: { id } }
        : { issues: [{ message: "Expected a number", path: ["id"] }] };
    },
  },
};

/** An object with a `parse` method that returns, or throws, is one too. */
const IsPrice: ChoValidator<Price> = {
  parse: (value) => value as Price,
};

// The contract: what the two sides share. In an application of several
// services, it is in a file or a package both import.
const GetPrice = contract({
  topic: "shop.prices.get",
  request: IsOrder,
  reply: IsPrice,
});

@Middlewares(validate())
@Controller({ topic: "shop.prices" })
class PricesController {
  /** `shop.prices.get`: the price of an order. The object is sent as JSON. */
  @Subscribe(GetPrice)
  get(order: Order): Price {
    if (order.id > 100) {
      throw new ReplyError(404, "Not Found"); // what who asked is told
    }
    if (order.id < 0) {
      throw new Error("the password of the database is wrong"); // not told
    }
    return { id: order.id, price: order.id * 10 };
  }
}

@Module({ controllers: [PricesController] })
class AppModule {}

const linker = new NatsLinker({
  connect: () => connect({ servers }),
  queue: "shop",
});
const app = await ChoMessage.create(AppModule, { linker });
await app.start();
console.log(`listening on ${servers}, in the queue group "shop"`);

// The client: it sends with the connection of the application. Another
// service makes its own, with its own linker.
const client = new ChoMessageClient(linker.sender);

for (const order of [{ id: 7 }, { id: 500 }, { id: -1 }, { id: "seven" }]) {
  try {
    // The reply is typed: `price` is a number.
    const { price } = await client.request(GetPrice, order as Order);
    console.log(JSON.stringify(order), "->", `the price is ${price}`);
  } catch (error) {
    console.log(
      JSON.stringify(order),
      "->",
      isReplyError(error)
        ? `error ${error.code}: ${error.description}`
        : isChoError(error)
        ? error.code
        : error,
    );
  }
}

await app.close();
