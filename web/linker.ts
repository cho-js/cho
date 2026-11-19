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
   *   the route (the middlewares of the built-in router): handlers see it as
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
 *   link(routes: readonly Route[]): Linked<MyServer> {
 *     const server = new MyServer();
 *     const mount = (route: Route) =>
 *       server.on(route.method, route.path, (req, params) =>
 *         route.handle(req, params));
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
   * @returns The linked application.
   */
  link(routes: readonly Route[]): Linked<T>;
}
