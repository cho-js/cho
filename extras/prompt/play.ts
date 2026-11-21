/**
 * What the tests of the questions share: pressing the keys of a script on a
 * question, with no terminal, and reading what a state shows. Not published.
 *
 * @module
 */

import type { Question } from "./question.ts";
import { make_style, strip_codes } from "./style.ts";
import { keys_of, type ScriptedKey } from "./testing.ts";

/** Where a question is after some keys. */
export type Played<S, T> = {
  /** The state after the last key that left the question open. */
  state: S;
  /** The answer, when a key gave one. */
  answer?: T;
  /** Whether a key cancelled the question. */
  cancel?: true;
};

/**
 * Press the keys of a script on a question, from a state.
 *
 * @param question The question.
 * @param state The state to start from.
 * @param items The keys, as `scriptedTerminal` takes them.
 * @returns The state, and the answer or the cancel that ended the keys.
 */
export function press<S, T>(
  question: Question<S, T>,
  state: S,
  ...items: ScriptedKey[]
): Played<S, T> {
  for (const key of items.flatMap(keys_of)) {
    const outcome = question.press(state, key);
    if (!("state" in outcome)) {
      return { state, ...outcome };
    }
    state = outcome.state;
  }
  return { state };
}

/**
 * Press the keys of a script on a question, from its start.
 *
 * @param question The question.
 * @param items The keys.
 * @returns The state, and the answer or the cancel that ended the keys.
 */
export function play<S, T>(
  question: Question<S, T>,
  ...items: ScriptedKey[]
): Played<S, T> {
  return press(question, question.start(), ...items);
}

/**
 * What a state shows, as plain text.
 *
 * @param question The question.
 * @param state The state.
 * @param colors Whether the terminal shows colours: the text is plain
 *   either way, but a question may show less with none.
 * @returns The lines, with no colour and no space at their end, and the
 *   cursor.
 */
export function shows<S, T>(
  question: Question<S, T>,
  state: S,
  colors = false,
): { lines: string[]; cursor?: { line: number; column: number } } {
  const { lines, cursor } = question.frame(state, make_style(colors));
  return {
    lines: lines.map((line) => strip_codes(line).trimEnd()),
    ...(cursor ? { cursor } : {}),
  };
}
