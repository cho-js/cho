/**
 * The ETag middleware: {@link etag}.
 *
 * @module
 */

import type { ChoWebMiddlewareFn } from "@chojs/web";

/** The options of {@link etag}. */
export type EtagOptions = {
  /**
   * Whether the tag is a weak one (`W/"…"`): the content is equivalent, not
   * identical byte for byte. Default: `false`.
   */
  readonly weak?: boolean;
};

/** The headers a `304` response keeps. */
const KEPT = [
  "cache-control",
  "content-location",
  "date",
  "etag",
  "expires",
  "vary",
];

/** A tag without its weakness mark: tags are compared that way. */
const strong = (tag: string) => tag.trim().replace(/^W\//, "");

/** Whether a tag is among the ones of an `If-None-Match` header. */
function matches(if_none_match: string, tag: string): boolean {
  return if_none_match.trim() === "*" ||
    if_none_match.split(",").some((one) => strong(one) === strong(tag));
}

/**
 * Make a middleware that lets a client keep a response it already has: it
 * tags each response with a hash of its body (`ETag`), and answers
 * `304 Not Modified`, without the body, to a request that already has that
 * tag (`If-None-Match`).
 *
 * - It applies to `GET` and `HEAD` requests answered `200`.
 * - The body is read whole to be hashed, so a streamed response is not
 *   streamed any more: keep the middleware off the routes that stream.
 * - A response that already has an `ETag` is not hashed: its own tag is
 *   compared.
 *
 * @param options Whether the tag is weak.
 * @returns A CHO middleware function.
 *
 * @example
 * ```ts
 * @Middlewares(etag())
 * @Get("report")
 * report() {
 *   return this.reports.latest();
 * }
 * ```
 */
export function etag(options: EtagOptions = {}): ChoWebMiddlewareFn {
  const weak = options.weak ?? false;
  return async (ctx, next) => {
    let response = await next();
    const { method, headers: sent } = ctx.req;
    if ((method !== "GET" && method !== "HEAD") || response.status !== 200) {
      return response;
    }
    let tag = response.headers.get("etag");
    if (tag === null) {
      if (response.body === null) {
        return response;
      }
      const body = await response.arrayBuffer();
      const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", body));
      const hex = [...hash].map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
      tag = `${weak ? "W/" : ""}"${hex}"`;
      response = new Response(body, response);
      response.headers.set("etag", tag);
    }
    const if_none_match = sent.get("if-none-match");
    if (if_none_match === null || !matches(if_none_match, tag)) {
      return response;
    }
    const headers = new Headers();
    for (const name of KEPT) {
      const value = response.headers.get(name);
      if (value !== null) {
        headers.set(name, value);
      }
    }
    await response.body?.cancel();
    return new Response(null, { status: 304, headers });
  };
}
