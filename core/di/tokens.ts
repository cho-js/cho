/**
 * Creating tokens and providers.
 *
 * - {@link token} creates a unique, typed token for a value that is not a
 *   class instance: a URL, a configuration object, a function.
 * - {@link provider} defines a provider object, with the arguments of its
 *   factory typed from its dependencies.
 * - {@link is_token} tells whether a value can be used as a token.
 *
 * @module
 */

import type {
  Any,
  Dependency,
  InjectionToken,
  Provider,
  ResolvedAll,
  Token,
} from "./types.ts";

/**
 * Brand of the objects created by {@link token}, used by {@link is_token} to
 * tell an injection token from any other object. `Symbol.for` returns the same
 * symbol across copies and versions of this package, so their tokens are
 * recognized too.
 *
 * @internal
 */
const TokenBrand: symbol = Symbol.for("chojs.token");

/**
 * Add a non-enumerable brand property to an object, then freeze it.
 *
 * @param obj The object to brand.
 * @param key The brand symbol.
 * @returns The same object, branded and frozen.
 */
function brand<T extends object>(obj: T, key: symbol): T {
  Object.defineProperty(obj, key, { value: true });
  return Object.freeze(obj);
}

/**
 * Create a typed, unique token for a value that is not a class instance.
 *
 * The token is a frozen object. It is unique by identity: calling `token()`
 * twice with the same description creates two different tokens. Its
 * `toString()` returns `InjectionToken(<description>)`, which is how it appears
 * in error messages.
 *
 * @typeParam T The type of the value the token identifies.
 * @param description A human-readable name, used in error messages.
 * @returns A new injection token.
 *
 * @example
 * ```ts
 * const API_URL = token<string>("API_URL");
 *
 * @Module({
 *   providers: [
 *     provider({ provide: API_URL, factory: () => Promise.resolve("https://example.com") }),
 *   ],
 * })
 * class AppModule {}
 * ```
 */
export function token<T>(description: string): InjectionToken<T> {
  return brand({
    description,
    toString: () => `InjectionToken(${description})`,
  }, TokenBrand);
}

/**
 * Tell whether a value can be used as a token: a class (or any function), a
 * symbol, or an injection token created by {@link token}.
 *
 * Strings and plain objects are not tokens.
 *
 * @param value The value to check.
 * @returns `true` when the value is a token.
 */
export function is_token(value: unknown): value is Token {
  return typeof value === "function" || typeof value === "symbol" ||
    (typeof value === "object" && value !== null &&
      (value as Any)[TokenBrand] === true);
}

/**
 * Define a provider object, with the arguments of its factory typed from its
 * dependencies.
 *
 * At runtime this only fills in `deps` with `[]` when it is omitted. Its value
 * is in the types: TypeScript checks that the factory accepts the values of
 * `deps`, in order, and returns the type of the provided token.
 *
 * @typeParam T The type of the provided value.
 * @typeParam D The dependencies, as a tuple.
 * @param p The provider: its token, its dependencies (default `[]`) and its
 *   factory.
 * @returns The provider, with `deps` always set.
 *
 * @example
 * ```ts
 * const API_URL = token<string>("API_URL");
 *
 * provider({
 *   provide: API_URL,
 *   deps: [Config],
 *   factory: (config) => Promise.resolve(config.apiUrl), // config: Config
 * });
 * ```
 */
export function provider<T, const D extends readonly Dependency[] = []>(p: {
  provide: Token<T>;
  deps?: D;
  factory: (...deps: ResolvedAll<D>) => NoInfer<T> | Promise<NoInfer<T>>;
}): Provider<T> {
  return { ...p, deps: p.deps ?? [] } as Provider<T>;
}
