import type { AppRef, ChoMiddlewareFn } from "@chojs/web";
import type { Context } from "@hono/hono";
import { Hono } from "@hono/hono";
import { MethodRef, NodeRef } from "@chojs/web/graph";
import type { Target } from "@chojs/core";
import { Linked, Linker } from "@chojs/web/linker";

export class HonoLinked extends Linked<Hono> {
  get handler(): (req: Request) => Promise<Response> {
    return this.instance.fetch;
  }
}

export class HonoLinker implements Linker<Hono> {
  /**
   * Link the given `graph` to a new Hono application, returning a `HonoLinked`
   * @param graph
   */
  link(graph: AppRef): HonoLinked {
    const app = new Hono();
    for (const fr of graph.features) {
      const feature = this.#createController(fr);
      for (const cr of fr.controllers) {
        const ctrl = this.#createController(cr);
        for (const mr of cr.methods) {
          const endpoint = this.#createMethod(mr);
          const action = mr.method.toLowerCase();
          const middlewares = this.#createMiddlewares(mr.middlewares);
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
      ctrl.onError(ref.errorHandler);
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

  #createMiddlewares(middlewares: ChoMiddlewareFn[]): Target[] {
    return middlewares.map(this.#createMiddleware.bind(this));
  }

  #createMiddleware(middleware: unknown): Target {
    return middleware as Target;
  }
}
