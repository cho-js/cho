import type { Any, Ctr, Target } from "../meta/mod.ts";
import type {
  ChoErrorHandler,
  ChoErrorHandlerFn,
  ChoMiddleware,
  ChoMiddlewareFn,
  ControllerDescriptor,
  MethodDescriptor,
  ModuleDescriptor,
} from "../di/types.ts";
import type {
  ControllerNode,
  MethodNode,
  ModuleNode,
} from "./graph-builder.ts";
import { Injector } from "../di/injector.ts";
import { debuglog } from "../utils/debuglog.ts";
import { isClass, isClassImplement } from "../utils/is.ts";

const log = debuglog("core:compiler");

/**
 * A compiled representation of a module, controller, or method.
 * It includes the associated middlewares, metadata, handler, and optional error handler.
 */
export type Compiled<M, T> = T & {
  /**
   * Middlewares associated with the module, controller or method.
   */
  middlewares: ChoMiddlewareFn[];

  /**
   * Metadata associated with the method (e.g., HTTP method, route info).
   */
  meta: M;

  /**
   * The instance of the target class (for modules and gateways) or the handler function (for methods).
   */
  handle: unknown;

  /**
   * Error handler associated with the entity.
   */
  errorHandler?: ChoErrorHandlerFn;
};

/**
 * A compiled method within a controller.
 */
export type CompiledMethod = Compiled<MethodDescriptor, {
  /**
   * The name of the method.
   */
  name: string;
}>;

/**
 * A compiled gateway (controller) within a module.
 */
export type CompiledGateway = Compiled<ControllerDescriptor, {
  /**
   * List of compiled methods within the gateway.
   */
  methods: CompiledMethod[];
}>;

/**
 * A compiled module, including its controllers and imported modules.
 */
export type CompiledModule = Compiled<ModuleDescriptor, {
  /**
   * List of compiled gateways (controllers) within the module.
   */
  controllers: CompiledGateway[];

  /**
   * List of compiled imported modules.
   */
  imports: CompiledModule[];
}>;

/**
 * Compiler class that compiles module classes into compiled modules.
 * It resolves all gateways, imported modules, and their dependencies.
 */
export class Compiler {
  protected readonly resolved: WeakMap<Ctr, CompiledModule> = new WeakMap();
  protected readonly middlewares: WeakMap<Ctr | Target, ChoMiddlewareFn> =
    new WeakMap();

  /**
   * Compile the given class constructor
   * Return a tree of compiled modules ready for execution
   * @param node
   */
  async compile(
    node: ModuleNode,
  ): Promise<CompiledModule> {
    const end = log.start();
    const compiled = await this.module(node);
    end(`module "${node.ctr.name}" compiled`);
    return compiled;
  }

  /**
   * Normalize and instantiate an error handler.
   * @param handler
   * @param injector
   * @protected
   */
  protected async errorHandler(
    handler: ChoErrorHandlerFn | ChoErrorHandler,
    injector: Injector,
  ): Promise<ChoErrorHandlerFn> {
    if (!isClass(handler)) {
      // function error handler, return as is
      return handler as ChoErrorHandlerFn;
    }
    if (!isClassImplement<ChoErrorHandler>(handler, "catch")) {
      throw new Error(
        `class ${
          (handler as Ctr).name
        } is not an ErrorHandler, it does not implement "catch" method`,
      );
    }
    const instance = await injector
      .register(handler)
      .resolve<ChoErrorHandler>(handler);
    return instance
      .catch
      .bind(instance) as ChoErrorHandlerFn;
  }

