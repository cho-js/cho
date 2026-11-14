/**
 * The arguments of a handler: what `@Args` takes.
 *
 * {@link Param}, {@link Query}, {@link Header}, {@link Body} and {@link Form}
 * each make an argument that reads one source of the request. An argument is
 * a function `(ctx) => value`, so an application can write its own.
 *
 * A validator given to an argument is run only for a request the validation
 * middleware covers (see `validate.ts`).
 *
 * @module
 */

import { describe } from "@chojs/core/utils";
import type { ChoWebContext } from "./context.ts";
import type {
  ChoWebArg,
  ChoWebArgInfo,
  ChoWebArgSource,
  ChoWebInvalid,
  ChoWebValidator,
} from "./types.ts";

/** An object of strings: all the keys of a source. */
type Strings = Readonly<Record<string, string>>;

/** The requests the validation middleware covers. */
const VALIDATED = new WeakSet<ChoWebContext>();

/** The text of the body of a request: it can be read once. */
const BODY_TEXT = new WeakMap<ChoWebContext, Promise<string>>();
/** The body of a request, parsed as JSON. */
const BODY_JSON = new WeakMap<ChoWebContext, Promise<unknown>>();
/** The body of a request, parsed as a URL-encoded form. */
const BODY_FORM = new WeakMap<ChoWebContext, Promise<Strings>>();

/**
 * Mark a request as covered by the validation middleware: the validators of
 * its arguments are run.
 *
 * @param ctx The context of the request.
 */
export function mark_validated(ctx: ChoWebContext): void {
  VALIDATED.add(ctx);
}

/**
 * An argument of a validated request that is not valid. It is thrown by
 * {@link evaluate_args} and caught by the validation middleware; nothing else
 * sees it.
 */
export class InvalidArgument extends Error {
  /** What failed, as given to `onInvalid`. */
  readonly invalid: ChoWebInvalid;

  /**
   * @param info The argument that is not valid.
   * @param error What the validator threw, or the error of a body that
   *   cannot be parsed.
   */
  constructor(info: ChoWebArgInfo, error: unknown) {
    super(`Invalid ${info.source}`, { cause: error });
    this.name = "InvalidArgument";
    this.invalid = {
      source: info.source,
      ...(info.key === undefined ? {} : { key: info.key }),
      error,
    };
  }
}

/**
 * Evaluate the arguments of a handler, in order.
 *
 * For a request the validation middleware covers, an argument with a
 * validator goes through it, and what the validator returns replaces the
 * value. For any other request, validators are not run.
 *
 * @param args The arguments, as given to `@Args`.
 * @param ctx The context of the request.
 * @returns The values, in the order of the arguments.
 * @throws {InvalidArgument} (as a rejection) For a validated request, when a
 *   validator throws or the body cannot be parsed.
 * @throws What an argument throws, unchanged, in every other case.
 */
export async function evaluate_args(
  args: readonly ChoWebArg[],
  ctx: ChoWebContext,
): Promise<unknown[]> {
  const validated = VALIDATED.has(ctx);
  const values: unknown[] = [];
  for (const arg of args) {
    const info = arg.info;
    if (!validated || !info) {
      values.push(await arg(ctx));
      continue;
    }
    try {
      const value = await arg(ctx);
      values.push(
        info.validator ? await info.validator.parse(value) : value,
      );
    } catch (error) {
      throw new InvalidArgument(info, error);
    }
  }
  return values;
}

/** The text of the body of a request, read once. */
function body_text(ctx: ChoWebContext): Promise<string> {
  let text = BODY_TEXT.get(ctx);
  if (!text) {
    text = ctx.req.text();
    BODY_TEXT.set(ctx, text);
  }
  return text;
}

/** The body of a request as JSON; an empty body is `undefined`. */
function body_json(ctx: ChoWebContext): Promise<unknown> {
  let json = BODY_JSON.get(ctx);
  if (!json) {
    json = body_text(ctx).then((text) =>
      text === "" ? undefined : JSON.parse(text)
    );
    BODY_JSON.set(ctx, json);
  }
  return json;
}

/** The first value of each key of a list of pairs. */
function first_values(pairs: Iterable<[string, string]>): Strings {
  const out: Record<string, string> = {};
  for (const [key, value] of pairs) {
    if (!Object.hasOwn(out, key)) {
      out[key] = value;
    }
  }
  return out;
}

