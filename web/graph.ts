import type {
  Ctr,
  ChoErrorHandler,
  ChoErrorHandlerFn,
  ChoMiddleware,
  ChoMiddlewareFn,
  ControllerMetadata,
  Injector,
  ModuleMetadata,
  ModuleScope,
} from "@chojs/core/di";
import {describe, isClass, isClassImplement} from "@chojs/core/utils";

export {ChoMiddlewareFn};
/**
 * An error handler as stored in the graph: a function given to `@Catch`, an
 * instance of a handler class (one with a `handle` method), or `null` when
 * there is none.
 */
export type ErrorHandlerRef =
  | ChoErrorHandlerFn
  | null;

export type ControllerInstance = {
  [key: string]: () => Promise<unknown>;
};

export type MethodMetadata = {
  isHTTP: true;
  type: "HTTP";
  method: string;
  name: string;
  route: string;
  middlewares?: ChoMiddleware[];
  errorHandler?: ChoErrorHandler;
};

export abstract class NodeRef {
  readonly route: string;
  readonly middlewares: ChoMiddlewareFn[];
  readonly errorHandler: ErrorHandlerRef;

  constructor(
    route: string,
    middlewares: ChoMiddlewareFn[],
    errorHandler: ErrorHandlerRef,
  ) {
    this.route = route;
    this.middlewares = middlewares ?? [];
    this.errorHandler = errorHandler;
  }
}

export class MethodRef extends NodeRef {
  readonly name: string;
  readonly method: string;
  readonly type: string;
  readonly handler: () => Promise<unknown>;

  constructor(
    name: string,
    route: string,
    method: string,
    type: string,
    middlewares: ChoMiddlewareFn[],
    errorHandler: ErrorHandlerRef,
    handler: () => Promise<unknown>,
  ) {
    super(route, middlewares, errorHandler);
    this.name = name;
    this.method = method;
    this.type = type;
    this.handler = handler;
  }
}

export class ControllerRef extends NodeRef {
  readonly instance: ControllerInstance;
  readonly methods: MethodRef[];

  constructor(
    route: string,
    middlewares: ChoMiddlewareFn[],
    errorHandler: ErrorHandlerRef,
    instance: ControllerInstance,
  ) {
    super(route, middlewares, errorHandler);
    this.instance = instance;
    this.methods = [];
  }
}

export class FeatureRef extends NodeRef {
  readonly controllers: ControllerRef[];

  constructor(
    route: string,
    middlewares: ChoMiddlewareFn[],
    errorHandler: ErrorHandlerRef,
  ) {
    super(route, middlewares, errorHandler);
    this.controllers = [];
  }
}

export class AppRef {
  readonly route: string;
  readonly features: FeatureRef[];

  constructor(route: string) {
    this.route = route;
    this.features = [];
  }
}

/**
 * One path segment: RFC 3986 `pchar` characters (unreserved, sub-delims, `:`
 * and `@`) or percent-encoded bytes. `:` keeps route parameters (`:id`) valid.
 */
