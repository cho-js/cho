/**
 * Route validation, shared by the decorators and the graph builder.
 *
 * @module
 */

import { describe } from "@chojs/core/utils";

/** A parameter segment: `:` and a name (letters, digits, `_`; no leading digit). */
const ROUTE_PARAMETER = /^:[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * One path segment: RFC 3986 `pchar` characters (unreserved, sub-delims, `:`
 * and `@`) or percent-encoded bytes. `:` keeps route parameters (`:id`) valid.
 */
const ROUTE_SEGMENT = /^(?:[A-Za-z0-9\-._~!$&'()*+,;=:@]|%[0-9A-Fa-f]{2})+$/;

/**
 * Assert that a route is valid. The empty string is valid: there is no route
 * at that level. Otherwise the route is one or more path segments separated by
 * `/`, where:
 *
 * - the route does not start or end with `/`;
 * - no segment is empty (`a//b`), `.` or `..`;
 * - every segment contains only characters a URL path allows, or
 *   percent-encoded bytes (no spaces, `?` or `#`);
 * - a segment that starts with `:` is a parameter, `:name`, and matches one
 *   segment. It is the only pattern: there are no wildcards (`*`), so a route
 *   means the same on every adapter.
 *
 * @param route The route to check.
 * @param where Where the route is declared, for the error message.
 * @throws {TypeError} When the route is not a string.
 * @throws {Error} When the route is not valid.
 */
export function assert_route(
  route: unknown,
  where: string,
): asserts route is string {
  if (typeof route !== "string") {
    throw new TypeError(
      `Invalid route of ${where}: expected a string, got ${describe(route)}`,
    );
  }
  if (route === "") {
    return;
  }
  const invalid = (reason: string) =>
    new Error(`Invalid route ${describe(route)} of ${where}: ${reason}`);
  if (route.startsWith("/") || route.endsWith("/")) {
    throw invalid('it must not start or end with "/"');
  }
  for (const segment of route.split("/")) {
    if (segment === "") {
      throw invalid('it must not contain an empty segment ("//")');
    }
    if (segment === "." || segment === "..") {
      throw invalid(`it must not contain a "${segment}" segment`);
    }
    if (!ROUTE_SEGMENT.test(segment)) {
      throw invalid(
        `${describe(segment)} is not a valid URL path segment`,
      );
    }
    if (segment.includes("*")) {
      throw invalid(
        `${
          describe(segment)
        } has a "*": wildcards are not part of the route syntax`,
      );
    }
    if (segment.startsWith(":") && !ROUTE_PARAMETER.test(segment)) {
      throw invalid(
        `${
          describe(segment)
        } is not a valid parameter: write ":name", with letters, digits and "_"`,
      );
    }
  }
}

/**
 * Trim a route and assert that it is valid (see {@link assert_route}).
 *
 * @param route The route as declared.
 * @param where Where the route is declared, for the error message.
 * @returns The trimmed route.
 */
export function normalize_route(route: unknown, where: string): string {
  const trimmed = typeof route === "string" ? route.trim() : route;
  assert_route(trimmed, where);
  return trimmed;
}
