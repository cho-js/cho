/**
 * The compression middleware: {@link compress}.
 *
 * @module
 */

import type { ChoWebMiddlewareFn } from "@chojs/web";

/** The options of {@link compress}. */
export type CompressOptions = {
  /**
   * The smallest body worth compressing, in bytes, for a response that
   * declares its size. Default: `1024`.
   */
  readonly threshold?: number;
};

/** The encodings `CompressionStream` has, in order of preference. */
const ENCODINGS = ["gzip", "deflate"] as const;

/** Content types that are text, whatever their name says. */
const TEXT_TYPES =
  /^(text\/|application\/(json|javascript|xml|x-www-form-urlencoded|wasm)|image\/svg\+xml)|\+(json|xml)$/i;

/** The encoding to use for a request, from its `Accept-Encoding`, if any. */
function pick_encoding(accept: string | null): "gzip" | "deflate" | undefined {
  if (accept === null) {
    return undefined;
  }
  const accepted = new Map<string, number>();
  for (const part of accept.split(",")) {
    const [name, ...params] = part.trim().toLowerCase().split(";");
    const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
    accepted.set(name!.trim(), q === undefined ? 1 : Number(q.slice(2)));
  }
  return ENCODINGS.find((encoding) =>
    (accepted.get(encoding) ?? accepted.get("*") ?? 0) > 0
  );
}

/**
 * Make a middleware that compresses the body of a response, with `gzip` or
 * `deflate`, for a client that accepts it (`Accept-Encoding`).
 *
 * A response is compressed when it has a body of a text type (text, JSON,
 * XML, JavaScript, SVG), is not compressed already, does not forbid it
 * (`Cache-Control: no-transform`), and is not smaller than the threshold. The
 * body is compressed as a stream: a streamed response stays streamed.
 *
 * It uses the standard `CompressionStream`. On a runtime that does not have
 * it, the middleware changes nothing.
 *
 * @param options The smallest body worth compressing.
 * @returns A CHO middleware function.
 * @throws {TypeError} When `threshold` is not a whole number of bytes.
 *
 * @example
 * ```ts
 * import { ChoLinker, ChoWeb } from "@chojs/web";
 * import { compress } from "@chojs/vendor-cho";
 *
 * const app = await ChoWeb.create(AppModule, {
 *   linker: new ChoLinker({ middlewares: [compress()] }),
 * });
 * ```
 */
export function compress(options: CompressOptions = {}): ChoWebMiddlewareFn {
  const threshold = options.threshold ?? 1024;
  if (!(Number.isInteger(threshold) && threshold >= 0)) {
    throw new TypeError(
      "compress(): threshold must be a whole number of bytes",
    );
  }
  return async (ctx, next) => {
    const response = await next();
    const { headers } = response;
    const encoding = pick_encoding(ctx.req.headers.get("accept-encoding"));
    const length = headers.get("content-length");
    if (
      typeof CompressionStream !== "function" ||
      encoding === undefined ||
      response.body === null ||
      ctx.req.method === "HEAD" ||
      headers.has("content-encoding") ||
      !TEXT_TYPES.test(headers.get("content-type") ?? "") ||
      /\bno-transform\b/i.test(headers.get("cache-control") ?? "") ||
      (length !== null && Number(length) < threshold)
    ) {
      return response;
    }
    const compressed = new Response(
      response.body.pipeThrough(new CompressionStream(encoding)),
      response,
    );
    compressed.headers.set("content-encoding", encoding);
    compressed.headers.delete("content-length");
    compressed.headers.append("vary", "Accept-Encoding");
    // The bytes changed: a strong tag of the original no longer holds.
    const tag = compressed.headers.get("etag");
    if (tag !== null && !tag.startsWith("W/")) {
      compressed.headers.set("etag", `W/${tag}`);
    }
    return compressed;
  };
}
