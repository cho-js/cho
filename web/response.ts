/**
 * Converts what a handler or an error handler returned into a `Response`.
 *
 * @module
 */

/**
 * The response for a returned value (already awaited):
 *
 * - a `Response` is sent as is;
 * - `undefined` answers `204 No Content`;
 * - anything else is sent as JSON, with status `200`.
 *
 * @param value The value a handler or an error handler returned.
 * @returns The response.
 * @throws {TypeError} When the value cannot be serialized as JSON.
 */
export function to_response(value: unknown): Response {
  if (value instanceof Response) {
    return value;
  }
  if (value === undefined) {
    return new Response(null, { status: 204 });
  }
  return Response.json(value);
}
