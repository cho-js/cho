/**
 * Handle classes: what a CHO module accepts where it accepts a function. A
 * middleware or an error handler is a function, or a class with a `handle`
 * method that the injector creates, so that it can have dependencies.
 *
 * Shared by the CHO modules (`@chojs/web`, `@chojs/command`), so they accept
 * the same values and report the same mistakes.
 *
 * @module
 */

import type { Injector } from "./injector.ts";
import type { Ctr } from "./types.ts";
import { describe } from "../utils/describe.ts";
import { is_class, is_class_implement } from "../utils/is.ts";

/**
 * Whether a value is a handle class: a class whose prototype has a `handle`
 * method.
 *
 * @typeParam F The type of the `handle` method.
 * @param value The value to check.
 */
export function is_handle_class<F>(
  value: unknown,
): value is Ctr<{ handle: F }> {
  return is_class_implement<{ handle: F }>(value, "handle");
}

/**
 * Assert that a value can be used as a middleware or an error handler: a
 * function, or a handle class. Nothing is created.
 *
 * @param value The declared value.
 * @param what What it is, capitalized, for the message: `"Middleware"`,
 *   `"Error handler"`.
 * @throws {Error} When it is a class without a `handle` method
 *   (`<what> class X must implement 'handle' method.`), or not a function at
 *   all (`Invalid <what> <v>: must be a function or a class with a 'handle'
 *   method.`).
 */
export function assert_handle(value: unknown, what: string): void {
  if (is_class(value) && !is_handle_class(value)) {
    throw new Error(
      `${what} class ${describe(value)} must implement 'handle' method.`,
    );
  }
  if (typeof value !== "function") {
    throw new Error(
      `Invalid ${what.toLowerCase()} ${
        describe(value)
      }: must be a function or a class with a 'handle' method.`,
    );
  }
}

/**
 * The function to call for a middleware or an error handler: the function
 * itself, or the `handle` method of the instance the injector creates for a
 * handle class, bound to it and named after its class (`Auth.handle`), for
 * error messages.
 *
 * @typeParam F The type of the function.
 * @param injector The injector of the application.
 * @param value The function or the handle class (see {@link assert_handle}).
 * @param scope The module in whose scope a class is resolved.
 * @returns The function to call.
 * @throws (as a rejection) What `Injector.resolve` rejects with, when the
 *   class is not visible in the module or cannot be created.
 */
export async function resolve_handle<F>(
  injector: Injector,
  value: unknown,
  scope: Ctr,
): Promise<F> {
  if (!is_handle_class<F>(value)) {
    return value as F;
  }
  const instance = await injector.resolve(value, scope);
  const handle = (instance.handle as (...args: unknown[]) => unknown)
    .bind(instance);
  Object.defineProperty(handle, "name", {
    value: `${describe(value)}.handle`,
  });
  return handle as F;
}
