/**
 * Runtime utilities shared by the CHO packages: environment variables, debug
 * logging, runtime detection and readable names for error messages.
 *
 * @module
 */

export { env, env_bool, env_num, type EnvSource, set_env } from "./env.ts";
export { engine, type EngineType } from "./engine.ts";
export { describe } from "./describe.ts";
export { debuglog } from "./debuglog.ts";
export { isClass, isClassImplement } from "./is.ts";
export type { Debuglog } from "./debuglog.ts";
