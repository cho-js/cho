/**
 * @chojs/vendor-cho — the middlewares of the built-in router of `@chojs/web`.
 *
 * The built-in router has no HTTP library underneath, so nothing brings the
 * middlewares an application usually takes from one. This package has them,
 * written as CHO middlewares: functions `(ctx, next)` on the standard
 * `Request` and `Response`, with no dependency.
 *
 * | Middleware              | For                                               |
 * | ----------------------- | ------------------------------------------------- |
 * | {@link cors}            | Letting pages of other origins call the application |
 * | {@link bodyLimit}       | Refusing a request whose body is too large        |
 * | {@link secureHeaders}   | The response headers that protect a site          |
 * | {@link logger}          | One log line for each request                     |
 * | {@link timeout}         | Answering a request that takes too long           |
 * | {@link requestId}       | An id for each request, to follow it in the logs  |
 * | {@link etag}            | `ETag`, and `304 Not Modified`                    |
 * | {@link basicAuth}       | A name and a password, with HTTP Basic            |
 * | {@link bearerAuth}      | A token, as `Authorization: Bearer`               |
 * | {@link compress}        | Compressing the body of a response                |
 *
 * A middleware goes on the routes it should cover, with `@Middlewares`, or on
 * the router, to cover every request:
 *
 * @example
 * ```ts
 * import { ChoLinker, ChoWeb } from "@chojs/web";
 * import { bodyLimit, cors, logger, secureHeaders } from "@chojs/vendor-cho";
 *
 * const app = await ChoWeb.create(AppModule, {
 *   linker: new ChoLinker({
 *     middlewares: [
 *       logger(),
 *       cors({ origin: "https://example.com" }),
 *       secureHeaders(),
 *       bodyLimit({ maxSize: 1024 * 1024 }),
 *     ],
 *   }),
 * });
 * ```
 *
 * @module
 */

export { basicAuth, type BasicAuthOptions } from "./basic-auth.ts";
export { bearerAuth, type BearerAuthOptions } from "./bearer-auth.ts";
export { bodyLimit, type BodyLimitOptions } from "./body-limit.ts";
export { compress, type CompressOptions } from "./compress.ts";
export { cors, type CorsOptions } from "./cors.ts";
export { etag, type EtagOptions } from "./etag.ts";
export { logger, type LoggerEntry, type LoggerOptions } from "./logger.ts";
export { REQUEST_ID, requestId, type RequestIdOptions } from "./request-id.ts";
export { secureHeaders, type SecureHeadersOptions } from "./secure-headers.ts";
export { timeout, type TimeoutOptions } from "./timeout.ts";

// The `@chojs/web` types the middlewares refer to.
export type { ChoWebContext, ChoWebMiddlewareFn, ChoWebNext } from "@chojs/web";
