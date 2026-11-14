/**
 * The Basic authentication middleware: {@link basicAuth}.
 *
 * @module
 */

import type { ChoWebContext, ChoWebMiddlewareFn } from "@chojs/web";
import { safe_equal } from "./auth.ts";

/** The options of {@link basicAuth}: one user, or a function that checks. */
export type BasicAuthOptions =
  & {
    /** The realm shown to the user. Default: `Secure Area`. */
    readonly realm?: string;
  }
  & (
    | {
      /** The name of the only user. */
      readonly username: string;
      /** Its password. */
      readonly password: string;
    }
    | {
      /**
       * Checks a name and a password: `true` lets the request in. It can be
       * `async`, and can keep what it found in `ctx.state` for the handler.
       */
      readonly verify: (
        username: string,
        password: string,
        ctx: ChoWebContext,
      ) => boolean | Promise<boolean>;
    }
  );

/** The name and the password of an `Authorization: Basic` header, if any. */
function credentials(header: string | null): [string, string] | undefined {
  const match = header === null ? null : /^Basic +([A-Za-z0-9+/=]+)$/i.exec(
    header.trim(),
  );
  if (!match) {
    return undefined;
  }
  let decoded: string;
  try {
    const bytes = Uint8Array.from(atob(match[1]!), (c) => c.charCodeAt(0));
    decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return undefined;
  }
  const colon = decoded.indexOf(":");
  return colon === -1
    ? undefined
    : [decoded.slice(0, colon), decoded.slice(colon + 1)];
}

/**
 * Make a middleware that asks for a name and a password, with HTTP Basic
 * authentication. A request without the right ones is answered `401`, with
 * the `WWW-Authenticate` header that makes a browser ask for them.
 *
 * Basic authentication sends the password with every request, encoded but
 * not encrypted: use it over HTTPS only.
 *
 * @param options One user (`username` and `password`), or a `verify`
 *   function; and the realm.
 * @returns A CHO middleware function.
 * @throws {TypeError} When neither a user nor a `verify` function is given.
 *
 * @example One user
 * ```ts
 * @Middlewares(basicAuth({ username: "ada", password: "secret" }))
 * @Controller({ route: "admin" })
 * class AdminController {}
 * ```
 *
 * @example Checking against a store
 * ```ts
 * basicAuth({
 *   verify: async (username, password, ctx) => {
 *     const user = await users.login(username, password);
 *     if (user) ctx.state.set("user", user);
 *     return user !== undefined;
 *   },
 * });
 * ```
 */
export function basicAuth(options: BasicAuthOptions): ChoWebMiddlewareFn {
  const given = (options ?? {}) as {
    realm?: string;
    username?: unknown;
    password?: unknown;
    verify?: unknown;
  };
  const realm = given.realm ?? "Secure Area";
  let verify: (
    username: string,
    password: string,
    ctx: ChoWebContext,
  ) => boolean | Promise<boolean>;
  if (typeof given.verify === "function") {
    verify = given.verify as typeof verify;
  } else if (
    typeof given.username === "string" && typeof given.password === "string"
  ) {
    const { username, password } = given as {
      username: string;
      password: string;
    };
    verify = async (name, word) => {
      // Both are always compared, so the time tells nothing.
      const [same_name, same_word] = await Promise.all([
        safe_equal(name, username),
        safe_equal(word, password),
      ]);
      return same_name && same_word;
    };
  } else {
    throw new TypeError(
      "basicAuth(): give a username and a password, or a verify function",
    );
  }
  const challenge = `Basic realm="${
    realm.replaceAll('"', '\\"')
  }", charset="UTF-8"`;

  return async (ctx, next) => {
    const found = credentials(ctx.req.headers.get("authorization"));
    if (found && await verify(found[0], found[1], ctx)) {
      return next();
    }
    return new Response("Unauthorized", {
      status: 401,
      headers: { "www-authenticate": challenge },
    });
  };
}
