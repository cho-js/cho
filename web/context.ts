/**
 * The request context: what handlers, middlewares and error handlers of a
 * `@chojs/web` application receive. It is built on the standard `Request`, so
 * application code does not depend on the HTTP runtime.
 *
 * @module
 */

/**
 * The context of one request.
 *
 * @example
 * ```ts
 * @Controller({ route: "users" })
 * class UsersController {
 *   @Get(":id")
 *   get(ctx: ChoWebContext) {
 *     return { id: ctx.params.id, verbose: ctx.url.searchParams.has("v") };
 *   }
 * }
 * ```
 */
export interface ChoWebContext {
  /** The request, as the standard `Request`. */
  readonly req: Request;
  /** The path parameters of the matched route (`:id`), decoded. */
  readonly params: Readonly<Record<string, string>>;
  /** The request URL, parsed on first use. */
  readonly url: URL;
  /**
   * Values shared during the request: a middleware sets one (the
   * authenticated user, say) for the middlewares and the handler after it.
   */
  readonly state: Map<PropertyKey, unknown>;
  /**
   * The context of the HTTP runtime (Hono's `Context` with `HonoLinker`), or
   * `undefined` when the adapter has none. Code that uses it only runs on
   * that runtime.
   */
  readonly native: unknown;
}

/** The context implementation: `url` is parsed lazily. */
class Context implements ChoWebContext {
  readonly req: Request;
  readonly params: Readonly<Record<string, string>>;
  readonly state: Map<PropertyKey, unknown>;
  readonly native: unknown;
  #url: URL | undefined;

  constructor(
    req: Request,
    params: Readonly<Record<string, string>>,
    native: unknown,
    state: Map<PropertyKey, unknown>,
  ) {
    this.req = req;
    this.params = params;
    this.native = native;
    this.state = state;
  }

  get url(): URL {
    return this.#url ??= new URL(this.req.url);
  }
}

/**
 * Create the context of a request.
 *
 * @param req The request.
 * @param params The path parameters of the matched route.
 * @param native The context of the HTTP runtime, if any.
 * @param state The state of the request, when it already has one. Default: a
 *   new, empty one.
 * @returns The context.
 */
export function create_context(
  req: Request,
  params: Readonly<Record<string, string>> = {},
  native?: unknown,
  state: Map<PropertyKey, unknown> = new Map(),
): ChoWebContext {
  return new Context(req, params, native, state);
}