const ROUTE_SEGMENT = /^(?:[A-Za-z0-9\-._~!$&'()*+,;=:@]|%[0-9A-Fa-f]{2})+$/;

/**
 * Assert that a route is valid. The empty string is valid: there is no route
 * at that level. Otherwise the route is one or more path segments separated by
 * `/`, where:
 *
 * - the route does not start or end with `/`;
 * - no segment is empty (`a//b`), `.` or `..`;
 * - every segment contains only characters a URL path allows, or
 *   percent-encoded bytes (no spaces, `?` or `#`).
 *
 * @param route The route to check.
 * @param where Where the route is declared, for the error message.
 * @throws {TypeError} When the route is not a string.
 * @throws {Error} When the route is not valid.
 */
export function assert_route(
  route: unknown,
  where: string,
): asserts route is string {
  if (typeof route !== "string") {
    throw new TypeError(
      `Invalid route of ${where}: expected a string, got ${describe(route)}`,
    );
  }
  if (route === "") {
    return;
  }
  const invalid = (reason: string) =>
    new Error(`Invalid route ${describe(route)} of ${where}: ${reason}`);
  if (route.startsWith("/") || route.endsWith("/")) {
    throw invalid('it must not start or end with "/"');
  }
  for (const segment of route.split("/")) {
    if (segment === "") {
      throw invalid('it must not contain an empty segment ("//")');
    }
    if (segment === "." || segment === "..") {
      throw invalid(`it must not contain a "${segment}" segment`);
    }
    if (!ROUTE_SEGMENT.test(segment)) {
      throw invalid(
        `${describe(segment)} is not a valid URL path segment`,
      );
    }
  }
}

/**
 * Trim a route and assert that it is valid (see {@link assert_route}).
 *
 * @param route The route as declared.
 * @param where Where the route is declared, for the error message.
 * @returns The trimmed route.
 */
function normalize_route(route: unknown, where: string): string {
  const trimmed = typeof route === "string" ? route.trim() : route;
  assert_route(trimmed, where);
  return trimmed;
}

/**
 * The route of a feature module or a controller: `""` when it declares none.
 *
 * @param meta The module's or controller's metadata.
 * @param where Where the route is declared, for the error message.
 * @returns The trimmed, valid route.
 */
function get_route(
  meta: ModuleMetadata | ControllerMetadata,
  where: string,
): string {
  const route = meta["route"];
  return route === undefined ? "" : normalize_route(route, where);
}

function* modules_with_controllers(
  injector: Injector,
): IterableIterator<ModuleScope> {
  for (const mdl of injector.modules()) {
    if (mdl.meta.controllers && mdl.meta.controllers.length > 0) {
      yield mdl;
    }
  }
}

function* controllers_with_methods(
  meta: ModuleMetadata,
): IterableIterator<ControllerMetadata> {
  for (const ctrl of meta.controllers) {
    if (ctrl.methods && ctrl.methods.length > 0) {
      yield ctrl;
    }
  }
}

function* http_methods(
  meta: ControllerMetadata,
): IterableIterator<MethodMetadata> {
  for (const m of meta.methods) {
    if (m.meta.isHTTP) {
      yield m.meta as MethodMetadata;
    }
  }
}

function error_handler_factory(
  mdl: Ctr,
  injector: Injector,
): (ctr: unknown) => Promise<ErrorHandlerRef> {
  return async function (ctr: unknown): Promise<ErrorHandlerRef> {
    if (
      isClassImplement<{ handle(error: unknown): unknown }>(ctr, "handle")
    ) {
      try {
        const instance = await injector.resolve(ctr, mdl);
        return instance.handle.bind(instance);
      } catch (error) {
        throw new Error(
          `Failed to create error handler ${describe(ctr)} in module ${
            describe(mdl)
          }`,
          { cause: error },
        );
      }
    }
    if (isClass(ctr)) {
      throw new Error(
        `Error handler class ${ctr.name} must implement 'handle' method.`,
      );
    }
    if (typeof ctr === "function") {
      return ctr;
    }
    return null;
  };
}

function create_middleware_factory(
  mdl: Ctr,
  injector: Injector,
): (mws: ChoMiddleware[]) => Promise<ChoMiddlewareFn[]> {
  return async function (mws: ChoMiddleware[]) {
    const fns: ChoMiddlewareFn[] = [];
    for (const mw of mws) {
      if (isClassImplement(mw, "handle")) {
        try {
          const instance = await injector.resolve<{ handle: ChoMiddlewareFn }>(
            mw as Ctr,
            mdl,
          );
          fns.push(instance.handle.bind(instance));
        } catch (error) {
          throw new Error(
            `Failed to create middleware ${describe(mw)} in module ${
              describe(mdl)
            }`,
            { cause: error },
          );
        }
      } else if (isClass(mw)) {
        throw new Error(
          `Middleware class ${mw.name} must implement 'handle' method.`,
        );
      } else if (typeof mw === "function") {
        fns.push(mw);
      } else {
        throw new Error(
          `Invalid middleware ${
            describe(mw)
          }: must be a function or a class with a 'handle' method.`,
        );
      }
    }
    return fns;
  };
}

function assert_no_duplicate_routes(ref: AppRef): void {
  const routes = new Set<string>();
  for (const feature of ref.features) {
    for (const controller of feature.controllers) {
      for (const method of controller.methods) {
        const path = [ref.route, feature.route, controller.route, method.route]
          .filter((segment) => segment !== "")
          .join("/");
        const full_route = `${method.method} /${path}`;
        if (routes.has(full_route)) {
          throw new Error(
            `Duplicate route ${
              describe(full_route)
            }: already declared by another method.`,
          );
        }
        routes.add(full_route);
      }
    }
  }
}

/**
 * The graph should expose all routes ready to invoke without the DI system, so that a web server can register them.
 *
 * @param injector
 * @param prefix
 */
export async function build_http_graph(
  injector: Injector,
  prefix: string,
): Promise<AppRef> {
  const graph = new AppRef(normalize_route(prefix, "the global prefix"));

  for (const mdl of modules_with_controllers(injector)) {
    // error handler resolver with context
    const error_handler = error_handler_factory(mdl.ctr, injector);
    // middleware resolver with context
    const create_middlewares = create_middleware_factory(mdl.ctr, injector);

    const meta = mdl.meta;
    const feature = new FeatureRef(
      get_route(meta, `feature ${describe(mdl.ctr)}`),
      await create_middlewares((meta.middlewares ?? []) as ChoMiddleware[]),
      await error_handler(meta.errorHandler),
    );

    for (const ctrl of controllers_with_methods(meta)) {
      const name = describe(ctrl.provider.provide);
      const route = get_route(ctrl, `controller ${name}`);

      const instance = await injector.resolve(ctrl.provider.provide, mdl.ctr);
      const controller = new ControllerRef(
        route,
        await create_middlewares((ctrl.middlewares ?? []) as ChoMiddleware[]),
        await error_handler(ctrl.errorHandler),
        instance,
      );

      for (const m of http_methods(ctrl)) {
        const handler = instance[m.name].bind(instance);
        const method = new MethodRef(
          m.name,
          normalize_route(m.route, `method ${m.name} of controller ${name}`),
          m.method,
          m.type,
          await create_middlewares(m.middlewares ?? []),
          await error_handler(m.errorHandler),
          handler,
        );
        controller.methods.push(method);
      }
      feature.controllers.push(controller);
    }
    graph.features.push(feature);
  }
  assert_no_duplicate_routes(graph);
  return graph;
}
