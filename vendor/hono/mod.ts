/**
 * @chojs/vendor-hono — runs CHO web applications on Hono.
 *
 * {@link HonoLinker} registers the routes of a `@chojs/web` application on a
 * Hono application. Pass it to `ChoWeb.create` as `linker`.
 *
 * {@link fromHono} turns a Hono middleware (`cors()`, `basicAuth()`, ...)
 * into a CHO middleware, for `@Middlewares`.
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

import { type Context, Hono, type MiddlewareHandler } from "hono";
import type { ChoWebContext, ChoWebMiddlewareFn, ChoWebNext } from "@chojs/web";
import type { Linked, Linker, Route } from "@chojs/web/linker";

// The `@chojs/web` types this module refers to. (`Hono` and
// `MiddlewareHandler` are types of the `hono` package: import them from
// there.)
export type {
  ChoWebContext,
  ChoWebMiddlewareFn,
  ChoWebNext,
  Linked,
  Linker,
  Route,
};

/**
 * A Hono application linked by {@link HonoLinker}.
 *
 * @example
 * ```ts
 * const app = await ChoWeb.create(AppModule, { linker: new HonoLinker() });
 * app.linked.instance; // the Hono application
 * Deno.serve(app.linked.handler);
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
 * Registers the routes of a CHO web application on a Hono application.
 *
 * Hono only matches requests: each route is registered with its method and
 * its full path, and answers through `Route.handle`, which `@chojs/web`
 * built. Middlewares, error handlers and the conversion of results to
 * responses are `@chojs/web`'s, so they behave the same on every adapter.
 *
 * - Handlers receive a `ChoWebContext`; Hono's own `Context` is its `native`
 *   property.
 * - Routes are matched in declaration order, `HEAD` routes first.
 * - A `HEAD` request runs the `@Head` handler of the route; without one, Hono
 *   answers it from the `@Get` handler, without the body.
 * - A route that fails without a `@Catch` handler goes to Hono's error
 *   handler, which logs the error and answers `500` (see `app.onError`).
 * - Hono middlewares (`cors()`, `logger()`, ...) are not CHO middlewares. To
 *   use them, add them to a Hono application and give it to the linker: the
 *   routes are registered after them, so they wrap every route.
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
 * @example With Hono middlewares
 * ```ts
 * import { Hono } from "hono";
 * import { cors } from "hono/cors";
 *
 * const hono = new Hono();
 * hono.use(cors());
 * const app = await ChoWeb.create(AppModule, { linker: new HonoLinker(hono) });
 * ```
 */
export class HonoLinker implements Linker<Hono> {
  /** The Hono application the routes are registered on. */
  readonly #app: Hono;
  /** Whether {@link link} was called: a linker serves one application. */
  #linked = false;

  /**
   * Create a linker.
   *
   * @param app The Hono application to register the routes on. Default: a new
   *   one. Give your own to add Hono middlewares, an error handler or a
   *   not-found handler first. Use a linker for one application only.
   */
  constructor(app: Hono = new Hono()) {
    this.#app = app;
  }

  /**
   * Register routes on the linker's Hono application.
   *
   * @param routes The routes of the application.
   * @returns The linked Hono application.
   * @throws {Error} When the linker was already used: its Hono application
   *   holds the routes of the first application.
   */
  link(routes: readonly Route[]): HonoLinked {
    // A second application would add its routes to the first one's.
    if (this.#linked) {
      throw new Error(
        "HonoLinker.link() was already called: use one linker for one application",
      );
    }
    this.#linked = true;
    const app = this.#app;
    // Hono answers a HEAD request by running the GET routes, so a HEAD
    // route is registered as a GET route that only answers HEAD requests,
    // ahead of the others: the GET route of the same path must not win.
    for (const route of routes.filter((r) => r.method === "HEAD")) {
      app.on(
        "GET",
        route.path,
        (ctx, next) =>
          ctx.req.raw.method === "HEAD"
            ? route.handle(ctx.req.raw, ctx.req.param(), ctx)
            : next(),
      );
    }
    for (const route of routes.filter((r) => r.method !== "HEAD")) {
      app.on(
        route.method,
        route.path,
        (ctx) => route.handle(ctx.req.raw, ctx.req.param(), ctx),
      );
    }
    return new HonoLinked(app);
  }
}

/** The Hono context of a request, or an error when the adapter is not Hono's. */
function hono_context(ctx: ChoWebContext): Context {
  const native = ctx.native as Partial<Context> | undefined;
  if (
    native === null || typeof native !== "object" ||
    typeof native.newResponse !== "function" || !("finalized" in native)
  ) {
    throw new Error(
      "fromHono(): a Hono middleware runs on the Hono adapter only: create the application with a HonoLinker",
    );
  }
  return native as Context;
}

/**
 * Turn a Hono middleware into a CHO middleware, so that the middlewares that
 * come with Hono (`cors()`, `basicAuth()`, `etag()`, `secureHeaders()`, ...)
 * can be given to `@Middlewares`, on a handler, a controller or a feature
 * module.
 *
 * The Hono middleware runs with the Hono context of the request, at the
 * place of the CHO middleware in the chain:
 *
 * - its `next()` runs the rest of the CHO chain (the next middlewares, then
 *   the handler), and sets `c.res` to the response, which the middleware can
 *   read and change;
 * - a `Response` it returns answers the request;
 * - an `HTTPException` it throws is answered with the exception's response,
 *   as Hono does. Any other error goes to the CHO error handlers.
 *
 * It only works for an application created with a {@link HonoLinker}: on
 * another adapter the middleware throws.
 *
 * A middleware that must also cover the requests no route matches (CORS
 * preflight requests of paths without an `OPTIONS` route, say) belongs on the
 * Hono application given to the linker instead (`hono.use(cors())`).
 *
 * @param middleware The Hono middleware.
 * @returns A CHO middleware function.
 *
 * @example
 * ```ts
 * import { basicAuth } from "hono/basic-auth";
 * import { etag } from "hono/etag";
 * import { Controller, Get, Middlewares } from "@chojs/web";
 * import { fromHono } from "@chojs/vendor-hono";
 *
 * @Middlewares(fromHono(basicAuth({ username: "ada", password: "secret" })))
 * @Controller({ route: "admin" })
 * class AdminController {
 *   @Middlewares(fromHono(etag()))
 *   @Get("report")
 *   report() {
 *     return { users: 3 };
 *   }
 * }
 * ```
 */
export function fromHono(middleware: MiddlewareHandler): ChoWebMiddlewareFn {
  return async (ctx, next) => {
    const c = hono_context(ctx);
    try {
      const result = await middleware(c, async () => {
        // What the middleware set on the context before (CORS headers, say)
        // is merged into the response by Hono's setter.
        c.res = await next();
      });
      if (result instanceof Response) {
        return result;
      }
      // Nothing returned: the response is the context's, when it has one
      // (`next()` was called, or the middleware set `c.res`).
      return c.finalized ? c.res : undefined;
    } catch (error) {
      // An HTTPException is a response, not a failure.
      const get_response = (error as { getResponse?: unknown } | null)
        ?.getResponse;
      if (typeof get_response === "function") {
        return get_response.call(error) as Response;
      }
      throw error;
    } finally {
      // Give the context back as Hono expects it at this point: without a
      // response. The response of the route is what the CHO chain returns,
      // and Hono ignores it when the context already has one.
      c.res = undefined;
      c.finalized = false;
    }
  };
}
