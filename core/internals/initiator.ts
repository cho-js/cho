import type { Any, Ctr, Target } from "./meta.ts";
import type {
  ChoErrorHandler,
  ChoErrorHandlerFn,
  ChoGuard,
  ChoMiddleware,
  ChoMiddlewareFn,
  Context,
  ControllerDescriptor,
  MethodDescriptor,
  ModuleDescriptor,
  Next,
} from "./types.ts";
import type {
  ControllerNode,
  MethodNode,
  ModuleNode,
} from "./graph-builder.ts";
import { Injector } from "./injector.ts";
import { debuglog } from "../utils/debuglog.ts";
import { isClass, isClassImplement } from "../utils/is.ts";

const log = debuglog("core:initiator");

export class InitiatedMethod {
  constructor(
    readonly handle: Target,
    readonly name: string,
    readonly meta: MethodDescriptor,
    readonly errorHandler: ChoErrorHandlerFn | undefined,
    readonly middlewares: ChoMiddlewareFn[],
  ) {}
}

export class InitiatedController {
  constructor(
    readonly handle: Any,
    readonly ctr: Ctr,
    readonly meta: ControllerDescriptor,
    readonly errorHandler: ChoErrorHandlerFn | undefined,
    readonly middlewares: ChoMiddlewareFn[],
    readonly methods: InitiatedMethod[],
  ) {}
}

export class InitiatedModule {
  constructor(
    readonly handle: Any,
    readonly ctr: Ctr,
    readonly meta: ModuleDescriptor,
    readonly errorHandler: ChoErrorHandlerFn | undefined,
    readonly middlewares: ChoMiddlewareFn[],
    readonly controllers: InitiatedController[],
    readonly imports: InitiatedModule[],
  ) {}

  /**
   * Iterate through all initiated modules recursively.
   * Used by lifecycle hooks processing.
   */
  *[Symbol.iterator](): Generator<InitiatedModule> {
    yield this;
    for (const im of this.imports) {
      yield* im;
    }
  }

  /**
   * Iterate through all initiated modules and controllers recursively.
   */
  *all(): Generator<InitiatedModule | InitiatedController> {
    yield this;
    for (const ctr of this.controllers) {
      yield ctr;
    }
    for (const im of this.imports) {
      yield* im.all();
    }
  }

  *ctrls(): Generator<InitiatedController> {
    for (const ctrl of this.controllers) {
      yield ctrl;
    }
    for (const im of this.imports) {
      yield* im.ctrls();
    }
  }
}

/**
 * Normalize and instantiate a middleware class.
 * @param mw
 * @param injector
 */
async function choMiddlewareToFn(
  mw: Ctr,
  injector: Injector,
): Promise<ChoMiddlewareFn> {
  const instance = await injector
    .register(mw)
    .resolve<ChoMiddleware>(mw);
  return instance
    .handle
    .bind(instance) as ChoMiddlewareFn;
}

/**
 * todo should we support guards returning response directly?
 *  do we need this separation at all?
 *  provide a function takes guard and return middleware fn?
 * Normalize and instantiate a guard middleware class.
 * @param mw
 * @param injector
 */
async function choGuardToFn(
  mw: Ctr,
  injector: Injector,
): Promise<ChoMiddlewareFn> {
  const instance = await injector
    .register(mw)
    .resolve<ChoGuard>(mw);
  return async function (ctx: Context, next: Next) {
    if (await instance.can(ctx)) {
      return next();
    } else {
      // todo verify how to handle guard rejection (returning response or throwing error)
      throw new Error("Request blocked by guard middleware");
    }
  } as ChoMiddlewareFn;
}

/**
 * Normalize and instantiate an error handler.
 * @param handler
 * @param injector
 */
