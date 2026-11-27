/**
 * The functions an application gives to `@chojs/message`: message handlers,
 * middlewares and error handlers, and the arguments of a handler with their
 * validators.
 *
 * @module
 */

import type { ChoIssue, ChoValidator } from "@chojs/core";
import type { Ctr } from "@chojs/core/di";
import type { ChoMessageContext } from "./context.ts";

/**
 * A message handler: a controller method marked with `@Subscribe`.
 *
 * When it returns (or resolves), the message is handled. What it returns is
 * the reply of the message: bytes and strings as they are, anything else as
 * JSON, a `ChoMessageReply` for a reply with headers, and nothing for no
 * reply. It is sent when the message asks for one,
 * by an adapter whose broker has replies; otherwise it is dropped. When it
 * throws (or rejects), the error goes to the nearest error handler.
 *
 * A handler that declares arguments with `@Args` is called with their values,
 * and then with the context.
 */
export type ChoMessageHandler = (ctx: ChoMessageContext) => unknown;

/**
 * Runs the rest of the chain. It resolves when the rest is done, and rejects
 * with its error. It does not give the reply: the reply is the handler's, and
 * a middleware neither reads nor replaces it.
 */
export type ChoMessageNext = () => Promise<void>;

/**
 * A middleware function. It wraps the rest of the chain (the next
 * middlewares, then the handler):
 *
 * - `next()` runs the rest of the chain;
 * - returning without calling `next()` skips the handler: the message is
 *   handled, and has no reply;
 * - what it returns is ignored.
 *
 * A middleware cannot hide the failure of the rest of the chain: when
 * `next()` rejects, the message failed, even when the middleware catches the
 * error. Settling a failed message as handled is what an error handler does.
 *
 * @example
 * ```ts
 * const timing: ChoMessageMiddlewareFn = async (ctx, next) => {
 *   const start = Date.now();
 *   await next();
 *   console.log(ctx.topic, `${Date.now() - start}ms`);
 * };
 *
 * // drops the messages that are not for this application
 * const mine: ChoMessageMiddlewareFn = (ctx, next) =>
 *   ctx.headers["tenant"] === "acme" ? next() : undefined;
 * ```
 */
export type ChoMessageMiddlewareFn = (
  ctx: ChoMessageContext,
  next: ChoMessageNext,
) => unknown;

/**
 * A middleware, as given to `@Middlewares`: a function, or a class with a
 * `handle(ctx, next)` method, created by the injector in the scope of the
 * feature module.
 */
export type ChoMessageMiddleware =
  | ChoMessageMiddlewareFn
  | Ctr<{ handle: ChoMessageMiddlewareFn }>;

/**
 * An error handler function. What it returns settles the message:
 *
 * - nothing, or `false`: the message failed. An error handler that only logs
 *   does not turn a failed message into a handled one;
 * - `true`: the message is handled, and has no reply;
 * - any other value: the message is handled, and the value is its reply,
 *   converted as what a handler returns is.
 *
 * @example
 * ```ts
 * // a value that is not JSON never will be: drop the message
 * const on_error: ChoMessageErrorHandlerFn = (error, ctx) => {
 *   console.error(ctx.topic, error);
 *   return error instanceof SyntaxError;
 * };
 *
 * // tells who asked what went wrong
 * const answer: ChoMessageErrorHandlerFn = (error) => ({
 *   error: error instanceof NotFound ? "not found" : "failed",
 * });
 * ```
 */
export type ChoMessageErrorHandlerFn = (
  error: unknown,
  ctx: ChoMessageContext,
) => unknown;

/**
 * An error handler, as given to `@Catch`: a function, or a class with a
 * `handle(error, ctx)` method, created by the injector in the scope of the
 * feature module.
 */
export type ChoMessageErrorHandler =
  | ChoMessageErrorHandlerFn
  | Ctr<{ handle: ChoMessageErrorHandlerFn }>;

/** Where an argument made by `Value`, `Key` or `Header` reads from. */
export type ChoMessageArgSource = "value" | "key" | "header";

/**
 * What is known about an argument made by `Value`, `Key` or `Header`: enough
 * to describe it in the documentation of an application.
 */
