/**
 * @chojs/vendor-hono — runs CHO web applications on Hono.
 *
 * {@link HonoLinker} registers the routes of a `@chojs/web` application on a
 * Hono application. Pass it to `ChoWeb.create` as `linker`.
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

import { Hono } from "hono";
import type { Linked, Linker, Route } from "@chojs/web/linker";

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
 * - Routes are matched in declaration order.
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
   */
  link(routes: readonly Route[]): HonoLinked {
    const app = this.#app;
    for (const route of routes) {
      app.on(
        route.method,
        route.path,
        (ctx) => route.handle(ctx.req.raw, ctx.req.param(), ctx),
      );
    }
    return new HonoLinked(app);
  }
}
