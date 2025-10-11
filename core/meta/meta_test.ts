import { expect } from "@std/expect";
import {
  addToMetadataObject,
  normTarget,
  read,
  readMetadataObject,
  write,
  writeMetadataObject,
} from "./mod.ts";
import { test } from "../testing/mod.ts";

const key = Symbol("key");

test("read should return undefined for non-existent key", () => {
  class Foo {}
  expect(read(Foo, key)).toBe(undefined);
});

test("read should return written data", () => {
  class Foo {}
  write(Foo, key, "value");
  expect(read(Foo, key)).toBe("value");
});

test("read should work with string keys", () => {
  class Foo {}
  write(Foo, "stringKey", "stringValue");
  expect(read(Foo, "stringKey")).toBe("stringValue");
});

test("read should work with different data types", () => {
  class Foo {}
  write(Foo, "number", 42);
  write(Foo, "object", { nested: "value" });
  write(Foo, "array", [1, 2, 3]);

  expect(read(Foo, "number")).toBe(42);
  expect(read(Foo, "object")).toEqual({ nested: "value" });
  expect(read(Foo, "array")).toEqual([1, 2, 3]);
});

test("write should make property non-writable", () => {
  class Foo {}
  write(Foo, "test", "value");

  const descriptor = Object.getOwnPropertyDescriptor(Foo, "test");
  expect(descriptor?.writable).toBe(false);
});

test("write should make property non-enumerable", () => {
  class Foo {}
  write(Foo, "test", "value");

  expect(Object.keys(Foo)).not.toContain("test");
});

test("write should make property non-configurable", () => {
  class Foo {}
  write(Foo, "test", "value");

  const descriptor = Object.getOwnPropertyDescriptor(Foo, "test");
  expect(descriptor?.configurable).toBe(false);
});

test("readMetadataObject should return undefined for uninitialized class", () => {
  class Foo {}
  expect(readMetadataObject(Foo)).toBe(undefined);
});

test("readMetadataObject should return written data", () => {
  class Foo {}
  writeMetadataObject(Foo, { foo: "bar" });
  expect(readMetadataObject(Foo)).toEqual({ foo: "bar" });
});

test("readMetadataObject should be type-safe with generics", () => {
  interface TestMeta {
    role: string;
    permissions: string[];
  }

  class Foo {}
  const meta = { role: "admin", permissions: ["read", "write"] };
  writeMetadataObject(Foo, meta);

  const result = readMetadataObject<TestMeta>(Foo);
  expect(result?.role).toBe("admin");
  expect(result?.permissions).toEqual(["read", "write"]);
});

test("writeMetadataObject should throw when trying to overwrite existing metadata", () => {
  class Foo {}
  writeMetadataObject(Foo, { first: "value1" });

  expect(() => {
    writeMetadataObject(Foo, { second: "value2" });
  }).toThrow();
});

test("addToMetadataObject should create metadata if not exists", () => {
  class Foo {}
  addToMetadataObject(Foo, { key: "value" });

  expect(readMetadataObject(Foo)).toEqual({ key: "value" });
});

test("addToMetadataObject should merge with existing metadata", () => {
  class Foo {}
  writeMetadataObject(Foo, { first: "value1" });
  addToMetadataObject(Foo, { second: "value2" });

  expect(readMetadataObject(Foo)).toEqual({
    first: "value1",
    second: "value2",
  });
});

test("addToMetadataObject should overwrite non-array properties", () => {
  class Foo {}
  writeMetadataObject(Foo, { key: "original" });
  addToMetadataObject(Foo, { key: "updated" });

  expect(readMetadataObject(Foo)).toEqual({ key: "updated" });
});

test("addToMetadataObject should merge array properties", () => {
  class Foo {}
  writeMetadataObject(Foo, { items: [1, 2] });
  addToMetadataObject(Foo, { items: [3, 4] });

  expect(readMetadataObject(Foo)).toEqual({ items: [1, 2, 3, 4] });
});

test("addToMetadataObject should merge multiple array properties", () => {
  class Foo {}
  writeMetadataObject(Foo, { arr1: ["a"], arr2: ["x"] });
  addToMetadataObject(Foo, { arr1: ["b"], arr2: ["y"], arr3: ["z"] });

  expect(readMetadataObject(Foo)).toEqual({
    arr1: ["a", "b"],
    arr2: ["x", "y"],
    arr3: ["z"],
  });
});

test("addToMetadataObject should handle empty arrays", () => {
  class Foo {}
  writeMetadataObject(Foo, { items: [] });
  addToMetadataObject(Foo, { items: [1, 2] });

  expect(readMetadataObject(Foo)).toEqual({ items: [1, 2] });
});

test("addToMetadataObject should not merge arrays with non-arrays", () => {
  class Foo {}
  writeMetadataObject(Foo, { key: [1, 2] });
  addToMetadataObject(Foo, { key: "string" });

  expect(readMetadataObject(Foo)).toEqual({ key: "string" });
});

test("normTarget should return target when target is a function", () => {
  class Foo {}
  const result = normTarget(Foo);
  expect(result).toBe(Foo);
});

test("normTarget should extract method from object for Bun decorators", () => {
  class Foo {
    method() {}
  }
  const obj = { method: Foo.prototype.method };
  const result = normTarget(obj as any, "method");
  expect(result).toBe(Foo.prototype.method);
});

test("normTarget should return target when key is undefined", () => {
  class Foo {}
  const result = normTarget(Foo, undefined);
  expect(result).toBe(Foo);
});

test("multiple classes should have independent metadata", () => {
  class Foo {}
  class Bar {}

  writeMetadataObject(Foo, { type: "foo" });
  writeMetadataObject(Bar, { type: "bar" });

  expect(readMetadataObject(Foo)).toEqual({ type: "foo" });
  expect(readMetadataObject(Bar)).toEqual({ type: "bar" });
});

test("metadata should not be enumerable in class properties", () => {
  class Foo {}
  write(Foo, "prop1", "value1");
  write(Foo, "prop2", "value2");

  const keys = Object.keys(Foo);
  expect(keys).not.toContain("prop1");
  expect(keys).not.toContain("prop2");
});

test("write should support null and undefined values", () => {
  class Foo {}
  write(Foo, "nullKey", null);
  write(Foo, "undefinedKey", undefined);

  expect(read(Foo, "nullKey")).toBe(null);
  expect(read(Foo, "undefinedKey")).toBe(undefined);
});

test("addToMetadataObject should handle complex nested objects", () => {
  class Foo {}
  writeMetadataObject(Foo, {
    config: { nested: { deep: "value1" } },
    arrays: [[1, 2]],
  });
  addToMetadataObject(Foo, {
    config: { another: "value2" },
    arrays: [[3, 4]],
  });

  const result = readMetadataObject(Foo);
  // Non-arrays are overwritten
  expect(result).toEqual({
    config: { another: "value2" },
    arrays: [[1, 2], [3, 4]],
  });
});
