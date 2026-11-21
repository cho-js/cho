/**
 * What a question is, for the runner (`run.ts`): pure functions over a state.
 * Nothing here reads a key or writes to a terminal, so a question is tested
 * with neither.
 *
 * @module
 */

import type { Style } from "./style.ts";
import type { ChoPromptKey, ChoPromptMistake } from "./types.ts";

/**
 * What a question shows: its lines, from the top, and where the cursor is.
 */
export type Frame = {
  /** The lines. A line longer than the terminal takes more than one row. */
  lines: string[];
  /**
   * Where the cursor is: the line, and the column in it, both from `0`.
   * With none, the cursor is hidden.
   */
  cursor?: { line: number; column: number };
};

/**
 * What a key does to a question: a new state, an answer, or a cancel.
 *
 * @typeParam S The state of the question.
 * @typeParam T The type of its answer.
 */
export type Outcome<S, T> =
  | { state: S }
  | { answer: T }
  | { cancel: true };

/**
 * A question.
 *
 * @typeParam S Its state: what the keys change.
 * @typeParam T The type of its answer.
 */
export type Question<S, T> = {
  /** The text of the question. */
  readonly message: string;
  /** The state the question starts in. */
  start(): S;
  /**
   * What a key does.
   *
   * @param state The state before the key.
   * @param key The key.
   * @returns The state after it, or the answer.
   */
  press(state: S, key: ChoPromptKey): Outcome<S, T>;
  /**
   * What a state shows.
   *
   * @param state The state.
   * @param style The colours of the terminal.
   * @returns Its lines, and its cursor.
   */
  frame(state: S, style: Style): Frame;
  /**
   * Check an answer, before it is taken.
   *
   * @param answer The answer.
   * @returns The text of a mistake, or nothing.
   */
  check?(answer: T): ChoPromptMistake | Promise<ChoPromptMistake>;
  /**
   * The state of a question whose answer was refused.
   *
   * @param state The state the answer was given in.
   * @param mistake What `check` returned.
   * @returns The state that shows the mistake.
   */
  refuse?(state: S, mistake: string): S;
  /**
   * How an answer is written, on the line of an answered question.
   *
   * @param answer The answer.
   * @returns Its text.
   */
  shown(answer: T): string;
};

/** Whether a key answers: Enter, under either of its names. */
export function is_enter(key: ChoPromptKey): boolean {
  return key.name === "return" || key.name === "enter";
}

/** Whether a key is a given letter with Ctrl. */
export function is_ctrl(key: ChoPromptKey, name: string): boolean {
  return key.ctrl && key.name === name;
}
