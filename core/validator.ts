/**
 * Validators: what the CHO packages accept as a schema of a value.
 *
 * A validator is a [Standard Schema](https://standardschema.dev/): an object
 * with a `~standard` key, as the schemas of Zod, Valibot, ArkType and many
 * other libraries are. An object with a `parse` method that returns the
 * value, or throws, is accepted too.
 *
 * The `Standard…` interfaces of this module are those of the specification,
 * copied as it allows: no package is depended on, and the schema of any
 * library that implements the specification fits them.
 *
 * @module
 */

/**
 * The Standard Typed interface: the part every Standard interface shares.
 *
 * @typeParam Input What the schema takes.
 * @typeParam Output What the schema gives.
 */
export interface StandardTypedV1<Input = unknown, Output = Input> {
  /** The Standard properties. */
  readonly "~standard": StandardTypedV1.Props<Input, Output>;
}

export declare namespace StandardTypedV1 {
  /** The Standard Typed properties. */
  interface Props<Input = unknown, Output = Input> {
    /** The version number of the standard. */
    readonly version: 1;
    /** The vendor name of the schema library. */
    readonly vendor: string;
    /** Inferred types associated with the schema. */
    readonly types?: Types<Input, Output> | undefined;
  }

  /** The Standard Typed types. */
  interface Types<Input = unknown, Output = Input> {
    /** The input type of the schema. */
    readonly input: Input;
    /** The output type of the schema. */
    readonly output: Output;
  }

  /** The input type of a Standard Typed. */
  type InferInput<Schema extends StandardTypedV1> = NonNullable<
    Schema["~standard"]["types"]
  >["input"];

  /** The output type of a Standard Typed. */
  type InferOutput<Schema extends StandardTypedV1> = NonNullable<
    Schema["~standard"]["types"]
  >["output"];
}

/**
 * The Standard Schema interface: a schema that validates a value.
 *
 * @typeParam Input What the schema takes.
 * @typeParam Output What the schema gives.
 *
 * @example A schema written by hand
 * ```ts
 * const positive: StandardSchemaV1<unknown, number> = {
 *   "~standard": {
 *     version: 1,
 *     vendor: "app",
 *     validate(value) {
 *       const n = Number(value);
 *       return n > 0
 *         ? { value: n }
 *         : { issues: [{ message: "expected a positive number" }] };
 *     },
 *   },
 * };
 * ```
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  /** The Standard Schema properties. */
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

export declare namespace StandardSchemaV1 {
  /** The Standard Schema properties. */
  interface Props<Input = unknown, Output = Input>
    extends StandardTypedV1.Props<Input, Output> {
    /** Validates an unknown input value. */
    readonly validate: (
      value: unknown,
      options?: StandardSchemaV1.Options | undefined,
    ) => Result<Output> | Promise<Result<Output>>;
  }

  /** The result of the validate function. */
  type Result<Output> = SuccessResult<Output> | FailureResult;

  /** The result when validation succeeds. */
  interface SuccessResult<Output> {
    /** The typed output value. */
    readonly value: Output;
    /** A falsy value for `issues` indicates success. */
    readonly issues?: undefined;
  }

  /** The options of the validate function. */
  interface Options {
    /** Explicit support for additional vendor-specific parameters. */
    readonly libraryOptions?: Record<string, unknown> | undefined;
  }

  /** The result when validation fails. */
  interface FailureResult {
    /** The issues of failed validation. */
    readonly issues: ReadonlyArray<Issue>;
  }

  /** An issue of a value that is not valid. */
  interface Issue {
    /** The error message of the issue. */
    readonly message: string;
    /** The path of the issue, if any. */
    readonly path?: ReadonlyArray<PropertyKey | PathSegment> | undefined;
  }

  /** A segment of the path of an issue. */
  interface PathSegment {
    /** The key of the segment. */
    readonly key: PropertyKey;
  }

  /** The Standard types. */
  interface Types<Input = unknown, Output = Input>
    extends StandardTypedV1.Types<Input, Output> {}

  /** The input type of a Standard Schema. */
  type InferInput<Schema extends StandardTypedV1> = StandardTypedV1.InferInput<
    Schema
  >;

  /** The output type of a Standard Schema. */
  type InferOutput<Schema extends StandardTypedV1> =
    StandardTypedV1.InferOutput<Schema>;
}

/**
 * The Standard JSON Schema interface: a schema that gives its JSON Schema.
 * It is what `@chojs/openapi` reads to document a validator.
 *
 * @typeParam Input What the schema takes.
 * @typeParam Output What the schema gives.
 */
