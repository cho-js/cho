/**
 * The web application: {@link ChoWeb} compiles the routes of a root module and
 * registers them on an HTTP runtime with the given {@link Linker} (such as
 * `HonoLinker` from `@chojs/vendor-hono`), which gives a `fetch`-style request
 * handler. Without a linker it uses the built-in router, {@link ChoLinker}.
 *
 * It logs to the `cho:web` debug context (`CHO_DEBUGLOG=cho:web` or
 * `CHO_DEBUG=1`): every route with its handler, any error that stops the
 * application from being created, and every error given to a `@Catch` handler.
 *
 * @module
 */

import { web_error } from "./errors.ts";
import type { Ctr, Provider } from "@chojs/core/di";
import { Injector } from "@chojs/core/di";
import { assert_known_options } from "@chojs/core/di";
import { debuglog, describe } from "@chojs/core/utils";
import { build_http_graph } from "./build-graph.ts";
import { around, compose } from "./compose.ts";
import type { ChoWebContext } from "./context.ts";
import type { AppRef } from "./graph.ts";
import type { Linked, Linker, LinkOptions, Route } from "./linker.ts";
import { ChoLinker, type ChoRouter } from "./router.ts";
import { normalize_route } from "./path.ts";
import { to_response } from "./response.ts";
import { compile_routes, make_route, route_key } from "./routes.ts";
import {
  close_connections,
  type Connection,
  take_upgrade,
  upgrade_here,
} from "./socket.ts";
import type {
  ChoWebErrorHandler,
  ChoWebMiddleware,
  ChoWebMiddlewareFn,
  ChoWebUpgrade,
} from "./types.ts";

/**
 * What a linker is given with the routes of an application: `around`, which
 * runs the middlewares of the application, when it has some.
 *
 * @param graph The HTTP graph of the application.
 * @returns The options of `Linker.link`.
 */
function link_options(graph: AppRef): LinkOptions {
  return graph.middlewares.length === 0
    ? {}
    : { around: around(graph.middlewares) };
}

/** The HTTP methods a mounted route can answer. */
const MOUNT_METHODS = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
] as const;

/** An HTTP method of a mounted route (see {@link ChoWeb.mount}). */
export type ChoWebMountMethod = typeof MOUNT_METHODS[number];

/** The options of {@link ChoWeb.mount}. */
export type ChoWebMountOptions = {
  /**
   * Middleware functions `(ctx, next)`, in order, around the handler. A
   * mounted route is not declared: no middleware of a feature or of a
   * controller runs for it. Default: none.
   */
  middlewares?: readonly ChoWebMiddlewareFn[];
  /**
   * The name of the route, for logs and errors. Default: the name of the
   * handler function, or `mounted`.
   */
  name?: string;
};

/**
 * Options of {@link ChoWeb.create}. Every option is optional.
 *
 * @typeParam T The application object of the HTTP runtime, such as `Hono`.
 *
 * @example
 * ```ts
 * import { HonoLinker } from "@chojs/vendor-hono";
 *
 * const app = await ChoWeb.create(AppModule, {
 *   linker: new HonoLinker(),
 *   prefix: "api/v1", // every route starts with /api/v1
 * });
 * ```
 */
