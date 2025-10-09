import { expect } from "@std/expect";
import {
  read,
  readMetadataObject,
  write,
  writeMetadataObject,
} from "../meta/mod.ts";
import { test } from "../testing/mod.ts";

const key = Symbol("key");

test("read should return undefined", () => {
  class Foo {}
  expect(read(Foo, key)).toBe(undefined);
});

test("read should return written data", () => {
  class Foo {}
  write(Foo, key, "value");
  expect(read(Foo, key)).toBe("value");
});

test("readMetadataObject should return undefined", () => {
  class Foo {}
  expect(readMetadataObject(Foo)).toBe(undefined);
});

test("readMetadataObject should return written data", () => {
  class Foo {}
  writeMetadataObject(Foo, { foo: "bar" });
  expect(readMetadataObject(Foo)).toEqual({ foo: "bar" });
});
