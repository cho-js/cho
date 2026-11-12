/**
 * @chojs/vendor-cho — runs CHO web applications with no HTTP library.
 *
 * {@link ChoLinker} matches requests to the routes of a `@chojs/web`
 * application with the standard
 * [URL Pattern API](https://developer.mozilla.org/docs/Web/API/URL_Pattern_API).
 * Pass it to `ChoWeb.create` as `linker`.
 *
 * @example
 * ```ts
 * import { ChoWeb } from "@chojs/web";
 * import { ChoLinker } from "@chojs/vendor-cho";
 *
 * const app = await ChoWeb.create(AppModule, { linker: new ChoLinker() });
 * Deno.serve(app.handler);
 * ```
 *
 * @module
 */

import type { Linked, Linker, Route } from "@chojs/web/linker";

// The `@chojs/web` types `ChoLinker` and `ChoRouter` refer to.
export type { Linked, Linker, Route };

/** The options of a {@link ChoLinker}. */
export type ChoLinkerOptions = {
  /**
   * Answer a request no route matches. Default: `404`, with the text
   * `Not Found`.
   */
  readonly notFound?: (req: Request) => Response | Promise<Response>;
};

/** A route a {@link ChoRouter} matched, and the parameters of the match. */
export type ChoMatch = {
  /** The route. */
  readonly route: Route;
  /** The path parameters, decoded. */
  readonly params: Readonly<Record<string, string>>;
};

/** Characters with a meaning in a URL pattern, in a static path segment. */
const PATTERN_SYNTAX = /[:()+*?{}\\]/g;

/**
 * Write a route path as the `pathname` of a URL pattern: parameters
 * (`:name`) stay as they are, and every other segment is matched literally.
 */
function pattern_pathname(path: string): string {
  return path
    .split("/")
    .map((segment) =>
      segment.startsWith(":")
        ? segment
        : segment.replace(PATTERN_SYNTAX, "\\$&")
    )
    .join("/");
}

/** Decode a path parameter; one that is not valid stays as it was sent. */
function decode_parameter(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * The router of {@link ChoLinker}: the routes of an application, each with
 * its URL pattern.
 *
 * @example
 * ```ts
 * const app = await ChoWeb.create(AppModule, { linker: new ChoLinker() });
 * const router = app.linked.instance;
 * router.match("GET", "/users/42")?.params; // { id: "42" }
 * Deno.serve(router.fetch);
 * ```
 */
export class ChoRouter {
  /** The routes, in declaration order. */
  readonly routes: readonly Route[];
  /** The routes and their patterns, by HTTP method. */
  readonly #table = new Map<string, { route: Route; pattern: URLPattern }[]>();
  /** Answers a request no route matches. */
  readonly #not_found: (req: Request) => Response | Promise<Response>;

  /**
   * Create a router.
   *
   * @param routes The routes of the application.
   * @param options The options of the linker.
   * @throws {Error} When the runtime has no URL Pattern API.
   */
  constructor(routes: readonly Route[], options: ChoLinkerOptions = {}) {
    if (typeof URLPattern !== "function") {
      throw new Error(
        "@chojs/vendor-cho needs the URL Pattern API (URLPattern), which this runtime does not have",
      );
    }
    this.routes = routes;
    this.#not_found = options.notFound ??
      (() => new Response("Not Found", { status: 404 }));
    for (const route of routes) {
      const pattern = new URLPattern({
        pathname: pattern_pathname(route.path),
      });
      const of_method = this.#table.get(route.method);
      if (of_method) {
        of_method.push({ route, pattern });
      } else {
        this.#table.set(route.method, [{ route, pattern }]);
      }
    }
  }

  /**
   * Find the route of a request: the first one, in declaration order, with
   * that method and a path that matches.
   *
   * @param method The HTTP method, upper case.
   * @param pathname The path of the request, as in `URL.pathname`.
   * @returns The route and the decoded path parameters, or `undefined`.
   */
  match(method: string, pathname: string): ChoMatch | undefined {
    for (const { route, pattern } of this.#table.get(method) ?? []) {
      const groups = pattern.exec({ pathname })?.pathname.groups;
      if (groups) {
        const params: Record<string, string> = {};
        for (const [name, value] of Object.entries(groups)) {
          params[name] = decode_parameter(value ?? "");
        }
        return { route, params };
      }
    }
    return undefined;
  }

  /**
   * The request handler: a `fetch`-style function.
   *
   * - A `HEAD` request without a `HEAD` route is answered by the `GET` route
   *   of the path, without the body.
   * - A request no route matches is answered by the `notFound` option.
   * - A route that rejects is logged with `console.error`, and answered with
   *   `500`.
   *
   * @param req The request.
   * @returns The response.
   */
  readonly fetch = async (req: Request): Promise<Response> => {
    const { pathname } = new URL(req.url);
    let found = this.match(req.method, pathname);
    let head_from_get = false;
    if (!found && req.method === "HEAD") {
      found = this.match("GET", pathname);
      head_from_get = found !== undefined;
    }
    if (!found) {
      return await this.#not_found(req);
    }
    try {
      const response = await found.route.handle(req, found.params);
      return head_from_get && response.body !== null
        ? new Response(null, response)
        : response;
    } catch (error) {
      console.error(error);
      return new Response("Internal Server Error", { status: 500 });
    }
  };
}

/**
 * Links the routes of a CHO web application to a {@link ChoRouter}: a plain
 * router on the standard URL Pattern API, with no HTTP library underneath.
 *
 * The router only matches requests: each route answers through
 * `Route.handle`, which `@chojs/web` built. Middlewares, error handlers and
 * the conversion of results to responses are `@chojs/web`'s, so they behave
 * the same on every adapter.
 *
 * - Routes are matched in declaration order.
 * - A `HEAD` request runs the `@Head` handler of the route; without one, the
 *   `@Get` handler answers it, without the body.
 * - A route that fails without a `@Catch` handler is logged with
 *   `console.error`, and answered with `500`.
 * - There is no runtime context: `ctx.native` is `undefined`.
 *
 * It needs the global `URLPattern`.
 *
 * @example
 * ```ts
 * import { ChoWeb } from "@chojs/web";
 * import { ChoLinker } from "@chojs/vendor-cho";
 *
 * const app = await ChoWeb.create(AppModule, { linker: new ChoLinker() });
 * Deno.serve(app.handler);
 * ```
 *
 * @example With a not-found handler
 * ```ts
 * const linker = new ChoLinker({
 *   notFound: () => Response.json({ error: "not found" }, { status: 404 }),
 * });
 * ```
 */
export class ChoLinker implements Linker<ChoRouter> {
  /** The options given to each router. */
  readonly #options: ChoLinkerOptions;

  /**
   * Create a linker.
   *
   * @param options The options of the linker.
   */
  constructor(options: ChoLinkerOptions = {}) {
    this.#options = options;
  }

  /**
   * Create a router for routes.
   *
   * @param routes The routes of the application.
   * @returns The router, and its `fetch` as the request handler.
   * @throws {Error} When the runtime has no URL Pattern API.
   */
  link(routes: readonly Route[]): Linked<ChoRouter> {
    const instance = new ChoRouter(routes, this.#options);
    return { instance, handler: instance.fetch };
  }
}
