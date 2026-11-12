/**
 * Converts what a handler or an error handler returned into a `Response`.
 *
 * @module
 */

/** The content type of a string result. */
const TEXT = "text/plain;charset=UTF-8";

/**
 * Whether a value is a body the platform's `Response` sends as it is: a
 * string, bytes (`ArrayBuffer`, typed arrays, `DataView`), a `Blob`, a
 * `ReadableStream`, a `FormData` or a `URLSearchParams`.
 *
 * @param value The value a handler returned.
 */
function is_body(value: unknown): value is BodyInit {
  return typeof value === "string" ||
    value instanceof ArrayBuffer ||
    ArrayBuffer.isView(value) ||
    value instanceof Blob ||
    value instanceof ReadableStream ||
    value instanceof FormData ||
    value instanceof URLSearchParams;
}

/**
 * The response for a returned value (already awaited):
 *
 * - a `Response` is sent as is;
 * - `undefined` answers `204 No Content`;
 * - a string is sent as text, `text/plain;charset=UTF-8`, with status `200`;
 * - any other body the platform knows is given to `new Response(value)`, with
 *   status `200`, and the platform sets the content type: a `Blob` has its
 *   own type, a `FormData` is `multipart/form-data`, a `URLSearchParams` is
 *   `application/x-www-form-urlencoded`; bytes (`ArrayBuffer`, typed arrays)
 *   and a `ReadableStream` have none;
 * - anything else is sent as JSON, with status `200`: objects, arrays,
 *   numbers, booleans, `null`, dates, class instances.
 *
 * @param value The value a handler or an error handler returned.
 * @returns The response.
 * @throws {TypeError} When the value cannot be serialized as JSON.
 *
 * @example
 * ```ts
 * to_response({ id: 1 });                // application/json: {"id":1}
 * to_response("hello");                  // text/plain: hello
 * to_response(new Uint8Array([1, 2]));   // the two bytes
 * to_response(undefined);                // 204
 * ```
 */
export function to_response(value: unknown): Response {
  if (value instanceof Response) {
    return value;
  }
  if (value === undefined) {
    return new Response(null, { status: 204 });
  }
  if (typeof value === "string") {
    // Set here, not left to the platform: Bun only adds it when the response
    // is sent, so the header would be missing for middlewares that read it.
    return new Response(value, { headers: { "content-type": TEXT } });
  }
  if (is_body(value)) {
    return new Response(value);
  }
  return Response.json(value);
}
