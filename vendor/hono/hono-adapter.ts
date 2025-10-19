import type { Target } from "@chojs/core/meta";
import type {
  ChoEndpointFn,
  ChoErrorHandlerFn,
  ChoMiddlewareFn,
} from "@chojs/core/di";
import type { Context, ErrorHandler, MiddlewareHandler } from "hono";
import type { ChoWebAdapter, ChoWebContext } from "@chojs/web";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { stream, streamSSE, streamText } from "hono/streaming";

/**
 * Cho adapter for Hono framework
 * @see https://hono.dev
 */
export class HonoAdapter implements
  ChoWebAdapter<
    Hono,
    Hono,
    Hono,
    Target,
    Target,
    Context
  > {
  createContext(
    raw: Context,
  ): ChoWebContext {
    // Hono's context is already well-typed, so we can directly cast it
    return raw as ChoWebContext;
  }

  createMiddlewares(
    middlewares: ChoMiddlewareFn[],
  ): Target {
    return middlewares.map((m) =>
      createMiddleware(m as MiddlewareHandler) as Target
    );
  }

  createEndpoint(
    endpoint: ChoEndpointFn,
  ): Target {
    // in hono, endpoint is just a handler function with the same
    // signature as middleware (omitting next)
    return endpoint;
  }

  createController(
    middlewares: Target[],
    errorHandler?: ChoErrorHandlerFn,
  ): Hono {
    const c = new Hono();
    for (const mw of middlewares) {
      c.use(mw as MiddlewareHandler);
    }
    if (errorHandler) {
      c.onError(errorHandler as ErrorHandler);
    }
    return c;
  }

  createFeature(
    middlewares: Target[],
    errorHandler?: ChoErrorHandlerFn,
  ): Hono {
    // in hone, feature and controller are the same
    return this.createController(middlewares, errorHandler);
  }

  mountEndpoint(
    ctr: Hono,
    middlewares: Target[],
    endpoint: Target,
    route: string,
    httpMethod: string,
  ): void {
    httpMethod = httpMethod.toLowerCase() as keyof Hono;
    ctr[httpMethod](
      route,
      ...middlewares,
      endpoint,
    );
  }

  mountApp<R = Hono>(feature: Hono, route: string): R {
    const app = new Hono();
    app.route(route, feature);
    return app as R;
  }

  mountController(feat: Hono, controller: Hono, route: string): void {
    feat.route(route, controller);
  }

  mountFeature(to: Hono, feat: Hono, route: string): void {
    return this.mountController(to, feat, route);
  }

  // extended HTTP methods

  // SseAdapter

    createSseEndpoint(handler: ChoEndpointFn): Target {
        return function (ctx: RawContext) {
            return streamSSE(ctx, (stream) => handler(ctx, stream));
        };
    }

    // StreamAdapter

  createStreamEndpoint(handler: ChoEndpointFn): Target {
    return function (ctx: RawContext) {
      return stream(ctx, (stream) => handler(ctx, stream));
    };
  }

  // TextStreamAdapter

  createTextStreamEndpoint(handler: ChoEndpointFn): Target {
    return function (ctx: RawContext) {
      return streamText(ctx, (stream) => handler(ctx, stream));
    };
  }
}