export type ChoWebOptions<T = unknown> = {
  /**
   * The linker that registers the routes on an HTTP runtime,
   * such as `HonoLinker` from `@chojs/vendor-hono`.
   *
   * Default: `new ChoLinker()`, the built-in router, which matches requests
   * with the standard URL Pattern API and needs no HTTP library.
   */
  linker?: Linker<T>;
  /**
   * The global route prefix, added before every feature route, without
   * leading or trailing `/` (for example `"api"`). Default: `""`, no prefix.
   */
  prefix?: string;
  /**
   * The error handler of the application: it handles the errors of every
   * route that no `@Catch` handler covers (the handler's, the controller's
   * and the feature's come first). Like `@Catch`, it takes a function
   * `(error, ctx)`, or a class with a `handle(error, ctx)` method, created by
   * the injector in the scope of the root module; what it returns is the
   * response, converted like a handler's result. When it returns nothing
   * (it only logs, say), the error is still unhandled. Default: none.
   * Unhandled errors go to the HTTP runtime, which answers `500`.
   *
   * It covers the errors of routes only: a request that matches no route
   * never reaches it (set the runtime's own not-found handler).
   *
   * @example
   * ```ts
   * const app = await ChoWeb.create(AppModule, {
   *   linker: new HonoLinker(),
   *   onError: (error, ctx) => {
   *     console.error(ctx.req.method, ctx.url.pathname, error);
   *     return Response.json({ error: "internal error" }, { status: 500 });
   *   },
   * });
   * ```
   */
  onError?: ChoWebErrorHandler;
  /**
   * The middlewares of the application: they run for **every** request, in
   * order, around what answers it. That is the route, with its own
   * middlewares and its error handlers, or the not-found answer of a request
   * no route matches: what a CORS middleware needs, to answer the preflight
   * requests of every path. A route {@link ChoWeb.mount} added is covered
   * too.
   *
   * Like `@Middlewares`, it takes functions `(ctx, next)`, and classes with a
   * `handle(ctx, next)` method, created by the injector in the scope of the
   * root module. They are the outermost: `next()` resolves with the response
   * as it is sent, after the error handlers.
   *
   * - `ctx.state` is the one the route sees: what such a middleware sets (a
   *   request id, the authenticated user) reaches its middlewares and its
   *   handler. `validate()` given here covers every handler.
   * - `ctx.params` and `ctx.native` are what the adapter knows before it
   *   runs the route: see its documentation.
   *
   * Default: none.
   *
   * @example
   * ```ts
   * import { cors, logger } from "@chojs/vendor-cho";
   *
   * const app = await ChoWeb.create(AppModule, {
   *   middlewares: [logger(), cors(), validate()],
   * });
   * ```
   */
  middlewares?: readonly ChoWebMiddleware[];
  /**
   * Providers that replace the declared providers of the same token, for
   * tests (see `InjectorOptions.overrides` of `@chojs/core`). Default: none.
   */
  overrides?: readonly Provider[];
};

/**
 * A web application, built from a root module.
 *
 * Every module that declares controllers is a feature. The route of a handler
 * joins up to four levels, each optional: the global `prefix`, the feature
 * module's `route`, the controller's `route` and the route given to the HTTP
 * method decorator (`@Get("…")`).
 *
 * Handlers, middlewares and error handlers receive a `ChoWebContext`, built
 * on the standard `Request`, whatever the HTTP runtime. What a handler
 * returns is the response: a `Response` as is, nothing as `204`, a string
 * or bytes as they are, anything else as JSON.
 *
 * @typeParam T The application object of the HTTP runtime, such as `Hono`.
 *
 * @example
 * ```ts
 * import { ChoWeb, type ChoWebContext, Controller, Get, Module } from "@chojs/web";
 * import { HonoLinker } from "@chojs/vendor-hono";
 *
 * @Controller({ route: "users" })
 * class UsersController {
 *   @Get(":id")
 *   get(ctx: ChoWebContext) {
 *     return { id: ctx.params.id };
 *   }
 * }
 *
 * @Module({ route: "api", controllers: [UsersController] })
 * class App {}
 *
 * // GET /api/users/42 -> {"id":"42"}
 * const app = await ChoWeb.create(App, { linker: new HonoLinker() });
 * Deno.serve(app.handler);
 * ```
 */