/** The body of a request as a URL-encoded form: the first value of each field. */
function body_form(ctx: ChoWebContext): Promise<Strings> {
  let form = BODY_FORM.get(ctx);
  if (!form) {
    form = body_text(ctx).then((text) =>
      first_values(new URLSearchParams(text))
    );
    BODY_FORM.set(ctx, form);
  }
  return form;
}

/**
 * Make an argument from the four call forms the five functions share: `()`,
 * `(validator)`, `(key)` and `(key, validator)`.
 *
 * @param name The name of the function, for error messages (`"Body"`).
 * @param source The source the argument reads.
 * @param read Reads the whole source (`key` is `undefined`), or one key.
 * @param first The key or the validator, if any.
 * @param second The validator, when `first` is the key.
 * @returns The argument, with its `info`.
 * @throws {TypeError} When `first` or `second` is not what it should be.
 */
function make_arg(
  name: string,
  source: ChoWebArgSource,
  read: (ctx: ChoWebContext, key: string | undefined) => unknown,
  first: unknown,
  second: unknown,
): ChoWebArg<unknown> {
  const as_validator = (value: unknown): ChoWebValidator => {
    if (
      value !== null && (typeof value === "object" ||
        typeof value === "function") &&
      typeof (value as { parse?: unknown }).parse === "function"
    ) {
      return value as ChoWebValidator;
    }
    throw new TypeError(
      `${name}(): expected a key (a string) or a validator (an object with a parse method), got ${
        describe(value)
      }`,
    );
  };
  let key: string | undefined;
  let validator: ChoWebValidator | undefined;
  if (typeof first === "string") {
    key = first;
    validator = second === undefined ? undefined : as_validator(second);
  } else if (first !== undefined) {
    validator = as_validator(first);
    if (second !== undefined) {
      throw new TypeError(
        `${name}(): a validator is the last argument, got ${
          describe(second)
        } after it`,
      );
    }
  }
  const info: ChoWebArgInfo = Object.freeze({
    source,
    ...(key === undefined ? {} : { key }),
    ...(validator === undefined ? {} : { validator }),
  });
  return Object.assign((ctx: ChoWebContext) => read(ctx, key), { info });
}

/**
 * An argument from the path parameters of the route, decoded.
 *
 * - `Param()` gives all of them, as an object of strings.
 * - `Param("id")` gives one. The name must be a parameter of the handler's
 *   path: `ChoWeb.create` rejects one that is not.
 * - A validator can follow: `Param(validator)`, `Param("id", validator)`. It
 *   is run when the validation middleware covers the request.
 *
 * @returns The argument, for `@Args`.
 * @throws {TypeError} When a key is not a string, or a validator has no
 *   `parse` method.
 *
 * @example
 * ```ts
 * @Get(":id")
 * @Args(Param("id"))
 * get(id: string) {
 *   return this.store.find(id);
 * }
 * ```
 */
export function Param(): ChoWebArg<Readonly<Record<string, string>>>;
/**
 * All the path parameters, through a validator: see the first signature of `Param`.
 *
 * @typeParam T What the validator gives.
 * @param validator The validator: an object with a `parse` method.
 * @returns The argument, for `@Args`.
 */
export function Param<T>(validator: ChoWebValidator<T>): ChoWebArg<T>;
/**
 * One path parameter: see the first signature of `Param`.
 *
 * @param key The name of the parameter, as in the route (`"id"` for `:id`).
 * @returns The argument, for `@Args`.
 */
export function Param(key: string): ChoWebArg<string>;
/**
 * One path parameter, through a validator: see the first signature of `Param`.
 *
 * @typeParam T What the validator gives.
 * @param key The name of the parameter, as in the route (`"id"` for `:id`).
 * @param validator The validator: an object with a `parse` method.
 * @returns The argument, for `@Args`.
 */
export function Param<T>(
  key: string,
  validator: ChoWebValidator<T>,
): ChoWebArg<T>;
export function Param(first?: unknown, second?: unknown): ChoWebArg<unknown> {
  return make_arg(
    "Param",
    "param",
    (ctx, key) => key === undefined ? ctx.params : ctx.params[key],
    first,
    second,
  );
}

