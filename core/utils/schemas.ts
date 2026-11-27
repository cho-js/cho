/**
 * The schemas of a document: turns the validators of an application into
 * JSON Schemas, and keeps the schemas the document refers to.
 *
 * A validator is a Standard Schema, or an object with a `parse` method. Its
 * schema comes from the validator itself, when it implements Standard JSON
 * Schema, or from the `toJsonSchema` function of the application.
 *
 * It is what the packages that document an application share:
 * `@chojs/openapi` and `@chojs/asyncapi`. Each asks for the dialect of its
 * document.
 *
 * @module
 */

import type { ChoValidator, StandardJSONSchemaV1 } from "../validator.ts";
import type { Debuglog } from "./debuglog.ts";

/** A JSON Schema, as a plain object. */
export type JsonSchema = { [keyword: string]: unknown };

/**
 * The dialect of JSON Schema a validator is asked for: the one of the
 * document. OpenAPI 3.1 has draft 2020-12, and AsyncAPI 3 has draft-07.
 */
export type SchemaTarget = "draft-07" | "draft-2020-12";

/** The direction of a schema: what a validator takes, or what it gives. */
export type SchemaIo = "input" | "output";

/**
 * Turns a validator into a JSON Schema: the `toJsonSchema` option.
 *
 * @param validator The validator, as the application declared it: for an
 *   argument of a handler, in a contract, or in `@Doc`.
 * @param io `"input"` for what goes into the validator, `"output"` for what
 *   it gives.
 * @returns The JSON Schema, or `undefined` when the function does not know
 *   the validator.
 *
 * @example
 * ```ts
 * const toJsonSchema: ToJsonSchema = (validator, io) =>
 *   validator instanceof z.ZodType
 *     ? z.toJSONSchema(validator, { io })
 *     : undefined;
 * ```
 */
export type ToJsonSchema = (
  validator: ChoValidator,
  io: SchemaIo,
) => JsonSchema | undefined;

/**
 * The converter of a validator that implements Standard JSON Schema. What a
 * validator has is not trusted: each method is checked before it is called.
 */
type StandardConverter = Partial<StandardJSONSchemaV1.Converter>;

/** Whether a value is a plain object: what a JSON Schema is. */
function is_object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A name a component can have: letters, digits, `.`, `-` and `_`. */
function component_name(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]/g, "_") || "Schema";
}

/** Decode a token of a JSON pointer. */
function pointer_token(token: string): string {
  return decodeURIComponent(token).replaceAll("~1", "/").replaceAll("~0", "~");
}

/** Call `visit` for every object of a schema, the schema itself included. */
function walk(value: unknown, visit: (node: JsonSchema) => void): void {
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visit));
  } else if (is_object(value)) {
    visit(value);
    Object.values(value).forEach((item) => walk(item, visit));
  }
}

/**
 * The schemas of one document.
 *
 * - A validator is converted once for each direction.
 * - Each use of a schema gets a copy of its own: the document is a plain
 *   object the application can change.
 * - A schema cannot be inlined with its definitions (`$defs`): in a document
 *   `#/$defs/User` points to the root. They are moved to {@link components},
 *   and the references are rewritten.
 */
export class Schemas {
  /** The schemas the document refers to: its `components.schemas`. */
  readonly components: Record<string, JsonSchema> = {};

  readonly #target: SchemaTarget;
  readonly #to_json_schema: ToJsonSchema | undefined;
  readonly #log: Debuglog;
  /** The converted schemas: `null` for a validator that has none. */
  readonly #converted = new Map<
    ChoValidator,
    Partial<Record<SchemaIo, JsonSchema | null>>
  >();
  /** Each component as it was given, to tell two schemas with one name. */
  readonly #given = new Map<string, string>();

  /**
   * @param target The dialect a validator is asked for.
   * @param to_json_schema The `toJsonSchema` option of the document.
   * @param log The debug logger of the package that makes the document.
   */
  constructor(
    target: SchemaTarget,
    to_json_schema: ToJsonSchema | undefined,
    log: Debuglog,
  ) {
    this.#target = target;
    this.#to_json_schema = to_json_schema;
    this.#log = log;
  }

