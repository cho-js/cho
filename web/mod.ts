/**
 * # CHO Web Framework Module
 *
 * The CHO web module provides a decorator-based framework for building modular web applications
 * using JavaScript stage 3 decorators. It's designed to be framework-agnostic and works with
 * various web frameworks through adapters.
 *
 * ## Key Features
 *
 * - **Decorator-based Architecture**: Uses `@Controller`, `@Feature`, and HTTP method decorators
 * - **Dependency Injection**: Built-in DI system with `@Injectable` classes
 * - **Type-safe Parameter Binding**: Extract and validate request data with `Params()`, `Body()`, etc.
 * - **ChoMiddlewareFn Support**: Apply middleware at feature, controller, or method level
 * - **Framework Agnostic**: Works with different web frameworks via adapters
 * - **Modular Design**: Organize code into features and controllers
 *
 * ## Core Concepts
 *
 * ### Controllers
 * Define API endpoints using the `@Controller` decorator and HTTP method decorators:
 * ```ts
 * @Controller("users")
 * class UserController {
 *   @Get(":id", [Params("id")])
 *   getUser(id: string) { ... }
 *
 *   @Post("", [Body()])
 *   createUser(userData: CreateUserDto) { ... }
 * }
 * ```
 *
 * ### Features
 * Group related functionality using the `@Feature` decorator:
 * ```ts
 * @Feature({
 *   controllers: [UserController, PostController],
 *   providers: [UserService, DatabaseService]
 * })
 * class UserFeature {}
 * ```
 *
 * ### Parameter Binding
 * Extract data from HTTP requests with type safety:
 * ```ts
 * @Get("users/:id", [
 *   Params("id", z.string().uuid()),
 *   Query("include"),
 *   Header("authorization")
 * ])
 * getUser(id: string, include: string, auth: string) { ... }
 * ```
 *
 * ## Exported Modules
 *
 * ### Decorators (`./decorators.ts`)
 * - **Class Decorators**:
 *   - `Controller(route, options?)` - Mark a class as a web controller
 *   - `Feature(options)` - Mark a class as a feature module
 *   - `Middlewares(...middlewares)` - Apply middleware to classes or methods
 *
 * - **HTTP Method Decorators**:
 *   - `Get(route, args?)` - Handle GET requests
 *   - `Post(route, args?)` - Handle POST requests
 *   - `Put(route, args?)` - Handle PUT requests
 *   - `Delete(route, args?)` - Handle DELETE requests
 *   - `Patch(route, args?)` - Handle PATCH requests
 *
 * - **Special Endpoint Decorators**:
 *   - `Sse(route, args?)` - Server-Sent Events endpoints
 *   - `WebSocket(route, args?)` - WebSocket endpoints
 *   - `Stream(route, args?)` - Streaming endpoints
 *
 * ### Parameter Functions (`./inputs.ts`)
 * - `Params(key?, validator?)` - Extract URL path parameters
 * - `Body(key?, validator?)` - Extract request body data
 * - `Query(key?, validator?)` - Extract query parameters
 * - `Header(key?, validator?)` - Extract request headers
 * - `Cookie(key?, validator?)` - Extract cookies
 *
 * ### Type Definitions (`./types.ts`)
 * - **Core Types**: `MethodType`, `ArgType`, `MethodArgType`
 * - **Descriptor Types**: `ControllerDescriptor`, `FeatureDescriptor`
 * - **Compilation Types**: `CompiledMethod`, `CompiledController`, `CompiledFeature`
 * - **ChoMiddlewareFn Types**: `ChoMiddlewareFn`, `Next`, `ChoMiddleware`, `ChoGuard`
 * - **Validation Types**: `Validator`, `ArgValidator`
 *
 * ### ChoWebContext Interface (`./context.ts`)
 * - `ChoWebContext<Ctx, Req, Res>` - Unified interface over different web frameworks
 * - `ParamsType<S>` - Type for URL parameters
 *
 * ### Compilation System (`./compiler.ts`)
 * - `compile(feature)` - Compile feature modules into linked structures
 *
 * ### Linking System (`./linker.ts`)
 * - `linker<App>(root, adapter)` - Link compiled features with framework adapters
 *
 * ### Adapter Interface (`./adapter.ts`)
 * - `Adapter<Application, Feature, Controller, ChoMiddlewareFn>` - Framework adapter interface
 *
 * ## Usage Example
 *
 * ```ts
 * import { Controller, Feature, Get, Post, Params, Body } from "@chojs/web";
 *
 * @Controller("users")
 * class UserController {
 *   @Get(":id", [Params("id")])
 *   getUser(id: string) {
 *     return { id, name: "John Doe" };
 *   }
 *
 *   @Post("", [Body()])
 *   createUser(userData: any) {
 *     return { id: "new-id", ...userData };
 *   }
 * }
 *
 * @Feature({
 *   controllers: [UserController]
 * })
 * class AppFeature {}
 * ```
 */
export * from "./adapter.ts";
export * from "./application.ts";
export * from "./context.ts";
export * from "./decorators.ts";
export * from "./inputs.ts";
export * from "./linker.ts";
export * from "./types.ts";
