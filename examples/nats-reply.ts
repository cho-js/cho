#!/usr/bin/env -S deno run --allow-all
/**
 * A service that answers, on NATS, with `@chojs/message` and
 * `@chojs/vendor-nats`: what a handler returns is the reply of its message.
 *
 * - `PricesController` answers the subject `shop.prices.get` with the price of
 *   an order, and the subject `shop.prices.fail` with an error.
 * - The application is one queue group, `shop`: start this file twice, and
 *   each request is answered by one of the two.
 * - The file then asks its own service, as any NATS client would, and prints
 *   the answers.
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
  type ChoMessageContext,
  Controller,
  Module,
  Subscribe,
} from "@chojs/message";
import { engine, env } from "@chojs/core/utils";
import { ERROR_HEADERS, NatsLinker } from "@chojs/vendor-nats";

// The transport of the runtime: Deno has its own, on JSR; the one of
// Node.js serves Bun too. An application imports the one it runs on.
const { connect } = engine() === "deno"
  ? await import("@nats-io/transport-deno")
  : await import("@nats-io/transport-node");

const servers = env("NATS_URL") ?? "localhost:4222";

class OrderNotFound extends Error {}

@Controller({ topic: "prices" })
class PricesController {
  /** `shop.prices.get`: the price of an order. The object is sent as JSON. */
  @Subscribe("get")
  get(ctx: ChoMessageContext) {
    const { id } = ctx.json<{ id: number }>();
    if (id > 100) {
      throw new OrderNotFound(`no order ${id}`);
    }
    return { id, price: id * 10 };
  }

  /** `shop.prices.fail`: a handler that fails for a reason nobody is told. */
  @Subscribe("fail")
  fail() {
    throw new Error("the password of the database is wrong");
  }
}

@Module({ topic: "shop", controllers: [PricesController] })
class AppModule {}

const app = await ChoMessage.create(AppModule, {
  linker: new NatsLinker({
    connect: () => connect({ servers }),
    queue: "shop",
    // What who asked is told when a handler failed. Nothing: 500.
    errorReply: (error) =>
      error instanceof OrderNotFound
        ? { code: 404, description: "Not Found" }
        : undefined,
  }),
});
await app.start();
console.log(`listening on ${servers}, in the queue group "shop"`);

// Another connection: the one that asks. Any NATS client does the same.
const client = await connect({ servers });
for (
  const [subject, payload] of [
    ["shop.prices.get", { id: 7 }],
    ["shop.prices.get", { id: 500 }],
    ["shop.prices.fail", {}],
  ] as const
) {
  const reply = await client.request(subject, JSON.stringify(payload));
  const failed = reply.headers?.get(ERROR_HEADERS.code);
  console.log(
    subject,
    JSON.stringify(payload),
    "->",
    failed
      ? `error ${failed}: ${reply.headers?.get(ERROR_HEADERS.description)}`
      : reply.string(),
  );
}
await client.close();

await app.close();
