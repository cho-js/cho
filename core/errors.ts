/**
 * The errors of the framework.
 *
 * Every mistake the framework finds is a {@link ChoError}: an `Error` with a
 * `code` that says which mistake it is. The message is for people, and can
 * change in any release. The code is part of the API: it is not renamed, and
 * not used again for another mistake.
 *
 * An error that is not the framework's own (what a factory, a handler or a
 * validator throws) is not turned into a `ChoError`: it is passed on as it
 * is, or kept as the `cause` of one.
 *
 * @module
 */

/**
 * What marks a `ChoError`. A registered symbol: two copies of this module in
 * one process (two versions of the package) share it, where each has a class
 * of its own.
 */
const BRAND = Symbol.for("cho.error");

/**
 * An error of the framework, with a stable code.
 *
 * @typeParam Code The codes the error can have: those of one package, such as
 *   {@link ChoCoreErrorCode}.
 *
 * @example
 * ```ts
 * try {
 *   await ChoWeb.create(App);
 * } catch (error) {
 *   if (isChoError(error, "CHO_WEB_DUPLICATE_ROUTE")) {
 *     // ...
 *   }
 *   throw error;
 * }
 * ```
 */
export class ChoError<Code extends string = string> extends Error {
  /** Which mistake it is: stable, and the same on every runtime. */
  readonly code: Code;

  /**
   * Make an error of the framework.
   *
   * @param code The code of the mistake.
   * @param message What went wrong, for a person to read.
   * @param options The `cause`, when another error led to this one.
   */
  constructor(code: Code, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

// On the prototype, as the name of a native error is: an error shows its
// code, and nothing else, as a property of its own.
Object.defineProperties(ChoError.prototype, {
  name: { value: "ChoError", writable: true, configurable: true },
  [BRAND]: { value: true },
});

/**
 * Whether a value is a {@link ChoError}.
 *
 * It does not use `instanceof`, which is false for an error made by another
 * copy of the package.
 *
 * @param value What was thrown.
 * @returns `true` for a `ChoError`.
 */
export function isChoError(value: unknown): value is ChoError;
/**
 * Whether a value is a {@link ChoError} with a given code.
 *
 * @param value What was thrown.
 * @param code The code to look for.
 * @returns `true` for a `ChoError` with this code.
 */
export function isChoError<Code extends string>(
  value: unknown,
  code: Code,
): value is ChoError<Code>;
export function isChoError(value: unknown, code?: string): boolean {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const error = value as { [BRAND]?: unknown; code?: unknown };
  return error[BRAND] === true && typeof error.code === "string" &&
    (code === undefined || error.code === code);
}

/**
 * The codes of the errors of `@chojs/core`. Each is described in `specs.md`,
 * section 2.8.
 */
export type ChoCoreErrorCode =
  | "CHO_CORE_ALREADY_DECORATED"
  | "CHO_CORE_AMBIGUOUS_TOKEN"
  | "CHO_CORE_CIRCULAR_DEPENDENCY"
  | "CHO_CORE_CREATE_FAILED"
  | "CHO_CORE_DISPOSED"
  | "CHO_CORE_DISPOSE_FAILED"
  | "CHO_CORE_DUPLICATE_CATCH"
  | "CHO_CORE_DUPLICATE_OVERRIDE"
  | "CHO_CORE_DUPLICATE_TOKEN"
  | "CHO_CORE_INVALID_ERROR_HANDLER"
  | "CHO_CORE_INVALID_EXPORT"
  | "CHO_CORE_INVALID_MIDDLEWARE"
  | "CHO_CORE_INVALID_MIDDLEWARE_RESULT"
  | "CHO_CORE_INVALID_OPTION"
  | "CHO_CORE_INVALID_OVERRIDE"
  | "CHO_CORE_INVALID_PROVIDER"
  | "CHO_CORE_INVALID_TARGET"
  | "CHO_CORE_METADATA_FORMAT"
  | "CHO_CORE_MISPLACED_PROVIDER"
  | "CHO_CORE_MISSING_MIDDLEWARE_RESULT"
  | "CHO_CORE_NEXT_CALLED_TWICE"
  | "CHO_CORE_NOT_A_CLASS"
  | "CHO_CORE_NOT_A_CONTROLLER"
  | "CHO_CORE_NOT_A_MODULE"
  | "CHO_CORE_NOT_INJECTABLE"
  | "CHO_CORE_NOT_VISIBLE"
  | "CHO_CORE_UNKNOWN_MODULE"
  | "CHO_CORE_UNKNOWN_OPTION"
  | "CHO_CORE_UNKNOWN_OVERRIDE"
  | "CHO_CORE_UNRESOLVED_DEPENDENCY";

/**
 * Make an error of a package: a {@link ChoError} whose stack starts where the
 * mistake was found, not in the function that made the error.
 *
 * Each package has a function of its own that calls this one with its codes:
 * {@link core_error} is the one of `@chojs/core`.
 *
 * @param code The code of the mistake.
 * @param message What went wrong.
 * @param options The `cause`.
 * @param above The function of the package: it is left out of the stack, with
 *   what is above it.
 * @returns The error, to throw.
 */
export function make_error<Code extends string>(
  code: Code,
  message: string,
  options: ErrorOptions | undefined,
  // deno-lint-ignore ban-types
  above: Function,
): ChoError<Code> {
  const error = new ChoError(code, message, options);
  // Not on every engine: without it the stack has one more line.
  const capture = (Error as {
    captureStackTrace?: (error: Error, above: unknown) => void;
  }).captureStackTrace;
  if (capture) {
    capture(error, above);
    // An engine with tail calls (JavaScriptCore) has no frame for `above`,
    // which returns the call of this function: nothing is left of the stack.
    // This function is then the one to leave out.
    if (!error.stack?.includes("\n")) {
      capture(error, make_error);
    }
  }
  return error;
}

/**
 * Make an error of `@chojs/core`.
 *
 * @param code The code of the mistake.
 * @param message What went wrong.
 * @param options The `cause`.
 * @returns The error, to throw.
 */
export function core_error(
  code: ChoCoreErrorCode,
  message: string,
  options?: ErrorOptions,
): ChoError<ChoCoreErrorCode> {
  return make_error(code, message, options, core_error);
}
