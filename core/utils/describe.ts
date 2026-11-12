/**
 * Readable name of a class, token or any value, for error messages.
 * Classes and functions give their name (or `<anonymous>`), strings are quoted,
 * symbols give `Symbol(description)`.
 *
 * @param value The value to describe.
 * @returns Its readable name.
 * @internal
 */
export function describe(value: unknown): string {
  if (typeof value === "function") {
    return value.name || "<anonymous>";
  }
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  return String(value);
}
