/**
 * The arguments of a handler: what `@Args` takes.
 *
 * {@link Value}, {@link Key} and {@link Header} each make an argument that
 * reads one part of the message. An argument is a function `(ctx) => value`,
 * so an application can write its own.
 *
 * A validator given to an argument is run only for a handler the validation
 * middleware covers (see `validate.ts`).
 *
 * @module
 */

import type { ChoIssue, ChoValidator } from "@chojs/core";
import {
  describe,
  error_issues,
  is_validator,
  run_validator,
} from "@chojs/core/utils";
import type { ChoMessageContext } from "./context.ts";
import { message_error } from "./errors.ts";
import type {
  ChoMessageArg,
  ChoMessageArgInfo,
  ChoMessageArgSource,
  ChoMessageInvalid,
} from "./types.ts";

/** The value of a message, parsed as JSON: it is parsed once. */
const JSON_VALUE = new WeakMap<ChoMessageContext, { value: unknown }>();

/**
 * An argument of a validated handler that is not valid. It is thrown by
 * {@link evaluate_args} and caught by the handler of the route (see
 * `build-graph.ts`); nothing else sees it.
 */
export class InvalidArgument extends Error {
  /** What failed, as given to `onInvalid`. */
  readonly invalid: ChoMessageInvalid;

  /**
   * @param info The argument that is not valid.
   * @param issues What is not valid.
   * @param thrown What was thrown, when something was: by the `parse` method
   *   of a validator, or by a value that cannot be parsed.
   */
  constructor(
    info: ChoMessageArgInfo,
    issues: readonly ChoIssue[],
    thrown?: { readonly error?: unknown },
  ) {
    super(`Invalid ${info.source}`, { cause: thrown?.error });
    this.name = "InvalidArgument";
    this.invalid = {
      source: info.source,
      ...(info.key === undefined ? {} : { key: info.key }),
      issues,
      ...(thrown && "error" in thrown ? { error: thrown.error } : {}),
    };
  }
}

/** The issues that are written in the message of an error, at most. */
const SHOWN_ISSUES = 3;

/**
 * The issues of a value that is not valid, in words, for the message of an
 * error: `Required (at name); Too small (at items.0.price)`. The first ones
 * are written, and the others are counted.
 *
 * @param issues The issues.
 * @returns The words, on one line.
 */
export function describe_issues(issues: readonly ChoIssue[]): string {
  const shown = issues.slice(0, SHOWN_ISSUES).map(({ message, path }) =>
    path === undefined ? message : `${message} (at ${path.join(".")})`
  );
  const more = issues.length - shown.length;
  return shown.join("; ") + (more > 0 ? `; and ${more} more` : "");
}

/**
 * What is not valid in a message, in words: `the value`, `the property "id"
 * of the value`, `the key`, `the headers`, `the header "tenant"`.
 *
 * @param invalid What failed.
 * @returns The words, for the message of an error.
 */
export function describe_invalid(
  { source, key }: Pick<ChoMessageInvalid, "source" | "key">,
): string {
  switch (source) {
    case "value":
      return key === undefined
        ? "the value"
        : `the property ${JSON.stringify(key)} of the value`;
    case "key":
      return "the key";
    case "header":
      return key === undefined
        ? "the headers"
        : `the header ${JSON.stringify(key)}`;
  }
}

/**
 * Evaluate the arguments of a handler, in order.
 *
 * For a handler the validation middleware covers, an argument with a
 * validator goes through it, and what the validator gives replaces the
 * value. For any other handler, validators are not run.
 *
 * @param args The arguments, as given to `@Args`.
 * @param ctx The context of the message.
 * @param validated Whether the validation middleware covers the handler.
 * @returns The values, in the order of the arguments.
 * @throws {InvalidArgument} (as a rejection) For a validated handler, when a
 *   validator says the value is not valid or the value cannot be parsed.
 * @throws What an argument throws, unchanged, in every other case, and what
 *   the `validate` function of a Standard Schema throws.
 */
export async function evaluate_args(
  args: readonly ChoMessageArg[],
  ctx: ChoMessageContext,
  validated: boolean,
): Promise<unknown[]> {
  const values: unknown[] = [];
  for (const arg of args) {
    const info = arg.info;
    if (!validated || !info) {
      values.push(await arg(ctx));
      continue;
    }
    let value: unknown;
    try {
      value = await arg(ctx);
    } catch (error) {
      // A source that cannot be read, such as a value that is not JSON.
      throw new InvalidArgument(info, error_issues(error), { error });
    }
    if (!info.validator) {
      values.push(value);
      continue;
    }
    const result = await run_validator(info.validator, value);
    if (result.issues) {
      throw new InvalidArgument(info, result.issues, result);
    }
    values.push(result.value);
  }
  return values;
}

