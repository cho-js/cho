/**
 * # CHO Core Framework Module
 *
 * The CHO core module provides the fundamental building blocks for the CHO framework,
 * including dependency injection, metadata handling, and runtime utilities. This module
 * is framework-agnostic and provides the foundation for building modular applications
 * using JavaScript stage 3 decorators.
 *
 * ## Key Features
 *
 * - **Dependency Injection System**: Complete DI container with `@Injectable` and `@Module` decorators
 * - **Metadata Management**: Low-level metadata utilities for decorator implementation
 * - **Runtime Utilities**: Cross-platform environment variables and debug logging
 * - **Type Safety**: Strong TypeScript support with utility types for dynamic resolution
 * - **Multi-Runtime Support**: Works with Deno, Node.js, Bun, and other JavaScript runtimes
 *
 * ## Core Concepts
 *
 * ### Dependency Injection
 * Create injectable services and organize them into modules:
 * ```ts
 * @Injectable({ deps: [DatabaseService] })
 * class UserService {
 *   constructor(private db: DatabaseService) {}
 * }
 *
 * @Module({
 *   imports: [DatabaseModule],
 *   providers: [
 *     {
 *      provide: UserService,
 *      factory: (injector) => {
 *          const db = injector.resolve(DatabaseService);
 *          return new UserService(db);
 *     }
 *   ]
 * })
 * class UserModule {}
 * ```
 *
 * ### Metadata System
 * Store and retrieve metadata on classes and methods:
 * ```ts
 * // Write metadata
 * writeMetadataObject(MyClass, { role: "controller", route: "/api" });
 *
 * // Read metadata
 * const meta = readMetadataObject<{ role: string, route: string }>(MyClass);
 * ```
 *
 * ### Cross-Platform Utilities
 * Environment variables and debug logging that work across runtimes:
 * ```ts
 * const dbUrl = env("DATABASE_URL") ?? "sqlite://default.db";
 * const debug = debuglog("app:database");
 * debug("Connecting to database...");
 * ```
 *
 * ## Exported Modules
 *
 * ### Dependency Injection (`./di/`)
 *
 * **Decorators**:
 * - `Injectable(descriptor?)` - Mark a class as injectable with optional dependencies
 * - `Module(descriptor)` - Mark a class as a module with imports and providers
 *
 * **Core Classes**:
 * - `Injector` - DI container for resolving dependencies and managing instances
 *
 * **Type Definitions**:
 * - `Token` - Type for dependency injection tokens (string | symbol | constructor)
 * - `Provider<T>` - Type for dependency providers with token and factory
 * - `Factory<T>` - Type for factory functions that create instances
 * - `Resolver` - Interface for resolving dependencies
 * - `InjectableDescriptor` - Descriptor for injectable classes
 * - `ModuleDescriptor` - Descriptor for module classes
 * - `ClassDecorator` - Type for class decorators
 * - `ClassMethodDecorator` - Type for method decorators
 * - `MethodContext` - ChoWebContext object for method decorators
 *
 * ### Metadata System (`./meta/`)
 *
 * **Utility Types**:
 * - `Any` - Utility type for dynamic values (replaces `any`)
 * - `Target` - Utility type for function/class targets (replaces `Function`)
 * - `Instance<T>` - Type for object instances
 * - `Ctr<T>` - Type for class constructors
 *
 * **Metadata Functions**:
 * - `read<T>(target, key)` - Read metadata value from a target
 * - `write(target, key, value)` - Write metadata value to a target
 * - `readMetadataObject<T>(target)` - Read the complete metadata object
 * - `writeMetadataObject(target, obj)` - Write a metadata object
 * - `addToMetadataObject(target, obj)` - Merge properties into existing metadata
 *
 * ### Runtime Utilities (`./utils/`)
 *
 * **Environment Variables**:
 * - `env(key)` - Get environment variable (supports Deno, Node.js, Bun)
 * - `envbool(key)` - Get environment variable as boolean
 * - `envnum(key)` - Get environment variable as number
 *
 * **Debug Logging**:
 * - `debuglog(context)` - Create a debug logger for a specific context
 *   - Supports timestamps, context filtering, and error logging
 *   - Configurable via `CHO_DEBUG`, `CHO_DEBUGLOG`, and related env vars
 *
 * ## Usage Examples
 *
 * ### Basic Dependency Injection
 * ```ts
 * import { Injectable, Module, Injector } from "@chojs/core";
 *
 * @Injectable()
 * class DatabaseService {
 *   connect() { return "Connected to DB"; }
 * }
 *
 * @Injectable({ deps: [DatabaseService] })
 * class UserService {
 *   constructor(private db: DatabaseService) {}
 *
 *   getUsers() {
 *     return this.db.connect() + " - Getting users";
 *   }
 * }
 *
 * @Module({
 *   providers: [
 *     { provide: DatabaseService, factory: () => new DatabaseService() },
 *     { provide: UserService, factory: (inj) => new UserService(inj.resolve(DatabaseService)) }
 *   ]
 * })
 * class AppModule {}
 *
 * const injector = await Injector.create(AppModule);
 * const userService = await injector.resolve(UserService);
 * ```
 *
 * ### Custom Metadata and Decorators
 * ```ts
 * import { writeMetadataObject, readMetadataObject, Target } from "@chojs/core";
 *
 * function MyDecorator(options: { name: string }) {
 *   return (target: Target) => {
 *     writeMetadataObject(target, { decoratorName: options.name });
 *   };
 * }
 *
 * @MyDecorator({ name: "example" })
 * class ExampleClass {}
 *
 * const meta = readMetadataObject<{ decoratorName: string }>(ExampleClass);
 * console.log(meta?.decoratorName); // "example"
 * ```
 *
 * ### Environment and Logging
 * ```ts
 * import { env, envbool, debuglog } from "@chojs/core";
 *
 * const port = env("PORT") ?? "3000";
 * const isDev = envbool("NODE_ENV") !== "production";
 *
 * const log = debuglog("app:server");
 * log(`Starting server on port ${port}`);
 * if (isDev) log("Development mode enabled");
 * ```
 */
export * from "./di/mod.ts";
export * from "./utils/mod.ts";
export * from "./meta/mod.ts";
export * from "./application/mod.ts";
