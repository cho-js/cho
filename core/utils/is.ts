import type { Ctr } from "../di/types.ts";

/**
 * Check if a value is a class constructor.
 *
 * @example
 * ```ts
 * class MyClass {}
 * function myFunction() {}
 *
 * console.log(is_class(MyClass));
 * // true
 * console.log(is_class(myFunction));
 * // false
 * console.log(is_class({}));
 * // false
 * ```
 * @param v
 */
export function is_class(v: unknown): v is Ctr {
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
export function is_class_implement<T>(v: unknown, method: string): v is Ctr<T> {
  return is_class(v) && typeof v.prototype?.[method] === "function";
}