/** The value of a message as JSON, parsed once; no value is `undefined`. */
function json_value(ctx: ChoMessageContext): unknown {
  let parsed = JSON_VALUE.get(ctx);
  if (!parsed) {
    parsed = { value: ctx.json() };
    JSON_VALUE.set(ctx, parsed);
  }
  return parsed.value;
}

/**
 * A validator, or an error for what is not one.
 *
 * @param name The name of the function, for the message of the error.
 * @param value What was given as a validator.
 * @param expected What the function takes, in words.
 */
function as_validator(
  name: string,
  value: unknown,
  expected: string,
): ChoValidator {
  if (is_validator(value)) {
    return value;
  }
  throw message_error(
    "CHO_MESSAGE_INVALID_ARGUMENT",
    `${name}(): expected ${expected}, got ${describe(value)}`,
  );
}

/**
 * Make an argument from the four call forms `Value` and `Header` share:
 * `()`, `(validator)`, `(key)` and `(key, validator)`.
 *
 * @param name The name of the function, for error messages (`"Value"`).
 * @param source The source the argument reads.
 * @param read Reads the whole source (`key` is `undefined`), or one key.
 * @param first The key or the validator, if any.
 * @param second The validator, when `first` is the key.
 * @returns The argument, with its `info`.
 * @throws {ChoError} When `first` or `second` is not what it should be.
 */
function make_arg(
  name: string,
  source: ChoMessageArgSource,
  read: (ctx: ChoMessageContext, key: string | undefined) => unknown,
  first: unknown,
  second: unknown,
): ChoMessageArg<unknown> {
  const expected =
    "a key (a string) or a validator (a Standard Schema, or an object with a parse method)";
  let key: string | undefined;
  let validator: ChoValidator | undefined;
  if (typeof first === "string") {
    key = first;
    validator = second === undefined
      ? undefined
      : as_validator(name, second, expected);
  } else if (first !== undefined) {
    validator = as_validator(name, first, expected);
    if (second !== undefined) {
      throw message_error(
        "CHO_MESSAGE_INVALID_ARGUMENT",
        `${name}(): a validator is the last argument, got ${
          describe(second)
        } after it`,
      );
    }
  }
  const info: ChoMessageArgInfo = Object.freeze({
    source,
    ...(key === undefined ? {} : { key }),
    ...(validator === undefined ? {} : { validator }),
  });
  return Object.assign((ctx: ChoMessageContext) => read(ctx, key), { info });
}

/**
 * An argument from the value of the message, parsed as JSON.
 *
 * - `Value()` gives the parsed value; a message with no value gives
 *   `undefined`.
 * - `Value("name")` gives one property of it, or `undefined` when the value
 *   has none, or is not an object.
 * - The value is parsed once for a message, whatever the number of `Value`
 *   arguments. For its text or its bytes, read `ctx.text()` and `ctx.value`.
 * - A validator can follow: `Value(validator)`, `Value("name", validator)`.
 *   It is run when the validation middleware covers the handler. Without
 *   one, the value is `unknown`, or the type given by hand: `Value<Order>()`.
 *
 * @typeParam T The type of the value.
 * @returns The argument, for `@Args`.
 * @throws {ChoError} When a key is not a string, or what is given as a
 *   validator is not one.
 *
 * @example
 * ```ts
 * @Subscribe("created")
 * @Args(Value(Order))
 * created(order: Order) {
 *   return this.store.add(order);
 * }
 * ```
 */
export function Value<T = unknown>(): ChoMessageArg<T>;
/**
 * The value, parsed as JSON, through a validator: see the first signature of `Value`.
 *
 * @typeParam T What the validator gives.
 * @param validator The validator: a Standard Schema, or an object with a
 *   `parse` method.
 * @returns The argument, for `@Args`.
 */
export function Value<T>(validator: ChoValidator<T>): ChoMessageArg<T>;
/**
 * One property of the value: see the first signature of `Value`.
 *
 * @typeParam T The type of the value.
 * @param key The name of the property.
 * @returns The argument, for `@Args`.
 */
export function Value<T = unknown>(key: string): ChoMessageArg<T>;
/**
 * One property of the value, through a validator: see the first signature of `Value`.
 *
 * @typeParam T What the validator gives.
 * @param key The name of the property.
 * @param validator The validator: a Standard Schema, or an object with a
 *   `parse` method.
 * @returns The argument, for `@Args`.
 */
