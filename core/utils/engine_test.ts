import { expect } from "@std/expect";
import { test } from "../testing/mod.ts";
import { engine } from "./engine.ts";

test("should return current engine", () => {
  // test runs in 3 different engines: deno, node, bun
  expect(["deno", "node", "bun"].includes(engine())).toBe(true);
});
