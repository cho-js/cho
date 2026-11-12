/**
 * Metadata storage: how the DI decorators attach data to classes.
 *
 * Every DI decorator records what it declares about a class (its
 * dependencies, and for a module its imports, providers, ...) in a single
 * record. The record lives in the class's TC39 decorator metadata object, under
 * a CHO-specific key:
 *
 * ```text
 * class Foo
 *   └─ [Symbol.metadata]                         the class's own metadata object
 *        ├─ [Symbol.for("chojs.meta")]           the CHO record of the class (frozen)
 *        └─ [Symbol.for("chojs.meta.methods")]   the methods of the class, by name
 *             └─ run
 *                  └─ [Symbol.for("chojs.meta")] the CHO record of `run` (frozen)
 * ```
 *
 * The record of a method is stored with its class, by method name, not on the
 * method function: it survives a decorator that replaces the function, and a
 * subclass finds the records of the methods it inherits (see
 * {@link method_records}).
 *
 * The storage has three properties:
 *
 * - **Own-only, for classes.** A class only sees the record written to
 *   itself, never the one of its parent class. A subclass of an injectable
 *   class is not injectable unless it is decorated itself. Method records are
 *   different: they follow the methods, which are inherited.
 * - **Immutable.** The stored record is frozen, and every write replaces it
 *   with a new frozen record. Values passed in by the caller are never
 *   mutated.
 * - **Runtime-agnostic.** It works with TC39 decorators (inside a decorator,
 *   the record is written to `context.metadata`), with legacy and Bun
 *   decorators, and with plain function calls (the record is written to the
 *   class itself). Runtimes without a native `Symbol.metadata` use
 *   `Symbol.for("Symbol.metadata")`, the same fallback transpilers use.
 *
 * A record's keys can be strings or symbols. The framework writes its own
 * data under symbol keys (core's are in `keys.ts`), so they never collide
 * with the string keys of user options.
 *
 * @module
 */

import type { Any, Target } from "./types.ts";

// Storage
// -----------------------------------------------------------------------------

/**
 * Key of the TC39 decorator metadata object on a class (`Symbol.metadata`).
 * Falls back to `Symbol.for("Symbol.metadata")`, the symbol transpilers
 * (esbuild, TypeScript) use when the runtime has no native `Symbol.metadata`.
 *
 * @internal
 */
const MetadataSymbol: symbol = Symbol.metadata ??
  Symbol.for("Symbol.metadata");

/**
 * Key of the CHO record inside a decorator metadata object. `Symbol.for`
 * returns the same symbol across copies and versions of this package, so all
 * of them read and write the same record.
 *
 * @internal
 */
const MetaKey: symbol = Symbol.for("chojs.meta");

/**
 * Where metadata can be stored: a class (or any function), or a TC39
 * decorator metadata object (`context.metadata` inside a decorator).
 */
export type MetaTarget = Target | DecoratorMetadataObject;

/** A decorator metadata object, seen as a plain key-value bag. */
type Bag = Record<PropertyKey, unknown>;

/**
 * Get the target's own decorator metadata object.
 *
 * A subclass inherits its parent's `Symbol.metadata` as a static property, so
 * only an own property counts. When `create` is set and the class has no own
 * metadata object, one is defined, chained to the inherited one through its
 * prototype, as the TC39 specification does.
 *
 * @param target A class, or a decorator metadata object (returned as is).
 * @param create Whether to create the class's own metadata object if missing.
 * @returns The own metadata object, or `undefined` when there is none and
 *   `create` is not set.
 */
function own_bag(target: MetaTarget, create: boolean): Bag | undefined {
  if (typeof target !== "function") {
    return target as Bag;
  }
  if (Object.hasOwn(target, MetadataSymbol)) {
    return (target as Any)[MetadataSymbol];
  }
  if (!create) {
    return undefined;
  }
  const bag = Object.create((target as Any)[MetadataSymbol] ?? null);
  Object.defineProperty(target, MetadataSymbol, {
    value: bag,
    writable: false,
    enumerable: true,
    configurable: true,
  });
  return bag;
}

