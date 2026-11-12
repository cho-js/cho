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
 *   └─ [Symbol.metadata]                 the class's own metadata object
 *        └─ [Symbol.for("chojs.meta")]   the CHO record (frozen)
 * ```
 *
 * The storage has three properties:
 *
 * - **Own-only.** A class only sees the record written to itself, never the
 *   one of its parent class. A subclass of an injectable class is not
 *   injectable unless it is decorated itself.
 * - **Immutable.** The stored record is frozen, and every write replaces it
 *   with a new frozen record. Values passed in by the caller are never
 *   mutated.
 * - **Runtime-agnostic.** It works with TC39 decorators (inside a decorator,
 *   the record is written to `context.metadata`), with legacy and Bun
 *   decorators, and with plain function calls (the record is written to the
 *   class itself). Runtimes without a native `Symbol.metadata` use
 *   `Symbol.for("Symbol.metadata")`, the same fallback transpilers use.
 *
 * The second part of this module declares the records the DI decorators write
 * ({@link InjectableDescriptor}, {@link ControllerDescriptor} and
 * {@link ModuleDescriptor}). They are the contract between the decorators,
 * which write them, and the metadata graph, which reads them.
 *
 * @module
 */

import type { Any, Ctr, Dependency, Provider, Target, Token } from "./types.ts";

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
 * read_metadata_object(Db); // { isInjectable: true, dependencies: [Logger] }
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
 * The stored record is a frozen copy of `obj`. Top-level arrays are copied and
 * frozen too; nested values (such as provider objects inside an array) are
 * stored by reference.
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
  obj: Record<string, unknown>,
): void {
  const entries = Object.entries(obj).map(([key, value]) =>
    [key, Array.isArray(value) ? Object.freeze([...value]) : value] as const
  );
  Object.defineProperty(own_bag(target, true), MetaKey, {
    value: Object.freeze(Object.fromEntries(entries)),
    writable: false,
    enumerable: false,
    configurable: true,
  });
}

/**
 * Merge properties into the CHO record of a target.
 *
 * Merge rules, per key:
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
  obj: Record<string, unknown>,
): void {
  const merged = new Map(
    Object.entries(read_metadata_object<Record<string, unknown>>(target) ?? {}),
  );
  for (const [key, value] of Object.entries(obj)) {
    const prev = merged.get(key);
    merged.set(
      key,
      Array.isArray(prev) && Array.isArray(value) ? [...prev, ...value] : value,
    );
  }
  write_metadata_object(target, Object.fromEntries(merged));
}

// Records written by the DI decorators
// -----------------------------------------------------------------------------

/**
 * The record `@Injectable` writes on a class.
 *
 * It is also the base of the `@Module` and `@Controller` records: modules and
 * controllers are injectable too.
 */
export type InjectableDescriptor = {
  /** Marks the class as injectable. */
  readonly isInjectable: true;
  /** The dependencies passed to the constructor, in argument order. */
  readonly dependencies: readonly Dependency[];
};

/**
 * The record `@Controller` writes on a class.
 *
 * A controller is an injectable class that an application module invokes
 * (for example a CLI command handler). Application modules can add their own
 * keys to this record; the DI system ignores them.
 */
export type ControllerDescriptor = InjectableDescriptor & {
  /** Marks the class as a controller. */
  readonly isController: true;
};

/**
 * The record `@Module` writes on a class.
 *
 * A module is injectable itself: `dependencies` are passed to its own
 * constructor. Extra `@Module` options and application modules' own keys are
 * stored in this record too; the DI system ignores them.
 */
export type ModuleDescriptor = InjectableDescriptor & {
  /** Marks the class as a module. */
  readonly isModule: true;
  /** Modules whose exported tokens this module can inject. */
  readonly imports: readonly Ctr[];
  /** Tokens that modules importing this module can inject. */
  readonly exports: readonly Token[];
  /** `@Injectable` classes and provider objects this module declares. */
  readonly providers: readonly (Provider | Ctr)[];
  /** `@Controller` classes this module declares. */
  readonly controllers: readonly Ctr[];
};
