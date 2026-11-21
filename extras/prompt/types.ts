/**
 * The types of `@chojs/prompt`: the options of each question, the terminal a
 * question is asked on, and the three questions as one object.
 *
 * @module
 */

/**
 * A key that was pressed.
 *
 * @example
 * ```ts
 * { name: "down", text: "", ctrl: false }  // the down arrow
 * { name: "a", text: "a", ctrl: false }    // the letter a
 * { name: "c", text: "", ctrl: true }      // Ctrl+C
 * { name: "", text: "é", ctrl: false }     // a character with no name
 * ```
 */
export type ChoPromptKey = {
  /**
   * The name of the key, as `node:readline` names it: `"return"`, `"up"`,
   * `"backspace"`, `"a"`. `""` for a key that has none.
   */
  readonly name: string;
  /** What the key types: `"a"`, `" "`. `""` for a key that types nothing. */
  readonly text: string;
  /** Whether Ctrl was held. */
  readonly ctrl: boolean;
};

/**
 * What a question is asked on. The default one is the terminal of the
 * process; `scriptedTerminal` of `@chojs/prompt/testing` is one for tests.
 */
export type ChoPromptTerminal = {
  /**
   * Whether somebody can answer: the input and the output are a terminal. A
   * question on a terminal that is not interactive is an error.
   */
  readonly interactive: boolean;
  /** The width of the terminal, in characters. */
  readonly columns: number;
  /** Whether the terminal shows colours. */
  readonly colors: boolean;
  /**
   * Write to the terminal.
   *
   * @param text The text, with its escape codes.
   */
  write(text: string): void;
  /**
   * Start reading the keys, one at a time, with no echo.
   *
   * @param listener Called with each key. What it returns is awaited by a
   *   terminal that sends the next key only when this one was handled.
   * @returns What stops the reading, and puts the terminal back as it was.
   */
  open(listener: (key: ChoPromptKey) => unknown): () => void;
};

/** The result of `validate`: the text of the mistake, or nothing. */
export type ChoPromptMistake = string | undefined | void;

/** The options of {@link ChoPrompts.text | `text`}. */
export type TextOptions = {
  /** The question. */
  message: string;
  /**
   * The answer of an empty line. It is shown between brackets while nothing
   * is typed. Default: none, and an empty line answers `""`.
   */
  default?: string;
  /**
   * An example of an answer, shown dimmed while nothing is typed, when the
   * question has no `default`. It is never the answer. Only its colour tells
   * it from a typed text: a terminal with no colour does not show it.
   * Default: none.
   */
  placeholder?: string;
  /**
   * Checks the answer. It returns the text of a mistake, which is shown
   * under the question, and the question stays open; or nothing, and the
   * answer is taken. It may be asynchronous. Default: every answer is taken.
   */
  validate?: (
    value: string,
  ) => ChoPromptMistake | Promise<ChoPromptMistake>;
};

/** The options of {@link ChoPrompts.confirm | `confirm`}. */
export type ConfirmOptions = {
  /** The question. */
  message: string;
  /**
   * The answer the question starts on. Default: none, and Enter does not
   * answer before `y` or `n` was pressed.
   */
  default?: boolean;
};

/**
 * A choice of {@link ChoPrompts.select | `select`}.
 *
 * @typeParam T The type of its value.
 */
export type ChoPromptChoice<T> = {
  /** What the question resolves to when this choice is taken. */
  value: T;
  /** The text of the choice. Default: the value, as a string. */
  label?: string;
  /** A few words after the label, dimmed. Default: none. */
  hint?: string;
};

/**
 * The options of {@link ChoPrompts.select | `select`}.
 *
 * @typeParam T The type of the values of the choices.
 */
export type SelectOptions<T> = {
  /** The question. */
  message: string;
  /** The choices, in the order they are listed: one at least. */
  choices: readonly ChoPromptChoice<T>[];
  /**
   * The value of the choice the question starts on. Default: the first
   * choice.
   */
  default?: NoInfer<T>;
};

/**
 * The questions, bound to a terminal: what `createPrompts` gives. An
 * application provides it behind a token, and its tests give another one.
 */
export type ChoPrompts = {
  /**
   * Ask for a text.
   *
   * @param options The question, and its options.
   * @returns The answer.
   */
  text(options: TextOptions): Promise<string>;
  /**
   * Ask for a yes or a no.
   *
   * @param options The question, and its options.
   * @returns `true` for yes.
   */
  confirm(options: ConfirmOptions): Promise<boolean>;
  /**
   * Ask for one choice of a list.
   *
   * @typeParam T The type of the values of the choices.
   * @param options The question, and its choices.
   * @returns The value of the choice that was taken.
   */
  select<const T>(options: SelectOptions<T>): Promise<T>;
};
