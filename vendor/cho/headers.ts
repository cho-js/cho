/**
 * What the middlewares share to change the headers of a response.
 *
 * @module
 */

/**
 * Change the headers of a response. The headers of some responses cannot be
 * changed (`Response.redirect()`, a response of `fetch`): those are copied
 * first.
 *
 * @param response The response.
 * @param change Changes the headers.
 * @returns The response, or a copy of it with the changed headers.
 */
export function with_headers(
  response: Response,
  change: (headers: Headers) => void,
): Response {
  try {
    change(response.headers);
    return response;
  } catch {
    const copy = new Response(response.body, response);
    change(copy.headers);
    return copy;
  }
}
