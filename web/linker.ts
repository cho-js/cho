import type {
  CompiledGateway,
  CompiledMethod,
  CompiledModule,
} from "@chojs/core/compiler";
import type { Any, Target } from "@chojs/core/meta";
import type { ChoEndpointFn } from "@chojs/core/di";
import type { ChoWebAdapter } from "./adapter.ts";
import type { ChoWebContext } from "./context.ts";
import type { InputFactory } from "./types.ts";
import { debuglog } from "@chojs/core/utils";
import { SSEMessage, SSEStreamingApi } from "./stream-api.ts";

const log = debuglog("web:linker");

/**
 * Where the magic happens: linking a compiled module to an application instance using the provided adapter.
 */
export class Linker {
  constructor(readonly adapter: ChoWebAdapter) {
  }

  /**
   * Link a compiled module to an application instance using the provided adapter.
   * @param cm
   */
  link<T>(cm: CompiledModule): T {
    const end = log.start();
    const app = this.feature(cm);
    if (!app) {
      throw new Error("Cannot link an empty module");
    }
    end("module linked");
    return app as T;
  }

  protected feature<T>(
    cm: CompiledModule,
  ): T | null {
    let mounted = false;

    const feat = this.adapter.createFeature(
      this.adapter.createMiddlewares(cm.meta.middlewares ?? []),
      cm.errorHandler,
    );

    for (const cf of cm.imports) {
      const sub = this.feature(cf);
      if (!sub) {
        continue;
      }
      mounted = true;
      log(`mounting sub-feature: /${cf.meta.route ?? ""}`);
      this.adapter.mountFeature(
        feat,
        sub,
        cf.meta.route ?? "",
      );
    }

    for (const cc of cm.controllers) {
      const ctrl = this.controller(cc);
      if (!ctrl) {
        continue;
      }
      mounted = true;
      log(`mounting controller: /${cc.meta.route ?? ""}`);
      this.adapter.mountController(
        feat,
        ctrl,
        cc.meta.route ?? "",
      );
    }

    if (!mounted) {
      return null;
    }
    return feat;
  }

  protected controller<T>(
    cg: CompiledGateway,
  ): T | null {
    if (0 === cg.methods.length) {
      // no methods, no controller
      return null;
    }
    let mounted = false;
    const controller = this.adapter.createController(
      this.adapter.createMiddlewares(cg.meta.middlewares ?? []),
      cg.errorHandler,
    );

    for (const cm of cg.methods) {
      const endpoint = this.method(cm);
      if (!endpoint) {
        continue;
      }
      mounted = true;
      log(
        `mounting endpoint: [${cm.meta.type}] ${cg.meta.route ?? ""}${
          cm.meta.route ?? ""
        }`,
      );
      this.adapter.mountEndpoint(
        controller,
        this.adapter.createMiddlewares(cm.meta.middlewares ?? []),
        endpoint,
        cm.meta.route ?? "",
        cm.meta.type,
      );
    }
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
        return this.adapter.createEndpoint(
          this.linkHttp(cm),
        );

      /**
       * Extended HTTP methods
       */

      case "stream":
        if (!this.adapter.createStreamEndpoint) {
          throw new Error(
            "Adapter does not support stream endpoints",
          );
        }
        return this.adapter.createStreamEndpoint(
          this.linkStream(cm),
        );

      case "stream_text":
        if (!this.adapter.createTextStreamEndpoint) {
          throw new Error(
            "Adapter does not support text stream endpoints",
          );
        }
        return this.adapter.createTextStreamEndpoint(
          this.linkStream(cm),
        );

      case "sse":
        if (!this.adapter.createSseEndpoint) {
          throw new Error(
            "Adapter does not support SSE endpoints",
          );
        }
        return this.adapter.createSseEndpoint(
          this.linkStream(cm),
        );

      case "stream_async":
        if (!this.adapter.createStreamEndpoint) {
          throw new Error(
            "Adapter does not support stream endpoints",
          );
        }
        return this.adapter.createStreamEndpoint(
          this.linkAsyncStream(cm, "raw"),
        );

      case "steam_text_async":
        if (!this.adapter.createTextStreamEndpoint) {
          throw new Error(
            "Adapter does not support text stream endpoints",
          );
        }
        return this.adapter.createTextStreamEndpoint(
          this.linkAsyncStream(cm, "string"),
        );

      case "sse_async":
        if (!this.adapter.createSseEndpoint) {
          throw new Error(
            "Adapter does not support SSE endpoints",
          );
        }
        return this.adapter.createSseEndpoint(
          this.linkAsyncStream(cm, "sse"),
        );

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
    const main = cm.handle as Target;
    const context = this.adapter.createContext.bind(this.adapter);
    const getArgs = this.createMethodArgFactory(cm.meta.args);
    const handler = cm.errorHandler;

    return async function (raw: Any) {
      const ctx = context(raw);
      try {
        // creating arguments from args factories
        // based on decorators used by the user
        // the data is extracted from the context
        const args = await getArgs(ctx);
        // this is the actual method call
        // with all arguments already prepared
        // including the context as the last argument
        const res = await main(...args, ctx);
        // on Response just return it
        // otherwise convert to JSON response
        if (res instanceof Response) {
          return res;
        }
        return ctx.json(res);
      } catch (err) {
        // if there is an error handler, use it
        if (handler) {
          return handler(err, ctx);
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
    const main = cm.handle as Target;
    const context = this.adapter.createContext.bind(this.adapter);
    const getArgs = this.createMethodArgFactory(cm.meta.args);
    const handler = cm.errorHandler;

    return async function (raw: Any, stream: SSEStreamingApi) {
      const ctx = context(raw);
      try {
        const args = await getArgs(ctx);
        await main(...args, stream, ctx);
      } catch (err) {
        // todo should we close the stream on error?
        if (handler) {
          // todo is the error handler compatible with streaming?
          return handler(err, ctx);
        }
        throw err;
      }
    };
  }

  protected linkAsyncStream(
    cm: CompiledMethod,
    type: "sse" | "string" | "raw",
  ): ChoEndpointFn {
    const main = cm.handle as Target;
    const context = this.adapter.createContext.bind(this.adapter);
    const getArgs = this.createMethodArgFactory(cm.meta.args);
    const handler = cm.errorHandler;

    return async function (raw: Any, stream: SSEStreamingApi) {
      const ctx = context(raw);
      try {
        const args = await getArgs(ctx);
        const it = await main(...args, ctx);
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
      } catch (err) {
        if (handler) {
          return handler(err, ctx);
        }
        throw err;
      }
    };
  }

  /**
   * Return an array of middlewares for the given metadata.
   * @param meta
   * @protected
   */
  // protected middlewares(
  //     meta: Compiled<unknown, Any>,
  // ): Target[] {
  //     return (meta.middlewares ?? []).map(this.adapter.createMiddleware);
  // }

  /**
   * Create a factory function that generates method arguments based on the provided input factories.
   * @param args
   * @protected
   */
  protected createMethodArgFactory(
    args: InputFactory[],
  ): (ctx: ChoWebContext) => Promise<unknown[]> {
    return async function (ctx: ChoWebContext): Promise<unknown[]> {
      const ret: unknown[] = [];
      for (const argFactory of args) {
        const value = await argFactory(ctx);
        ret.push(value);
      }
      return ret;
    };
  }
}
