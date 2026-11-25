/**
 * The entry point: creates the application, and connects it to Kafka.
 *
 * The brokers are those of `KAFKA_BROKERS` (`host:port`, with a `,` between
 * two), or `localhost:9092`. The same file runs on Deno, on Node.js and on
 * Bun.
 *
 * @module
 */

import process from "node:process";
import { ChoMessage, env } from "@chojs/message";
import { KafkaLinker } from "@chojs/vendor-kafka";
import { AppModule } from "./app.ts";

const brokers = (env("KAFKA_BROKERS") ?? "localhost:9092").split(",");

const app = await ChoMessage.create(AppModule, {
  // the group is the name of the application for Kafka: every instance of
  // it has the same one, and the group shares the messages between them
  linker: new KafkaLinker({ brokers, groupId: "__name__" }),
});
try {
  await app.start(); // connects, joins the group, and subscribes to the topics
} catch (error) {
  // most often: no broker answers at that address
  console.error(`__name__ could not start on Kafka, at ${brokers.join(", ")}`);
  throw error;
}

console.log(`__name__ is reading from Kafka, at ${brokers.join(", ")}`);

// Ctrl+C, and the end a platform asks for: finish the messages in hand,
// leave the group, and disconnect
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => void app.close());
}