export interface StandardJSONSchemaV1<Input = unknown, Output = Input> {
  /** The Standard JSON Schema properties. */
  readonly "~standard": StandardJSONSchemaV1.Props<Input, Output>;
}

export declare namespace StandardJSONSchemaV1 {
  /** The Standard JSON Schema properties. */
  interface Props<Input = unknown, Output = Input>
    extends StandardTypedV1.Props<Input, Output> {
    /** Methods for generating the input and the output JSON Schema. */
    readonly jsonSchema: StandardJSONSchemaV1.Converter;
  }

  /** The Standard JSON Schema converter. */
  interface Converter {
    /** Converts the input type to JSON Schema. May throw. */
    readonly input: (
      options: StandardJSONSchemaV1.Options,
    ) => Record<string, unknown>;
    /** Converts the output type to JSON Schema. May throw. */
    readonly output: (
      options: StandardJSONSchemaV1.Options,
    ) => Record<string, unknown>;
  }

  /**
   * The target version of the generated JSON Schema. A library throws for a
   * target it does not support.
   */
  type Target =
    | "draft-2020-12"
    | "draft-07"
    | "openapi-3.0"
    // Any other string, and the names above are still suggested.
    // deno-lint-ignore ban-types
    | ({} & string);

  /** The options of the input and the output methods. */
  interface Options {
    /** The version of JSON Schema to generate. */
    readonly target: Target;
    /** Explicit support for additional vendor-specific parameters. */
    readonly libraryOptions?: Record<string, unknown> | undefined;
  }

  /** The Standard types. */
  interface Types<Input = unknown, Output = Input>
    extends StandardTypedV1.Types<Input, Output> {}

  /** The input type of a Standard JSON Schema. */
  type InferInput<Schema extends StandardTypedV1> = StandardTypedV1.InferInput<
    Schema
  >;

  /** The output type of a Standard JSON Schema. */
  type InferOutput<Schema extends StandardTypedV1> =
    StandardTypedV1.InferOutput<Schema>;
}

/**
 * The older shape of a validator: an object with a `parse` method that
 * returns the value, or throws.
 *
 * @typeParam Output What the validator gives.
 *
 * @example
 * ```ts
 * const positive: ChoParseValidator<number> = {
 *   parse(value) {
 *     const n = Number(value);
 *     if (!(n > 0)) throw new Error("expected a positive number");
 *     return n;
 *   },
 * };
 * ```
 */
export type ChoParseValidator<Output = unknown> = {
  parse(value: unknown): Output | Promise<Output>;
};

/**
 * A validator: a Standard Schema, or an object with a `parse` method.
 *
 * - A Standard Schema says what is not valid with a result that has `issues`.
 *   What its `validate` throws is an error of the validator, not a value
 *   that is not valid.
 * - A `parse` method says it by throwing.
 * - For an object with both, as a Zod schema is, the Standard Schema is used.
 *
 * What a validator gives is what the handler receives, so a validator can
 * also convert a value. Both shapes can give a promise.
 *
 * @typeParam Output What the validator gives.
 * @typeParam Input What the validator takes.
 */
export type ChoValidator<Output = unknown, Input = unknown> =
  | StandardSchemaV1<Input, Output>
  | ChoParseValidator<Output>;

/**
 * What a validator gives: the output type of a Standard Schema, or what a
 * `parse` method returns.
 *
 * @typeParam V The type of the validator.
 *
 * @example
 * ```ts
 * const NewUser = z.object({ name: z.string(), age: z.number().default(18) });
 * type User = ChoOutput<typeof NewUser>; // { name: string; age: number }
 * ```
 */
export type ChoOutput<V> = V extends StandardTypedV1
  ? StandardTypedV1.InferOutput<V>
  : V extends { parse(value: unknown): infer Output } ? Awaited<Output>
  : never;

/**
 * What a validator takes: the input type of a Standard Schema. A `parse`
 * method does not say what it takes, so it is what it returns.
 *
 * @typeParam V The type of the validator.
 *
 * @example
 * ```ts
 * const NewUser = z.object({ name: z.string(), age: z.number().default(18) });
 * type Sent = ChoInput<typeof NewUser>; // { name: string; age?: number }
 * ```
 */
export type ChoInput<V> = V extends StandardTypedV1
  ? StandardTypedV1.InferInput<V>
  : V extends { parse(value: unknown): infer Output } ? Awaited<Output>
  : never;

/**
 * What is not valid in a value: a message, and where in the value. It is the
 * same for every validator, whatever its library.
 */
