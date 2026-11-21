import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ChoCommand } from "@chojs/command";
import { AppModule } from "./app.ts";

/** Run a command line, and give its exit code and what it printed. */
async function run(...argv: string[]) {
  const lines: string[] = [];
  const log = console.log;
  console.log = (...values: unknown[]) => void lines.push(values.join(" "));
  try {
    const app = ChoCommand.create(AppModule, { name: "__name__" });
    const code = await app.run(argv);
    await app.close();
    return { code, lines };
  } finally {
    console.log = log;
  }
}

describe("__name__", () => {
  it("says hello to the world", async () => {
    assert.deepEqual(await run("hello"), {
      code: 0,
      lines: ["Hello, world!"],
    });
  });

  it("says hello to who --name names", async () => {
    assert.deepEqual(await run("hello", "--name", "Ada"), {
      code: 0,
      lines: ["Hello, Ada!"],
    });
  });
});