  /**
   * The schema of a validator.
   *
   * @param validator The validator.
   * @param io The direction: `"input"` for what goes into the validator,
   *   `"output"` for what it gives.
   * @param where What the schema is for, for the log.
   * @returns A copy of the schema, or `undefined` when the validator has
   *   none.
   */
  of(
    validator: ChoValidator,
    io: SchemaIo,
    where: string,
  ): JsonSchema | undefined {
    let of_validator = this.#converted.get(validator);
    if (!of_validator) {
      this.#converted.set(validator, of_validator = {});
    }
    let schema = of_validator[io];
    if (schema === undefined) {
      const converted = this.#convert(validator, io, where);
      schema = of_validator[io] = converted ? this.#settle(converted) : null;
    }
    return schema === null ? undefined : structuredClone(schema);
  }

  /**
   * Follow a reference to a component: the schema itself, when it is not
   * one.
   */
  resolve(schema: JsonSchema): JsonSchema {
    const prefix = "#/components/schemas/";
    const ref = schema.$ref;
    if (typeof ref === "string" && ref.startsWith(prefix)) {
      return this.components[ref.slice(prefix.length)] ?? schema;
    }
    return schema;
  }

  /** Ask the validator, then the application. */
  #convert(
    validator: ChoValidator,
    io: SchemaIo,
    where: string,
  ): JsonSchema | undefined {
    const attempts: [string, () => unknown][] = [];
    const standard = (validator as { "~standard"?: { jsonSchema?: unknown } })[
      "~standard"
    ]?.jsonSchema as StandardConverter | undefined;
    const convert = standard?.[io];
    if (typeof convert === "function") {
      attempts.push([
        "the validator",
        () => convert.call(standard, { target: this.#target }),
      ]);
    }
    const to_json_schema = this.#to_json_schema;
    if (to_json_schema) {
      attempts.push(["toJsonSchema", () => to_json_schema(validator, io)]);
    }
    for (const [who, attempt] of attempts) {
      try {
        const schema = attempt();
        if (is_object(schema)) {
          // The application's own object is not to be changed.
          return structuredClone(schema);
        }
      } catch (error) {
        this.#log.error(`${where}: ${who} could not give a schema:`, error);
      }
    }
    this.#log(`${where}: no schema for the validator: it is documented as any`);
    return undefined;
  }

  /**
   * Make a schema one that can be written anywhere in the document: without
   * `$schema`, and with its definitions among the components.
   */
  #settle(schema: JsonSchema): JsonSchema {
    delete schema.$schema;
    // The names the definitions get as components, by their reference.
    const renamed = new Map<string, string>();
    for (const keyword of ["$defs", "definitions"]) {
      const definitions = schema[keyword];
      if (!is_object(definitions)) {
        continue;
      }
      for (const [name, definition] of Object.entries(definitions)) {
        if (is_object(definition)) {
          renamed.set(
            `#/${keyword}/${name}`,
            this.#component(name, definition),
          );
        }
      }
      delete schema[keyword];
    }
    // A schema that refers to itself has to be somewhere a reference reaches.
    let itself: string | undefined;
    walk(schema, (node) => {
      if (node.$ref === "#") {
        itself ??= this.#component("Schema", schema);
      }
    });
    const rewrite = (root: JsonSchema) =>
      walk(root, (node) => {
        if (typeof node.$ref !== "string") {
          return;
        }
        const name = node.$ref === "#" ? itself : renamed.get(
          node.$ref.split("/").map(pointer_token).join("/"),
        );
        if (name !== undefined) {
          node.$ref = `#/components/schemas/${name}`;
        }
      });
    rewrite(schema);
    for (const name of [...renamed.values(), ...(itself ? [itself] : [])]) {
      rewrite(this.components[name]!);
    }
    return itself ? { $ref: `#/components/schemas/${itself}` } : schema;
  }

  /**
   * Keep a schema among the components.
   *
   * @returns The name it has there: the wanted one, or the wanted one with a
   *   number when another schema has it.
   */
  #component(wanted: string, schema: JsonSchema): string {
    const base = component_name(wanted);
    const given = JSON.stringify(schema);
    for (let n = 1;; n++) {
      const name = n === 1 ? base : `${base}${n}`;
      const existing = this.#given.get(name);
      if (existing === undefined) {
        this.#given.set(name, given);
        this.components[name] = schema;
        return name;
      }
      if (existing === given) {
        return name;
      }
    }
  }
}