export type ChoIssue = {
  /** What is wrong, in words. */
  readonly message: string;
  /**
   * The keys that lead to what is wrong: `["items", 0, "price"]`. It is not
   * there when the whole value is what is wrong.
   */
  readonly path?: readonly (string | number)[];
};

/**
 * The outcome of {@link run_validator}: the value the validator gives, or
 * the issues of a value that is not valid.
 *
 * @typeParam Output What the validator gives.
 * @internal
 */
export type Validated<Output = unknown> =
  | { readonly value: Output; readonly issues?: undefined }
  | {
    /** What is not valid: one issue at least. */
    readonly issues: readonly ChoIssue[];
    /** What a `parse` method threw. */
    readonly error?: unknown;
  };

/** The message of an issue that has none. */
const NO_MESSAGE = "Invalid value";

/** The Standard Schema properties of a value, when it validates. */
function standard_of(value: object): StandardSchemaV1.Props | undefined {
  const standard = (value as { "~standard"?: unknown })["~standard"];
  return typeof standard === "object" && standard !== null &&
      typeof (standard as { validate?: unknown }).validate === "function"
    ? standard as StandardSchemaV1.Props
    : undefined;
}

/**
 * Whether a value is a validator: an object, or a function, that is a
 * Standard Schema with a `validate` function or has a `parse` method.
 *
 * @param value Any value.
 * @returns `true` for a validator.
 * @internal
 */
export function is_validator(value: unknown): value is ChoValidator {
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  ) {
    return false;
  }
  return standard_of(value) !== undefined ||
    typeof (value as { parse?: unknown }).parse === "function";
}

/** One key of a path: a string or a number, whatever the validator gave. */
function to_key(segment: unknown): string | number {
  const key = typeof segment === "object" && segment !== null
    ? (segment as { key?: unknown }).key
    : segment;
  if (typeof key === "string" || typeof key === "number") {
    return key;
  }
  return typeof key === "symbol" ? key.description ?? "" : String(key);
}

/**
 * The issues a validator gave, each as a {@link ChoIssue}: its message and
 * its path, and nothing else of what the library wrote.
 *
 * @param issues The issues of a Standard Schema result, or of an error.
 * @returns The issues: one at least.
 * @internal
 */
export function to_issues(issues: readonly unknown[]): ChoIssue[] {
  const list = issues.map((issue): ChoIssue => {
    const { message, path } =
      (typeof issue === "object" && issue !== null ? issue : {}) as {
        message?: unknown;
        path?: unknown;
      };
    return {
      message: typeof message === "string" && message !== ""
        ? message
        : NO_MESSAGE,
      // Array.from, not map: the path of a library can be of a class of
      // its own, and the path of an issue is a plain list.
      ...(Array.isArray(path) && path.length > 0
        ? { path: Array.from(path, to_key) }
        : {}),
    };
  });
  return list.length > 0 ? list : [{ message: NO_MESSAGE }];
}

/**
 * The issues of something that was thrown: its `issues` when it has a list
 * of them, as the error of a Zod schema does, and otherwise one issue with
 * its message.
 *
 * @param error What was thrown.
 * @returns The issues: one at least.
 * @internal
 */
export function error_issues(error: unknown): ChoIssue[] {
  const issues = (error as { issues?: unknown } | null | undefined)?.issues;
  if (Array.isArray(issues) && issues.length > 0) {
    return to_issues(issues);
  }
  let message: unknown;
  try {
    message = error instanceof Error ? error.message : String(error);
  } catch {
    // a value that String() cannot convert
  }
  return [{
    message: typeof message === "string" && message !== ""
      ? message
      : NO_MESSAGE,
  }];
}

/**
 * Run a validator on a value.
 *
 * - A Standard Schema: a result with `issues` is a value that is not valid;
 *   what `validate` throws is thrown on, unchanged.
 * - A `parse` method: what it throws is a value that is not valid.
 * - An object with both is run as a Standard Schema.
 *
 * @typeParam Output What the validator gives.
 * @param validator The validator.
 * @param value The value to validate.
 * @returns The value the validator gives, or the issues.
 * @throws What the `validate` function of a Standard Schema throws.
 * @internal
 */
export async function run_validator<Output>(
  validator: ChoValidator<Output>,
  value: unknown,
): Promise<Validated<Output>> {
  const standard = standard_of(validator) as
    | StandardSchemaV1.Props<unknown, Output>
    | undefined;
  if (standard) {
    const result = await standard.validate(value);
    return result.issues
      ? { issues: to_issues(result.issues) }
      : { value: result.value };
  }
  try {
    return {
      value: await (validator as ChoParseValidator<Output>).parse(value),
    };
  } catch (error) {
    return { issues: error_issues(error), error };
  }
}
