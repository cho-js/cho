/**
 * Linkers register the routes of an application on an HTTP runtime, such as
 * Hono. Each runtime adapter, such as `@chojs/vendor-hono`, implements
 * {@link Linker} and {@link Linked}.
 *
 * A linker does no plumbing: every {@link Route} is ready to call.
 * `@chojs/web` creates the request context and runs the middlewares, the
 * handler and the error handler; the adapter only matches the request to a
 * route and passes on the path parameters.
 *
 * `@chojs/web` does not depend on any adapter: the application passes the
 * linker to `ChoWeb.create`, and the adapters depend on `@chojs/web`.
 *
 * @module
 */

import type { ChoWebContext } from "./context.ts";

/** A route of the application, ready to register on an HTTP runtime. */
export type Route = {
  /** The HTTP method, upper case, such as `"GET"`. */
  readonly method: string;
  /**
   * The full path, global prefix included, starting with `/`. Parameters are
   * written `:name` and match one segment (`"/api/users/:id"`).
   */
  readonly path: string;
  /** Where the route is declared, for logs: `"UsersController.get"`. */
  readonly name: string;
  /**
   * `true` for a route that upgrades its request to a WebSocket (`@Ws`). It
   * is registered as any `GET` route. An adapter that has a server of its
   * own, and cannot upgrade a connection, refuses such a route.
   */
  readonly socket?: true;
  /**
   * Answer a request that matches the route. It runs the route's
   * middlewares, its handler and, on an error, its error handler.
   *
   * @param req The request.
   * @param params The path parameters of the match, decoded.
   * @param native The runtime's own request context, if any; handlers see it
   *   as `ctx.native`.
   * @param state The state of the request, when something ran for it before
   *   the route (the middlewares of the application): handlers see it as
   *   `ctx.state`. Default: a new, empty one.
   * @returns The response. It rejects when the route fails and has no error
   *   handler, or when its error handler fails: the runtime answers `500`.
   */
  handle(
    req: Request,
    params?: Readonly<Record<string, string>>,
    native?: unknown,
    state?: Map<PropertyKey, unknown>,
  ): Promise<Response>;
};

/**
 * Runs the middlewares of the application around what answers a request.
 * `@chojs/web` makes it, and a linker calls it for **every** request: one a
 * route matches, and one no route matches.
 *
 * It creates the context of the request, and runs the middlewares, in order,
 * around `answer`. `answer` receives that context: a middleware may have
 * replaced the request, and the state is the one the route must have. So a
 * route is given both: `route.handle(ctx.req, params, native, ctx.state)`.
 *
 * @param req The request.
 * @param answer What answers the request, when the middlewares let it: the
 *   route, or the not-found answer of the runtime.
 * @param native The runtime's own request context, if any; the middlewares
 *   see it as `ctx.native`.
 * @param params The path parameters of the route that matched, where the
 *   runtime knows them before the middlewares run; the middlewares see them
 *   as `ctx.params`. Default: none.
 * @returns The response. It rejects when a middleware fails, or when `answer`
 *   rejects and no middleware answered in its place.
 *
 * @example
 * ```ts
 * const handle = (route: Route, req: Request, params: Params) =>
 *   around
 *     ? around(
 *       req,
 *       (ctx) => route.handle(ctx.req, params, undefined, ctx.state),
 *       undefined,
 *       params,
 *     )
 *     : route.handle(req, params);
 * ```
 */
export type Around = (
  req: Request,
  answer: (ctx: ChoWebContext) => Promise<Response>,
  native?: unknown,
  params?: Readonly<Record<string, string>>,
) => Promise<Response>;

/** What `@chojs/web` gives a {@link Linker} with the routes. */
export type LinkOptions = {
  /**
   * Runs the middlewares of the application (the `middlewares` option of
   * `ChoWeb.create`) around what answers a request. It is there when the
   * application has some: the linker then calls it for every request, the
   * ones no route matches included. Without it, nothing changes.
   */
  readonly around?: Around;
};

/**
 * An HTTP application linked by a {@link Linker}: the runtime's own
 * application object, and its request handler.
 *
 * @typeParam T The application object of the HTTP runtime, such as `Hono`.
 *
 * Adapters can return a plain object, or an instance of their own class.
 *
 * @example
 * ```ts
 * const app = new Hono();
 * const linked: Linked<Hono> = {
 *   instance: app,
 *   handler: (req) => Promise.resolve(app.fetch(req)),
 *   mount: (route) =>
 *     app.on(route.method, route.path, (ctx) =>
 *       route.handle(ctx.req.raw, ctx.req.param(), ctx)),
 * };
 * ```
 */
export interface Linked<T> {
  /** The application object of the HTTP runtime. */
  readonly instance: T;

  /**
   * The request handler: a `fetch`-style function that takes a `Request` and
   * resolves to a `Response`.
   */
  readonly handler: (req: Request) => Promise<Response>;

  /**
   * Register one more route, after {@link Linker.link}: what `app.mount` of
   * `ChoWeb` calls.
   *
   * The route behaves like one that was given to `link()`: the same answer
   * to a `HEAD` request, the same `ctx.native`, and the same order when two
   * routes match, after the routes the runtime already has.
   *
   * @param route The route to register.
   * @throws {Error} When the runtime can no longer take a route: its server
   *   is ready, or it answered a request.
   */
  mount(route: Route): void;
}

/**
 * Registers the routes of an application on a new application object of an
 * HTTP runtime.
 *
 * @typeParam T The application object of the HTTP runtime, such as `Hono`.
 *
 * @example
 * ```ts
 * class MyLinker implements Linker<MyServer> {
 *   link(routes: readonly Route[], { around }: LinkOptions): Linked<MyServer> {
 *     const server = new MyServer();
 *     // The middlewares of the application, around every request.
 *     if (around) {
 *       server.use((req, next) => around(req, (ctx) => next(ctx.req, ctx.state)));
 *     }
 *     const mount = (route: Route) =>
 *       server.on(route.method, route.path, (req, params, state) =>
 *         route.handle(req, params, undefined, state));
 *     routes.forEach(mount);
 *     return { instance: server, handler: (req) => server.fetch(req), mount };
 *   }
 * }
 *
 * const app = await ChoWeb.create(AppModule, { linker: new MyLinker() });
 * ```
 */
export interface Linker<T> {
  /**
   * Register the routes on a new application object of the runtime.
   *
   * @param routes The routes of the application, in declaration order.
   * @param options What comes with the routes: `around`, which runs the
   *   middlewares of the application. A linker that leaves it out runs none
   *   of them.
   * @returns The linked application.
   */
  link(routes: readonly Route[], options: LinkOptions): Linked<T>;
}