export type ChoMessageArgInfo = {
  /** Where the value is read from. */
  readonly source: ChoMessageArgSource;
  /** The key of the source, when the argument is one key of it. */
  readonly key?: string;
  /** The validator of the argument, when it has one: its schema. */
  readonly validator?: ChoValidator;
};

/**
 * An argument of a handler, as given to `@Args`: a function that takes the
 * context of the message and gives the value, now or as a promise.
 *
 * `Value`, `Key` and `Header` make one, with its `info`. Any other function of
 * that shape is an argument too.
 *
 * @typeParam T The value the handler receives.
 *
 * @example
 * ```ts
 * const Tenant: ChoMessageArg<string> = (ctx) => ctx.state.get("tenant") as string;
 * ```
 */
export type ChoMessageArg<T = unknown> =
  & ((ctx: ChoMessageContext) => T | Promise<T>)
  & {
    /** What the argument reads, when `Value`, `Key` or `Header` made it. */
    readonly info?: ChoMessageArgInfo;
  };

/**
 * The values of a list of arguments: what a handler receives for them, in
 * order.
 *
 * @typeParam A The arguments, as given to `@Args`.
 */
export type ChoMessageArgValues<A extends readonly ChoMessageArg[]> = {
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
export type ChoMessageArgsDecorator<P extends unknown[]> = {
  // deno-lint-ignore no-explicit-any
  <M extends (this: any, ...args: [...P, ChoMessageContext]) => unknown>(
    method: M,
    context: ClassMethodDecoratorContext,
  ): void;
  // deno-lint-ignore no-explicit-any
  <M extends (this: any, ...args: [...P, ChoMessageContext]) => unknown>(
    target: object,
    name: string | symbol,
    descriptor: TypedPropertyDescriptor<M>,
  ): void;
};

/** What a handler replies, as documented with `@Doc`. */
export type ChoMessageDocReply = {
  /** What the reply means. */
  readonly description?: string;
  /**
   * The schema of the reply: a validator. It only documents: it is not run.
   * A handler of a contract takes it from the contract.
   */
  readonly schema?: ChoValidator;
};

/**
 * The options of `@Doc`: what the code cannot tell about a handler, a
 * controller or a feature module, for the documentation of the application.
 */
export type ChoMessageDoc = {
  /** One line about what the handler does with the message. On a handler only. */
  readonly summary?: string;
  /** A longer text. On a handler only. */
  readonly description?: string;
  /** What the handler replies. On a handler only. */
  readonly reply?: ChoMessageDocReply;
  /**
   * The id of the operation. On a handler only. Default, for what generates
   * the documentation: the controller and the method,
   * `OrdersController.created`.
   */
  readonly operationId?: string;
  /** The tags of the handlers under it. */
  readonly tags?: readonly string[];
  /** Whether it is left out of the documentation. */
  readonly hidden?: boolean;
};

/** What failed the validation of a message: given to `onInvalid`. */
export type ChoMessageInvalid = {
  /** The source of the argument that is not valid. */
  readonly source: ChoMessageArgSource;
  /** Its key, when the argument is one key of the source. */
  readonly key?: string;
  /**
   * What is not valid: one issue at least. The issues of the validator, or
   * one issue with the message of what was thrown.
   */
  readonly issues: readonly ChoIssue[];
  /**
   * What was thrown, when something was: by the `parse` method of a
   * validator, or by a value that cannot be parsed as JSON. A Standard
   * Schema throws nothing for a value that is not valid, so it is not there.
   */
  readonly error?: unknown;
};

/** The options of `validate()`. */
export type ChoMessageValidateOptions = {
  /**
   * Decide what a message that is not valid leads to, as an error handler
   * does:
   *
   * - nothing, or `false`: the message failed, with a `ChoError` of the code
   *   `CHO_MESSAGE_INVALID_MESSAGE`. This is the default;
   * - `true`: the message is handled, and has no reply. It is skipped;
   * - any other value: the message is handled, and the value is its reply.
   */
  readonly onInvalid?:
    | ((invalid: ChoMessageInvalid, ctx: ChoMessageContext) => unknown)
    | undefined;
};
