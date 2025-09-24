import { Ctr } from "../meta/mod.ts";

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

export function isClassImplement<T>(ctr: Ctr, method: string): ctr is Ctr<T> {
  return isClass(ctr) &&
    (typeof ctr.prototype[method as keyof typeof ctr.prototype] === "function");
}