/**
 * Read the CHO record of a target.
 *
 * Only the target's own record is returned, never the one of a parent class.
 *
 * @typeParam T The expected shape of the record. It is not checked.
 * @param target A class, or a decorator metadata object.
 * @returns The record, or `undefined` when the target has none.
 *
 * @example
 * ```ts
 * @Injectable([Logger])
 * class Db {}
 *
 * read_metadata_object(Db);
 * // { [Symbol(chojs.core.isInjectable)]: true,
 * //   [Symbol(chojs.core.dependencies)]: [Logger] }
 * ```
 */
export function read_metadata_object<T>(target: MetaTarget): T | undefined {
  const bag = own_bag(target, false);
  if (bag && Object.hasOwn(bag, MetaKey)) {
    return bag[MetaKey] as T;
  }
  return undefined;
}

/**
 * Write the CHO record of a target, replacing any existing one.
 *
 * The stored record is a frozen copy of the own enumerable properties of
 * `obj`, string and symbol keys alike. Top-level arrays are copied and frozen
 * too; nested values (such as provider objects inside an array) are stored by
 * reference.
 *
 * @param target A class, or a decorator metadata object.
 * @param obj The new record.
 *
 * @example
 * ```ts
 * write_metadata_object(Foo, { a: 1 });
 * read_metadata_object(Foo); // { a: 1 }
 * ```
 */
export function write_metadata_object(
  target: MetaTarget,
  obj: Record<PropertyKey, unknown>,
): void {
  const record: Record<PropertyKey, unknown> = {};
  for (const key of own_keys(obj)) {
    const value = obj[key];
    record[key] = Array.isArray(value) ? Object.freeze([...value]) : value;
  }
  Object.defineProperty(own_bag(target, true), MetaKey, {
    value: Object.freeze(record),
    writable: false,
    enumerable: false,
    configurable: true,
  });
}

/**
 * Merge properties into the CHO record of a target.
 *
 * Merge rules, per key (string and symbol keys alike):
 *
 * - when both the existing and the added value are arrays, they are
 *   concatenated, existing values first, without removing duplicates;
 * - any other added value replaces the existing one. Objects are not merged
 *   deeply.
 *
 * The result is written with {@link write_metadata_object}, so it is frozen.
 *
 * @param target A class, or a decorator metadata object.
 * @param obj The properties to merge in.
 *
 * @example
 * ```ts
 * add_to_metadata_object(Foo, { a: 1, b: [2] });
 * add_to_metadata_object(Foo, { b: [3], c: 4 });
 * read_metadata_object(Foo); // { a: 1, b: [2, 3], c: 4 }
 * ```
 */
export function add_to_metadata_object(
  target: MetaTarget,
  obj: Record<PropertyKey, unknown>,
): void {
  const merged: Record<PropertyKey, unknown> = {
    ...read_metadata_object<Record<PropertyKey, unknown>>(target),
  };
  for (const key of own_keys(obj)) {
    const prev = merged[key];
    const value = obj[key];
    merged[key] = Array.isArray(prev) && Array.isArray(value)
      ? [...prev, ...value]
      : value;
  }
  write_metadata_object(target, merged);
}

/**
 * The own enumerable keys of an object, strings and symbols.
 *
 * @param obj The object.
 * @returns Its keys: what object spread copies.
 */
export function own_keys(obj: object): PropertyKey[] {
  return Reflect.ownKeys(obj).filter((key) =>
    Object.prototype.propertyIsEnumerable.call(obj, key)
  );
}

// Method records
// -----------------------------------------------------------------------------

/**
 * Key of the method table inside a class's decorator metadata object: the
 * metadata of each decorated method, by method name.
 *
 * @internal
 */
const MethodsKey: symbol = Symbol.for("chojs.meta.methods");

/** A method table: one metadata object per method name. */
type MethodTable = Record<PropertyKey, Bag>;

/**
 * Get the own method table of a class.
 *
 * @param owner A class, or its decorator metadata object.
 * @param create Whether to create the table if the class has none.
 * @returns The table, or `undefined` when there is none and `create` is not
 *   set.
 */
