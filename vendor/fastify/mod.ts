/**
 * @chojs/vendor-fastify — runs CHO web applications on Fastify, on Node.js.
 *
 * {@link FastifyLinker} registers the routes of a `@chojs/web` application on
 * a Fastify application. Pass it to `ChoWeb.create` as `linker`, and serve
 * the Fastify application.
 *
 * {@link fromFastify} turns a Fastify request hook (what `@fastify/auth`,
 * `@fastify/basic-auth`, `@fastify/rate-limit` and others give for a route)
 * into a CHO middleware, for `@Middlewares`.
 *
 * @example
 * ```ts
 * import { ChoWeb } from "@chojs/web";
 * import { FastifyLinker } from "@chojs/vendor-fastify";
 *
 * const app = await ChoWeb.create(AppModule, { linker: new FastifyLinker() });
 * await app.linked.instance.listen({ port: 3000 });
 * ```
 *
 * @module
 */

import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
  type HTTPMethods,
} from "fastify";
import type { ChoWebContext, ChoWebMiddlewareFn, ChoWebNext } from "@chojs/web";
import type { Linked, Linker, Route } from "@chojs/web/linker";

// The `@chojs/web` types this module refers to. (`FastifyInstance`,
// `FastifyRequest` and `FastifyReply` are types of the `fastify` package:
// import them from there.)
export type {
  ChoWebContext,
  ChoWebMiddlewareFn,
  ChoWebNext,
  Linked,
  Linker,
  Route,
};

/**
 * What a handler finds in `ctx.native` on this adapter: Fastify's request and
 * reply.
 *
 * @example
 * ```ts
 * @Get("ip")
 * ip(ctx: ChoWebContext) {
 *   return (ctx.native as FastifyNative).request.ip;
 * }
 * ```
 */
export type FastifyNative = {
  /** Fastify's request. */
  readonly request: FastifyRequest;
  /** Fastify's reply. */
  readonly reply: FastifyReply;
};

/** The replies a Fastify hook answered by itself (see {@link fromFastify}). */
const ANSWERED = new WeakSet<FastifyReply>();

/** The statuses of a response that has no body. */
const NO_BODY = new Set([101, 204, 205, 304]);

/**
 * Write a route path for Fastify's router: a `:` that does not start a
 * parameter is written `::`.
 */
function fastify_path(path: string): string {
  return path
    .split("/")
    .map((segment) =>
      segment.startsWith(":") ? segment : segment.replaceAll(":", "::")
    )
    .join("/");
}

/** The standard `Request` of a Fastify request; its body is the raw stream. */
function to_request(request: FastifyRequest, reply: FastifyReply): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (name.startsWith(":")) {
      continue; // an HTTP/2 pseudo-header
    }
    for (const one of Array.isArray(value) ? value : [value]) {
      if (one !== undefined) {
        headers.append(name, one);
      }
    }
  }
  // Aborted when the connection closes before the response is sent.
  const abort = new AbortController();
  reply.raw.once("close", () => {
    if (!reply.raw.writableFinished) {
      abort.abort();
    }
  });
  const has_body = request.method !== "GET" && request.method !== "HEAD";
  return new Request(`${request.protocol}://${request.host}${request.url}`, {
    method: request.method,
    headers,
    signal: abort.signal,
    ...(has_body
      ? {
        body: Readable.toWeb(request.raw) as unknown as ReadableStream,
        duplex: "half",
      }
      : {}),
  } as RequestInit);
}

/**
 * A Fastify application linked by {@link FastifyLinker}.
 *
 * Serve it with Fastify: `instance.listen()`. {@link handler} is for tests
 * and for code that needs a `fetch`-style function.
 *
 * @example
 * ```ts
 * const app = await ChoWeb.create(AppModule, { linker: new FastifyLinker() });
 * await app.linked.instance.listen({ port: 3000 });
 * ```
 */
export class FastifyLinked implements Linked<FastifyInstance> {
  /** The Fastify application. */
  readonly instance: FastifyInstance;

