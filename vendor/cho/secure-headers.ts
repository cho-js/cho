/**
 * The security headers middleware: {@link secureHeaders}.
 *
 * @module
 */

import type { ChoWebMiddlewareFn } from "@chojs/web";
import { with_headers } from "./headers.ts";

/** The headers {@link secureHeaders} sets by default. */
const DEFAULTS: Readonly<Record<string, string>> = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "origin-agent-cluster": "?1",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=15552000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-dns-prefetch-control": "off",
  "x-download-options": "noopen",
  "x-frame-options": "SAMEORIGIN",
  "x-permitted-cross-domain-policies": "none",
  "x-xss-protection": "0",
};

/**
 * The options of {@link secureHeaders}: headers by name, in any case. A
 * string sets the header, one of the defaults or any other
 * (`"content-security-policy"`); `false` leaves a default out.
 */
export type SecureHeadersOptions = Readonly<Record<string, string | false>>;

/**
 * Make a middleware that adds the response headers browsers use to protect a
 * site: it turns off content type sniffing, framing by other sites, and so
 * on.
 *
 * | Header                              | Default                               |
 * | ----------------------------------- | ------------------------------------- |
 * | `Cross-Origin-Opener-Policy`        | `same-origin`                         |
 * | `Cross-Origin-Resource-Policy`      | `same-origin`                         |
 * | `Origin-Agent-Cluster`              | `?1`                                  |
 * | `Referrer-Policy`                   | `no-referrer`                         |
 * | `Strict-Transport-Security`         | `max-age=15552000; includeSubDomains` |
 * | `X-Content-Type-Options`            | `nosniff`                             |
 * | `X-DNS-Prefetch-Control`            | `off`                                 |
 * | `X-Download-Options`                | `noopen`                              |
 * | `X-Frame-Options`                   | `SAMEORIGIN`                          |
 * | `X-Permitted-Cross-Domain-Policies` | `none`                                |
 * | `X-XSS-Protection`                  | `0`                                   |
 *
 * A header the response already has is kept: a handler can set its own.
 * There is no `Content-Security-Policy` by default, as it depends on the
 * application: give one in the options.
 *
 * @param options Headers to set, to change, or (`false`) to leave out.
 * @returns A CHO middleware function.
 * @throws {TypeError} When a value is not a string or `false`.
 *
 * @example
 * ```ts
 * import { ChoLinker, ChoWeb } from "@chojs/web";
 * import { secureHeaders } from "@chojs/vendor-cho";
 *
 * const app = await ChoWeb.create(AppModule, {
 *   linker: new ChoLinker({
 *     middlewares: [
 *       secureHeaders({
 *         "content-security-policy": "default-src 'self'",
 *         "x-frame-options": "DENY",
 *         "strict-transport-security": false, // not behind HTTPS yet
 *       }),
 *     ],
 *   }),
 * });
 * ```
 */
export function secureHeaders(
  options: SecureHeadersOptions = {},
): ChoWebMiddlewareFn {
  const wanted = new Map(Object.entries(DEFAULTS));
  for (const [name, value] of Object.entries(options)) {
    if (value === false) {
      wanted.delete(name.toLowerCase());
    } else if (typeof value === "string") {
      wanted.set(name.toLowerCase(), value);
    } else {
      throw new TypeError(
        `secureHeaders(): the value of ${
          JSON.stringify(name)
        } must be a string or false`,
      );
    }
  }
  return async (_ctx, next) =>
    with_headers(await next(), (headers) => {
      for (const [name, value] of wanted) {
        if (!headers.has(name)) {
          headers.set(name, value);
        }
      }
    });
}
