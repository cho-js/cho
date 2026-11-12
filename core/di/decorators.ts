/**
 * The DI decorators, `@Injectable`, `@Module` and `@Controller`, and the
 * `@Middlewares` and `@Catch` decorators.
 *
 * Decorators only declare. Each one writes a record on the class (see
 * `metadata.ts`) and nothing else: no instance is created and nothing is
 * validated beyond the decorator's own arguments. The records are read later,
 * when an `Injector` is created for a root module.
 *
 * A class gets exactly one DI decorator. Dependencies are positional
 * constructor arguments, so combining the lists of two decorators would never
 * be correct; applying a second DI decorator throws.
 *
 * `@Middlewares` and `@Catch` are not DI decorators: they decorate a class or
 * a method, and can be combined with a DI decorator.
 *
 * The decorators work with TC39 standard decorators and with legacy or Bun
 * decorators (see `ChoClassDecorator` and `ChoClassOrMethodDecorator`).
 *
 * @module
 */

import type {
  ChoClassDecorator,
  ChoClassOrMethodDecorator,
  ChoErrorHandler,
  ChoMiddleware,
  Dependency,
} from "./types.ts";
import {
  assert_module_options,
  type ControllerOptions,
  decorated_target,
  type ExtraOptions,
  type ModuleOptions,
  type NoExtraOptions,
  set_controller,
  set_error_handler,
  set_injectable,
  set_middlewares,
  set_module,
} from "./decorations.ts";

export type {
  ControllerOptions,
  Dependency,
  ExtraOptions,
  ModuleOptions,
  NoExtraOptions,
};

/**
 * Mark a class as injectable.
 *
 * An injectable class can be listed in the `providers` of a module. The
 * injector then creates it by calling its constructor with the values of
 * `dependencies`, in order.
 *
 * @param dependencies The constructor's dependencies, in argument order.
 *   Defaults to `[]`.
 * @returns The class decorator.
 * @throws {Error} When the class already has a DI decorator.
 *
 * @example Without dependencies
 * ```ts
 * @Injectable()
 * class Logger {}
 * ```
 *
 * @example With dependencies
 * ```ts
 * const PORT = token<number>("PORT");
 *
 * @Injectable([Logger, PORT])
 * class Server {
 *   constructor(logger: Logger, port: number) {}
 * }
 * ```
 */
export function Injectable(dependencies: Dependency[] = []): ChoClassDecorator {
  return (target, context) => {
    const meta = context?.metadata ?? target;
    set_injectable(meta, { dependencies });
  };
}

/**
 * Mark a class as a module.
 *
 * A module groups providers and controllers, and controls what other modules
 * can use:
 *
 * - it can inject what it declares, and what its `imports` export;
 * - modules that import it can inject only what it `exports`.
 *
 * A module is injectable itself: the injector creates it with the values of
 * `dependencies`, which resolve in the module's own scope.
 *
 * @typeParam E The extra options a CHO module accepts (such as the `route` of
 *   `@chojs/web`), stored as is and handed back as `ModuleMetadata.options`.
 *   By default there is none, so an unknown option is a compile error.
 * @param options What the module imports, declares and exports. Every field
 *   defaults to `[]`.
 * @returns The class decorator.
 * @throws {Error} When the class already has a DI decorator.
 * @throws {Error} When an option is invalid. Nothing is written: the class is
 *   left undecorated.
 *
 * @example
 * ```ts
 * const API_URL = token<string>("API_URL");
 *
 * @Module({
 *   imports: [DbModule],
 *   providers: [
 *     UserService,
 *     provider({ provide: API_URL, factory: () => Promise.resolve("https://example.com") }),
 *   ],
 *   exports: [UserService],
 * })
 * class UserModule {}
 * ```
 */
