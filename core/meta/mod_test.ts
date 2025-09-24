import { expect } from "@std/expect";
import { read, readMetadataObject, write, writeMetadataObject } from "./mod.ts";

const key = Symbol("key");

Deno.test("read should return undefined", () => {
  class Foo {}
  expect(read(Foo, key)).toBe(undefined);
});

Deno.test("read should return written data", () => {
  class Foo {}
  write(Foo, key, "value");
  expect(read(Foo, key)).toBe("value");
});

Deno.test("readMetadataObject should return undefined", () => {
  class Foo {}
  expect(readMetadataObject(Foo)).toBe(undefined);
});

Deno.test("readMetadataObject should return written data", () => {
  class Foo {}
  writeMetadataObject(Foo, { foo: "bar" });
  expect(readMetadataObject(Foo)).toEqual({ foo: "bar" });
});
