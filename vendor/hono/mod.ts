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
import { type Debuglog, debuglog } from "@chojs/core/utils";
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import type { AppRef, MethodRef, NodeRef } from "@chojs/web/graph";
import type { Linked, Linker } from "@chojs/web/linker";
import type { ChoWebContext } from "@chojs/web";

/**
 * The response for what a handler or an error handler returned: a `Response`
 * as is, anything else as JSON.
 *
 * @param ctx The request context.
 * @param result The value returned (already awaited).
 * @returns The response.
 */
function to_response(
  ctx: { json(content: unknown): Response },
  result: unknown,
): Response {
  return result instanceof Response ? result : ctx.json(result);
}

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
 * It logs to the `cho:web:hono` debug context (`CHO_DEBUGLOG=cho:web:hono`,
 * `CHO_DEBUGLOG=cho:web*` or `CHO_DEBUG=1`): each route it registers, and each
 * error a `@Catch` handler receives.
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
   * The `cho:web:hono` debug logger, created with the linker, so it follows
   * `set_env` and the environment at that time.
   */
  readonly #log: Debuglog = debuglog("cho:web:hono");

  /**
   * Link an HTTP graph to a new Hono application.
   *
   * @param graph The HTTP graph of the application.
   * @returns The linked Hono application.
   * @throws {Error} When a handler uses an unsupported HTTP method.
   */
  link(graph: AppRef): HonoLinked {
    const done = this.#log.start();
    let count = 0;
    // The global prefix is applied when mounting each feature, not with
    // `basePath()`: that returns a copy built from Hono's base class, which is
    // not `instanceof Hono`.
    const app = new Hono();
    for (const fr of graph.features) {
      const feature = this.#createController(fr);
      const featureMiddlewares = this.#createMiddlewares(fr.middlewares);
      for (const cr of fr.controllers) {
        const ctrl = this.#createController(cr);
        const controllerMiddlewares = this.#createMiddlewares(cr.middlewares);
        for (const mr of cr.methods) {
          const endpoint = this.#createMethod(mr);
          const action = mr.method.toLowerCase() as keyof typeof Hono;
          const methodMiddlewares = this.#createMiddlewares(mr.middlewares);
          const middlewares = [
            ...featureMiddlewares,
            ...controllerMiddlewares,
            ...methodMiddlewares,
          ];
          // @ts-ignore: ts unable to infer that action is a key of ctrl
          ctrl[action](`/${mr.route}`, ...middlewares, endpoint);
          count++;
          this.#log(
            `registered ${mr.method} /${
              [graph.route, fr.route, cr.route, mr.route].filter(Boolean)
                .join("/")
            }`,
          );
        }
        feature.route(cr.route, ctrl);
      }
      app.route([graph.route, fr.route].filter(Boolean).join("/"), feature);
    }
    done(`linked ${count} routes`);
    return new HonoLinked(app);
  }

  #createController(ref: NodeRef) {
    const ctrl = new Hono();
    const handler = ref.errorHandler;
    if (handler) {
      ctrl.onError(async (error, ctx) => {
        this.#log.error(`${ctx.req.method} ${ctx.req.path} failed:`, error);
        return to_response(ctx, await handler(error, ctx));
      });
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
    return async (ctx: ChoWebContext) => {
      try {
        return to_response(ctx, await ref.handler(ctx));
      } catch (error) {
        if (ref.errorHandler) {
          this.#log.error(`${ctx.req.method} ${ctx.req.path} failed:`, error);
          return to_response(ctx, await ref.errorHandler(error, ctx));
        }
        throw error;
      }
    };
  }

  #createMiddlewares(middlewares: ChoMiddlewareFn[]): MiddlewareHandler[] {
    // ChoMiddlewareFn resolves to `unknown`; Hono wants `void | Response`.
    return middlewares.map((mw) => createMiddleware(mw as MiddlewareHandler));
  }
}
