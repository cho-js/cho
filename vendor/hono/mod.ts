/**
 * @chojs/vendor-hono — runs CHO web applications on Hono.
 *
 * {@link HonoLinker} turns the HTTP graph of a `@chojs/web` application into
 * the routes of a Hono application. Pass it to `ChoWeb.create` as `linker`.
 *
 * @example
 * ```ts
 * import { ChoWeb } from "@chojs/web";
 * import { HonoLinker } from "@chojs/vendor-hono";
 *
 * const app = await ChoWeb.create(AppModule, { linker: new HonoLinker() });
 * Deno.serve(app.handler);
 * ```
 *
 * @module
 */

import type { ChoMiddlewareFn } from "@chojs/core/di";
import type { Context, ErrorHandler, MiddlewareHandler } from "@hono/hono";
import { Hono } from "@hono/hono";
import type { AppRef, MethodRef, NodeRef } from "@chojs/web/graph";
import type { Linked, Linker } from "@chojs/web/linker";

/**
 * A Hono application linked by {@link HonoLinker}.
 *
 * @example
 * ```ts
 * const linked = new HonoLinker().link(graph);
 * linked.instance; // the Hono application
 * Deno.serve(linked.handler);
 * ```
 */
export class HonoLinked implements Linked<Hono> {
  /** The Hono application. */
  readonly instance: Hono;

  /**
   * Wrap a Hono application.
   *
   * @param instance The Hono application.
   */
  constructor(instance: Hono) {
    this.instance = instance;
  }

  /** The Hono application's `fetch`, as a request handler. */
  get handler(): (req: Request) => Promise<Response> {
    return this.instance.fetch as (req: Request) => Promise<Response>;
  }
}

/**
 * Links the HTTP graph of a CHO web application to a new Hono application.
 *
 * Each feature module and each controller becomes a Hono sub-application,
 * mounted at its route, with its middlewares and its error handler. Each
 * handler method becomes a route; what it returns is sent with `ctx.json()`,
 * unless it is a `Response`. Supported HTTP methods: GET, POST, PUT, DELETE
 * and PATCH.
 *
 * @example
 * ```ts
 * import { ChoWeb } from "@chojs/web";
 * import { HonoLinker } from "@chojs/vendor-hono";
 *
 * const app = await ChoWeb.create(AppModule, { linker: new HonoLinker() });
 * Deno.serve(app.handler);
 * ```
 */
export class HonoLinker implements Linker<Hono> {
  /**
   * Link an HTTP graph to a new Hono application.
   *
   * @param graph The HTTP graph of the application.
   * @returns The linked Hono application.
   * @throws {Error} When a handler uses an unsupported HTTP method.
   */
  link(graph: AppRef): HonoLinked {
    const app = new Hono();
    for (const fr of graph.features) {
      const feature = this.#createController(fr);
      for (const cr of fr.controllers) {
        const ctrl = this.#createController(cr);
        for (const mr of cr.methods) {
          const endpoint = this.#createMethod(mr);
          const action = mr.method.toLowerCase() as keyof typeof Hono;
          const middlewares = this.#createMiddlewares(mr.middlewares);
          // @ts-ignore: ts unable to infer that action is a key of ctrl
          ctrl[action](`/${mr.route}`, ...middlewares, endpoint);
        }
        feature.route(cr.route, ctrl);
      }
      app.route(fr.route, feature);
    }
    return new HonoLinked(app);
  }

  #createController(ref: NodeRef) {
    const ctrl = new Hono();

    const middlewares = this.#createMiddlewares(ref.middlewares);
    if (middlewares.length > 0) {
      ctrl.use(...middlewares);
    }
    if (ref.errorHandler) {
      ctrl.onError(ref.errorHandler as ErrorHandler);
    }
    return ctrl;
  }

  #createMethod(ref: MethodRef) {
    switch (ref.method.toLowerCase()) {
      case "get":
      case "post":
      case "put":
      case "delete":
      case "patch":
        return this.#createHttpMethod(ref);
      default:
        throw new Error(`Unsupported HTTP method: ${ref.method}`);
    }
  }

  #createHttpMethod(ref: MethodRef) {
    return async (ctx: Context) => {
      try {
        const result = await ref.handler(ctx);
        if (result instanceof Response) {
          return result;
        }
        return ctx.json(result);
      } catch (error) {
        if (ref.errorHandler) {
          return ref.errorHandler(ctx, error);
        }
        throw error;
      }
    };
  }

  #createMiddlewares(middlewares: ChoMiddlewareFn[]): MiddlewareHandler[] {
    return middlewares.map(this.#createMiddleware.bind(this));
  }

  #createMiddleware(middleware: unknown): MiddlewareHandler {
    return middleware as MiddlewareHandler;
  }
}
