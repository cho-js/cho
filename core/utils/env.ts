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
 * @param key
 * @return The value of the environment variable, or `undefined` if not set.
 * @category @chojs/core/utils
 */
export function env(key: string): string | undefined {
  // @ts-ignore: used to support multiple runtimes
  if ("process" in globalThis && globalThis.process?.env) {
    // @ts-ignore: used to support multiple runtimes
    return globalThis.process.env[key];
  }
  // @ts-ignore: used to support multiple runtimes
  if ("Deno" in globalThis && Deno?.env?.get) {
    // TODO: remove the try-catch? Let the user know about permission errors?
    try {
      // @ts-ignore: used to support multiple runtimes
      return globalThis.Deno.env.get(key);
    } catch (err) {
      return undefined;
    }
  }
  // @ts-ignore: used to support multiple runtimes
  if ("Bun" in globalThis && globalThis.Bun?.env) {
    // @ts-ignore: used to support multiple runtimes
    return globalThis.Bun.env[key];
  }
  return undefined;
}

/**
 * Get environment variable as number.
 *
 * @example
 * ```ts
 * const port = envnum("PORT") ?? 3000;
 * ```
 *
 * @param key
 * @return The value of the environment variable as a number, or `NaN` if not set or not a valid number.
 * @category @chojs/core/utils
 */
export function envnum(key: string): number {
  return Number(env(key));
}

/**
 * Get environment variable as boolean.
 * Recognizes "1", "true", "yes", "on" (case-insensitive) as true.
 *
 * @param key
 * @return The value of the environment variable as a boolean, or `false` if not set or not recognized as true.
 * @category @chojs/core/utils
 */
export function envbool(key: string): boolean {
  const val = env(key);
  if (!val) return false;
  return ["1", "true", "yes", "on"].includes(val.toLowerCase());
}
