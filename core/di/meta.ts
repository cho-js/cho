/**
 * MetaTypes
 * =========
 * Sometimes we need to use `any` type or `Function` type in TypeScript,
 * but it's generally discouraged.
 * However, in the context of dependency injection and dynamic resolution,
 * we often need to work with generic types and dynamic values.
 * Therefore, we define these types here for convenience.
 */

/**
 * Real any type.
 * @internal
 */
// deno-lint-ignore no-explicit-any
export type Any = any;

/**
 * Real Function type.
 * @internal
 */
// deno-lint-ignore ban-types
export type Target = Function;

/**
 * Instance type for objects.
 * This is a utility type that represents an instance of a given object type.
 * @internal
 */
export type Instance<T extends object = object> = T;

/**
 * Constructor type for classes.
 */
export type Ctr<T = Any> = new (...args: Any[]) => T;

/**
 * Class decorator context (decorators stage 3, TC39)
 * This is used in class decorators to provide metadata and utilities.
 * @see https://github.com/tc39/proposal-decorators
 * @internal
 */
export type MethodContext = {
  kind: string;
  name: string;
  static: boolean;
  private: boolean;
  metadata: object;
  addInitializer: (fn: () => void) => void;
  access: { get: () => unknown };
};

/**
 * Class method decorators receive the method that is being decorated as the first value,
 * and can optionally return a new method to replace it. If a new method is returned,
 * it will replace the original on the prototype (or on the class itself in the case of static methods).
 * If any other type of value is returned, an error will be thrown.
 * @see https://github.com/tc39/proposal-decorators?tab=readme-ov-file#class-methods
 */
export type ClassDecorator = (value: Function, context: {
  kind: "class";
  name: string | undefined;
  addInitializer(initializer: () => void): void;
}) => Function | void | Any;

/**
 * Class decorators receive the class that is being decorated as the first parameter,
 * and may optionally return a new callable (a class, function, or Proxy) to replace it.
 * If a non-callable value is returned, then an error is thrown.
 * @see https://github.com/tc39/proposal-decorators?tab=readme-ov-file#class-methods
 */
export type ClassMethodDecorator = (value: Function, context: {
  kind: "method";
  name: string | symbol;
  access: { get(): unknown };
  static: boolean;
  private: boolean;
  addInitializer(initializer: () => void): void;
}) => Function | void;

// metadata read/write utilities
// ------------------------------------

// const MetaKey = Symbol("meta");
const MetaKey = "___cho_meta___";

/**
 * Read a metadata value from a target.
 * Returns undefined if the key does not exist.
 *
 * @param target
 * @param key
 * @returns T | undefined
 */
export function read<T = unknown>(
  target: Target,
  key: symbol | string,
): T | undefined {
  if (key in target) {
    return target[key as keyof typeof target] as T;
  }
  return undefined;
}

/**
 * Write a metadata value to a target.
 *
 * @param target
 * @param key
 * @param value
 */
export function write(
  target: Target,
  key: symbol | string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    value,
    writable: false,
    enumerable: false,
    configurable: false,
  });
}

/**
 * Read the metadata object from a target.
 * Returns undefined if no metadata object is found.
 *
 * @template T
 * @param target
 * @returns T | undefined
 */
export function readMetadataObject<T>(
  target: Target,
): T | undefined {
  return read<T>(target, MetaKey);
}

/**
 * Write a metadata object to a target.
 *
 * @param target
 * @param obj
 */
export function writeMetadataObject(
  target: Target,
  obj: Record<string, unknown>,
) {
  write(target, MetaKey, obj);
}

/**
 * Add properties to the metadata object of a target.
 * Merges with existing metadata object if present.
 *
 * @param target
 * @param obj
 */
export function addToMetadataObject(
  target: Target,
  obj: Record<string, unknown>,
) {
  const existing = readMetadataObject<Record<string, unknown>>(target) ?? {};
  // merge arrays, overwrite other types
  for (const key in obj) {
    if (
      key in existing &&
      Array.isArray(existing[key]) &&
      Array.isArray(obj[key])
    ) {
      existing[key].push(...obj[key]);
    } else {
      existing[key] = obj[key];
    }
  }
  writeMetadataObject(target, existing);
}

export type Metadata = Record<string, unknown>;
export type MetaDecoratorFactory<T extends Metadata> = (
  desc?: Partial<T>,
) => ClassDecorator;

/**
 * class decorator factory that writes metadata to the target
 *
 * @example
 * ```ts
 * interface MyMeta {
 *   role: string;
 *   permissions: string[];
 * }
 *
 * const MyMetaDecorator = createMetaDecorator<MyMeta>();
 * ```
 *
 * // todo mark not suppose to be any
 */
export function createMetaDecorator<T extends Metadata>(
  mark: Record<string, boolean> = {},
): MetaDecoratorFactory<T> {
  return (desc: Partial<T> = {}) => (target: Target) => {
    addToMetadataObject(target, { ...desc, ...mark });
  };
}
