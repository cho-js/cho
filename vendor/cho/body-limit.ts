/**
 * The body limit middleware: {@link bodyLimit}.
 *
 * @module
 */

import type { ChoWebContext, ChoWebMiddlewareFn } from "@chojs/web";

/** The options of {@link bodyLimit}. */
export type BodyLimitOptions = {
  /** The largest body a request may have, in bytes. */
  readonly maxSize: number;
  /**
   * Answer a request whose body is too large. Default: `413`, with the text
   * `Payload Too Large`.
   */
  readonly onExceeded?: (ctx: ChoWebContext) => Response | Promise<Response>;
};

/**
 * Make a middleware that refuses a request whose body is larger than a
 * limit, with `413 Payload Too Large`.
 *
 * A server on the standard `Request` has no limit of its own: without this
 * middleware, a handler that reads the body reads all of it, whatever its
 * size.
 *
 * - A request that declares its size (`Content-Length`) over the limit is
 *   refused at once: the rest of the chain does not run, and nothing is
 *   read.
 * - A request that does not declare it (a streamed body) is counted while it
 *   is read. When it passes the limit, reading it fails, and the request is
 *   answered `413`, whatever the rest of the chain answered.
 * - A request without a body is left as it is.
 *
 * @param options The limit, and the answer to a request over it.
 * @returns A CHO middleware function.
 * @throws {TypeError} When `maxSize` is not a whole number of bytes.
 *
 * @example
 * ```ts
 * import { ChoLinker, ChoWeb } from "@chojs/web";
 * import { bodyLimit } from "@chojs/vendor-cho";
 *
 * const app = await ChoWeb.create(AppModule, {
 *   linker: new ChoLinker({
 *     middlewares: [bodyLimit({ maxSize: 1024 * 1024 })], // 1 MB
 *   }),
 * });
 * ```
 *
 * @example A larger limit for one handler
 * ```ts
 * @Middlewares(bodyLimit({ maxSize: 50 * 1024 * 1024 }))
 * @Post("upload")
 * upload(ctx: ChoWebContext) {
 *   return ctx.req.arrayBuffer();
 * }
 * ```
 */
export function bodyLimit(options: BodyLimitOptions): ChoWebMiddlewareFn {
  const { maxSize, onExceeded } = options ?? {};
  if (!(Number.isInteger(maxSize) && maxSize >= 0)) {
    throw new TypeError(
      "bodyLimit(): maxSize must be a whole number of bytes",
    );
  }
  const too_large = (ctx: ChoWebContext) =>
    onExceeded
      ? onExceeded(ctx)
      : new Response("Payload Too Large", { status: 413 });

  return async (ctx, next) => {
    const body = ctx.req.body;
    if (body === null) {
      return next();
    }
    const declared = ctx.req.headers.get("content-length");
    if (declared !== null && !ctx.req.headers.has("transfer-encoding")) {
      return Number(declared) > maxSize ? await too_large(ctx) : next();
    }

    // The size is not declared: count the bytes as they are read.
    let exceeded = false;
    let size = 0;
    const reader = body.getReader();
    const counted = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        size += value.byteLength;
        if (size > maxSize) {
          exceeded = true;
          await reader.cancel().catch(() => {});
          controller.error(new Error("the body of the request is too large"));
          return;
        }
        controller.enqueue(value);
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
      // Nothing is read ahead: a body nobody reads is not counted.
    }, { highWaterMark: 0 });
    // The context keeps the request in a plain property: what reads the body
    // after this middleware reads the counted one.
    (ctx as { req: Request }).req = new Request(ctx.req, {
      body: counted,
      duplex: "half",
    } as RequestInit);

    try {
      const response = await next();
      return exceeded ? await too_large(ctx) : response;
    } catch (error) {
      if (exceeded) {
        return await too_large(ctx);
      }
      throw error;
    }
  };
}