  /**
   * A `fetch`-style request handler. It sends the request through Fastify's
   * `inject()`, without a network connection: the bodies of the request and
   * of the response are read whole, not streamed.
   */
  readonly handler: (req: Request) => Promise<Response>;

  /**
   * Wrap a Fastify application.
   *
   * @param instance The Fastify application.
   */
  constructor(instance: FastifyInstance) {
    this.instance = instance;
    this.handler = async (req) => {
      const payload = req.body === null
        ? undefined
        : Buffer.from(await req.arrayBuffer());
      const result = await instance.inject({
        method: req.method as HTTPMethods,
        url: req.url,
        headers: Object.fromEntries(req.headers),
        ...(payload ? { payload } : {}),
      });
      const headers = new Headers();
      for (const [name, value] of Object.entries(result.headers)) {
        for (const one of Array.isArray(value) ? value : [value]) {
          if (one !== undefined) {
            headers.append(name, String(one));
          }
        }
      }
      const no_body = req.method === "HEAD" || NO_BODY.has(result.statusCode);
      return new Response(no_body ? null : new Uint8Array(result.rawPayload), {
        status: result.statusCode,
        statusText: result.statusMessage,
        headers,
      });
    };
  }
}

/**
 * Registers the routes of a CHO web application on a Fastify application.
 * Fastify runs on Node.js: so does this adapter.
 *
 * Fastify only matches requests: each route is registered with its method and
 * its full path, and answers through `Route.handle`, which `@chojs/web`
 * built. Middlewares, error handlers and the conversion of results to
 * responses are `@chojs/web`'s, so they behave the same on every adapter.
 *
 * - Handlers receive a `ChoWebContext`, with a standard `Request` built from
 *   Fastify's. Fastify's request and reply are its `native` property (see
 *   {@link FastifyNative}).
 * - The routes are registered as a Fastify plugin, so they are there once the
 *   application is ready: `listen()`, `ready()` and the linked `handler` wait
 *   for it. Inside the plugin Fastify parses no body: `ctx.req` reads it.
 * - Fastify's router decides which route matches: a static path wins over a
 *   parameter, wherever they are declared.
 * - A `HEAD` request runs the `@Head` handler of the route; without one, the
 *   `@Get` handler answers it, without the body.
 * - A route that fails without a `@Catch` handler goes to Fastify's error
 *   handler (see `setErrorHandler`), and a request no route matches to its
 *   not-found handler (see `setNotFoundHandler`).
 * - Fastify plugins and hooks are not CHO middlewares. To use them, add them
 *   to a Fastify application and give it to the linker: they apply to every
 *   route.
 *
 * @example
 * ```ts
 * import { ChoWeb } from "@chojs/web";
 * import { FastifyLinker } from "@chojs/vendor-fastify";
 *
 * const app = await ChoWeb.create(AppModule, { linker: new FastifyLinker() });
 * await app.linked.instance.listen({ port: 3000 });
 * ```
 *
 * @example With Fastify options and plugins
 * ```ts
 * import Fastify from "fastify";
 * import cors from "@fastify/cors";
 *
 * const fastify = Fastify({ logger: true });
 * await fastify.register(cors);
 * const app = await ChoWeb.create(AppModule, {
 *   linker: new FastifyLinker(fastify),
 * });
 * ```
 */
export class FastifyLinker implements Linker<FastifyInstance> {
  /** The Fastify application the routes are registered on. */
  readonly #app: FastifyInstance;
  /** Whether {@link link} was called: a linker serves one application. */
  #linked = false;

  /**
   * Create a linker.
   *
   * @param app The Fastify application to register the routes on. Default: a
   *   new one, with Fastify's default options. Give your own to set options
   *   (`logger`, ...), and to add plugins, hooks, an error handler or a
   *   not-found handler first. Use a linker for one application only.
   */
  constructor(app: FastifyInstance = Fastify()) {
    this.#app = app;
  }