export function Value<T>(
  key: string,
  validator: ChoValidator<T>,
): ChoMessageArg<T>;
export function Value(
  first?: unknown,
  second?: unknown,
): ChoMessageArg<unknown> {
  return make_arg(
    "Value",
    "value",
    (ctx, key) => {
      const value = json_value(ctx);
      if (key === undefined) {
        return value;
      }
      return value !== null && typeof value === "object"
        ? (value as Record<string, unknown>)[key]
        : undefined;
    },
    first,
    second,
  );
}

/**
 * An argument from the key of the message.
 *
 * - `Key()` gives the key, or `undefined` when the message has none, as on a
 *   broker that has no keys.
 * - A validator can follow: `Key(validator)`. It is run when the validation
 *   middleware covers the handler.
 *
 * @returns The argument, for `@Args`.
 * @throws {ChoError} When what is given is not a validator.
 *
 * @example
 * ```ts
 * @Subscribe("created")
 * @Args(Key(), Value<Order>())
 * created(key: string | undefined, order: Order) {
 *   return this.store.add(key, order);
 * }
 * ```
 */
export function Key(): ChoMessageArg<string | undefined>;
/**
 * The key, through a validator: see the first signature of `Key`.
 *
 * @typeParam T What the validator gives.
 * @param validator The validator: a Standard Schema, or an object with a
 *   `parse` method.
 * @returns The argument, for `@Args`.
 */
export function Key<T>(validator: ChoValidator<T>): ChoMessageArg<T>;
export function Key(...given: unknown[]): ChoMessageArg<unknown> {
  if (given.length > 1) {
    throw message_error(
      "CHO_MESSAGE_INVALID_ARGUMENT",
      `Key(): a validator is the only argument, got ${
        describe(given[1])
      } after it`,
    );
  }
  const validator = given[0] === undefined ? undefined : as_validator(
    "Key",
    given[0],
    "a validator (a Standard Schema, or an object with a parse method): a key has no keys of its own",
  );
  const info: ChoMessageArgInfo = Object.freeze({
    source: "key",
    ...(validator === undefined ? {} : { validator }),
  });
  return Object.assign((ctx: ChoMessageContext) => ctx.key, { info });
}

/**
 * An argument from the headers of the message.
 *
 * - `Header()` gives all of them, as an object of strings.
 * - `Header("tenant")` gives one, or `undefined` when it is not there. The
 *   name is the one the broker gave, in the same case: the headers of a
 *   broker, unlike those of HTTP, tell `Tenant` from `tenant`.
 * - A validator can follow: `Header(validator)`, `Header("tenant",
 *   validator)`. It is run when the validation middleware covers the handler.
 *
 * @returns The argument, for `@Args`.
 * @throws {ChoError} When a key is not a string, or what is given as a
 *   validator is not one.
 *
 * @example
 * ```ts
 * @Subscribe("created")
 * @Args(Header("tenant"), Value<Order>())
 * created(tenant: string | undefined, order: Order) {
 *   return this.store.of(tenant).add(order);
 * }
 * ```
 */
export function Header(): ChoMessageArg<Readonly<Record<string, string>>>;
/**
 * All the headers, through a validator: see the first signature of `Header`.
 *
 * @typeParam T What the validator gives.
 * @param validator The validator: a Standard Schema, or an object with a
 *   `parse` method.
 * @returns The argument, for `@Args`.
 */
export function Header<T>(validator: ChoValidator<T>): ChoMessageArg<T>;
/**
 * One header: see the first signature of `Header`.
 *
 * @param key The name of the header, as the broker gives it.
 * @returns The argument, for `@Args`.
 */
export function Header(key: string): ChoMessageArg<string | undefined>;
/**
 * One header, through a validator: see the first signature of `Header`.
 *
 * @typeParam T What the validator gives.
 * @param key The name of the header, as the broker gives it.
 * @param validator The validator: a Standard Schema, or an object with a
 *   `parse` method.
 * @returns The argument, for `@Args`.
 */
export function Header<T>(
  key: string,
  validator: ChoValidator<T>,
): ChoMessageArg<T>;
export function Header(
  first?: unknown,
  second?: unknown,
): ChoMessageArg<unknown> {
  return make_arg(
    "Header",
    "header",
    (ctx, key) =>
      key === undefined
        ? ctx.headers
        : Object.hasOwn(ctx.headers, key)
        ? ctx.headers[key]
        : undefined,
    first,
    second,
  );
}
