/**
 * The Bearer token middleware: {@link bearerAuth}.
 *
 * @module
 */

import type { ChoWebContext, ChoWebMiddlewareFn } from "@chojs/web";
import { safe_equal } from "./auth.ts";

/** The options of {@link bearerAuth}: tokens, or a function that checks. */
export type BearerAuthOptions =
  | {
    /** The token, or the tokens, that let a request in. */
    readonly token: string | readonly string[];
  }
  | {
    /**
     * Checks a token: `true` lets the request in. It can be `async`, and can
     * keep what it found in `ctx.state` for the handler.
     */
    readonly verify: (
      token: string,
      ctx: ChoWebContext,
    ) => boolean | Promise<boolean>;
  };

/**
 * Make a middleware that asks for a token, sent as
 * `Authorization: Bearer <token>`.
 *
 * - A request without the header is answered `401`, with
 *   `WWW-Authenticate: Bearer`.
 * - A request with a token that is not accepted is answered `401`, with
 *   `WWW-Authenticate: Bearer error="invalid_token"`.
 *
 * @param options The accepted tokens, or a `verify` function.
 * @returns A CHO middleware function.
 * @throws {TypeError} When neither a token nor a `verify` function is given.
 *
 * @example
 * ```ts
 * @Middlewares(bearerAuth({ token: process.env.API_TOKEN! }))
 * @Controller({ route: "api" })
 * class ApiController {}
 * ```
 *
 * @example Checking a token of your own, such as a JWT
 * ```ts
 * bearerAuth({
 *   verify: async (token, ctx) => {
 *     const claims = await tokens.verify(token);
 *     if (claims) ctx.state.set("claims", claims);
 *     return claims !== undefined;
 *   },
 * });
 * ```
 */
export function bearerAuth(options: BearerAuthOptions): ChoWebMiddlewareFn {
  const given = (options ?? {}) as { token?: unknown; verify?: unknown };
  let verify: (token: string, ctx: ChoWebContext) => boolean | Promise<boolean>;
  if (typeof given.verify === "function") {
    verify = given.verify as typeof verify;
  } else {
    const tokens = typeof given.token === "string"
      ? [given.token]
      : given.token;
    if (
      !Array.isArray(tokens) || tokens.length === 0 ||
      !tokens.every((one) => typeof one === "string" && one !== "")
    ) {
      throw new TypeError(
        "bearerAuth(): give a token, a list of tokens, or a verify function",
      );
    }
    verify = async (token) => {
      // Every token is compared, so the time tells nothing.
      const results = await Promise.all(
        (tokens as string[]).map((one) => safe_equal(token, one)),
      );
      return results.includes(true);
    };
  }
  const refuse = (challenge: string) =>
    new Response("Unauthorized", {
      status: 401,
      headers: { "www-authenticate": challenge },
    });

  return async (ctx, next) => {
    const header = ctx.req.headers.get("authorization");
    if (header === null) {
      return refuse("Bearer");
    }
    const match = /^Bearer +([A-Za-z0-9\-._~+/]+=*)$/i.exec(header.trim());
    if (match && await verify(match[1]!, ctx)) {
      return next();
    }
    return refuse('Bearer error="invalid_token"');
  };
}
