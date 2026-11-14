/**
 * The functions an application gives to `@chojs/web`: route handlers,
 * middlewares and error handlers.
 *
 * @module
 */

import type { Ctr } from "@chojs/core/di";
import type { ChoWebContext } from "./context.ts";

/**
 * A route handler: a controller method marked with `@Get`, `@Post`, ...
 *
 * What it returns (or resolves to) is the response: a `Response` is sent as
 * is, `undefined` answers `204 No Content`, a body the platform knows (a
 * string, bytes, a `Blob`, a `ReadableStream`, a form) is sent as it is, and
 * anything else is sent as JSON.
 */
export type ChoWebHandler = (ctx: ChoWebContext) => unknown;

/** Runs the rest of the chain, and resolves to its response. */
export type ChoWebNext = () => Promise<Response>;

/**
 * A middleware function. It wraps the rest of the chain (the next
 * middlewares, then the handler):
 *
 * - `next()` runs the rest of the chain and resolves to its `Response`;
 * - returning a `Response` answers the request with it, whether `next()` was
 *   called (to replace the response) or not (to answer early);
 * - returning nothing after calling `next()` passes the response on.
 *
 * @example
 * ```ts
 * const timing: ChoWebMiddlewareFn = async (ctx, next) => {
 *   const start = Date.now();
 *   const res = await next();
 *   res.headers.set("x-time", `${Date.now() - start}ms`);
 *   return res;
 * };
 *
 * const auth: ChoWebMiddlewareFn = (ctx, next) =>
 *   ctx.req.headers.has("authorization")
 *     ? next()
 *     : new Response("unauthorized", { status: 401 });
 * ```
 */
export type ChoWebMiddlewareFn = (
  ctx: ChoWebContext,
  next: ChoWebNext,
) => Response | void | Promise<Response | void>;

/**
 * A middleware, as given to `@Middlewares`: a function, or a class with a
 * `handle(ctx, next)` method, created by the injector in the scope of the
 * feature module.
 */
export type ChoWebMiddleware =
  | ChoWebMiddlewareFn
  | Ctr<{ handle: ChoWebMiddlewareFn }>;

/**
 * An error handler function. What it returns is the response, converted like
 * a handler's result, with one difference: returning nothing is not a
 * response. The error is then still unhandled, and goes on to the HTTP
 * runtime (a `500`), so a handler that only logs does not turn a failed
 * request into a success.
 *
 * @example
 * ```ts
 * const on_error: ChoWebErrorHandlerFn = (error, ctx) =>
 *   Response.json({ error: String(error), path: ctx.url.pathname }, { status: 500 });
 * ```
 */
export type ChoWebErrorHandlerFn = (
  error: unknown,
  ctx: ChoWebContext,
) => unknown;

/**
 * An error handler, as given to `@Catch`: a function, or a class with a
 * `handle(error, ctx)` method, created by the injector in the scope of the
 * feature module.
 */
export type ChoWebErrorHandler =
  | ChoWebErrorHandlerFn
  | Ctr<{ handle: ChoWebErrorHandlerFn }>;

/** Where an argument made by `Param`, `Query`, `Header`, `Body` or `Form` reads from. */
export type ChoWebArgSource = "param" | "query" | "header" | "body" | "form";

/**
 * A validator: any object with a `parse` method that returns the value, or
 * throws. It is the shape of a zod schema, so a zod schema is one.
 *
 * What `parse` returns is what the handler receives, so a validator can also
 * convert a value. It can return a promise.
 *
 * @typeParam T What the validator gives.
 *
 * @example
 * ```ts
 * const positive: ChoWebValidator<number> = {
 *   parse(value) {
 *     const n = Number(value);
 *     if (!(n > 0)) throw new Error("expected a positive number");
 *     return n;
 *   },
 * };
 * ```
 */
export type ChoWebValidator<T = unknown> = {
  parse(value: unknown): T | Promise<T>;
};

