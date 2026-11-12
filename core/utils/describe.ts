/**
 * Readable name of a class, token or any value, for error messages.
 * Classes and functions give their name (or `<anonymous>`), strings are quoted,
 * symbols give `Symbol(description)`, injection tokens
 * `InjectionToken(description)`.
 *
 * It never throws, so it is safe to call while reporting another error: a value
 * that `String()` cannot convert (an object without a prototype, or whose
 * `toString` throws) gives its `Object.prototype.toString` tag, such as
 * `[object Object]`, and `<unknown>` as a last resort.
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
  try {
    return String(value);
  } catch {
    // e.g. Object.create(null), or a toString that throws
  }
  try {
    return Object.prototype.toString.call(value);
  } catch {
    // e.g. a Symbol.toStringTag getter that throws
    return "<unknown>";
  }
}
