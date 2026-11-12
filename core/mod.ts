/**
 * @chojs/core — core building blocks of the CHO framework.
 *
 * @example
 * ```ts
 * import { Injectable, Module } from "@chojs/core";
 *
 * @Injectable()
 * class Logger {}
 *
 * @Module({ providers: [Logger] })
 * class AppModule {}
 * ```
 * @module
 */

export * from "./di/decorators.ts";
export * from "./di/injector.ts";
export { provider, token } from "./di/tokens.ts";
export type { Any, Ctr, Target } from "./di/types.ts";