/**
 * What is known about an argument made by `Param`, `Query`, `Header`, `Body`
 * or `Form`: enough to describe it in an OpenAPI document.
 */
export type ChoWebArgInfo = {
  /** Where the value is read from. */
  readonly source: ChoWebArgSource;
  /** The key of the source, when the argument is one key of it. */
  readonly key?: string;
  /** The validator of the argument, when it has one: its schema. */
  readonly validator?: ChoWebValidator;
};

/**
 * An argument of a handler, as given to `@Args`: a function that takes the
 * context of the request and gives the value, now or as a promise.
 *
 * `Param`, `Query`, `Header`, `Body` and `Form` make one, with its `info`. Any
 * other function of that shape is an argument too.
 *
 * @typeParam T The value the handler receives.
 *
 * @example
 * ```ts
 * const CurrentUser: ChoWebArg<User> = (ctx) => ctx.state.get("user") as User;
 * ```
 */
export type ChoWebArg<T = unknown> =
  & ((ctx: ChoWebContext) => T | Promise<T>)
  & {
    /** What the argument reads, when one of the five functions made it. */
    readonly info?: ChoWebArgInfo;
  };

/**
 * The values of a list of arguments: what a handler receives for them, in
 * order.
 *
 * @typeParam A The arguments, as given to `@Args`.
 */
export type ChoWebArgValues<A extends readonly ChoWebArg[]> = {
  -readonly [K in keyof A]: Awaited<ReturnType<A[K]>>;
};

/**
 * The decorator `@Args` returns. It only accepts a method whose parameters
 * take the values of the arguments, in order, and then the context: a handler
 * that expects something else does not compile.
 *
 * It has both decorator call shapes: standard (TC39) `(method, context)`, and
 * legacy / Bun `(prototype, name, descriptor)`.
 *
 * @typeParam P The values of the arguments.
 */
export type ChoWebArgsDecorator<P extends unknown[]> = {
  // deno-lint-ignore no-explicit-any
  <M extends (this: any, ...args: [...P, ChoWebContext]) => unknown>(
    method: M,
    context: ClassMethodDecoratorContext,
  ): void;
  // deno-lint-ignore no-explicit-any
  <M extends (this: any, ...args: [...P, ChoWebContext]) => unknown>(
    target: object,
    name: string | symbol,
    descriptor: TypedPropertyDescriptor<M>,
  ): void;
};

/** What failed the validation of a request: given to `onInvalid`. */
export type ChoWebInvalid = {
  /** The source of the argument that is not valid. */
  readonly source: ChoWebArgSource;
  /** Its key, when the argument is one key of the source. */
  readonly key?: string;
  /** What the validator threw, or the error of a body that cannot be parsed. */
  readonly error: unknown;
};

/** The options of `validate()`. */
export type ChoWebValidateOptions = {
  /**
   * Answer a request that is not valid. What it returns is the response,
   * converted like the result of a handler. Default: `400`, with a JSON body
   * of `error`, `source`, `key` and `issues`.
   */
  onInvalid?: (invalid: ChoWebInvalid, ctx: ChoWebContext) => unknown;
};

/** A response of a handler, as documented with `@Doc`. */
export type ChoWebDocResponse = {
  /** What the response means. */
  readonly description?: string;
  /** The schema of its body: a validator. */
  readonly schema?: ChoWebValidator;
};

/**
 * The options of `@Doc`: what the code cannot tell about a handler, a
 * controller or a feature module, for the documentation of the application.
 */
export type ChoWebDoc = {
  /** One line about the operation. On a handler only. */
  readonly summary?: string;
  /** A longer text. */
  readonly description?: string;
  /** The tags of the handlers under it. */
  readonly tags?: readonly string[];
  /** Whether it should no longer be used. */
  readonly deprecated?: boolean;
  /** The responses, by status. On a handler only. */
  readonly responses?: Readonly<Record<number, ChoWebDocResponse>>;
  /** Whether it is left out of the documentation. */
  readonly hidden?: boolean;
};
