/**
 * The checks of the options of a question, made when it is asked: a mistake
 * is an error of the application, found before anything is drawn.
 *
 * @module
 */

import { assert_known_options } from "@chojs/core/di";
import { describe } from "@chojs/core/utils";
import { prompt_error } from "./errors.ts";

/** The options of a question, before they are checked. */
export type Options = Record<string, unknown>;

/**
 * Check what every question has: options that are an object, with no unknown
 * one, and a message.
 *
 * @param caller The function that was called: `"text()"`.
 * @param options What it was given.
 * @param known The names of its options.
 * @throws {ChoError} `CHO_PROMPT_INVALID_OPTION` when the options are not an
 *   object, or the message is not a text; `CHO_CORE_UNKNOWN_OPTION` for an
 *   option that does not exist.
 */
export function assert_options(
  caller: string,
  options: unknown,
  known: readonly string[],
): asserts options is Options {
  if (typeof options !== "object" || options === null) {
    throw prompt_error(
      "CHO_PROMPT_INVALID_OPTION",
      `${caller}: expected options, such as { message: "Project name" }, got ${
        describe(options)
      }`,
    );
  }
  assert_known_options(caller, options, known);
  const { message } = options as Options;
  if (typeof message !== "string" || message.trim() === "") {
    throw prompt_error(
      "CHO_PROMPT_INVALID_OPTION",
      `${caller}: "message" must be the text of the question, got ${
        describe(message)
      }`,
    );
  }
}

/**
 * Check that an option, when it is given, has the type it must have.
 *
 * @param caller The function that was called.
 * @param options Its options.
 * @param name The name of the option.
 * @param type What `typeof` says of a right value.
 * @throws {ChoError} `CHO_PROMPT_INVALID_OPTION` when it has another type.
 */
export function assert_type(
  caller: string,
  options: Options,
  name: string,
  type: "string" | "boolean" | "function",
): void {
  const value = options[name];
  if (value !== undefined && typeof value !== type) {
    throw prompt_error(
      "CHO_PROMPT_INVALID_OPTION",
      `${caller}: "${name}" must be a ${type}, got ${describe(value)}`,
    );
  }
}