export function Module<E extends ExtraOptions = NoExtraOptions>(
  options: Partial<ModuleOptions> & NoInfer<E> = {} as NoInfer<E>,
): ChoClassDecorator {
  return (target, context) => {
    const meta = context?.metadata ?? target;
    // Checked first, so a bad option leaves the class undecorated instead of
    // half-decorated (injectable, but not a module).
    assert_module_options(options);
    set_injectable(meta, { dependencies: options.dependencies ?? [] });
    set_module(meta, options);
  };
}

/**
 * Mark a class as a controller: an entry point of the application that an
 * application module invokes, such as a CLI command handler.
 *
 * A controller is declared in the `controllers` of a module, not in its
 * `providers`. It is injectable: the injector creates it with the values of
 * `dependencies`, which resolve in the scope of the module that declares it.
 *
 * CHO modules can accept options of their own (type parameter `E`), and
 * attach metadata to the controller's methods; the DI system collects both
 * (`ControllerMetadata.options` and `.methods`) but does not interpret them.
 *
 * @typeParam E The extra options a CHO module accepts (such as the `route` of
 *   `@chojs/web`), stored as is and handed back as
 *   `ControllerMetadata.options`. By default there is none, so an unknown
 *   option is a compile error.
 * @param options The controller's dependencies (default `[]`), plus the extra
 *   options of `E`.

 * @returns The class decorator.
 * @throws {Error} When the class already has a DI decorator, or when
 *   `dependencies` is invalid.
 *
 * @example
 * ```ts
 * @Controller({ dependencies: [Logger] })
 * class Cli {
 *   constructor(logger: Logger) {}
 * }
 *
 * @Module({ providers: [Logger], controllers: [Cli] })
 * class App {}
 * ```
 */
export function Controller<E extends ExtraOptions = NoExtraOptions>(
  options: Partial<ControllerOptions> & NoInfer<E> = {} as NoInfer<E>,
): ChoClassDecorator {
  return (target, context) => {
    const meta = context?.metadata ?? target;
    set_injectable(meta, { dependencies: options.dependencies ?? [] });
    set_controller(meta, options);
  };
}

/**
 * Declare middlewares for a class or a method.
 *
 * Unlike the DI decorators, it can be combined with any of them, and applied
 * several times: the middlewares are kept in source order, top decorator
 * first (see `set_middlewares`). The DI system only stores them; the
 * application module that runs the class or method uses them.
 *
 * @param middlewares The middlewares, in the order they run.
 * @returns A class or method decorator.
 * @throws {TypeError} When applied to anything other than a class or a method.
 * @throws {Error} When a middleware is not a function.
 *
 * @example
 * ```ts
 * @Middlewares(auth)
 * @Controller()
 * class Cli {
 *   @Middlewares(timing)
 *   @Action("copy")
 *   copy() {}
 * }
 * ```
 */
export function Middlewares(
  ...middlewares: ChoMiddleware[]
): ChoClassOrMethodDecorator {
  return (target, context, descriptor) => {
    const meta = decorated_target(
      "@Middlewares()",
      target,
      context,
      descriptor,
    );
    set_middlewares(meta, middlewares);
  };
}

/**
 * Declare the error handler of a class or a method.
 *
 * It can be combined with the DI decorators, but a class or method has at most
 * one `@Catch`. The DI system only stores the handler; the application module
 * that runs the class or method calls it.
 *
 * @param handler A function called with the error, or an injectable class
 *   that handles it.
 * @returns A class or method decorator.
 * @throws {TypeError} When applied to anything other than a class or a method.
 * @throws {Error} When `handler` is not a function or a class, or when the
 *   class or method already has an error handler.
 *
 * @example
 * ```ts
 * @Controller()
 * class Cli {
 *   @Catch((error) => 2)
 *   @Action("copy")
 *   copy() {}
 * }
 * ```
 */
export function Catch(handler: ChoErrorHandler): ChoClassOrMethodDecorator {
  return (target, context, descriptor) => {
    const meta = decorated_target("@Catch()", target, context, descriptor);
    set_error_handler(meta, handler);
  };
}