export class ChoWeb<T = unknown> {
  /** The linked HTTP application, which holds the runtime's own object. */
  readonly linked: Linked<T>;
  /**
   * The HTTP graph: the features, controllers and handlers of the
   * application, as a tree. For introspection, such as listing routes.
   */
  readonly graph: AppRef;
  /**
   * The routes of the application: those it declares, as given to the
   * linker, then those {@link mount} added.
   */
  readonly routes: readonly Route[];
  /**
   * The injector of the application: it holds its instances, and is disposed
   * by {@link close}. Give it to the `from` of another CHO module, such as
   * `ChoMessage.from(app.injector)` of `@chojs/message`, to build a second
   * application on the same instances. Close that application first: this
   * one owns the injector.
   */
  readonly injector: Injector;
  /** Whether {@link close} was called: requests are then refused. */
  #closed = false;
  /** The list behind {@link routes}, to add a mounted route to. */
  readonly #routes: Route[];
  /** The routes {@link mount} added. */
  readonly #mounted = new Set<Route>();
  /** The open sockets of the application: {@link close} closes them. */
  readonly #sockets = new Set<Connection>();
  /**
   * The request handler of the application: a `fetch`-style function that
   * takes a `Request` and resolves to a `Response`. It is the handler of the
   * linked runtime (`linked.handler`), with whatever other arguments the
   * server gives it, until the application is closed: after {@link close}, it
   * answers `503 Service Unavailable` without running any route.
   *
   * For a route that upgrades its request to a WebSocket (`@Ws`), it does
   * the upgrade on the runtimes where a `Response` carries it: Deno and
   * Cloudflare Workers. On Bun and on Node.js the connection is upgraded by
   * who holds it: `serve` of `@chojs/web/serve`, which calls
   * {@link upgrade}. There, this handler answers `426 Upgrade Required`.
   *
   * @example Deno
   * ```ts
   * Deno.serve(app.handler);
   * ```
   *
   * @example Bun
   * ```ts
   * Bun.serve({ fetch: app.handler });
   * ```
   */
  readonly handler: (req: Request) => Promise<Response>;
  /**
   * Run the route of a request that asks to be upgraded to a WebSocket, and
   * resolve with what the route decided. It is for the code that holds the
   * connection: `serve` of `@chojs/web/serve` on Bun and on Node.js, or an
   * adapter with a server of its own.
   *
   * - **An upgrade**, when the route accepted: upgrade the connection, then
   *   give what it can do to `accept`.
   * - **A `Response`** in every other case, to answer the request with: what
   *   refused the connection (a middleware, an `HttpError`, a `Response` of
   *   the handler), `404` when no route matches, `426` for a request that
   *   does not ask for an upgrade, and `503` once the application is closed.
   *
   * @param req The request. The route must receive this same object: a
   *   middleware that replaces the request refuses the upgrade.
   * @returns The upgrade, or the response.
   *
   * @example
   * ```ts
   * const upgrade = await app.upgrade(request);
   * if (upgrade instanceof Response) {
   *   return upgrade;
   * }
   * const events = upgrade.accept({ send, close, native });
   * ```
   */
  readonly upgrade: (req: Request) => Promise<ChoWebUpgrade | Response>;

  /**
   * Create the web application of a root module.
   *
   * Creates the injector and every instance of the application, builds the
   * HTTP graph, compiles its routes, and registers them with
   * `options.linker`.
   *
   * @param app The root module.
   * @param options The application options: the linker, and optionally the
   *   global prefix and the others.
   * @returns The application.
   * @throws {ChoError} When the module graph is invalid (see `Injector`), when a
   *   route is invalid or declared twice, or when a middleware or an error
   *   handler is invalid.
   *
   * @example
   * ```ts
   * const app = await ChoWeb.create(AppModule, {
   *   linker: new HonoLinker(),
   *   prefix: "api",
   * });
   * Deno.serve({ port: 8080 }, app.handler);
   * ```
   */
  static create<T>(
    app: Ctr,
    options: ChoWebOptions<T> & { linker: Linker<T> },
  ): Promise<ChoWeb<T>>;
  /**
   * Create the web application of a root module, on the built-in router:
   * without a linker, the routes are registered with a `ChoLinker`, and
   * `linked.instance` is its `ChoRouter`.
   *
   * @param app The root module.
   * @param options The application options, such as the global prefix.
   *   Default: none.
   * @returns The application.
   * @throws {ChoError} As above, and on a runtime that has no URL Pattern API.
   *
   * @example
   * ```ts
   * const app = await ChoWeb.create(AppModule);
   * Deno.serve(app.handler);
   * ```
   */
  static create(
    app: Ctr,
    options?: Omit<ChoWebOptions<ChoRouter>, "linker">,
  ): Promise<ChoWeb<ChoRouter>>;
  static async create<T>(
    app: Ctr,
    options: ChoWebOptions<T> = {},
  ): Promise<ChoWeb<T | ChoRouter>> {
    // Created here, not when the module is loaded, so it follows `set_env`.
    const log = debuglog("cho:web");
    const done = log.start();
    let inj: Injector | undefined;
    try {
      const linker: Linker<T | ChoRouter> = options.linker ?? new ChoLinker();
      inj = new Injector(
        app,
        options.overrides ? { overrides: options.overrides } : {},
      );
      await inj.init();
      const graph = await build_http_graph(
        inj,
        options.prefix ?? "",
        options.onError,
        options.middlewares,
      );
      const routes = compile_routes(graph, log);
      if (log.enabled) {
        for (const route of routes) {
          log(`${route.method} ${route.path} -> ${route.name}`);
        }
      }
      const web = new ChoWeb(
        linker.link(routes, link_options(graph)),
        graph,
        routes,
        inj,
      );
      done(`application ${describe(app)} created`);
      return web;
    } catch (error) {
      log.error(`cannot create application ${describe(app)}:`, error);
      // Release what was created before the failure (an open connection,
      // say); the failure to create is the error to report.
      await inj?.dispose().catch((cause) =>
        log.error("cleanup after the failure failed:", cause)
      );
      throw error;
    }
  }

