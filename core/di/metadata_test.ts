/**
 * Tests for `metadata.ts`: storing and reading the CHO record of a class.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  add_to_metadata_object,
  METADATA_FORMAT,
  method_metadata,
  method_records,
  read_metadata_object,
  read_method_metadata,
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
    const metadata = {};
    write_metadata_object(metadata, { a: 1 });
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

  it("stores symbol keys too, with their arrays copied and frozen", () => {
    const KEY = Symbol.for("test.key");
    class Foo {}
    const list = [1];
    write_metadata_object(Foo, { [KEY]: list, a: 1 });
    const record = read_metadata_object<Record<PropertyKey, unknown>>(Foo)!;
    assert.deepEqual(record, { [KEY]: [1], a: 1 });
    assert.notEqual(record[KEY], list);
    assert.ok(Object.isFrozen(record[KEY]));
  });

  it("skips non-enumerable keys, as object spread does", () => {
    class Foo {}
    const input = { a: 1 };
    Object.defineProperty(input, Symbol.for("test.hidden"), { value: 2 });
    write_metadata_object(Foo, input);
    assert.deepEqual(read_metadata_object(Foo), { a: 1 });
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

  it("merges symbol keys like string keys", () => {
    const LIST = Symbol.for("test.list");
    const FLAG = Symbol.for("test.flag");
    class Foo {}
    add_to_metadata_object(Foo, { [LIST]: [1], [FLAG]: 1, a: 1 });
    add_to_metadata_object(Foo, { [LIST]: [2], [FLAG]: 2 });
    assert.deepEqual(read_metadata_object(Foo), {
      [LIST]: [1, 2],
      [FLAG]: 2,
      a: 1,
    });
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

describe("method records", () => {
  it("stores a method's record with its class, by name", () => {
    class Cli {
      run() {}
    }
    add_to_metadata_object(method_metadata(Cli, "run"), { a: 1 });
    add_to_metadata_object(method_metadata(Cli, "run"), { b: 2 });

    assert.deepEqual(read_method_metadata(Cli, "run"), { a: 1, b: 2 });
    assert.equal(read_method_metadata(Cli, "other"), undefined);
    // not on the function, and not in the class's own record
    assert.equal(read_metadata_object(Cli.prototype.run), undefined);
    assert.equal(read_metadata_object(Cli), undefined);
  });

  it("reads a decorator metadata object's own table", () => {
    const metadata = {};
    add_to_metadata_object(method_metadata(metadata, "run"), { a: 1 });
    assert.deepEqual(read_method_metadata(metadata, "run"), { a: 1 });
    assert.equal(read_method_metadata({}, "run"), undefined);
  });

  it("accepts symbol names, and names of Object.prototype", () => {
    const key = Symbol("run");
    class Cli {}
    add_to_metadata_object(method_metadata(Cli, key), { a: 1 });
    assert.deepEqual(read_method_metadata(Cli, key), { a: 1 });
    assert.equal(read_method_metadata(Cli, "toString"), undefined);
    assert.equal(read_method_metadata(Cli, "constructor"), undefined);
  });

  it("gives a subclass its parents' records, without sharing its own", () => {
    class Base {}
    class Cli extends Base {}
    add_to_metadata_object(method_metadata(Base, "run"), { from: "base" });
    add_to_metadata_object(method_metadata(Cli, "copy"), { from: "cli" });

    assert.deepEqual([...method_records(Cli)], [
      ["run", { from: "base" }],
      ["copy", { from: "cli" }],
    ]);
    assert.deepEqual([...method_records(Base)], [["run", { from: "base" }]]);
  });

  it("reads records written on a method function too", () => {
    class Cli {
      run() {}
      static build() {}
    }
    write_metadata_object(Cli.prototype.run, { a: 1 });
    write_metadata_object(Cli.build, { b: 2 }); // static: never listed
    assert.deepEqual([...method_records(Cli)], [["run", { a: 1 }]]);
  });
});

describe("metadata format", () => {
  const FORMAT = Symbol.for("chojs.meta.format");
  const META = Symbol.for("chojs.meta");
  const bag_of = (target: object) =>
    (target as Record<symbol, Record<symbol, unknown>>)[
      Symbol.metadata ?? Symbol.for("Symbol.metadata")
    ]!;

  it("stamps every record with the format it was written in", () => {
    class Foo {
      run() {}
    }
    write_metadata_object(Foo, { a: 1 });
    add_to_metadata_object(method_metadata(Foo, "run"), { b: 2 });
    assert.equal(bag_of(Foo)[FORMAT], METADATA_FORMAT);
    assert.equal(
      (method_metadata(Foo, "run") as Record<symbol, unknown>)[FORMAT],
      METADATA_FORMAT,
    );
  });

  /** A class whose record was written by a copy with another format. */
  function foreign(format: number | undefined) {
    class Foo {}
    const bag: Record<symbol, unknown> = { [META]: { a: 1 } };
    if (format !== undefined) bag[FORMAT] = format;
    Object.defineProperty(
      Foo,
      Symbol.metadata ?? Symbol.for("Symbol.metadata"),
      {
        value: bag,
      },
    );
    return Foo;
  }

  it("refuses to read a record of another format", () => {
    assert.throws(() => read_metadata_object(foreign(METADATA_FORMAT + 1)), {
      message:
        `The CHO metadata of Foo was written in format ${
          METADATA_FORMAT + 1
        }, ` +
        `but this copy of @chojs/core reads format ${METADATA_FORMAT}. ` +
        "Two incompatible versions of @chojs/core are loaded: use one version.",
    });
  });

  it("refuses a record with no format stamp (an older copy)", () => {
    assert.throws(
      () => read_metadata_object(foreign(undefined)),
      /was written in format \(none\)/,
    );
  });

  it("refuses to overwrite or extend a record of another format", () => {
    const Foo = foreign(METADATA_FORMAT + 1);
    assert.throws(() => write_metadata_object(Foo, { b: 2 }), /format/);
    assert.throws(() => add_to_metadata_object(Foo, { b: 2 }), /format/);
    assert.deepEqual(bag_of(Foo)[META], { a: 1 });
  });

  it("reads nothing, without an error, where there is no record", () => {
    class Foo {}
    assert.equal(read_metadata_object(Foo), undefined);
  });
});
