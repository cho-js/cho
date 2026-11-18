#!/usr/bin/env -S deno run --allow-all
/**
 * Messages that must not be lost, on NATS JetStream, with `@chojs/message`
 * and `@chojs/vendor-nats`.
 *
 * - The stream `EXAMPLE_ORDERS` keeps the messages of `example.orders.>`, and
 *   `EXAMPLE_DEAD` the dead letters. The adapter creates no stream: this file
 *   makes them first, as who operates NATS would.
 * - `OrdersController` handles `example.orders.created`. A message that was
 *   handled is acknowledged; one that failed is delivered again, twice, then
 *   published to `dead.example.orders.created`.
 * - The file publishes three orders, and prints what happened to each.
 *
 * It needs a NATS server with JetStream (`NATS_URL`, `localhost:4222` by
 * default):
 *
 * ```sh
 * docker run -d --rm -p 4222:4222 nats:2 -js
 * deno run --allow-all examples/nats-stream.ts
 * npx tsx examples/nats-stream.ts
 * bun examples/nats-stream.ts
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
import { NatsLinker, type NatsStreamNative } from "@chojs/vendor-nats";

// The transport and the JetStream client of the runtime: Deno has its own,
// on JSR; the ones of Node.js serve Bun too. An application imports the ones
// it runs on.
const { connect } = engine() === "deno"
  ? await import("@nats-io/transport-deno")
  : await import("@nats-io/transport-node");
const { jetstream, jetstreamManager } = engine() === "deno"
  ? await import("@nats-io/jetstream-deno")
  : await import("@nats-io/jetstream");

const servers = env("NATS_URL") ?? "localhost:4222";

type Order = { id: number; stock: boolean };

let settled = 0;

@Controller({ topic: "example.orders" })
class OrdersController {
  /** `example.orders.created`, of the stream `EXAMPLE_ORDERS`. */
  @Subscribe("created")
  created(ctx: ChoMessageContext) {
    const order = ctx.json<Order>();
    const { attempt } = ctx.native as NatsStreamNative;
    if (!order.stock) {
      console.log(`order ${order.id}: no stock (attempt ${attempt})`);
      settled += attempt === 3 ? 1 : 0;
      throw new Error("no stock"); // delivered again, then dead
    }
    console.log(`order ${order.id}: handled (attempt ${attempt})`);
    settled++;
  }
}

@Module({ controllers: [OrdersController] })
class AppModule {}

// What who operates NATS does: the streams.
const admin = await connect({ servers });
const manager = await jetstreamManager(admin);
for (
  const [name, subjects] of [
    ["EXAMPLE_ORDERS", ["example.orders.>"]],
    ["EXAMPLE_DEAD", ["dead.example.>"]],
  ] as const
) {
  await manager.streams.delete(name).catch(() => {}); // a clean run
  await manager.streams.add({ name, subjects: [...subjects] });
}

const app = await ChoMessage.create(AppModule, {
  linker: new NatsLinker({
    connect: () => connect({ servers }),
    queue: "example",
    jetstream: {
      client: (nc) => jetstream(nc),
      streams: ["EXAMPLE_ORDERS"],
      retries: 2,
      retryDelay: 200,
      deadLetter: (topic) => `dead.${topic}`,
    },
  }),
});
await app.start();

// Publish with JetStream: it resolves when the stream has the message.
const js = jetstream(admin);
for (
  const order of [{ id: 1, stock: true }, { id: 2, stock: false }, {
    id: 3,
    stock: true,
  }]
) {
  await js.publish("example.orders.created", JSON.stringify(order));
}

// Wait until the three are settled: two handled, and one dead.
while (settled < 3) {
  await new Promise((resolve) => setTimeout(resolve, 50));
}
await new Promise((resolve) => setTimeout(resolve, 200));

const dead = await manager.streams.getMessage("EXAMPLE_DEAD", { seq: 1 });
console.log(
  "dead letter:",
  dead?.string(),
  `after ${dead?.header.get("cho-attempts")} attempts:`,
  dead?.header.get("cho-error"),
);

await app.close();
for (const name of ["EXAMPLE_ORDERS", "EXAMPLE_DEAD"]) {
  await manager.streams.delete(name);
}
await admin.close();
