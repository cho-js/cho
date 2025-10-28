import type {
  CompiledGateway,
  CompiledMethod,
  CompiledModule,
} from "@chojs/core/application";
import type { Target } from "@chojs/core/meta";
import type { ChoEndpointFn, ChoMiddlewareFn } from "@chojs/core/di";
import type { InputFactory } from "./types.ts";
import { debuglog } from "@chojs/core/utils";
import type { Context, ErrorHandler, MiddlewareHandler } from "@hono/hono";
import { Hono } from "@hono/hono";
import { createMiddleware } from "@hono/hono/factory";
import { stream, streamSSE, streamText } from "@hono/hono/streaming";
import type { SSEMessage, SSEStreamingApi } from "@hono/hono/streaming";

const log = debuglog("web:hono-linker");

/**
 * Where the magic happens, linking compiled modules to Hono application instances.
 */
export class HonoLinker {
  /**
   * Link a compiled module to an Hono application instance.
   * @param cm
   */
  link(cm: CompiledModule): Hono {
    const end = log.start();
    const app = this.feature(cm);
    if (!app) {
      throw new Error("Cannot link an empty module");
    }
    end("module linked");
    return app;
  }

  /**
   * Return a feature for the given compiled module, or null if the module has no routes.
   * The feature is a Hono instance.
   *
   * @param cm
   * @protected
   */
  protected feature(
    cm: CompiledModule,
  ): Hono | null {
    let mounted = false;

    // feature instance
    const feat = this.createController(cm);

    // sub features
    for (const cf of cm.imports) {
      const sub = this.feature(cf);
      if (!sub) {
        continue;
      }
      mounted = true;
      const route = cf.meta.route ?? "";
      log(`mounting sub-feature: /${route}`);
      feat.route(route, sub as Hono);
    }

    // controllers
    for (const cc of cm.controllers) {
      const ctrl = this.controller(cc);
      if (!ctrl) {
        continue;
      }
      mounted = true;
      const route = cc.meta.route ?? "";
      log(`mounting controller: /${route}`);
      feat.route(route, ctrl as Hono);
    }

    // if no routes were mounted, return null
    // there is nothing to link
    if (!mounted) {
      return null;
    }
    return feat;
  }

  /**
   * Return a controller for the given compiled gateway, or null if the gateway has no routes.
   * @param cg
   * @protected
   */
  protected controller<T>(
    cg: CompiledGateway,
  ): Hono | null {
    if (0 === cg.methods.length) {
      // no methods, no controller
      return null;
    }

    let mounted = false;

    // controller instance
    const controller = this.createController(cg);

    for (const cm of cg.methods) {
      const endpoint = this.method(cm);
      if (!endpoint) {
        // no endpoint, skip
        continue;
      }

      mounted = true;
      const method = cm.meta.type.toLowerCase() as keyof typeof Hono;
      const route = cm.meta.route ?? "";
      log(`mounting endpoint: [${method}] ${route}`);

      // @ts-ignore
      controller[method](
        route,
        ...this.createMiddlewares(cm.middlewares ?? []),
        endpoint,
      );
    }

    // if no endpoints were mounted, return null
    // there is nothing to link
    if (!mounted) {
      return null;
    }

    return controller;
  }

  /**
   * Return an endpoint for the given compiled method, or null if the method is not an endpoint.
   * todo add extended endpoint support (e.g. websockets, graphql, etc.)
   * @param cm
   */
  protected method(
    cm: CompiledMethod,
  ): Target | null {
    const type = cm.meta.type.toLocaleLowerCase();
    switch (type) {
      /**
       * Standard HTTP methods
       */

      case "get":
      case "post":
      case "put":
      case "delete":
      case "patch":
        return this.linkHttp(cm);

      /**
       * Extended HTTP methods
       */

      case "stream":
        const handler0 = this.linkStream(cm);
        return function (ctx: Context) {
          return stream(
            ctx,
            (stream) => handler0(ctx, stream) as Promise<void>,
          );
        };

      case "stream_text":
        const handler1 = this.linkStream(cm);
        return function (ctx: Context) {
          return streamText(
            ctx,
            (stream) => handler1(ctx, stream) as Promise<void>,
          );
        };

      case "sse":
        const handler2 = this.linkStream(cm);
        return function (ctx: Context) {
          return streamSSE(
            ctx,
            (stream) => handler2(ctx, stream) as Promise<void>,
          );
        };

      case "stream_async":
        const handler3 = this.linkAsyncStream(cm, "raw");
        return function (ctx: Context) {
          return stream(
            ctx,
            (stream) => handler3(ctx, stream) as Promise<void>,
          );
        };

      case "steam_text_async":
        const handler4 = this.linkAsyncStream(cm, "string");
        return function (ctx: Context) {
          return streamText(
            ctx,
            (stream) => handler4(ctx, stream) as Promise<void>,
          );
        };

      case "sse_async":
        const handler5 = this.linkAsyncStream(cm, "sse");
        return function (ctx: Context) {
          return streamSSE(
            ctx,
            (stream) => handler5(ctx, stream) as Promise<void>,
          );
        };

      /**
       * todo how to handle other types of endpoints (error?!)
       */
      default:
        return null;
    }
  }