  /**
   * Register routes on the linker's Fastify application.
   *
   * @param routes The routes of the application.
   * @returns The linked Fastify application.
   * @throws {Error} When the linker was already used: its Fastify application
   *   holds the routes of the first application.
   */
  link(routes: readonly Route[]): FastifyLinked {
    // A second application would add its routes to the first one's.
    if (this.#linked) {
      throw new Error(
        "FastifyLinker.link() was already called: use one linker for one application",
      );
    }
    this.#linked = true;

    /** Answer a Fastify request with a route. */
    const answer = (route: Route, bodiless: boolean) =>
    async (
      request: FastifyRequest,
      reply: FastifyReply,
    ): Promise<FastifyReply> => {
      const params = request.params as Record<string, string>;
      // Fastify matches an empty parameter (`/users/`): a parameter is one
      // segment, as on every adapter.
      if (Object.values(params).includes("")) {
        reply.callNotFound();
        return reply;
      }
      const native: FastifyNative = { request, reply };
      const response = await route.handle(
        to_request(request, reply),
        params,
        native,
      );
      // A Fastify hook (`fromFastify`) answered: the response is Fastify's.
      if (ANSWERED.has(reply)) {
        return reply;
      }
      return reply.send(
        bodiless && response.body !== null
          ? new Response(null, response)
          : response,
      );
    };

    // A HEAD request is answered by the HEAD route of the path or, without
    // one, by its GET route, without the body. Fastify's own HEAD routes are
    // turned off: they do not take a `Response`.
    const with_head = new Set(
      routes.filter((r) => r.method === "HEAD").map((r) => r.path),
    );
    // In a plugin, so that what is set here stays here: Fastify parses no
    // body for these routes, and leaves the stream to the `Request`.
    this.#app.register((scope, _options, done) => {
      scope.removeAllContentTypeParsers();
      scope.addContentTypeParser("*", (_request, _payload, parsed) => {
        parsed(null);
      });
      for (const route of routes) {
        const url = fastify_path(route.path);
        scope.route({
          method: route.method as HTTPMethods,
          url,
          exposeHeadRoute: false,
          handler: answer(route, false),
        });
        if (route.method === "GET" && !with_head.has(route.path)) {
          scope.route({ method: "HEAD", url, handler: answer(route, true) });
        }
      }
      done();
    });
    return new FastifyLinked(this.#app);
  }
}

/**
 * A Fastify hook of the request phase (`onRequest`, `preValidation`,
 * `preHandler`): a function of the request and the reply, that either
 * returns a promise or calls `done`. It is what many Fastify plugins give to
 * protect a route: `fastify.basicAuth`, `fastify.auth([...])`,
 * `fastify.rateLimit()`, `fastify.csrfProtection`.
 */
export type FastifyHook = (
  this: FastifyInstance,
  request: FastifyRequest,
  reply: FastifyReply,
  done: (error?: Error) => void,
) => unknown;

/** Fastify's request and reply, or an error when the adapter is not Fastify's. */
function fastify_native(ctx: ChoWebContext): FastifyNative {
  const native = ctx.native as Partial<FastifyNative> | undefined;
  if (
    native === null || typeof native !== "object" ||
    typeof native.reply?.send !== "function" ||
    typeof native.request?.raw !== "object"
  ) {
    throw new Error(
      "fromFastify(): a Fastify hook runs on the Fastify adapter only: create the application with a FastifyLinker",
    );
  }
  return native as FastifyNative;
}

/** Whether Fastify has sent, or is sending, the response of a reply. */
function is_sent(reply: FastifyReply): boolean {
  return reply.sent || reply.raw.writableEnded || !reply.raw.writable;
}

/**
 * Run a Fastify hook, in either of its two styles.
 *
 * @returns Whether the hook answered the request itself, once it is done:
 *   its promise resolved, it called `done`, or it sent the reply without
 *   calling `done`.
 */
