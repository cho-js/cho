/**
 * @chojs/vendor-cho — the middlewares of the built-in router of `@chojs/web`.
 *
 * The built-in router has no HTTP library underneath, so nothing brings the
 * middlewares an application usually takes from one. This package has them,
 * written as CHO middlewares: functions `(ctx, next)` on the standard
 * `Request` and `Response`, with no dependency.
 *
 * - {@link cors}: Cross-Origin Resource Sharing.
 *
 * A middleware goes on the routes it should cover, with `@Middlewares`, or on
 * the router, to cover every request:
 *
 * @example
 * ```ts
 * import { ChoLinker, ChoWeb } from "@chojs/web";
 * import { cors } from "@chojs/vendor-cho";
 *
 * const app = await ChoWeb.create(AppModule, {
 *   linker: new ChoLinker({
 *     middlewares: [cors({ origin: "https://example.com" })],
 *   }),
 * });
 * ```
 *
 * @module
 */

import type { ChoWebContext, ChoWebMiddlewareFn, ChoWebNext } from "@chojs/web";

// The `@chojs/web` types this module refers to.
export type { ChoWebContext, ChoWebMiddlewareFn, ChoWebNext };

/** The options of {@link cors}. */
export type CorsOptions = {
  /**
   * The origins that may read the responses:
   *
   * - `"*"`: any origin. Default.
   * - a string: that origin (`"https://example.com"`);
   * - a list of strings: those origins;
   * - a function `(origin, ctx)`: the origins it returns `true` for. It can
   *   be `async`.
   *
   * An origin is compared as it is sent: scheme, host and port, with no
   * trailing slash.
   */
  readonly origin?:
    | string
    | readonly string[]
    | ((origin: string, ctx: ChoWebContext) => boolean | Promise<boolean>);
  /**
   * The methods a cross-origin request may use, sent in answer to a
   * preflight request. Default: `GET`, `HEAD`, `PUT`, `POST`, `DELETE`,
   * `PATCH`.
   */
  readonly methods?: readonly string[];
  /**
   * The request headers a cross-origin request may send, sent in answer to a
   * preflight request. Default: the headers the preflight request asks for.
   */
  readonly allowedHeaders?: readonly string[];
  /**
   * The response headers a script may read, besides the ones every script
   * may. Default: none.
   */
  readonly exposedHeaders?: readonly string[];
  /**
   * Whether a cross-origin request may be sent with credentials (cookies,
   * authorization). With credentials, a response never allows `*`: it names
   * the origin of the request. Default: `false`.
   */
  readonly credentials?: boolean;
  /**
   * For how long, in seconds, a browser may keep the answer to a preflight
   * request. Default: not sent, so the browser's own default.
   */
  readonly maxAge?: number;
};

/** The default of the `methods` option of {@link cors}. */
const DEFAULT_METHODS = ["GET", "HEAD", "PUT", "POST", "DELETE", "PATCH"];

/** Assert that an option is a list of strings, when it is given. */
function assert_strings(name: string, value: unknown): void {
  if (
    value !== undefined &&
    !(Array.isArray(value) && value.every((one) => typeof one === "string"))
  ) {
    throw new TypeError(`cors(): ${name} must be a list of strings`);
  }
}

/**
 * A response whose headers can be changed. The headers of some responses
 * cannot (`Response.redirect()`, a response of `fetch`): those are copied.
 */
function with_headers(
  response: Response,
  change: (headers: Headers) => void,
): Response {
  try {
    change(response.headers);
    return response;
  } catch {
    const copy = new Response(response.body, response);
    change(copy.headers);
    return copy;
  }
}

