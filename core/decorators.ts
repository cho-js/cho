import type {
  ChoErrorHandler,
  ChoErrorHandlerFn,
  ControllerDescriptor,
  InjectableDescriptor,
  ModuleDescriptor,
  Token,
} from "./internals/types.ts";
import type { Any, Ctr, Target } from "./internals/meta.ts";
import { addToMetadataObject, normTarget } from "./internals/meta.ts";

/**
 * Mark a class as injectable and create its provider.
 *
 * @example usage without dependencies:
 * ```ts
 * @Injectable()
 * class MyService {}
 * ```
 *
 * @example usage with dependencies:
 * ```ts
 * @Injectable({
 *  deps: [Dep1, Dep2]
 * })
 * class MyService {
 *   constructor(private dep1: Dep1, private dep2: Dep2) {}
 * }
 * ```
 */
export function Injectable(
  descriptor: Partial<InjectableDescriptor> = {},
): ClassDecorator {
  return (target: Target) => {
    addToMetadataObject(target, { isInjectable: true, ...descriptor });
  };
}

/**
 * Mark a class as a module.
 * Modules can import other modules and provide services.
 * Module is an injectable itself and can have its own dependencies.
 *
 * @example usage:
 * ```ts
 * @Module({
 *   deps: [Dep1, Dep2], // optional dependencies for the module itself
 *   imports: [OtherModule],
 *   providers: [MyService, { provide: "API_URL", factory: () => Promise.resolve("https://api.example.com") }],
 * })
 */
export function Module(
  descriptor: Partial<ModuleDescriptor> = {},
): ClassDecorator {
  return (target: Target) => {
    addToMetadataObject(target, { isModule: true, ...descriptor });
  };
}

/**
 * Mark a class as a controller (gateway) for any CHO application.
 * Controllers can have their own route prefix (supported applications), middlewares, and error handlers.
 * Controller is an injectable itself and can have its own dependencies.
 *
 * @param route
 * @constructor
 */
export function Controller(
  route?: string | Partial<ControllerDescriptor>,
): ClassDecorator {
  let desc: Partial<ControllerDescriptor> = {};
  if (route && typeof route === "string") {
    desc.route = route;
  }
  if (route && typeof route === "object") {
    desc = route;
  }
  desc.isGateway = true;

  return (target: Target) => {
    addToMetadataObject(target, desc);
  };
}

/**
 * Add dependencies to an injectable dependency list.
 * Another way to specify dependencies instead of using the `deps` property in `@Injectable` or `@Module`.
 *
 * @example usage:
 * ```ts
 * @Injectable()
 * @Dependencies(Dep1, Dep2)
 * class MyService {
 *  constructor(private dep1: Dep1, private dep2: Dep2) {}
 * }
 * ```
 *
 * @param deps
 * @constructor
 */
export function Dependencies(
  ...deps: Token[]
): ClassDecorator {
  return (target: Target) => {
    addToMetadataObject(target, { deps, isInjectable: true });
  };
}

/**
 * Alias for `Dependencies` decorator.
 */
export const Deps = Dependencies; // alias

/**
 * Add providers to a module's provider list.
 * Another way to specify providers instead of using the `providers` property in `@Module`.
 *
 * @param providers
 * @constructor
 */
export function Providers(
  ...providers: (Token | Ctr)[]
): ClassDecorator {
  return (target: Target) => {
    addToMetadataObject(target, { providers, isModule: true });
  };
}

/**
 * Add imported modules to a module's import list.
 * Another way to specify imports instead of using the `imports` property in `@Module`.
 *
 * @param imports
 * @constructor
 */
export function Imports(
  ...imports: Ctr[]
): ClassDecorator {
  return (target: Target) => {
    addToMetadataObject(target, { imports, isModule: true });
  };
}

/**
 * Adds middleware to a class or method.
 * Can be applied to modules, controllers, or individual methods.
 *
 * @param middlewares - Array of middleware classes or functions
 * @example
 * ```ts
 * @Controller("/api")
 * @Middlewares(AuthMiddleware, LoggingMiddleware)
 * class ApiController {
 *   @Get("/users")
 *   @Middlewares(CacheMiddleware)
 *   getUsers() { ... }
 * }
 * ```
 */
export function Middlewares(
  ...middlewares: (Ctr | Target)[]
): ClassDecorator & MethodDecorator {
  return (target: Any, key?: string | symbol) => {
    addToMetadataObject(normTarget(target, key), { middlewares });
  };
}

/**
 * Adds an error handler to an entity (class or method).
 * @param errorHandler
 */
export function Catch(
  errorHandler: ChoErrorHandler | ChoErrorHandlerFn,
): ClassDecorator & MethodDecorator {
  return (target: Any, key?: string | symbol) => {
    addToMetadataObject(normTarget(target, key), { errorHandler });
  };
}
