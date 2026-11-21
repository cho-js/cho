/**
 * The runner: asks a question on a terminal. It draws what the question
 * shows, gives it each key, and draws again, until there is an answer.
 *
 * It is the only part that writes escape codes to move the cursor. A frame is
 * redrawn from its first row: the cursor goes up to it, the screen is erased
 * from there, and the lines are written again.
 *
 * Whatever ends a question (an answer, a cancel, an error), the terminal is
 * put back as it was: the keys are no longer read, and the cursor is shown.
 *
 * @module
 */

import { prompt_error } from "./errors.ts";
import { type Frame, is_ctrl, type Question } from "./question.ts";
import { CODES, make_style, MARKS, width_of } from "./style.ts";
import type { ChoPromptKey, ChoPromptTerminal } from "./types.ts";

/** The terminals that have an open question. */
const busy = new WeakSet<ChoPromptTerminal>();

/**
 * Ask a question on a terminal.
 *
 * @typeParam S The state of the question.
 * @typeParam T The type of its answer.
 * @param terminal The terminal.
 * @param caller The function that was called, for the errors: `"text()"`.
 * @param question The question.
 * @returns The answer.
 * @throws {ChoError} (as a rejection) `CHO_PROMPT_NO_TERMINAL` when the
 *   terminal is not interactive; `CHO_PROMPT_BUSY` when it has an open
 *   question; `CHO_PROMPT_CANCELLED` when the question is cancelled. What
 *   the check of an answer throws is rejected as it is.
 */
export function ask<S, T>(
  terminal: ChoPromptTerminal,
  caller: string,
  question: Question<S, T>,
): Promise<T> {
  const asked = `${caller}: "${question.message}"`;
  if (!terminal.interactive) {
    return Promise.reject(prompt_error(
      "CHO_PROMPT_NO_TERMINAL",
      `${asked} cannot be asked: there is no terminal to answer on. Check isInteractive() first, and take the answer from a flag or a default`,
    ));
  }
  if (busy.has(terminal)) {
    return Promise.reject(prompt_error(
      "CHO_PROMPT_BUSY",
      `${asked} cannot be asked while another question is open: await each question before the next one`,
    ));
  }
  busy.add(terminal);

  const style = make_style(terminal.colors);
  let state = question.start();
  /** The rows between the first row of the frame and the cursor. */
  let below = 0;
  let hidden = false;

  /** What takes the cursor to the first row of the frame, and erases it. */
  const erase = () => CODES.start + CODES.up(below) + CODES.erase;

  const draw = (frame: Frame) => {
    const columns = Math.max(1, terminal.columns);
    const rows = frame.lines.map((line) =>
      Math.max(1, Math.ceil(width_of(line) / columns))
    );
    const rows_before = (line: number) =>
      rows.slice(0, line).reduce((sum, count) => sum + count, 0);
    const total = rows_before(rows.length);
    let out = erase() + frame.lines.join(CODES.line);
    if (frame.cursor) {
      const row = rows_before(frame.cursor.line) +
        Math.floor(frame.cursor.column / columns);
      out += CODES.start + CODES.up(total - 1 - row) +
        CODES.right(frame.cursor.column % columns);
      below = row;
      if (hidden) {
        out += CODES.show;
        hidden = false;
      }
    } else {
      below = total - 1;
      if (!hidden) {
        out = CODES.hide + out;
        hidden = true;
      }
    }
    terminal.write(out);
  };

  return new Promise<T>((resolve, reject) => {
    let close: (() => void) | undefined;
    let ended = false;
    /** The keys are handled one after the other: a check may take time. */
    let queue: Promise<void> = Promise.resolve();

    /** End the question: its last line, and the terminal put back. */
    const end = (line: string | undefined, settle: () => void) => {
      if (ended) {
        return;
      }
      ended = true;
      try {
        terminal.write(
          (line === undefined ? CODES.start : erase() + line) + CODES.line +
            (hidden ? CODES.show : ""),
        );
      } finally {
        busy.delete(terminal);
        try {
          close?.();
        } finally {
          settle();
        }
      }
    };
    const cancel = () =>
      end(
        `${style.bad(MARKS.failed)} ${style.bold(question.message)}`,
        () =>
          reject(
            prompt_error("CHO_PROMPT_CANCELLED", `${asked} was cancelled`),
          ),
      );
    const fail = (error: unknown) => end(undefined, () => reject(error));

    const handle = async (key: ChoPromptKey) => {
      if (ended) {
        return;
      }
      if (is_ctrl(key, "c")) {
        return cancel();
      }
      const outcome = question.press(state, key);
      if ("cancel" in outcome) {
        return cancel();
      }
      if ("state" in outcome) {
        if (outcome.state !== state) {
          state = outcome.state;
          draw(question.frame(state, style));
        }
        return;
      }
      const { answer } = outcome;
      const mistake = await question.check?.(answer);
      if (typeof mistake === "string" && mistake !== "" && question.refuse) {
        state = question.refuse(state, mistake);
        draw(question.frame(state, style));
        return;
      }
      end(
        `${style.good(MARKS.answered)} ${style.bold(question.message)} ${
          style.dim(MARKS.answer)
        } ${question.shown(answer)}`,
        () => resolve(answer),
      );
    };

    try {
      // The keys are read before the question is drawn: what is typed while
      // it appears is neither lost nor echoed by the terminal.
      close = terminal.open((key) =>
        queue = queue.then(() => handle(key)).catch(fail)
      );
      draw(question.frame(state, style));
    } catch (error) {
      fail(error);
    }
  });
}