async function createErrorHandler(
  handler: ChoErrorHandlerFn | ChoErrorHandler | undefined,
  injector: Injector,
): Promise<ChoErrorHandlerFn | undefined> {
  if (!handler) {
    return undefined;
  }
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
 */
async function createMiddleware(
  mw: ChoMiddleware | ChoMiddlewareFn | Target,
  injector: Injector,
): Promise<ChoMiddlewareFn> {
  if (typeof mw !== "function") {
    throw new Error(`Middleware is not a class or function: ${mw}`);
  }

  if (!isClass(mw)) {
    // function middleware, return as is
    return mw as ChoMiddlewareFn;
  }

  // is implement ChoMiddleware interface
  if (isClassImplement<ChoMiddleware>(mw, "handle")) {
    return choMiddlewareToFn(mw, injector);
  }

  // is implement ChoGuard interface
  if (isClassImplement<ChoGuard>(mw, "can")) {
    return choGuardToFn(mw, injector);
  }

  throw new Error(
    'ChoMiddlewareFn is not middleware class, it does not implement "handle" method',
  );
}

async function createMiddlewares(
  mws: (ChoMiddleware | ChoMiddlewareFn | Target)[],
  injector: Injector,
): Promise<ChoMiddlewareFn[]> {
  const middlewares: ChoMiddlewareFn[] = [];
  for (const mw of mws) {
    middlewares.push(await createMiddleware(mw, injector));
  }
  return middlewares;
}

/**
 * Take a nodes graph and instantiate all modules, controllers, methods,
 * middlewares, and error handlers while resolving dependencies.
 * After this process, the all endpoints are invokable.
 *
 * @param root
 */
export async function initiate(
  root: ModuleNode,
): Promise<InitiatedModule> {
  /**
   * Module resolution cache (modules are processed only once)
   */
  const resolved = new WeakMap<Ctr, InitiatedModule>();

  /**
   * Initiate a method node.
   * @param instance
   * @param node
   * @param injector
   */
  async function initiateMethod(
    instance: Any,
    node: MethodNode,
    injector: Injector,
  ): Promise<InitiatedMethod> {
    log(`initiating method: ${node.name}`);
    const handle = instance[node.name as keyof typeof instance].bind(instance);

    const errorHandler = await createErrorHandler(
      node.meta.errorHandler,
      injector,
    );

    const middlewares = await createMiddlewares(
      node.meta.middlewares ?? [],
      injector,
    );

    return new InitiatedMethod(
      handle,
      node.name,
      node.meta,
      errorHandler,
      middlewares,
    );
  }

  /**
   * Initiate a controller node.
   * @param node
   * @param injector
   */
  async function initiateController(
    node: ControllerNode,
    injector: Injector,
  ): Promise<InitiatedController> {
    log(`initiating controller: ${node.name}`);
    const handle = await injector.register(node.ctr).resolve(node.ctr);

    const methods: InitiatedMethod[] = [];
    for (const m of node.methods) {
      methods.push(await initiateMethod(handle, m, injector));
    }

    const errorHandler = await createErrorHandler(
      node.meta.errorHandler,
      injector,
    );

    const middlewares = await createMiddlewares(
      node.meta.middlewares ?? [],
      injector,
    );

    return new InitiatedController(
      handle,
      node.ctr,
      node.meta,
      errorHandler,
      middlewares,
      methods,
    );
  }

  /**
   * Initiate a module node recursively.
   * @param node
   */
  async function initiateModule(
    node: ModuleNode,
  ): Promise<InitiatedModule> {
    log(`initiating module: ${node.name}`);
    // module is processed only once
    if (resolved.has(node.ctr)) {
      log(`module ${node.name} already initiated, returning from cache`);
      return resolved.get(node.ctr) as InitiatedModule;
    }

    // create injector for the module while resolving its dependencies
    const injector = await Injector.get(node.ctr);
    const handle = await injector.resolve(node.ctr);

    const controllers: InitiatedController[] = [];
    for (const cn of node.controllers) {
      controllers.push(await initiateController(cn, injector));
    }

    const imports: InitiatedModule[] = [];
    for (const mn of node.imports) {
      imports.push(await initiateModule(mn));
    }

    const errorHandler = await createErrorHandler(
      node.meta.errorHandler,
      injector,
    );

    const middlewares = await createMiddlewares(
      node.meta.middlewares ?? [],
      injector,
    );

    const initiated = new InitiatedModule(
      handle,
      node.ctr,
      node.meta,
      errorHandler,
      middlewares,
      controllers,
      imports,
    );

    resolved.set(node.ctr, initiated);
    return initiated;
  }

  const end = log.start();
  const ret = await initiateModule(root);
  end("initiation completed");
  return ret;
}