/**
 * An argument from the query string of the request.
 *
 * - `Query()` gives all of it, as an object of strings.
 * - `Query("page")` gives one key, or `undefined` when it is not there.
 * - A key that is repeated gives its first value. For every value, use
 *   `ctx.url.searchParams.getAll(key)`.
 * - A validator can follow: `Query(validator)`, `Query("page", validator)`.
 *   It is run when the validation middleware covers the request.
 *
 * @returns The argument, for `@Args`.
 * @throws {TypeError} When a key is not a string, or a validator has no
 *   `parse` method.
 *
 * @example
 * ```ts
 * @Get("")
 * @Args(Query("page"), Query())
 * list(page: string | undefined, query: Record<string, string>) {
 *   return this.store.list(Number(page ?? 1), query);
 * }
 * ```
 */
export function Query(): ChoWebArg<Readonly<Record<string, string>>>;
/**
 * The whole query string, through a validator: see the first signature of `Query`.
 *
 * @typeParam T What the validator gives.
 * @param validator The validator: an object with a `parse` method.
 * @returns The argument, for `@Args`.
 */
export function Query<T>(validator: ChoWebValidator<T>): ChoWebArg<T>;
/**
 * One key of the query string: see the first signature of `Query`.
 *
 * @param key The key.
 * @returns The argument, for `@Args`.
 */
export function Query(key: string): ChoWebArg<string | undefined>;
/**
 * One key of the query string, through a validator: see the first signature of `Query`.
 *
 * @typeParam T What the validator gives.
 * @param key The key.
 * @param validator The validator: an object with a `parse` method.
 * @returns The argument, for `@Args`.
 */
export function Query<T>(
  key: string,
  validator: ChoWebValidator<T>,
): ChoWebArg<T>;
export function Query(first?: unknown, second?: unknown): ChoWebArg<unknown> {
  return make_arg(
    "Query",
    "query",
    (ctx, key) =>
      key === undefined
        ? first_values(ctx.url.searchParams)
        : ctx.url.searchParams.get(key) ?? undefined,
    first,
    second,
  );
}

/**
 * An argument from the headers of the request.
 *
 * - `Header()` gives all of them, as an object, with names in lower case.
 * - `Header("x-token")` gives one, or `undefined` when it is not there. The
 *   name is looked up without regard to case.
 * - A header sent several times has its values joined with `", "`, as the
 *   platform's `Headers` does.
 * - A validator can follow: `Header(validator)`, `Header("x-token",
 *   validator)`. It is run when the validation middleware covers the request.
 *
 * @returns The argument, for `@Args`.
 * @throws {TypeError} When a key is not a string, or a validator has no
 *   `parse` method.
 *
 * @example
 * ```ts
 * @Get("")
 * @Args(Header("accept-language"))
 * hello(language: string | undefined) {
 *   return language?.startsWith("fr") ? "Bonjour" : "Hello";
 * }
 * ```
 */
export function Header(): ChoWebArg<Readonly<Record<string, string>>>;
/**
 * All the headers, through a validator: see the first signature of `Header`.
 *
 * @typeParam T What the validator gives.
 * @param validator The validator: an object with a `parse` method.
 * @returns The argument, for `@Args`.
 */
export function Header<T>(validator: ChoWebValidator<T>): ChoWebArg<T>;
/**
 * One header: see the first signature of `Header`.
 *
 * @param key The name of the header, in any case.
 * @returns The argument, for `@Args`.
 */
export function Header(key: string): ChoWebArg<string | undefined>;
/**
 * One header, through a validator: see the first signature of `Header`.
 *
 * @typeParam T What the validator gives.
 * @param key The name of the header, in any case.
 * @param validator The validator: an object with a `parse` method.
 * @returns The argument, for `@Args`.
 */
export function Header<T>(
  key: string,
  validator: ChoWebValidator<T>,
): ChoWebArg<T>;
export function Header(first?: unknown, second?: unknown): ChoWebArg<unknown> {
  return make_arg(
    "Header",
    "header",
    (ctx, key) =>
      key === undefined
        ? Object.fromEntries(ctx.req.headers)
        : ctx.req.headers.get(key) ?? undefined,
    first,
    second,
  );
}

