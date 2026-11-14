/**
 * What the authentication middlewares share.
 *
 * @module
 */

/**
 * Compare two strings in a time that does not depend on where they differ,
 * so that a response time tells nothing about a secret.
 *
 * @param a A string.
 * @param b Another string.
 * @returns Whether they are equal.
 */
export async function safe_equal(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  // Hashing gives two values of the same length, whatever the inputs.
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const x = new Uint8Array(left);
  const y = new Uint8Array(right);
  let difference = 0;
  for (let i = 0; i < x.length; i++) {
    difference |= x[i]! ^ y[i]!;
  }
  return difference === 0;
}
