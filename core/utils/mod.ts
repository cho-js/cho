/**
 * Utils
 *
 * @example using env variables
 * ```ts
 * import {env} from "@chojs/core/utils";
 *
 * const nodeEnv = env("NODE_ENV") ?? "development";
 * ```
 *
 * @module
 */
export * from "./debuglog.ts";
export * from "./env.ts";
