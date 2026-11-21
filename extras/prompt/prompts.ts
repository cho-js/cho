/**
 * The public functions: the three questions on the terminal of the process,
 * and {@link createPrompts}, which binds them to a terminal.
 *
 * @module
 */

import { confirm_question } from "./confirm.ts";
import { ask } from "./run.ts";
import { select_question } from "./select.ts";
import { is_interactive, process_terminal } from "./terminal.ts";
import { text_question } from "./text.ts";
import type {
  ChoPrompts,
  ChoPromptTerminal,
  ConfirmOptions,
  SelectOptions,
  TextOptions,
} from "./types.ts";

/**
 * The three questions, bound to a terminal.
 *
 * An application that asks questions provides the result behind a token, and
 * its commands ask through it. Its tests give another terminal, such as
 * `scriptedTerminal` of `@chojs/prompt/testing`, and answer with keys.
 *
 * @param terminal The terminal to ask on. Default: the terminal of the
 *   process.
 * @returns `text`, `confirm` and `select`, which ask on that terminal.
 *
 * @example
 * ```ts
 * import { createPrompts, type ChoPrompts } from "@chojs/prompt";
 * import { provider, token } from "@chojs/command";
 *
 * export const ASK = token<ChoPrompts>("ASK");
 * export const ask = provider({ provide: ASK, factory: () => createPrompts() });
 * ```
 */
export function createPrompts(terminal?: ChoPromptTerminal): ChoPrompts {
  // The options are checked first: a mistake in them is thrown as it is, and
  // not as a question that cannot be asked.
  const on = async <T>(
    question: (terminal: ChoPromptTerminal) => Promise<T>,
  ) => question(terminal ?? await process_terminal());
  return {
    text(options) {
      const question = text_question(options);
      return on((terminal) => ask(terminal, "text()", question));
    },
    confirm(options) {
      const question = confirm_question(options);
      return on((terminal) => ask(terminal, "confirm()", question));
    },
    select(options) {
      const question = select_question(options);
      return on((terminal) => ask(terminal, "select()", question));
    },
  };
}

/** The questions on the terminal of the process. */
const DEFAULT = createPrompts();

/**
 * Ask for a text, on the terminal of the process.
 *
 * ```
 * ? Project name › my-app
 * ```
 *
 * Typing edits the line, and Enter answers. An empty line answers `default`,
 * or `""` when there is none.
 *
 * @param options The question (`message`), and `default`, `placeholder` and
 *   `validate`.
 * @returns The answer.
 * @throws {ChoError} `CHO_PROMPT_INVALID_OPTION` and
 *   `CHO_CORE_UNKNOWN_OPTION`, when the options are wrong. As a rejection:
 *   `CHO_PROMPT_NO_TERMINAL` when there is no terminal,
 *   `CHO_PROMPT_CANCELLED` when the question is cancelled (Ctrl+C), and
 *   `CHO_PROMPT_BUSY` when another question is open.
 *
 * @example
 * ```ts
 * const name = await text({
 *   message: "Project name",
 *   validate: (value) =>
 *     /^[a-z][a-z0-9_-]*$/.test(value) ? undefined : "Lower case letters, digits, - and _",
 * });
 * ```
 */
export function text(options: TextOptions): Promise<string> {
  return DEFAULT.text(options);
}

/**
 * Ask for a yes or a no, on the terminal of the process.
 *
 * ```
 * ? Initialize a git repository? › ● Yes / ○ No
 * ```
 *
 * `y` and `n` take an answer, and Enter gives it.
 *
 * @param options The question (`message`), and `default`.
 * @returns `true` for yes, `false` for no.
 * @throws {ChoError} As {@link text} does.
 *
 * @example
 * ```ts
 * const git = await confirm({ message: "Initialize a git repository?", default: true });
 * ```
 */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return DEFAULT.confirm(options);
}

/**
 * Ask for one choice of a list, on the terminal of the process.
 *
 * ```
 * ? What are you building?
 * ❯ A web application
 *   A command-line tool
 * ```
 *
 * The arrows move the pointer, and Enter answers.
 *
 * @typeParam T The type of the values of the choices: the answer is one of
 *   them.
 * @param options The question (`message`), its `choices`, and `default`.
 * @returns The value of the choice that was taken.
 * @throws {ChoError} As {@link text} does.
 *
 * @example
 * ```ts
 * const kind = await select({
 *   message: "What are you building?",
 *   choices: [
 *     { value: "web", label: "A web application" },
 *     { value: "cli", label: "A command-line tool" },
 *   ],
 * }); // "web" | "cli"
 * ```
 */
export function select<const T>(options: SelectOptions<T>): Promise<T> {
  return DEFAULT.select(options);
}

/**
 * Whether a question can be asked: the input and the output of the process
 * are a terminal. It is `false` in CI, when the input or the output is a pipe
 * or a file, and where there is no terminal at all.
 *
 * A question asked when it is `false` is an error. Check it first, and take
 * the answers from flags and defaults instead.
 *
 * @returns Whether somebody can answer.
 *
 * @example
 * ```ts
 * const name = ctx.args.name ?? (isInteractive()
 *   ? await text({ message: "Project name" })
 *   : undefined);
 * ```
 */
export function isInteractive(): boolean {
  return is_interactive();
}
