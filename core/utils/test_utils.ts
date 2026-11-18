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
 * {@link check_codes} checks the error codes of a package against its
 * documentation and its tests.
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

/**
 * Check the error codes of a package against what it documents and what it
 * tests:
 *
 * - every code is in the document, and the document has no other code with
 *   the prefix of the package;
 * - every code is named by a test of the package, other than the test that
 *   calls this function.
 *
 * It reads files, so it needs a permission on Deno (`--allow-read`). Without
 * it nothing is checked, and `undefined` is returned; so it is where the test
 * is not a file (a bundle, as on Cloudflare Workers).
 *
 * @param codes The codes of the package.
 * @param prefix What the codes of the package start with: `"CHO_WEB_"`.
 * @param url `import.meta.url` of the test: the folder of the package is the
 *   one it is in.
 * @param doc The document with the table of the codes, from that folder:
 *   `"specs.md"`.
 * @returns What is wrong, one line for each problem: an empty list when
 *   nothing is. `undefined` when the files cannot be read.
 *
 * @example
 * ```ts
 * const problems = await check_codes(CODES, "CHO_WEB_", import.meta.url, "specs.md");
 * assert.deepEqual(problems ?? [], []);
 * ```
 */
export async function check_codes(
  codes: readonly string[],
  prefix: string,
  url: string,
  doc: string,
): Promise<string[] | undefined> {
  // A bundled test, as on Cloudflare Workers, has no files beside it.
  if (typeof url !== "string" || !url.startsWith("file:")) {
    return undefined;
  }
  const fs = await import("node:fs");
  const root = new URL(".", url);
  const itself = new URL(url).pathname;
  let documented: string;
  let tests = "";
  try {
    documented = fs.readFileSync(new URL(doc, root), "utf8");
    const read = (dir: URL) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          if (entry.name !== "node_modules") {
            read(new URL(`${entry.name}/`, dir));
          }
          continue;
        }
        const file = new URL(entry.name, dir);
        if (entry.name.endsWith("_test.ts") && file.pathname !== itself) {
          tests += fs.readFileSync(file, "utf8");
        }
      }
    };
    read(root);
  } catch (error) {
    const name = (error as { name?: unknown } | null)?.name;
    if (name === "NotCapable" || name === "PermissionDenied") {
      return undefined;
    }
    throw error;
  }
  const known = new Set(codes);
  const in_doc = new Set(
    documented.match(new RegExp(`\\b${prefix}[A-Z0-9_]*[A-Z0-9]\\b`, "g")),
  );
  const problems: string[] = [];
  for (const code of known) {
    if (!in_doc.has(code)) {
      problems.push(`${code} is not in ${doc}`);
    }
    // The whole code: not the start of a longer one.
    if (!new RegExp(`\\b${code}\\b`).test(tests)) {
      problems.push(`${code} is not thrown by a test`);
    }
  }
  for (const code of in_doc) {
    if (!known.has(code)) {
      problems.push(`${code} is in ${doc}, and is not a code of the package`);
    }
  }
  return problems;
}
