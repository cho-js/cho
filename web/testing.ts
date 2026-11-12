/**
 * A linker for tests: it matches requests itself, so a `@chojs/web`
 * application can be tested end to end without an HTTP runtime.
 *
 * Not part of the published package.
 *
 * @module
 */

import type { Linked, Linker, Route } from "./linker.ts";

/**
 * Match a path against a route path.
 *
 * @returns The decoded parameters, or `undefined` when it does not match.
 */
function match(
  route: string,
  path: string,
): Record<string, string> | undefined {
  const expected = route.split("/");
  const actual = path.split("/");
  if (expected.length !== actual.length) {
    return undefined;
  }
  const params: Record<string, string> = {};
  for (const [i, segment] of expected.entries()) {
    const value = actual[i]!;
    if (segment.startsWith(":")) {
      params[segment.slice(1)] = decodeURIComponent(value);
    } else if (segment !== value) {
      return undefined;
    }
  }
  return params;
}

/**
 * Links routes to a plain `fetch`-style handler: the first route that matches
 * the method and the path answers; no match answers `404`; a route that
 * rejects answers `500`, with the error in `errors`.
 */
export class TestLinker implements Linker<readonly Route[]> {
  /** The errors of the routes that rejected, in order. */
  readonly errors: unknown[] = [];

  link(routes: readonly Route[]): Linked<readonly Route[]> {
    return {
      instance: routes,
      handler: async (req) => {
        const path = new URL(req.url).pathname;
        for (const route of routes) {
          const params = route.method === req.method
            ? match(route.path, path)
            : undefined;
          if (params) {
            try {
              return await route.handle(req, params);
            } catch (error) {
              this.errors.push(error);
              return new Response("Internal Server Error", { status: 500 });
            }
          }
        }
        return new Response("Not Found", { status: 404 });
      },
    };
  }
}