/**
 * An argument from the body of the request, read and parsed as JSON.
 *
 * - `Body()` gives the parsed body; an empty body gives `undefined`.
 * - `Body("name")` gives one property of it, or `undefined` when the body has
 *   none, or is not an object.
 * - The `content-type` of the request is not looked at.
 * - The body is read once for a request, whatever the number of `Body` and
 *   `Form` arguments. A handler that declares one must not read `ctx.req`
 *   itself.
 * - A validator can follow: `Body(validator)`, `Body("name", validator)`. It
 *   is run when the validation middleware covers the request. Without one,
 *   the value is `unknown`, or the type given by hand: `Body<User>()`.
 *
 * @typeParam T The type of the value.
 * @returns The argument, for `@Args`.
 * @throws {TypeError} When a key is not a string, or a validator has no
 *   `parse` method.
 *
 * @example
 * ```ts
 * @Post("")
 * @Args(Body<NewUser>())
 * create(user: NewUser) {
 *   return this.store.add(user);
 * }
 * ```
 */
export function Body<T = unknown>(): ChoWebArg<T>;
/**
 * The body, parsed as JSON, through a validator: see the first signature of `Body`.
 *
 * @typeParam T What the validator gives.
 * @param validator The validator: an object with a `parse` method.
 * @returns The argument, for `@Args`.
 */
export function Body<T>(validator: ChoWebValidator<T>): ChoWebArg<T>;
/**
 * One property of the body: see the first signature of `Body`.
 *
 * @typeParam T The type of the value.
 * @param key The name of the property.
 * @returns The argument, for `@Args`.
 */
export function Body<T = unknown>(key: string): ChoWebArg<T>;
/**
 * One property of the body, through a validator: see the first signature of `Body`.
 *
 * @typeParam T What the validator gives.
 * @param key The name of the property.
 * @param validator The validator: an object with a `parse` method.
 * @returns The argument, for `@Args`.
 */
export function Body<T>(
  key: string,
  validator: ChoWebValidator<T>,
): ChoWebArg<T>;
export function Body(first?: unknown, second?: unknown): ChoWebArg<unknown> {
  return make_arg(
    "Body",
    "body",
    async (ctx, key) => {
      const body = await body_json(ctx);
      if (key === undefined) {
        return body;
      }
      return body !== null && typeof body === "object"
        ? (body as Record<string, unknown>)[key]
        : undefined;
    },
    first,
    second,
  );
}

/**
 * An argument from the body of the request, read as a URL-encoded form
 * (`application/x-www-form-urlencoded`).
 *
 * - `Form()` gives all the fields, as an object of strings; an empty body
 *   gives an empty object.
 * - `Form("name")` gives one field, or `undefined` when it is not there.
 * - A field that is repeated gives its first value.
 * - The `content-type` of the request is not looked at. Multipart forms and
 *   files are not covered: read them from `ctx.req.formData()`.
 * - A validator can follow: `Form(validator)`, `Form("name", validator)`. It
 *   is run when the validation middleware covers the request.
 *
 * @returns The argument, for `@Args`.
 * @throws {TypeError} When a key is not a string, or a validator has no
 *   `parse` method.
 *
 * @example
 * ```ts
 * @Post("login")
 * @Args(Form("user"), Form("password"))
 * login(user: string | undefined, password: string | undefined) {
 *   return this.auth.login(user, password);
 * }
 * ```
 */
export function Form(): ChoWebArg<Readonly<Record<string, string>>>;
/**
 * All the fields of the form, through a validator: see the first signature of `Form`.
 *
 * @typeParam T What the validator gives.
 * @param validator The validator: an object with a `parse` method.
 * @returns The argument, for `@Args`.
 */
export function Form<T>(validator: ChoWebValidator<T>): ChoWebArg<T>;
/**
 * One field of the form: see the first signature of `Form`.
 *
 * @param key The name of the field.
 * @returns The argument, for `@Args`.
 */
export function Form(key: string): ChoWebArg<string | undefined>;
/**
 * One field of the form, through a validator: see the first signature of `Form`.
 *
 * @typeParam T What the validator gives.
 * @param key The name of the field.
 * @param validator The validator: an object with a `parse` method.
 * @returns The argument, for `@Args`.
 */
export function Form<T>(
  key: string,
  validator: ChoWebValidator<T>,
): ChoWebArg<T>;
export function Form(first?: unknown, second?: unknown): ChoWebArg<unknown> {
  return make_arg(
    "Form",
    "form",
    async (ctx, key) => {
      const form = await body_form(ctx);
      return key === undefined ? form : form[key];
    },
    first,
    second,
  );
}