function run_hook(
  hook: FastifyHook,
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<boolean> {
  return new Promise<boolean>((resolve, reject) => {
    // A hook that answers in the callback style never calls `done`: the end
    // of the response is what says it is done.
    const closed = () => resolve(true);
    reply.raw.once("close", closed);
    const settle = (error: unknown, returned?: unknown) => {
      reply.raw.off("close", closed);
      if (error !== undefined && error !== null) {
        reject(error);
      } else {
        // Returning the reply says "I answered", as in a Fastify handler.
        resolve(returned === reply || is_sent(reply));
      }
    };
    try {
      const result = hook.call(request.server, request, reply, settle);
      if (typeof (result as PromiseLike<unknown> | null)?.then === "function") {
        (result as PromiseLike<unknown>).then(
          (returned) => settle(undefined, returned),
          (error) => settle(error ?? new Error("the hook rejected")),
        );
      }
    } catch (error) {
      settle(error ?? new Error("the hook threw"));
    }
  });
}

/**
 * Turn a Fastify hook into a CHO middleware, so that what Fastify plugins
 * give to protect a route (`fastify.basicAuth`, `fastify.auth([...])`,
 * `fastify.rateLimit()`, ...) can be given to `@Middlewares`, on a handler, a
 * controller or a feature module.
 *
 * The hook runs with Fastify's request and reply, at the place of the CHO
 * middleware in the chain, on the Fastify application of the route (`this`):
 *
 * - when it is done (its promise resolves, or it calls `done()`), the rest
 *   of the CHO chain runs;
 * - when it answers by itself (`reply.send()`, `reply.redirect()`), the rest
 *   of the chain does not run, and the response is the one Fastify sends.
 *   The CHO middlewares around it see a response with that status and those
 *   headers, and cannot change it;
 * - when it fails (it throws, rejects, or calls `done(error)`), the error
 *   goes to the CHO error handlers, then to Fastify's.
 *
 * A hook is a step before the handler: it cannot change the response of the
 * handler. For that, and for plugins that are not hooks (`@fastify/cors`,
 * `@fastify/helmet`), register the plugin on the Fastify application given
 * to the linker.
 *
 * Fastify does not parse the body of CHO routes, so `request.body` is not set
 * in a hook.
 *
 * It only works for an application created with a {@link FastifyLinker}: on
 * another adapter the middleware throws.
 *
 * @param hook The Fastify hook.
 * @returns A CHO middleware function.
 *
 * @example
 * ```ts
 * import Fastify from "fastify";
 * import basicAuth from "@fastify/basic-auth";
 * import { ChoWeb, Controller, Get, Middlewares } from "@chojs/web";
 * import { FastifyLinker, fromFastify } from "@chojs/vendor-fastify";
 *
 * const fastify = Fastify();
 * await fastify.register(basicAuth, { validate, authenticate: true });
 *
 * @Middlewares(fromFastify(fastify.basicAuth))
 * @Controller({ route: "admin" })
 * class AdminController {
 *   @Get("report")
 *   report() {
 *     return { users: 3 };
 *   }
 * }
 *
 * const app = await ChoWeb.create(App, { linker: new FastifyLinker(fastify) });
 * ```
 *
 * @example A hook of your own
 * ```ts
 * const only_local = fromFastify(async (request, reply) => {
 *   if (request.ip !== "127.0.0.1") {
 *     return reply.code(403).send({ error: "forbidden" });
 *   }
 * });
 * ```
 */
export function fromFastify(hook: FastifyHook): ChoWebMiddlewareFn {
  return async (ctx, next) => {
    const { request, reply } = fastify_native(ctx);
    if (!await run_hook(hook, request, reply)) {
      return next();
    }
    ANSWERED.add(reply);
    // What the CHO chain sees of Fastify's answer: its status and headers.
    const headers = new Headers();
    for (const [name, value] of Object.entries(reply.getHeaders())) {
      for (const one of Array.isArray(value) ? value : [value]) {
        if (one !== undefined) {
          headers.append(name, String(one));
        }
      }
    }
    return new Response(null, { status: reply.statusCode, headers });
  };
}
