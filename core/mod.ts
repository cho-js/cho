/**
 * # @chojs/core
 *
 * Core modules for the **_CHO_** framework.
 *
 * The CHO core module provides the fundamental building blocks for the **CHO**
 * framework, including dependency injection, metadata handling, and application
 * lifecycle management.
 *
 * ## Public API
 *
 * | Feature                   | Description                                    |
 * |---------------------------|------------------------------------------------|
 * | Decorators               | `@Injectable`, `@Module`, `@Controller`, etc.   |
 *
 * ## Submodules
 *
 * | Submodule                 | Description                                    |
 * |---------------------------|------------------------------------------------|
 * | `@chojs/core/internals`   | Chojs engine, DI, etc.                         |
 * | `@chojs/core/testing`     | Tests runner                                   |
 * | `@chojs/core/utils`       | Core utilities
 *
 * @module
 */
export * from "./decorators.ts";
