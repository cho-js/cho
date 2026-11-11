import type { Ctr } from "../di/types.ts";

/**
 * Check if a value is a class constructor.
 *
 * @example
 * ```ts
 * class MyClass {}
 * function myFunction() {}
 *
 * console.log(isClass(MyClass));
 * // true
 * console.log(isClass(myFunction));
 * // false
 * console.log(isClass({}));
 * // false
 * ```
 * @param v
 */
export function isClass(v: unknown): v is Ctr {
  if (typeof v !== "function") {
    return false;
  }
  const descriptor = Object.getOwnPropertyDescriptor(v, "prototype");
  return !!descriptor && descriptor.writable === false;
}

/**
 * Check if a value is a class whose prototype has a given method.
 *
 * @param v The value to check.
 * @param method The method name.
 */
export function isClassImplement<T>(v: unknown, method: string): v is Ctr<T> {
  return isClass(v) && typeof v.prototype?.[method] === "function";
}
