/**
 * The question that asks for one choice of a list.
 *
 * ```
 * ? What are you building?
 * ❯ A web application (HTTP routes)
 *   A command-line tool
 * ```
 *
 * | Key       | What it does                                       |
 * | --------- | -------------------------------------------------- |
 * | Up, `k`   | To the choice above; from the first, to the last   |
 * | Down, `j` | To the choice below; from the last, to the first   |
 * | Enter     | Answers with the choice the pointer is on          |
 *
 * @module
 */

import { describe } from "@chojs/core/utils";
import { prompt_error } from "./errors.ts";
import { assert_options } from "./options.ts";
import {
  type Frame,
  is_enter,
  type Outcome,
  type Question,
} from "./question.ts";
import { MARKS, type Style } from "./style.ts";
import type { ChoPromptChoice, ChoPromptKey, SelectOptions } from "./types.ts";

/** The state of a choice question. */
export type SelectState = {
  /** The choice the pointer is on: its place in the list. */
  readonly index: number;
};

/** The names of the options, for the error of an unknown one. */
const OPTIONS = ["choices", "default", "message"];

/** Whether two values are the same one, as a `Set` tells: `NaN` is itself. */
function same(a: unknown, b: unknown): boolean {
  return a === b || (a !== a && b !== b);
}

/** The text of a choice. */
function label_of<T>(choice: ChoPromptChoice<T>): string {
  return choice.label ?? String(choice.value);
}

/** Check the choices, and the default among them. */
function assert_choices(options: Record<string, unknown>): void {
  const { choices } = options;
  const invalid = (what: string) =>
    prompt_error("CHO_PROMPT_INVALID_OPTION", `select(): ${what}`);
  if (!Array.isArray(choices) || choices.length === 0) {
    throw invalid(
      `"choices" must be a list of one choice at least, such as [{ value: "web" }], got ${
        describe(choices)
      }`,
    );
  }
  const values = new Set<unknown>();
  for (const [index, choice] of choices.entries()) {
    if (typeof choice !== "object" || choice === null || !("value" in choice)) {
      throw invalid(
        `choice ${index} must be an object with a "value", such as { value: "web" }, got ${
          describe(choice)
        }`,
      );
    }
    for (const name of ["label", "hint"] as const) {
      const text = (choice as Record<string, unknown>)[name];
      if (text !== undefined && typeof text !== "string") {
        throw invalid(
          `the "${name}" of choice ${index} must be a string, got ${
            describe(text)
          }`,
        );
      }
    }
    if (values.has(choice.value)) {
      throw invalid(
        `two choices have the value ${
          describe(choice.value)
        }: the answer would not say which was taken`,
      );
    }
    values.add(choice.value);
  }
  if (options["default"] !== undefined && !values.has(options["default"])) {
    throw invalid(
      `"default" must be the value of a choice, got ${
        describe(options["default"])
      }`,
    );
  }
}

/** What a key does. */
function press<T>(
  state: SelectState,
  key: ChoPromptKey,
  choices: readonly ChoPromptChoice<T>[],
): Outcome<SelectState, T> {
  if (is_enter(key)) {
    return { answer: choices[state.index]!.value };
  }
  const step = key.name === "up" || key.text === "k"
    ? -1
    : key.name === "down" || key.text === "j"
    ? 1
    : 0;
  return step === 0 || choices.length === 1 ? { state } : {
    state: { index: (state.index + step + choices.length) % choices.length },
  };
}

/** What a state shows. */
function frame<T>(
  state: SelectState,
  style: Style,
  options: SelectOptions<T>,
): Frame {
  return {
    lines: [
      `${style.accent(MARKS.open)} ${style.bold(options.message)}`,
      ...options.choices.map((choice, index) => {
        const hint = choice.hint ? ` ${style.dim(`(${choice.hint})`)}` : "";
        return index === state.index
          ? `${style.accent(MARKS.pointer)} ${label_of(choice)}${hint}`
          : `  ${label_of(choice)}${hint}`;
      }),
    ],
  };
}

/**
 * The question of `select()`.
 *
 * @typeParam T The type of the values of the choices.
 * @param options The options of the question, as they were given.
 * @returns The question, for the runner.
 * @throws {ChoError} `CHO_PROMPT_INVALID_OPTION` when an option is not what
 *   it must be; `CHO_CORE_UNKNOWN_OPTION` for an option that does not exist.
 */
export function select_question<const T>(
  options: SelectOptions<T>,
): Question<SelectState, T> {
  assert_options("select()", options, OPTIONS);
  assert_choices(options);
  const { choices } = options;
  const first = options.default === undefined
    ? 0
    : choices.findIndex((choice) => same(choice.value, options.default));
  return {
    message: options.message,
    start: () => ({ index: Math.max(0, first) }),
    press: (state, key) => press(state, key, choices),
    frame: (state, style) => frame(state, style, options),
    shown: (answer) =>
      label_of(choices.find((choice) => same(choice.value, answer))!),
  };
}
