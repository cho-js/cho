/**
 * Debug logging by context, enabled from the environment:
 *
 * - `CHO_DEBUG=1` enables every context;
 * - `CHO_DEBUGLOG` enables a comma-separated list of contexts, where `*`
 *   matches every context and `name*` every context that starts with `name`
 *   (`CHO_DEBUGLOG=di:*,cho`).
 *
 * The environment is read when a logger is created. Logs go to stderr.
 *
 * @module
 */

import { env, env_bool } from "./env.ts";

/** A logger for one context. */
export type Debuglog = {
  (...args: unknown[]): void;
  /** Log an error message. */
  error(...args: unknown[]): void;
  /** Start a timer; the returned logger appends the elapsed time. */
  start(): (...args: unknown[]) => void;
  /** Whether this context logs; check it before building costly messages. */
  readonly enabled: boolean;
};

/**
 * Whether a context is enabled by `CHO_DEBUG` / `CHO_DEBUGLOG`.
 *
 * @param context The context name.
 */
export function isEnabled(context: string): boolean {
  if (env_bool("CHO_DEBUG")) {
    return true;
  }
  return (env("CHO_DEBUGLOG") ?? "")
    .split(",")
    .map((pattern) => pattern.trim())
    .some((pattern) =>
      pattern === "*" || pattern === context ||
      (pattern.endsWith("*") && context.startsWith(pattern.slice(0, -1)))
    );
}

/** `HH:MM:SS.mmm` of the current local time. */
function timestamp(): string {
  const now = new Date();
  const pad = (n: number, width = 2) => String(n).padStart(width, "0");
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${
    pad(now.getSeconds())
  }.${pad(now.getMilliseconds(), 3)}`;
}

/** The logger of a disabled context, and all its methods. */
const noop = () => {};

/**
 * Create a logger for a context. When the context is disabled, every method is
 * a no-op.
 *
 * @param context name of the logging context, e.g. `di:injector`
 */
export function debuglog(context: string): Debuglog {
  if (!isEnabled(context)) {
    return Object.assign(noop, {
      error: noop,
      start: () => noop,
      enabled: false,
    });
  }
  const log = (...args: unknown[]) =>
    console.error(timestamp(), context, ...args);
  return Object.assign(log, {
    error: (...args: unknown[]) =>
      console.error(timestamp(), context, "ERROR", ...args),
    start: () => {
      const started = performance.now();
      return (...args: unknown[]) =>
        log(...args, `+${Math.round(performance.now() - started)}ms`);
    },
    enabled: true,
  });
}
