/**
 * The library: what it exports.
 *
 * It is plain TypeScript, and runs nothing. Another project of the workspace
 * imports it by the name of its package.
 *
 * @module
 */

/**
 * Greet someone.
 *
 * @param name Who to greet.
 * @returns The greeting.
 */
export function greet(name: string): string {
  return `Hello, ${name}, from __name__`;
}
