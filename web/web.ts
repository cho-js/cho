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

import type { Ctr, Provider } from "@chojs/core/di";
import { Injector } from "@chojs/core/di";
import { debuglog, describe } from "@chojs/core/utils";
import { build_http_graph } from "./build-graph.ts";
import type { AppRef } from "./graph.ts";
import type { Linked, Linker, Route } from "./linker.ts";
import { ChoLinker, type ChoRouter } from "./router.ts";
import { compile_routes } from "./routes.ts";
import type { ChoWebErrorHandler } from "./types.ts";

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
  /** The routes of the application, as given to the linker. */
  readonly routes: readonly Route[];
  /** Holds the instances of the application; disposed by {@link close}. */
  readonly #injector: Injector;
  /** Whether {@link close} was called: requests are then refused. */
  #closed = false;
  /**
   * The request handler of the application: a `fetch`-style function that
   * takes a `Request` and resolves to a `Response`. It is the handler of the
   * linked runtime (`linked.handler`), with whatever other arguments the
   * server gives it, until the application is closed: after {@link close}, it
   * answers `503 Service Unavailable` without running any route.
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
   * @throws {Error} When the module graph is invalid (see `Injector`), when a
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
   * @throws {Error} As above, and on a runtime that has no URL Pattern API.
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
      );
      const routes = compile_routes(graph, log);
      if (log.enabled) {
        for (const route of routes) {
          log(`${route.method} ${route.path} -> ${route.name}`);
        }
      }
      const web = new ChoWeb(linker.link(routes), graph, routes, inj);
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
    this.routes = routes;
    this.#injector = injector;
    // Servers call the handler with more than the request (Deno's connection
    // info, Bun's server, a Workers' env and context): pass everything on.
    // The request is a declared parameter on purpose: `Deno.serve` reads the
    // handler's `length`, and gives no request to a function that declares
    // no parameter.
    type Fetch = (req: Request, ...rest: unknown[]) => Promise<Response>;
    this.handler = (req: Request, ...rest: unknown[]) =>
      this.#closed
        ? Promise.resolve(
          new Response("Service Unavailable", { status: 503 }),
        )
        : (linked.handler as Fetch).call(linked, req, ...rest);
  }

  /**
   * Release the instances of the application: every provider, controller and
   * module that has a `[Symbol.asyncDispose]()` or `[Symbol.dispose]()`
   * method is disposed, in reverse creation order (see `Injector.dispose`).
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
  close(): Promise<void> {
    this.#closed = true;
    return this.#injector.dispose();
  }

  /** Close the application at the end of an `await using` block. */
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }
}
