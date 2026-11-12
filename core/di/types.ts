/**
 * Shared types of the dependency injection (DI) system.
 *
 * This module only declares types. They describe the three things the DI
 * system works with:
 *
 * - **Tokens** ({@link Token}): the keys that identify something injectable.
 * - **Dependencies** ({@link Dependency}): the tokens a provider needs.
 * - **Providers** ({@link Provider}): how to create the value of a token.
 *
 * DI handles constructors and values whose types only the declaring code
 * knows. The few deliberately loose types this needs ({@link Any} and
 * {@link Target}) are declared here once, so their lint exceptions live in a
 * single place instead of being scattered across the code.
 *
 * @module
 */

/**
 * An unchecked type, for values whose type the DI system cannot know, such as
 * the arguments of an arbitrary constructor or factory.
 *
 * @internal
 */
// deno-lint-ignore no-explicit-any
export type Any = any;

/**
 * Any function, classes included. This is what a class decorator receives as
 * its target.
 *
 * @internal
 */
// deno-lint-ignore ban-types
export type Target = Function;

/**
 * A concrete class whose instances are of type `T`.
 *
 * @typeParam T The instance type of the class.
 */
export type Ctr<T = Any> = new (...args: Any[]) => T;

/**
 * A class whose instances are of type `T`, abstract classes included.
 *
 * Tokens accept abstract classes: an abstract class can identify a dependency
 * (for example a `Logger` interface-like base class) even though only a
 * provider can create a value for it.
 *
 * @typeParam T The instance type of the class.
 */
export type AbstractCtr<T = Any> = abstract new (...args: never[]) => T;

/**
 * Phantom key that carries the value type of an {@link InjectionToken}.
 * It exists only in the type system and never at runtime.
 */
declare const valueType: unique symbol;

/**
 * A typed, unique token for a value that is not a class instance, such as a
 * URL, a configuration object or a function. Create one with `token<T>()`.
 *
 * Tokens are compared by identity: two tokens created with the same
 * description are two different tokens.
 *
 * @typeParam T The type of the value the token identifies.
 *
 * @example
 * ```ts
 * const API_URL: InjectionToken<string> = token<string>("API_URL");
 * ```
 */
export interface InjectionToken<T = Any> {
  /** Human-readable description, shown in error messages. */
  readonly description: string;
  /** Type-only carrier of `T`. Never present at runtime. */
  readonly [valueType]?: T;
}

/**
 * The key that identifies something injectable. A token is one of:
 *
 * | Token                                 | Value type             |
 * | ------------------------------------- | ---------------------- |
 * | a class (abstract classes included)   | the instance type      |
 * | an {@link InjectionToken}`<T>`        | `T`                    |
 * | a symbol                              | `unknown` (untyped)    |
 *
 * Strings are deliberately not tokens: two unrelated packages can easily pick
 * the same string, while classes, injection tokens and symbols are unique by
 * identity and cannot collide.
 *
 * @typeParam T The type of the value the token identifies.
 */
export type Token<T = Any> =
  | Ctr<T>
  | AbstractCtr<T>
  | InjectionToken<T>
  | symbol;

/**
 * A dependency of a provider: the token whose value the provider receives.
 *
 * It is a separate name from {@link Token} because it describes a role, not
 * a kind of value: every place that lists what a provider needs uses
 * `Dependency`, every place that names what is provided uses `Token`.
 */
export type Dependency = Token;

/**
 * The value a dependency resolves to:
 *
 * - the instance type, for a class;
 * - `T`, for an {@link InjectionToken}`<T>`;
 * - `unknown`, for a symbol.
 *
 * @typeParam D The dependency.
 */
export type Resolved<D> = D extends AbstractCtr<infer T> ? T
  : D extends InjectionToken<infer T> ? T
  : unknown;

/**
 * The values of a list of dependencies, in the same order. This is the
 * argument list a factory receives.
 *
 * @typeParam D The list of dependencies.
 *
 * @example
 * ```ts
 * // [Config, string]
 * type Args = ResolvedAll<[typeof Config, InjectionToken<string>]>;
 * ```
 */
export type ResolvedAll<D extends readonly unknown[]> = {
  -readonly [K in keyof D]: Resolved<D[K]>;
};

/**
 * Creates the value of a provider.
 *
 * A factory receives the values of the provider's dependencies as arguments,
 * in the order the dependencies are declared, and never resolves anything
 * itself. It always returns a promise, so creating a value can include
 * asynchronous initialization (opening a connection, reading a file).
 *
 * @typeParam T The type of the created value.
 */
export type Factory<T = Any> = (...deps: Any[]) => Promise<T>;

/**
 * Binds a token to the factory that creates its value and to the dependencies
 * that factory receives.
 *
 * A class listed in a module's `providers` is shorthand for a provider: its
 * token is the class, its dependencies are the ones declared with
 * `@Injectable`, and its factory constructs the class. Use the `provider()`
 * helper to write a provider object with its factory arguments typed from
 * `deps`.
 *
 * @typeParam T The type of the provided value.
 */
export type Provider<T = Any> = {
  /** The token this provider creates a value for. */
  readonly provide: Token<T>;
  /** The dependencies passed to `factory`, in order. */
  readonly deps: readonly Dependency[];
  /** Creates the value from the resolved dependencies. */
  readonly factory: Factory<T>;
};

/**
 * A class decorator that works with both decorator implementations:
 *
 * - TC39 standard decorators, which pass a `context` object;
 * - legacy (`experimentalDecorators`) and Bun decorators, which pass the class
 *   only, so `context` is `undefined`.
 */
export type ChoClassDecorator = (
  target: Target,
  context?: ClassDecoratorContext,
) => void;

export type ChoMiddlewareFn = (
  ctx: Any,
  next: () => Promise<unknown>,
) => Promise<unknown>;
/**
 * A middleware, declared with `@Middlewares`. For now any function: what it
 * receives and returns is up to the application module that runs it.
 */
export type ChoMiddleware = ChoMiddlewareFn | Ctr;

/**
 * An error handler, declared with `@Catch`: a function called with the error,
 * or an injectable class that handles it. The application module that runs
 * the decorated class or method decides how it is invoked.
 */
export type ChoErrorHandler = ((error: unknown) => unknown) | Ctr;
export type ChoErrorHandlerFn = (ctx: unknown, error: unknown) => unknown;

/**
 * A method decorator that works with both decorator implementations:
 *
 * - TC39 standard decorators call it with the method and a
 *   `ClassMethodDecoratorContext`;
 * - legacy (`experimentalDecorators`) and Bun decorators call it with the
 *   class prototype, the method name and the property descriptor.
 *
 * Use `decorated_method` to find the method from these arguments.
 */
export type ChoMethodDecorator = (
  target: Target | object,
  context: ClassMethodDecoratorContext | string | symbol,
  descriptor?: PropertyDescriptor,
) => void;

/**
 * A decorator for a class or a method, in both decorator implementations: the
 * calls of {@link ChoMethodDecorator}, plus those of {@link ChoClassDecorator}.
 *
 * Use `decorated_target` to find where to write the record from these
 * arguments.
 */
export type ChoClassOrMethodDecorator = (
  target: Target | object,
  context?:
    | ClassDecoratorContext
    | ClassMethodDecoratorContext
    | string
    | symbol,
  descriptor?: PropertyDescriptor,
) => void;