  /**
   * Use {@link ChoWeb.create}, which builds and links the application from a
   * module.
   *
   * @param linked The linked HTTP application.
   * @param graph The HTTP graph of the application.
   * @param routes The routes given to the linker.
   * @param injector The injector that holds the application's instances.
   */
  constructor(
    linked: Linked<T>,
    graph: AppRef,
    routes: readonly Route[],
    injector: Injector,
  ) {
    this.linked = linked;
    this.graph = graph;
    // A list of its own: mounted routes are added to it.
    this.routes = this.#routes = [...routes];
    this.injector = injector;
    // Servers call the handler with more than the request (Deno's connection
    // info, Bun's server, a Workers' env and context): pass everything on.
    // The request is a declared parameter on purpose: `Deno.serve` reads the
    // handler's `length`, and gives no request to a function that declares
    // no parameter.
    type Fetch = (req: Request, ...rest: unknown[]) => Promise<Response>;
    const answer = (req: Request, rest: unknown[]) =>
      this.#closed
        ? Promise.resolve(
          new Response("Service Unavailable", { status: 503 }),
        )
        : (linked.handler as Fetch).call(linked, req, ...rest);
    this.handler = async (req: Request, ...rest: unknown[]) => {
      const response = await answer(req, rest);
      // A route that accepted an upgrade answered 426: the upgrade is done
      // here where the runtime lets a `Response` carry it.
      const upgrade = take_upgrade(req, response, this.#sockets);
      return (upgrade && upgrade_here(req, upgrade)) ?? response;
    };
    this.upgrade = async (req: Request, ...rest: unknown[]) => {
      const response = await answer(req, rest);
      return take_upgrade(req, response, this.#sockets) ?? response;
    };
  }

  /**
   * Add one more route to the application, after it is created.
   *
   * The routes of an application are declared by its controllers. `mount` is
   * for a route that cannot be declared, because it is made from the
   * application itself: the documentation of its routes, which reads
   * {@link graph}.
   *
   * - The route is written like the route of a decorator (`"internal/docs"`,
   *   `"users/:id"`, `""`), and says its whole path: it is **not** under the
   *   global prefix, which is for the routes the application declares.
   * - It is added to {@link routes}, after the others, and registered on the
   *   HTTP runtime. It is not in {@link graph}.
   * - What the handler returns is the response, converted like the result of
   *   a declared handler.
   * - No middleware and no `@Catch` handler of the application runs for it:
   *   it has the `middlewares` of the options. When it fails, the `onError`
   *   of {@link ChoWeb.create} answers, if there is one; without one it
   *   rejects, and the HTTP runtime answers `500`.
   * - It is the last route: where the first declared route wins (the
   *   built-in router, Hono), a declared route that matches the same path
   *   answers first.
   *
   * Call it before the application serves. Later, the HTTP runtime decides:
   * the built-in router takes the route, Hono and Fastify throw.
   *
   * @param method The HTTP method, upper case.
   * @param route The whole route, without leading or trailing `/`.
   * @param handler The handler: a function of the context.
   * @param options The options: `middlewares` and `name`.
   * @throws {ChoError} When the method is not an HTTP method, or when the
   *   handler or a middleware is not a function.
   * @throws {ChoError} When the route is invalid, when a route of the
   *   application already has that method and path, when an option is
   *   unknown, when the application is closed, or when the HTTP runtime can
   *   no longer take a route.
   *
   * @example
   * ```ts
   * const app = await ChoWeb.create(AppModule, { prefix: "api" });
   * app.mount("GET", "health", () => ({ status: "ok" })); // GET /health
   * Deno.serve(app.handler);
   * ```
   */
  mount(
    method: ChoWebMountMethod,
    route: string,
    handler: (ctx: ChoWebContext) => unknown,
    options: ChoWebMountOptions = {},
  ): void {
    if (this.#closed) {
      throw web_error("CHO_WEB_CLOSED", "The application is closed");
    }
    if (!(MOUNT_METHODS as readonly unknown[]).includes(method)) {
      throw web_error(
        "CHO_WEB_INVALID_METHOD",
        `ChoWeb.mount(): method must be one of ${
          MOUNT_METHODS.join(", ")
        }, got ${describe(method)}`,
      );
    }
    const path = "/" + normalize_route(route, "ChoWeb.mount()");
    const where = `${method} ${path}`;
    if (typeof handler !== "function") {
      throw web_error(
        "CHO_WEB_INVALID_HANDLER",
        `ChoWeb.mount(): the handler of ${where} must be a function, got ${
          describe(handler)
        }`,
      );
    }
    assert_known_options("ChoWeb.mount()", options, ["middlewares", "name"]);
    const middlewares = options.middlewares ?? [];
    middlewares.forEach((middleware, index) => {
      if (typeof middleware !== "function") {
        throw web_error(
          "CHO_WEB_INVALID_MIDDLEWARE",
          `ChoWeb.mount(): middleware ${
            index + 1
          } of ${where} must be a function, got ${describe(middleware)}`,
        );
      }
    });
    const name = options.name ?? (handler.name || "mounted");
    const key = route_key({ method, path });
    const taken = this.#routes.find((existing) => route_key(existing) === key);
    if (taken) {
      throw web_error(
        "CHO_WEB_DUPLICATE_ROUTE",
        `Duplicate route ${describe(`${taken.method} ${taken.path}`)}: ${
          this.#mounted.has(taken) ? "mounted as" : "declared by"
        } ${taken.name} and mounted as ${name}`,
      );
    }
    // Created here, not when the module is loaded, so it follows `set_env`.
    const log = debuglog("cho:web");
    const mounted = make_route(
      method,
      path,
      name,
      compose(middlewares, async (ctx) => to_response(await handler(ctx))),
      this.graph.errorHandler,
      log,
    );
    // The runtime first: when it refuses the route, the application has not
    // got it either.
    this.linked.mount(mounted);
    this.#routes.push(mounted);
    this.#mounted.add(mounted);
    log(`${where} -> ${name} (mounted)`);
  }

  /**
   * Release the instances of the application: every provider, controller and
   * module that has a `[Symbol.asyncDispose]()` or `[Symbol.dispose]()`
   * method is disposed, in reverse creation order (see `Injector.dispose`).
   *
   * The open sockets of the application are closed first, with the code
   * `1001` (Going Away): the method marked with `@WsClose` of each runs, and
   * is waited for, before anything is disposed.
   *
   * Call it when the server has stopped: `@chojs/web` does not run the
   * server, so it cannot know. Requests still in flight keep the instances
   * they hold, disposed or not; a request that arrives afterwards is answered
   * `503 Service Unavailable` by {@link handler}, and runs no route. Calling
   * it again does nothing more.
   *
   * @returns A promise that resolves when everything is disposed.
   * @throws {AggregateError} (as a rejection) When instances failed to
   *   dispose.
   *
   * @example
   * ```ts
   * const app = await ChoWeb.create(AppModule, { linker: new HonoLinker() });
   * const server = Deno.serve(app.handler);
   * Deno.addSignalListener("SIGTERM", async () => {
   *   await server.shutdown(); // stop accepting, finish the requests
   *   await app.close();
   * });
   * ```
   */
  async close(): Promise<void> {
    this.#closed = true;
    // The sockets first: their `@WsClose` methods use what is disposed next.
    await close_connections(this.#sockets);
    await this.injector.dispose();
  }

  /** Close the application at the end of an `await using` block. */
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
}
