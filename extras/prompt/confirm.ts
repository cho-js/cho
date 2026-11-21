/**
 * The question that asks for a yes or a no.
 *
 * ```
 * ? Initialize a git repository? › ● Yes / ○ No
 * ```
 *
 * | Key        | What it does                           |
 * | ---------- | -------------------------------------- |
 * | `y`, Left  | Takes yes                              |
 * | `n`, Right | Takes no                               |
 * | Enter      | Answers, once yes or no is taken       |
 *
 * @module
 */

import { assert_options, assert_type } from "./options.ts";
import {
  type Frame,
  is_enter,
  type Outcome,
  type Question,
} from "./question.ts";
import { MARKS, type Style } from "./style.ts";
import type { ChoPromptKey, ConfirmOptions } from "./types.ts";

/** The state of a yes or no question. */
export type ConfirmState = {
  /** What is taken: yes, no, or nothing yet. */
  readonly value: boolean | undefined;
  /** What Enter was told, when nothing was taken. */
  readonly mistake?: string;
};

/** The names of the options, for the error of an unknown one. */
const OPTIONS = ["default", "message"];

/** What Enter is told when neither yes nor no is taken. */
const NO_ANSWER = "Press y for yes, or n for no";

/** What a key does. */
function press(
  state: ConfirmState,
  key: ChoPromptKey,
): Outcome<ConfirmState, boolean> {
  if (is_enter(key)) {
    return state.value === undefined
      ? { state: { value: undefined, mistake: NO_ANSWER } }
      : { answer: state.value };
  }
  const lower = key.text.toLowerCase();
  const value = lower === "y" || key.name === "left"
    ? true
    : lower === "n" || key.name === "right"
    ? false
    : undefined;
  return value === undefined || value === state.value
    ? { state }
    : { state: { value } };
}

/** What a state shows. */
function frame(
  state: ConfirmState,
  style: Style,
  message: string,
): Frame {
  const choice = (label: string, taken: boolean) =>
    taken
      ? `${style.accent(MARKS.on)} ${label}`
      : style.dim(`${MARKS.off} ${label}`);
  const lines = [
    `${style.accent(MARKS.open)} ${style.bold(message)} ${
      style.dim(MARKS.input)
    } ${choice("Yes", state.value === true)} ${style.dim("/")} ${
      choice("No", state.value === false)
    }`,
  ];
  if (state.mistake !== undefined) {
    lines.push(`${style.bad(MARKS.failed)} ${style.bad(state.mistake)}`);
  }
  return { lines };
}

/**
 * The question of `confirm()`.
 *
 * @param options The options of the question, as they were given.
 * @returns The question, for the runner.
 * @throws {ChoError} `CHO_PROMPT_INVALID_OPTION` when an option is not what
 *   it must be; `CHO_CORE_UNKNOWN_OPTION` for an option that does not exist.
 */
export function confirm_question(
  options: ConfirmOptions,
): Question<ConfirmState, boolean> {
  assert_options("confirm()", options, OPTIONS);
  assert_type("confirm()", options, "default", "boolean");
  return {
    message: options.message,
    start: () => ({ value: options.default }),
    press,
    frame: (state, style) => frame(state, style, options.message),
    shown: (answer) => (answer ? "Yes" : "No"),
  };
}
