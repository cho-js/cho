/**
 * Environment variables, read the same way on Deno, Bun and Node.js (through
 * `process.env`). A variable that cannot be read is treated as not set.
 *
 * @module
 */

// declare var Deno: any;
// declare var Bun: any;
// declare var process: any;

/**
 * Get environment variable with support for Deno, Bun, and Node.js.
 *
 * @example
 * ```ts
 * const dbHost = env("DB_HOST") ?? "localhost";
 * ```
 *
 * @param key The variable name.
 * @return The value of the environment variable, or `undefined` if not set.
 * @category @chojs/core/internals
 */
export function env(key: string): string | undefined {
  try {
    const process = (globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }).process;
    return process?.env?.[key];
  } catch {
    // e.g. Deno without --allow-env
    return undefined;
  }
}

/**
 * Get environment variable as boolean.
 * Recognizes "1", "true", "yes", "on" (case-insensitive) as true.
 *
 * @example
 * ```ts
 * const isDebug = env_bool("DEBUG");
 * ```
 *
 * @param key The variable name.
 * @return The value of the environment variable as a boolean, or `false` if not set or not recognized as true.
 * @category @chojs/core/internals
 */
export function env_bool(key: string): boolean {
  const val = env(key);
  if (!val) return false;
  return ["1", "true", "yes", "on"].includes(val.toLowerCase());
}

/**
 * Get environment variable as number.
 *
 * @example
 * ```ts
 * const port = env_num("PORT") ?? 3000;
 * ```
 *
 * @param key The variable name.
 * @return The value of the environment variable as a number, or `NaN` if not set or not a valid number.
 * @category @chojs/core/internals
 */
export function env_num(key: string): number {
  return Number(env(key));
}