function own_methods(
  owner: MetaTarget,
  create: boolean,
): MethodTable | undefined {
  const bag = own_bag(owner, create);
  if (!bag) {
    return undefined;
  }
  if (Object.hasOwn(bag, MethodsKey)) {
    return bag[MethodsKey] as MethodTable;
  }
  if (!create) {
    return undefined;
  }
  const table: MethodTable = Object.create(null);
  Object.defineProperty(bag, MethodsKey, {
    value: table,
    writable: false,
    enumerable: false,
    configurable: true,
  });
  return table;
}

/**
 * Where the record of a method is stored: a metadata object of its own, kept
 * with its class. Use it as the target of {@link read_metadata_object},
 * {@link write_metadata_object} and {@link add_to_metadata_object}.
 *
 * Decorators get it from `decorated_method` (`.meta`) or `decorated_target`,
 * which find the class from the decorator's arguments.
 *
 * @param owner The class that declares the method, or its decorator metadata
 *   object (`context.metadata` inside a TC39 decorator).
 * @param name The method name.
 * @returns The method's metadata object, created if needed.
 *
 * @example
 * ```ts
 * add_to_metadata_object(method_metadata(Cli, "run"), { command: "run" });
 * read_method_metadata(Cli, "run"); // { command: "run" }
 * ```
 */
export function method_metadata(
  owner: MetaTarget,
  name: string | symbol,
): MetaTarget {
  const table = own_methods(owner, true)!;
  return table[name] ??= Object.create(null) as Bag;
}

/**
 * The records of the methods of a class, by method name: its own, and those
 * of the methods it inherits. A record of a subclass replaces the record its
 * parent has for the same method name.
 *
 * Two places are read for each class of the prototype chain, parents first,
 * and merged when a method has a record in both (the table's keys win):
 *
 * - the class's method table (see {@link method_metadata}), where decorators
 *   write;
 * - the method functions of its prototype, for records written on a function:
 *   by a decorator that could not reach the class (static and private
 *   methods, which are never listed here, and TC39 decorators compiled for a
 *   runtime without `Symbol.metadata`), or directly by a caller.
 *
 * @param ctr The class.
 * @returns The records, in declaration order, parents first. Static and
 *   private methods are not part of it.
 */
export function method_records(
  ctr: Target,
): Map<string | symbol, Readonly<Record<PropertyKey, unknown>>> {
  const chain: Target[] = [];
  for (
    let cls: unknown = ctr;
    typeof cls === "function" && cls !== Function.prototype;
    cls = Object.getPrototypeOf(cls)
  ) {
    chain.unshift(cls);
  }

  const records = new Map<
    string | symbol,
    Readonly<Record<PropertyKey, unknown>>
  >();
  const read = (target: MetaTarget) =>
    read_metadata_object<Record<PropertyKey, unknown>>(target);
  for (const cls of chain) {
    // The records of this class alone: it replaces its parents' by name.
    const own = new Map<string | symbol, Record<PropertyKey, unknown>>();
    const proto: unknown = cls.prototype;
    if (typeof proto === "object" && proto !== null) {
      for (const name of Reflect.ownKeys(proto)) {
        const value = Object.getOwnPropertyDescriptor(proto, name)?.value;
        const record = name !== "constructor" && typeof value === "function"
          ? read(value)
          : undefined;
        if (record) {
          own.set(name, record);
        }
      }
    }
    const table = own_methods(cls, false);
    if (table) {
      for (const name of Reflect.ownKeys(table)) {
        const record = read(table[name]!);
        if (record) {
          const on_function = own.get(name);
          own.set(
            name,
            on_function ? Object.freeze({ ...on_function, ...record }) : record,
          );
        }
      }
    }
    for (const [name, record] of own) {
      records.set(name, record);
    }
  }
  return records;
}

/**
 * Read the record of a method.
 *
 * @typeParam T The expected shape of the record. It is not checked.
 * @param owner A class: the record is looked up as {@link method_records}
 *   does, inherited methods included. Or a decorator metadata object: only
 *   its own method table is read.
 * @param name The method name.
 * @returns The record, or `undefined` when the method has none.
 */
export function read_method_metadata<T>(
  owner: MetaTarget,
  name: string | symbol,
): T | undefined {
  if (typeof owner === "function") {
    return method_records(owner).get(name) as T | undefined;
  }
  const target = own_methods(owner, false)?.[name];
  return target ? read_metadata_object<T>(target) : undefined;
}
