/**
 * Test helpers for CHO packages: applying decorators without decorator syntax,
 * and capturing console output.
 *
 * Imported as `@chojs/core/utils/test_utils`. It is not part of the runtime
 * API, and nothing in `@chojs/core` imports it outside of tests.
 *
 * Decorators are applied as plain function calls, so tests run on every
 * runtime, including Node, which has no decorator syntax:
 *
 * - {@link legacy} calls a method decorator the legacy / Bun way:
 *   `(prototype, name, descriptor)`;
 * - {@link tc39} calls it the TC39 way: `(method, context)`.
 *
 * {@link with_env} sets environment variables for the duration of a test.
 *
 * @module
 */

import { read_method_metadata } from "../di/metadata.ts";
import type { Ctr } from "../di/types.ts";

/** Bypass the parameter types, to pass the values JS callers can. */
// deno-lint-ignore no-explicit-any
export const loose = (value: unknown): any => value;

/** A method decorator, in either call shape. */
export type AnyMethodDecorator = (
  target: object,
  context: ClassMethodDecoratorContext | string | symbol,
  descriptor?: PropertyDescriptor,
) => void;

/**
 * Apply a method decorator the legacy / Bun way.
 *
 * @param decorator The decorator.
 * @param ctr The class that has the method.
 * @param name The method name. A static method is looked up on the class.
 */
export function legacy(
  decorator: AnyMethodDecorator,
  ctr: Ctr,
  name: string,
  { isStatic = false } = {},
): void {
  const owner = isStatic ? ctr : ctr.prototype;
  decorator(owner, name, Object.getOwnPropertyDescriptor(owner, name));
}

/** A TC39 method decorator context. */
export function method_context(
  name: string | symbol,
  { isStatic = false, isPrivate = false } = {},
  metadata: DecoratorMetadataObject = {},
): ClassMethodDecoratorContext {
  return loose({
    kind: "method",
    name,
    static: isStatic,
    private: isPrivate,
    metadata,
    addInitializer: () => {},
  });
}

/**
 * The class metadata object {@link tc39} uses for each method function: the
 * decorators applied to one function share it, as the decorators of one
 * class do.
 */
// deno-lint-ignore ban-types
const tc39_metadata = new WeakMap<Function, DecoratorMetadataObject>();

/**
 * Apply a method decorator the TC39 way.
 *
 * @param decorator The decorator.
 * @param fn The method function.
 * @param name The method name, as `context.name`.
 * @returns The class metadata object given as `context.metadata`: the same
 *   one for every call with the same function.
 */
export function tc39(
  decorator: AnyMethodDecorator,
  // deno-lint-ignore ban-types
  fn: Function,
  name: string | symbol,
  flags: { isStatic?: boolean; isPrivate?: boolean } = {},
): DecoratorMetadataObject {
  let metadata = tc39_metadata.get(fn);
  if (!metadata) {
    metadata = {};
    tc39_metadata.set(fn, metadata);
  }
  decorator(fn, method_context(name, flags, metadata));
  return metadata;
}

/**
 * The record of a method decorated with {@link tc39}.
 *
 * @param fn The method function given to `tc39`.
 * @param name The method name given to `tc39`. Default: the function's name.
 * @returns The record, or `undefined` when the method has none.
 */
export function tc39_record(
  // deno-lint-ignore ban-types
  fn: Function,
  name: string | symbol = fn.name,
): unknown {
  const metadata = tc39_metadata.get(fn);
  return metadata ? read_method_metadata(metadata, name) : undefined;
}

/** What a function wrote to `console.log` and `console.error`. */
export type Output = { log: string[]; error: unknown[] };

/**
 * Run a function with `console.log` and `console.error` captured, and restore
 * them afterwards.
 *
 * @param fn The function to run.
 * @returns Its result, and what it wrote.
 */
export async function capture<T>(
  fn: () => T | Promise<T>,
): Promise<{ result: T; output: Output }> {
  const output: Output = { log: [], error: [] };
  const { log, error } = console;
  console.log = (...args: unknown[]) => output.log.push(args.join(" "));
  console.error = (...args: unknown[]) => output.error.push(...args);
  try {
    return { result: await fn(), output };
  } finally {
    console.log = log;
    console.error = error;
  }
}

/**
 * Run a function with environment variables overridden, then restore the
 * environment, even when it throws.
 *
 * The real environment is never changed. While `fn` runs, `globalThis.process`
 * is replaced by a stand-in (inheriting from the real one) whose `env` returns
 * the given values, and the real variables for every other name. So it needs
 * no permission (Deno's `--allow-env`), and tests cannot leak variables into
 * each other. Only code that reads `process.env` at call time sees the values,
 * as `env()` from `@chojs/core/utils` does.
 *
 * @param vars The variables to override; `undefined` makes a variable unset.
 * @param fn The function to run. It must be synchronous.
 *
 * @example
 * ```ts
 * with_env({ CHO_DEBUG: "1", CHO_DEBUGLOG: undefined }, () => {
 *   assert.equal(debuglog("cho").enabled, true);
 * });
 * ```
 */
export function with_env(
  vars: Record<string, string | undefined>,
  fn: () => void,
): void {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "process");
  const real = (globalThis as { process?: { env?: Record<string, unknown> } })
    .process;
  const env = new Proxy({}, {
    get(_target, key) {
      if (typeof key === "string" && Object.hasOwn(vars, key)) {
        return vars[key];
      }
      try {
        return real?.env?.[key as string];
      } catch {
        return undefined; // e.g. Deno without --allow-env
      }
    },
  });
  Object.defineProperty(globalThis, "process", {
    value: Object.create(real ?? null, { env: { value: env } }),
    configurable: true,
    writable: true,
  });
  try {
    fn();
  } finally {
    if (saved) Object.defineProperty(globalThis, "process", saved);
    else delete (globalThis as { process?: unknown }).process;
  }
}
