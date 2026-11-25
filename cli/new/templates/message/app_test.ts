import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChoMessage } from "@chojs/message";
import { AppModule } from "./app.ts";

/** Give the application one message, and give what it printed. */
async function handle(topic: string, value: string) {
  const lines: string[] = [];
  const log = console.log;
  console.log = (...values: unknown[]) => void lines.push(values.join(" "));
  try {
    // with no linker, the application connects to nothing: a test needs no
    // broker
    const app = await ChoMessage.create(AppModule);
    await app.handle(topic, { value });
    await app.close();
    return lines;
  } finally {
    console.log = log;
  }
}

describe("__name__", () => {
  it("says hello to who the message names", async () => {
    assert.deepEqual(await handle("__name__.hello", '{"name":"Ada"}'), [
      "Hello, Ada!",
    ]);
  });

  it("says hello to the world, for a message with no name", async () => {
    assert.deepEqual(await handle("__name__.hello", "{}"), ["Hello, world!"]);
  });
});
