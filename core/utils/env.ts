/**
 * Environment variables, read the same way on every runtime.
 *
 * Variables come from the source given to {@link set_env}, if any, and then
 * from `process.env`, which Deno, Node.js and Bun provide. Runtimes without
 * `process` (Cloudflare Workers, browsers) pass their environment with
 * `set_env`. A variable that cannot be read is treated as not set.
 *
 * @module
 */

/**
 * An environment that {@link env} can read: a record of variables (such as a
 * Cloudflare Workers `env`), or a function that returns a variable's value.
 * Only string values count; any other value is treated as not set.
 */
export type EnvSource =
  | Readonly<Record<string, unknown>>
  | ((key: string) => unknown);

/** The source set with {@link set_env}, read before `process.env`. */
let source: EnvSource | undefined;

/**
 * Set where {@link env} reads variables from, before `process.env`.
 *
 * It applies to the whole program, until it is set again. Call it at startup,
 * before anything reads the environment: `debuglog()` reads it when a logger
 * is created.
 *
 * @param env The environment, or `undefined` to read `process.env` only.
 *
 * @example Cloudflare Workers
 * ```ts
 * import { env as worker_env } from "cloudflare:workers";
 *
 * set_env(worker_env);
 * ```
 *
 * @example A function
 * ```ts
 * set_env((key) => config.get(key));
 * ```
 */
export function set_env(env: EnvSource | undefined): void {
  source = env;
}

/**
 * Read an environment variable: from the {@link set_env} source first, then
 * from `process.env`.
 *
 * @example
 * ```ts
 * const dbHost = env("DB_HOST") ?? "localhost";
 * ```
 *
 * @param key The variable name.
 * @returns The variable's value, or `undefined` when it is not set or cannot
 *   be read.
 */
export function env(key: string): string | undefined {
  if (source) {
    try {
      const value = typeof source === "function" ? source(key) : source[key];
      if (typeof value === "string") {
        return value;
      }
    } catch {
      // a source that throws is treated as not having the variable
    }
  }
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
 * Read an environment variable as a boolean: `1`, `true`, `yes` and `on`, in
 * any case, are `true`; anything else, or no value, is `false`.
 *
 * @example
 * ```ts
 * const isDebug = env_bool("DEBUG");
 * ```
 *
 * @param key The variable name.
 * @returns Whether the variable is set to a true value.
 */
export function env_bool(key: string): boolean {
  const val = env(key);
  if (!val) return false;
  return ["1", "true", "yes", "on"].includes(val.toLowerCase());
}

/**
 * Read an environment variable as a number.
 *
 * @example
 * ```ts
 * const port = env("PORT") ? env_num("PORT") : 3000;
 * ```
 *
 * @param key The variable name.
 * @returns The variable's value as a number: `NaN` when it is not set or not a
 *   number.
 */
export function env_num(key: string): number {
  return Number(env(key));
}
