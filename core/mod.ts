/**
 * # @chojs/core
 *
 * Core modules for the **_CHO_** framework.
 *
 * The CHO core module provides the fundamental building blocks for the **CHO**
 * framework, including dependency injection, metadata handling, and application
 * lifecycle management.
 *
 * ## Submodules
 *
 * | Submodule                 | Description                                   |
 * |---------------------------|-----------------------------------------------|
 * | `@chojs/core/meta`        | Metadata utilities                            |
 * | `@chojs/core/di`          | Dependency Injection                          |
 * | `@chojs/core/application` | Application lifecycle                         |
 * | `@chojs/core/testing`     | Tests runner                                  |
 * | `@chojs/core/utils`       | Core utilities
 *
 * @module
 */
export * from "./application/mod.ts";
export * from "./di/mod.ts";
export * from "./meta/mod.ts";
export * from "./testing/mod.ts";
export * from "./utils/mod.ts";