  /**
   * Normalize and instantiate a middleware.
   * @param mw
   * @param injector
   * @protected
   */
  protected async middleware(
    mw: ChoMiddleware | ChoMiddlewareFn,
    injector: Injector,
  ): Promise<ChoMiddlewareFn> {
    if (typeof mw !== "function") {
      throw new Error(`Middleware is not a class or function: ${mw}`);
    }

    // no need to re-instantiate, return from cache
    if (this.middlewares.has(mw)) {
      return this.middlewares.get(mw) as ChoMiddlewareFn;
    }

    if (!isClass(mw)) {
      // function middleware, return as is
      return mw as ChoMiddlewareFn;
    }

    // is implement ChoMiddlewareFn interface
    if (isClassImplement<ChoMiddleware>(mw, "handle")) {
      const instance = await injector
        .register(mw as Ctr)
        .resolve<ChoMiddleware>(mw as Ctr);
      const mwFn = instance.handle.bind(instance) as ChoMiddlewareFn;
      this.middlewares.set(mw, mwFn);
      return mwFn;
    }

    // if (typeof mw.prototype.canActivate === "function") {
    //   const instance = await injector
    //     .register(mw as Ctr)
    //     .resolve(mw as Ctr);
    //   // todo add support for guard type middleware
    //   // complete the implementation
    // }

    throw new Error(
      'ChoMiddlewareFn is not middleware class, it does not implement "handle" method',
    );
  }

  /**
   * Compile a method into a compiled method.
   * @param instance
   * @param node
   * @param injector
   * @protected
   */
  protected async endpoint(
    instance: Any,
    node: MethodNode,
    injector: Injector,
  ): Promise<CompiledMethod> {
    const handle = instance[node.name as keyof typeof instance].bind(instance);

    const middlewares: ChoMiddlewareFn[] = [];
    for (const mw of node.middlewares) {
      middlewares.push(await this.middleware(mw, injector));
    }

    const errorHandler = node.errorHandler
      ? await this.errorHandler(node.errorHandler, injector)
      : undefined;

    return {
      meta: node.meta,
      errorHandler,
      middlewares,
      handle,
      name: node.name,
    };
  }

  /**
   * Compile a gateway (controller) into a compiled gateway.
   * @param node
   * @param injector
   * @protected
   */
  protected async gateway(
    node: ControllerNode,
    injector: Injector,
  ): Promise<CompiledGateway> {
    const handle = await injector.register(node.ctr).resolve(node.ctr);

    const methods: CompiledMethod[] = [];
    for (const m of node.methods) {
      methods.push(await this.endpoint(handle, m, injector));
    }

    const middlewares: ChoMiddlewareFn[] = [];
    for (const mw of node.middlewares) {
      middlewares.push(await this.middleware(mw, injector));
    }

    const errorHandler = node.errorHandler
      ? await this.errorHandler(node.errorHandler, injector)
      : undefined;

    return {
      meta: node.meta,
      errorHandler,
      middlewares,
      handle,
      methods,
    };
  }

  /**
   * Compile a module into a compiled module.
   * @protected
   * @param node
   */
  protected async module(
    node: ModuleNode,
  ): Promise<CompiledModule> {
    // module is processed only once
    if (this.resolved.has(node.ctr)) {
      return this.resolved.get(node.ctr) as CompiledModule;
    }

    log("compiling module: " + node.ctr);
    // create injector for the module while resolving its dependencies
    const injector = await Injector.get(node.ctr);
    const handle = await injector.resolve(node.ctr);

    const controllers: CompiledGateway[] = [];
    for (const cn of node.controllers) {
      controllers.push(await this.gateway(cn, injector));
    }

    const imports: CompiledModule[] = [];
    for (const mn of node.imports) {
      imports.push(await this.module(mn));
    }

    const middlewares: ChoMiddlewareFn[] = [];
    for (const mw of node.middlewares) {
      middlewares.push(await this.middleware(mw, injector));
    }

    const errorHandler = node.errorHandler
      ? await this.errorHandler(node.errorHandler, injector)
      : undefined;

    const mod: CompiledModule = {
      meta: node.meta,
      errorHandler,
      middlewares,
      controllers,
      imports,
      handle,
    };
    this.resolved.set(node.ctr, mod);
    return mod;
  }
}
