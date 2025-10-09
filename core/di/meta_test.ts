import { expect } from "@std/expect";
import {
  addToMetadataObject,
  createMetaDecorator,
  type Metadata,
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

test("write should make property non-enumerable", () => {
  class Foo {}
  write(Foo, key, "value");
  expect(Object.keys(Foo)).not.toContain(key.toString());
});

test("write should make property non-writable and non-configurable", () => {
  class Foo {}
  write(Foo, key, "value");
  const descriptor = Object.getOwnPropertyDescriptor(Foo, key);
  expect(descriptor?.writable).toBe(false);
  expect(descriptor?.configurable).toBe(false);
});

test("addToMetadataObject should create metadata if none exists", () => {
  class Foo {}
  addToMetadataObject(Foo, { foo: "bar" });
  expect(readMetadataObject(Foo)).toEqual({ foo: "bar" });
});

test("addToMetadataObject should merge with existing metadata", () => {
  class Foo {}
  writeMetadataObject(Foo, { foo: "bar" });
  addToMetadataObject(Foo, { baz: "qux" });
  expect(readMetadataObject(Foo)).toEqual({ foo: "bar", baz: "qux" });
});

test("addToMetadataObject should overwrite non-array values", () => {
  class Foo {}
  writeMetadataObject(Foo, { foo: "bar" });
  addToMetadataObject(Foo, { foo: "new value" });
  expect(readMetadataObject(Foo)).toEqual({ foo: "new value" });
});

test("addToMetadataObject should merge array values", () => {
  class Foo {}
  writeMetadataObject(Foo, { items: [1, 2] });
  addToMetadataObject(Foo, { items: [3, 4] });
  expect(readMetadataObject(Foo)).toEqual({ items: [1, 2, 3, 4] });
});

test("addToMetadataObject should handle mixed array and non-array", () => {
  class Foo {}
  writeMetadataObject(Foo, { items: [1, 2], name: "test" });
  addToMetadataObject(Foo, { items: [3], name: "new" });
  expect(readMetadataObject(Foo)).toEqual({
    items: [1, 2, 3],
    name: "new",
  });
});

test("createMetaDecorator should create a decorator factory", () => {
  interface MyMeta extends Metadata {
    role: string;
    permissions: string[];
  }
  const MyDecorator = createMetaDecorator<MyMeta>();

  @MyDecorator({ role: "admin", permissions: ["read", "write"] })
  class Foo {}

  expect(readMetadataObject(Foo)).toEqual({
    role: "admin",
    permissions: ["read", "write"],
  });
});

test("createMetaDecorator should apply marker metadata", () => {
  interface MyMeta extends Metadata {
    name: string;
  }
  const MyDecorator = createMetaDecorator<MyMeta>({ isSpecial: true });

  @MyDecorator({ name: "test" })
  class Foo {}

  expect(readMetadataObject(Foo)).toEqual({ name: "test", isSpecial: true });
});

test("createMetaDecorator should work without arguments", () => {
  interface MyMeta extends Metadata {
    value?: string;
  }
  const MyDecorator = createMetaDecorator<MyMeta>({ isMarked: true });

  @MyDecorator()
  class Foo {}

  expect(readMetadataObject(Foo)).toEqual({ isMarked: true });
});

test("createMetaDecorator should merge multiple applications", () => {
  interface MyMeta extends Metadata {
    tags: string[];
  }
  const AddTag = createMetaDecorator<MyMeta>();

  @AddTag({ tags: ["tag1"] })
  @AddTag({ tags: ["tag2"] })
  class Foo {}

  // Decorators apply bottom-up, so tag2 is applied first, then tag1
  expect(readMetadataObject(Foo)).toEqual({ tags: ["tag2", "tag1"] });
});