/**
 * Make a CORS (Cross-Origin Resource Sharing) middleware: it lets pages of
 * other origins call the application from a browser.
 *
 * - **A preflight request** (an `OPTIONS` request with
 *   `Access-Control-Request-Method`) is answered `204` by the middleware
 *   itself, with what is allowed. The rest of the chain does not run.
 * - **Any other request** runs the rest of the chain, and the middleware adds
 *   the CORS headers to its response.
 * - A request without an `Origin` header is not a cross-origin request: it is
 *   left as it is. A request from an origin that is not allowed gets no CORS
 *   header, so the browser refuses to give its response to the page.
 * - `Vary: Origin` is added whenever the answer depends on the origin of the
 *   request, so that caches keep the answers apart.
 *
 * **Where to put it.** A browser sends a preflight request to the path of
 * the real request, with the method `OPTIONS`. A middleware of
 * `@Middlewares` only runs for a request that matches a route, so it answers
 * a preflight request only where there is an `@Options` route. To cover every
 * path, give the middleware to the router: `new ChoLinker({ middlewares:
 * [cors()] })`.
 *
 * @param options The origins, methods and headers to allow. Default: any
 *   origin, without credentials.
 * @returns A CHO middleware function.
 * @throws {TypeError} When an option is not of the right type.
 *
 * @example On every request
 * ```ts
 * import { ChoLinker, ChoWeb } from "@chojs/web";
 * import { cors } from "@chojs/vendor-cho";
 *
 * const app = await ChoWeb.create(AppModule, {
 *   linker: new ChoLinker({
 *     middlewares: [
 *       cors({
 *         origin: ["https://example.com", "https://admin.example.com"],
 *         credentials: true,
 *         maxAge: 600,
 *       }),
 *     ],
 *   }),
 * });
 * ```
 *
 * @example On some routes
 * ```ts
 * @Middlewares(cors({ origin: "https://example.com" }))
 * @Controller({ route: "public" })
 * class PublicController {
 *   @Get("status")
 *   status() {
 *     return { ok: true };
 *   }
 * }
 * ```
 */
export function cors(options: CorsOptions = {}): ChoWebMiddlewareFn {
  const {
    origin = "*",
    methods = DEFAULT_METHODS,
    allowedHeaders,
    exposedHeaders = [],
    credentials = false,
    maxAge,
  } = options;
  if (
    typeof origin !== "string" && typeof origin !== "function" &&
    !(Array.isArray(origin) && origin.every((one) => typeof one === "string"))
  ) {
    throw new TypeError(
      "cors(): origin must be a string, a list of strings or a function",
    );
  }
  assert_strings("methods", methods);
  assert_strings("allowedHeaders", allowedHeaders);
  assert_strings("exposedHeaders", exposedHeaders);
  if (typeof credentials !== "boolean") {
    throw new TypeError("cors(): credentials must be a boolean");
  }
  if (maxAge !== undefined && !(Number.isInteger(maxAge) && maxAge >= 0)) {
    throw new TypeError("cors(): maxAge must be a whole number of seconds");
  }

  const any = origin === "*";
  // With `*` and no credentials, every request gets the same answer.
  const varies = !any || credentials;

  /** The value of `Access-Control-Allow-Origin` for a request, if any. */
  async function allow_origin(
    requested: string,
    ctx: ChoWebContext,
  ): Promise<string | undefined> {
    if (any) {
      // `*` is not allowed with credentials: name the origin instead.
      return credentials ? requested : "*";
    }
    const allowed = typeof origin === "function"
      ? await origin(requested, ctx)
      : typeof origin === "string"
      ? origin === requested
      : origin.includes(requested);
    return allowed ? requested : undefined;
  }

  return async (ctx, next) => {
    const { headers: sent, method } = ctx.req;
    const requested = sent.get("origin");
    const allowed = requested === null
      ? undefined
      : await allow_origin(requested, ctx);

    if (method === "OPTIONS" && sent.has("access-control-request-method")) {
      const headers = new Headers();
      if (varies) {
        headers.append("vary", "Origin");
      }
      if (allowed !== undefined) {
        headers.set("access-control-allow-origin", allowed);
        if (credentials) {
          headers.set("access-control-allow-credentials", "true");
        }
        headers.set("access-control-allow-methods", methods.join(", "));
        const asked = sent.get("access-control-request-headers");
        if (allowedHeaders) {
          headers.set(
            "access-control-allow-headers",
            allowedHeaders.join(", "),
          );
        } else if (asked !== null) {
          // What is allowed is what was asked: it differs between requests.
          headers.set("access-control-allow-headers", asked);
          headers.append("vary", "Access-Control-Request-Headers");
        }
        if (maxAge !== undefined) {
          headers.set("access-control-max-age", String(maxAge));
        }
      }
      return new Response(null, { status: 204, headers });
    }

    const response = await next();
    if (!varies && allowed === undefined) {
      return response;
    }
    return with_headers(response, (headers) => {
      if (varies) {
        headers.append("vary", "Origin");
      }
      if (allowed !== undefined) {
        headers.set("access-control-allow-origin", allowed);
        if (credentials) {
          headers.set("access-control-allow-credentials", "true");
        }
        if (exposedHeaders.length > 0) {
          headers.set(
            "access-control-expose-headers",
            exposedHeaders.join(", "),
          );
        }
      }
    });
  };
}
