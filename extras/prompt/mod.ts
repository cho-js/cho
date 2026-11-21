/**
 * @chojs/prompt — questions in a terminal: a text, a yes or no, a choice of a
 * list.
 *
 * - {@link text}, {@link confirm} and {@link select} ask a question on the
 *   terminal of the process, and resolve to the answer.
 * - {@link isInteractive} tells whether somebody can answer: a question asked
 *   with no terminal is an error.
 * - {@link createPrompts} binds the three questions to a terminal, for an
 *   application that provides them behind a token. In its tests the terminal
 *   is `scriptedTerminal`, of `@chojs/prompt/testing`.
 *
 * It runs on Deno, Node.js and Bun, with no dependency but `@chojs/core`.
 *
 * @example
 * ```ts
 * import { confirm, select, text } from "@chojs/prompt";
 *
 * const name = await text({ message: "Project name" });
 * const kind = await select({
 *   message: "What are you building?",
 *   choices: [
 *     { value: "web", label: "A web application" },
 *     { value: "cli", label: "A command-line tool" },
 *   ],
 * }); // "web" | "cli"
 * const git = await confirm({ message: "Initialize a git repository?", default: true });
 * ```
 *
 * @module
 */

export {
  confirm,
  createPrompts,
  isInteractive,
  select,
  text,
} from "./prompts.ts";
export type {
  ChoPromptChoice,
  ChoPromptKey,
  ChoPromptMistake,
  ChoPrompts,
  ChoPromptTerminal,
  ConfirmOptions,
  SelectOptions,
  TextOptions,
} from "./types.ts";

/** The codes of the errors of this package. */
export type { ChoPromptErrorCode } from "./errors.ts";