  protected linkHttp(
    cm: CompiledMethod,
  ): ChoEndpointFn {
    const getArgs = this.createMethodArgFactory(cm.meta.args);

    return async function (ctx: Context) {
      try {
        // creating arguments from args factories
        // based on decorators used by the user
        // the data is extracted from the context
        const args = await getArgs(ctx);
        // this is the actual method call
        // with all arguments already prepared
        // including the context as the last argument
        const res = await cm.handle(...args, ctx);
        // on Response just return it
        // otherwise convert to JSON response
        if (res instanceof Response) {
          return res;
        }
        return ctx.json(res);
      } catch (err) {
        // if there is an error handler, use it
        if (cm.errorHandler) {
          return cm.errorHandler(err as Error, ctx);
        }
        throw err;
      }
    };
  }

  /**
   * Link a streaming endpoint.
   * The endpoint method should accept the streaming API as one before last argument.
   * The last argument is always the context.
   *
   * The streaming API is dependent on the decorator selected by the user (e.g. Stream, SseAsync, etc.)
   *
   * @param cm
   * @protected
   */
  protected linkStream(
    cm: CompiledMethod,
  ): ChoEndpointFn {
    const getArgs = this.createMethodArgFactory(cm.meta.args);

    return async function (ctx: Context, stream: SSEStreamingApi) {
      try {
        const args = await getArgs(ctx);
        await cm.handle(...args, stream, ctx);
      } catch (err) {
        // todo should we close the stream on error?
        if (cm.errorHandler) {
          // todo is the error handler compatible with streaming?
          return cm.errorHandler(err as Error, ctx);
        }
        throw err;
      }
    } as ChoEndpointFn;
  }

  protected linkAsyncStream(
    cm: CompiledMethod,
    type: "sse" | "string" | "raw",
  ): ChoEndpointFn {
    const getArgs = this.createMethodArgFactory(cm.meta.args);

    return async function (ctx: Context, stream: SSEStreamingApi) {
      try {
        const args = await getArgs(ctx);
        const it = await cm.handle(...args, ctx);
        if (it[Symbol.asyncIterator] == null) {
          throw new Error(
            `Method "${cm.meta.name}" not return an async generator`,
          );
        }
        for await (const next of it) {
          switch (type) {
            case "raw":
              await stream.write(next as Uint8Array);
              break;
            case "string":
              await stream.writeln(next as string);
              break;
            case "sse":
              await stream.writeSSE(next as SSEMessage);
              break;
          }
        }
        stream.close();
      } catch (err) {
        if (cm.errorHandler) {
          return cm.errorHandler(err as Error, ctx);
        }
        throw err;
      }
    } as ChoEndpointFn;
  }

  /**
   * Create a factory function that generates method arguments based on the provided input factories.
   * @param args
   * @protected
   */
  protected createMethodArgFactory(
    args: InputFactory[],
  ): (ctx: Context) => Promise<unknown[]> {
    return async function (ctx: Context): Promise<unknown[]> {
      const ret: unknown[] = [];
      for (const argFactory of args) {
        const value = await argFactory(ctx);
        ret.push(value);
      }
      return ret;
    };
  }

  /**
   * Create a controller for the given compiled item (module or gateway).
   * @param c
   * @protected
   */
  protected createController(c: CompiledModule | CompiledGateway): Hono {
    // feature instance
    const ctrl = new Hono();

    // add middlewares
    ctrl.use(...this.createMiddlewares(c.meta.middlewares ?? []));

    // add error handler
    if (c.errorHandler) {
      ctrl.onError(c.errorHandler as ErrorHandler);
    }
    return ctrl;
  }

  /**
   * Create middlewares from the given functions list.
   * @param middlewares
   * @protected
   */
  protected createMiddlewares(
    middlewares: ChoMiddlewareFn[],
  ): Target[] {
    return middlewares.map((m) =>
      createMiddleware(m as MiddlewareHandler) as Target
    );
  }
}
