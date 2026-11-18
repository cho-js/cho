/**
 * What the tests of `@chojs/openapi` share: validators with a schema, and
 * the decorators of `@chojs/web`, applied by hand. Not published.
 *
 * @module
 */

import { Args, ChoWeb, type ChoWebValidator } from "@chojs/web";
import { type AnyMethodDecorator, loose } from "@chojs/core/utils/test_utils";
import { TestLinker } from "../../web/testing.ts";
import type { JsonSchema } from "./types.ts";

/** A class with no constructor argument. */
export type Class = new () => object;

/** `@Args`, as a decorator the test helpers can apply by hand. */
export const args = (...list: unknown[]): AnyMethodDecorator =>
  loose(Args(...loose(list)));

/** Create the application of a root module, with the test linker. */
export function create(root: Class, prefix = ""): Promise<ChoWeb<unknown>> {
  return ChoWeb.create(root, { linker: new TestLinker(), prefix });
}

/** Send a request to an application. */
export function send(
  app: ChoWeb<unknown>,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  return app.handler(new Request(`http://localhost${path}`, init));
}

/** A validator with no schema: an object with a `parse` method. */
export function plain(): ChoWebValidator {
  return { parse: (value) => value };
}

/**
 * A validator that implements Standard JSON Schema, as a Zod schema does.
 *
 * @param input The schema of what it takes.
 * @param output The schema of what it gives. Default: the same.
 * @param calls Each conversion is recorded there, as `input` or `output`.
 */
export function standard(
  input: JsonSchema,
  output: JsonSchema = input,
  calls: string[] = [],
): ChoWebValidator {
  const convert =
    (io: "input" | "output", schema: JsonSchema) =>
    (options: { target: string }) => {
      calls.push(`${io} ${options.target}`);
      return schema;
    };
  return loose({
    parse: (value: unknown) => value,
    "~standard": {
      version: 1,
      vendor: "test",
      jsonSchema: {
        input: convert("input", input),
        output: convert("output", output),
      },
    },
  });
}
