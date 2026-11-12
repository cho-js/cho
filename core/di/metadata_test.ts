/**
 * Tests for `metadata.ts`: storing and reading the CHO record of a class.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  add_to_metadata_object,
  read_metadata_object,
  write_metadata_object,
} from "./metadata.ts";

/** Where classes keep their decorator metadata object (see `metadata.ts`). */
const MetadataSymbol: symbol = Symbol.metadata ??
  Symbol.for("Symbol.metadata");

/** The key of the CHO record inside a decorator metadata object. */
const MetaKey: symbol = Symbol.for("chojs.meta");

describe("read_metadata_object", () => {
  it("returns undefined for a class without a record", () => {
    class Foo {}
    assert.equal(read_metadata_object(Foo), undefined);
  });

  it("returns undefined for a class whose metadata object has no CHO record", () => {
    class Foo {}
    Object.defineProperty(Foo, MetadataSymbol, { value: { other: 1 } });
    assert.equal(read_metadata_object(Foo), undefined);
  });

  it("reads the record from a decorator metadata object", () => {
    const metadata = { [MetaKey]: { a: 1 } };
    assert.deepEqual(read_metadata_object(metadata), { a: 1 });
  });
});

describe("write_metadata_object", () => {
  it("stores a record that read_metadata_object returns", () => {
    class Foo {}
    write_metadata_object(Foo, { a: 1, b: [2] });
    assert.deepEqual(read_metadata_object(Foo), { a: 1, b: [2] });
  });

  it("stores the record in the class's own metadata object, under the CHO key", () => {
    class Foo {}
    write_metadata_object(Foo, { a: 1 });
    assert.ok(Object.hasOwn(Foo, MetadataSymbol));
    assert.deepEqual(Reflect.get(Foo, MetadataSymbol)[MetaKey], { a: 1 });
  });

  it("writes to a decorator metadata object as is", () => {
    const metadata = {};
    write_metadata_object(metadata, { a: 1 });
    assert.deepEqual(read_metadata_object(metadata), { a: 1 });
  });

  it("replaces any existing record", () => {
    class Foo {}
    write_metadata_object(Foo, { a: 1 });
    write_metadata_object(Foo, { b: 2 });
    assert.deepEqual(read_metadata_object(Foo), { b: 2 });
  });

  it("freezes the record and its top-level arrays", () => {
    class Foo {}
    write_metadata_object(Foo, { list: [1, 2] });
    const record = read_metadata_object<{ list: number[] }>(Foo)!;
    assert.ok(Object.isFrozen(record));
    assert.ok(Object.isFrozen(record.list));
  });

  it("copies top-level arrays, so later changes to the input are not seen", () => {
    class Foo {}
    const list = [1];
    write_metadata_object(Foo, { list });
    list.push(2);
    assert.deepEqual(read_metadata_object(Foo), { list: [1] });
  });

  it("keeps nested values by reference", () => {
    class Foo {}
    const nested = { x: 1 };
    write_metadata_object(Foo, { nested, list: [nested] });
    const record = read_metadata_object<
      { nested: object; list: object[] }
    >(Foo)!;
    assert.equal(record.nested, nested);
    assert.equal(record.list[0], nested);
  });

  it("does not mutate the input", () => {
    class Foo {}
    const list = [1];
    const input = { list };
    write_metadata_object(Foo, input);
    assert.ok(!Object.isFrozen(input));
    assert.ok(!Object.isFrozen(list));
    assert.equal(input.list, list);
  });
});

describe("add_to_metadata_object", () => {
  it("creates the record when there is none", () => {
    class Foo {}
    add_to_metadata_object(Foo, { a: 1 });
    assert.deepEqual(read_metadata_object(Foo), { a: 1 });
  });

  it("concatenates arrays, existing values first, keeping duplicates", () => {
    class Foo {}
    add_to_metadata_object(Foo, { list: [1, 2] });
    add_to_metadata_object(Foo, { list: [2, 3] });
    assert.deepEqual(read_metadata_object(Foo), { list: [1, 2, 2, 3] });
  });

  it("replaces values that are not both arrays", () => {
    class Foo {}
    add_to_metadata_object(Foo, { a: 1, b: [1], c: 1 });
    add_to_metadata_object(Foo, { a: 2, b: 2, c: [2] });
    assert.deepEqual(read_metadata_object(Foo), { a: 2, b: 2, c: [2] });
  });

  it("keeps keys that are not added again", () => {
    class Foo {}
    add_to_metadata_object(Foo, { a: 1 });
    add_to_metadata_object(Foo, { b: 2 });
    assert.deepEqual(read_metadata_object(Foo), { a: 1, b: 2 });
  });

  it("does not merge objects deeply", () => {
    class Foo {}
    add_to_metadata_object(Foo, { obj: { a: 1 } });
    add_to_metadata_object(Foo, { obj: { b: 2 } });
    assert.deepEqual(read_metadata_object(Foo), { obj: { b: 2 } });
  });

  it("stores a frozen record", () => {
    class Foo {}
    add_to_metadata_object(Foo, { list: [1] });
    add_to_metadata_object(Foo, { list: [2] });
    const record = read_metadata_object<{ list: number[] }>(Foo)!;
    assert.ok(Object.isFrozen(record));
    assert.ok(Object.isFrozen(record.list));
  });
});

describe("inheritance", () => {
  it("a subclass does not see its parent's record", () => {
    class Base {}
    write_metadata_object(Base, { a: 1 });
    class Sub extends Base {}
    assert.equal(read_metadata_object(Sub), undefined);
  });

  it("writing to a subclass does not change its parent's record", () => {
    class Base {}
    write_metadata_object(Base, { a: 1 });
    class Sub extends Base {}
    write_metadata_object(Sub, { b: 2 });
    assert.deepEqual(read_metadata_object(Base), { a: 1 });
    assert.deepEqual(read_metadata_object(Sub), { b: 2 });
  });

  it("chains a subclass's metadata object to its parent's", () => {
    class Base {}
    write_metadata_object(Base, { a: 1 });
    class Sub extends Base {}
    write_metadata_object(Sub, { b: 2 });
    assert.equal(
      Object.getPrototypeOf(Reflect.get(Sub, MetadataSymbol)),
      Reflect.get(Base, MetadataSymbol),
    );
  });
});
