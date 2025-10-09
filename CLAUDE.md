# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CHO is a tiny decorator-based framework for building modular applications using JavaScript stage 3 decorators (TC39 proposal). It's inspired by Angular, NestJS, and Spring but designed to be:
- **Cross-runtime**: Works with Deno, Node.js, Bun, Cloudflare Workers, AWS Lambda
- **Performance-focused**: Minimalistic and optimized
- **Standardized**: Consistent decorator implementation across runtimes

The repository is a monorepo containing multiple packages:
- `@chojs/core` - DI system, metadata management, runtime utilities (in `/core`)
- `@chojs/command` - CLI applications with decorators (in `/command`)
- `@chojs/web` - Web framework (in `/web`)
- `@chojs/vendor-hono` - Hono adapter (in `/vendor`)
- `@chojs/dev` - Development utilities (in `/dev`)

## Development Commands

### Testing
```bash
# Run all tests (Deno)
deno task test

# Run tests for specific runtime
deno task test-node    # Node.js with tsx
deno task test-bun     # Bun

# Run single test file
deno test --allow-env core/di/injector_test.ts
```

### Formatting
```bash
deno fmt
```

## Architecture

### Core System Architecture

The framework operates in three main phases:

1. **Graph Building** (`core/application/graph-builder.ts`)
   - Reads decorator metadata from module/controller/method classes
   - Constructs a dependency graph (`ModuleNode` tree)
   - Validates that all classes have required decorators (@Module, @Controller)
   - Each node contains: metadata, middlewares, error handlers, and children (imports/controllers/methods)

2. **Compilation** (`core/application/compiler.ts`)
   - Takes the module graph and produces executable compiled modules
   - Creates/resolves DI injectors for each module
   - Instantiates controllers and resolves all dependencies
   - Converts middleware/error handler classes to functions
   - Returns `CompiledModule` with instantiated handlers ready for execution

3. **Application Runtime** (`web/application.ts`, `command/application.ts`)
   - Takes compiled modules and binds them to an adapter (Hono for web, minimist for CLI)
   - Web: Maps HTTP routes from method metadata to framework routes
   - Command: Maps CLI commands from method metadata to CLI handlers

### Dependency Injection System

The DI system (`core/di/`) implements a hierarchical injector pattern:

- **Injector** (`core/di/injector.ts`): Container that manages providers and resolves dependencies
  - Each module gets its own injector instance stored via metadata
  - Injectors search locally first, then recursively search imported modules
  - Implements circular dependency detection
  - Caches resolved instances (singleton by default)

- **Provider resolution flow**:
  1. Check cache for already-resolved instance
  2. Find provider by token in local providers array
  3. If not found, search imported modules recursively
  4. Call provider factory with injector as resolver
  5. Cache and return instance

- **Decorators** (`core/di/decorators.ts`):
  - `@Injectable({ deps: [Token] })` - Marks class and declares constructor dependencies
  - `@Module({ imports, providers, controllers })` - Defines a module's structure
  - `@Dependencies(Token, ...)` - Syntactic sugar, equivalent to `@Injectable({ deps: [...] })`

### Metadata System

The metadata system (`core/meta/`) is a thin wrapper around WeakMap for storing decorator metadata:
- `read(target, key)` / `write(target, key, value)` - Low-level metadata access
- `readMetadataObject(target)` / `writeMetadataObject(target, obj)` - Read/write entire metadata objects
- All decorator metadata is stored on the class/method using this system
- Type-safe with generics: `readMetadataObject<ModuleDescriptor>(MyModule)`

### Hooks System

The hooks system (`core/application/hooks.ts`) provides lifecycle events during compilation:
- Modules can implement hooks like `onModuleInit()` or `onBootstrap()`
- Used for initialization logic after DI resolution but before app starts

## Key Patterns

### Controller Pattern
Controllers are classes decorated with `@Controller(route)` that contain handler methods:
```ts
@Controller("api")
class DataController {
  @Get("data/:id")
  getData(@Params("id") id: string) {
    return { id };
  }
}
```

### Module Pattern
Modules organize controllers and providers:
```ts
@Module({
  imports: [OtherModule],
  providers: [Service, { provide: "TOKEN", factory: () => "value" }],
  controllers: [DataController]
})
class AppModule {}
```

### Provider Pattern
Providers define how to create dependencies:
```ts
{
  provide: Service,  // Token to identify dependency
  factory: (resolver) => new Service()  // Factory receives resolver for nested deps
}
```

## Testing Patterns

Tests use Deno's standard testing library (`@std/testing`, `@std/expect`):
- Test files follow `*_test.ts` pattern
- Use `describe()` and `it()` for test organization
- Use `expect()` assertions from `@std/expect`
- Tests must pass for all three runtimes (Deno, Node, Bun)

## Important Notes

- The framework uses stage 3 decorators, not experimental TypeScript decorators
- All core functionality is runtime-agnostic - avoid Node.js/Deno-specific APIs in core
- Use `@chojs/core/utils` for cross-runtime utilities (env vars, debug logging)
- The metadata system uses WeakMap, so metadata is garbage-collected with classes
- Providers use "last wins" strategy - duplicate tokens will use the last registered provider
