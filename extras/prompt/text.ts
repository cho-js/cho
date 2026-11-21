/**
 * The question that asks for a text: one line, with a small editor.
 *
 * ```
 * ? Project name › my-app
 * ✖ Lower case letters, digits, - and _
 * ```
 *
 * | Key                       | What it does                             |
 * | ------------------------- | ---------------------------------------- |
 * | A character               | Typed where the cursor is                |
 * | Backspace                 | Erases the character before the cursor   |
 * | Delete, Ctrl+D            | Erases the character under the cursor    |
 * | Left, Right               | Move the cursor                          |
 * | Home, Ctrl+A; End, Ctrl+E | To the start, and to the end             |
 * | Ctrl+U                    | Erases what is before the cursor         |
 * | Enter                     | Answers; an empty line answers `default` |
 * | Ctrl+D, on an empty line  | Cancels                                  |
 *
 * @module
 */

import { assert_options, assert_type } from "./options.ts";
import {
  type Frame,
  is_ctrl,
  is_enter,
  type Outcome,
  type Question,
} from "./question.ts";
import { MARKS, type Style, width_of } from "./style.ts";
import type { ChoPromptKey, TextOptions } from "./types.ts";

/** The state of a text question. */
export type TextState = {
  /** What was typed, a character for each item. */
  readonly chars: readonly string[];
  /** Where the cursor is: the number of characters before it. */
  readonly cursor: number;
  /** The mistake of the last answer, until the text changes. */
  readonly mistake?: string;
};

/** The names of the options, for the error of an unknown one. */
const OPTIONS = ["default", "message", "placeholder", "validate"];

/** A state with another text: the mistake of the old one is gone. */
function edited(chars: readonly string[], cursor: number): TextState {
  return { chars, cursor };
}

/** A state with the cursor elsewhere, kept inside the text. */
function moved(state: TextState, cursor: number): TextState {
  const inside = Math.max(0, Math.min(state.chars.length, cursor));
  return inside === state.cursor ? state : { ...state, cursor: inside };
}

/** What a key does to the text. */
function press(
  state: TextState,
  key: ChoPromptKey,
  fallback: string | undefined,
): Outcome<TextState, string> {
  const { chars, cursor } = state;
  if (is_enter(key)) {
    const value = chars.join("");
    return {
      answer: value === "" && fallback !== undefined ? fallback : value,
    };
  }
  if (is_ctrl(key, "d") && chars.length === 0) {
    return { cancel: true };
  }
  if (key.name === "backspace") {
    return cursor === 0 ? { state } : {
      state: edited(
        [...chars.slice(0, cursor - 1), ...chars.slice(cursor)],
        cursor - 1,
      ),
    };
  }
  if (key.name === "delete" || is_ctrl(key, "d")) {
    return cursor === chars.length ? { state } : {
      state: edited(
        [...chars.slice(0, cursor), ...chars.slice(cursor + 1)],
        cursor,
      ),
    };
  }
  if (is_ctrl(key, "u")) {
    return cursor === 0 ? { state } : { state: edited(chars.slice(cursor), 0) };
  }
  if (key.name === "left") {
    return { state: moved(state, cursor - 1) };
  }
  if (key.name === "right") {
    return { state: moved(state, cursor + 1) };
  }
  if (key.name === "home" || is_ctrl(key, "a")) {
    return { state: moved(state, 0) };
  }
  if (key.name === "end" || is_ctrl(key, "e")) {
    return { state: moved(state, chars.length) };
  }
  if (key.text !== "") {
    const typed = [...key.text];
    return {
      state: edited(
        [...chars.slice(0, cursor), ...typed, ...chars.slice(cursor)],
        cursor + typed.length,
      ),
    };
  }
  return { state };
}

/**
 * What an empty line shows, after the cursor: the answer it would give,
 * between brackets, or an example of an answer. An example is told from a
 * typed text by its colour alone, so a terminal with no colour shows none.
 */
function empty_line(style: Style, options: TextOptions): string {
  if (options.default !== undefined && options.default !== "") {
    return `(${options.default})`;
  }
  return style.colors ? options.placeholder ?? "" : "";
}

/** What a state shows. */
function frame(
  state: TextState,
  style: Style,
  options: TextOptions,
): Frame {
  const head = `${style.accent(MARKS.open)} ${style.bold(options.message)} ${
    style.dim(MARKS.input)
  } `;
  const body = state.chars.length > 0
    ? state.chars.join("")
    : style.dim(empty_line(style, options));
  // A space after the text: the cursor has a column of its own at the end,
  // on a line that fills the terminal too.
  const lines = [`${head}${body} `];
  if (state.mistake !== undefined) {
    lines.push(`${style.bad(MARKS.failed)} ${style.bad(state.mistake)}`);
  }
  return { lines, cursor: { line: 0, column: width_of(head) + state.cursor } };
}

/**
 * The question of `text()`.
 *
 * @param options The options of the question, as they were given.
 * @returns The question, for the runner.
 * @throws {ChoError} `CHO_PROMPT_INVALID_OPTION` when an option is not what
 *   it must be; `CHO_CORE_UNKNOWN_OPTION` for an option that does not exist.
 */
export function text_question(
  options: TextOptions,
): Question<TextState, string> {
  assert_options("text()", options, OPTIONS);
  assert_type("text()", options, "default", "string");
  assert_type("text()", options, "placeholder", "string");
  assert_type("text()", options, "validate", "function");
  const { validate } = options;
  return {
    message: options.message,
    start: () => ({ chars: [], cursor: 0 }),
    press: (state, key) => press(state, key, options.default),
    frame: (state, style) => frame(state, style, options),
    ...(validate ? { check: (answer: string) => validate(answer) } : {}),
    refuse: (state, mistake) => ({ ...state, mistake }),
    shown: (answer) => answer,
  };
}
