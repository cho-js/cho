/**
 * @chojs/prompt/testing — a terminal for tests: {@link scriptedTerminal}
 * answers the questions with the keys it is given, and keeps what was drawn.
 *
 * The questions run as they do on a real terminal: the same keys, the same
 * escape codes. The terminal reads those codes on a screen of its own, so a
 * test compares what a user would see.
 *
 * @example
 * ```ts
 * import { createPrompts } from "@chojs/prompt";
 * import { scriptedTerminal } from "@chojs/prompt/testing";
 *
 * const terminal = scriptedTerminal(["my-app", "return", "down", "return"]);
 * const { text, select } = createPrompts(terminal);
 *
 * await text({ message: "Project name" }); // "my-app"
 * await select({ message: "Kind", choices: [{ value: "web" }, { value: "cli" }] }); // "cli"
 * terminal.screen();
 * // ["✔ Project name · my-app", "✔ Kind · cli"]
 * ```
 *
 * @module
 */

import type { ChoPromptKey, ChoPromptTerminal } from "./types.ts";

/**
 * A key of a script:
 *
 * - the name of a key: `"return"`, `"enter"`, `"up"`, `"down"`, `"left"`,
 *   `"right"`, `"backspace"`, `"delete"`, `"home"`, `"end"`, `"tab"`,
 *   `"escape"`, `"space"`;
 * - a letter with Ctrl: `"ctrl+c"`;
 * - any other text is typed, a key for each character: `"my-app"`;
 * - a key, as it is.
 *
 * To type a word that is the name of a key, give its characters:
 * `[..."home"]`.
 */
export type ScriptedKey = string | ChoPromptKey;

/** The options of {@link scriptedTerminal}. Every option is optional. */
export type ScriptedTerminalOptions = {
  /** The width of the screen, in characters. Default: `80`. */
  columns?: number;
  /** Whether the terminal shows colours. Default: `false`. */
  colors?: boolean;
  /**
   * Whether somebody can answer. `false` is a terminal with no keyboard: a
   * question on it is an error. Default: `true`.
   */
  interactive?: boolean;
};

/** A terminal that answers with a script, and keeps what was drawn. */
export type ScriptedTerminal = ChoPromptTerminal & {
  /**
   * What the screen shows now: its lines, from the top, with no colour and
   * no space at their end.
   *
   * @returns The lines.
   */
  screen(): string[];
  /**
   * The screen when a question was opened, and after each key that left it
   * open: one item for each, in order.
   */
  readonly screens: string[][];
  /** Everything that was written, with its escape codes, in order. */
  readonly written: string[];
  /** Where the cursor is, and whether it is hidden. */
  readonly cursor: { row: number; column: number; hidden: boolean };
  /** The number of keys that were not pressed yet. */
  readonly left: number;
  /** Whether a question is reading the keys: `false` once it ended. */
  readonly reading: boolean;
};

/** The names a script may give, and what the keyboard types for each. */
const NAMED: Record<string, string> = {
  return: "",
  enter: "",
  up: "",
  down: "",
  left: "",
  right: "",
  backspace: "",
  delete: "",
  home: "",
  end: "",
  tab: "",
  escape: "",
  space: " ",
};

/** Ctrl+C: what cancels a question. */
const CTRL_C: ChoPromptKey = { name: "c", text: "", ctrl: true };

/**
 * The keys of one item of a script.
 *
 * @param item A name, a letter with Ctrl, a text to type, or a key.
 * @returns The keys to press for it.
 */
export function keys_of(item: ScriptedKey): ChoPromptKey[] {
  if (typeof item !== "string") {
    return [item];
  }
  const text = NAMED[item];
  if (text !== undefined) {
    return [{ name: item, text, ctrl: false }];
  }
  const ctrl = /^ctrl\+([a-z])$/.exec(item);
  if (ctrl) {
    return [{ name: ctrl[1]!, text: "", ctrl: true }];
  }
  return [...item].map((char) => ({
    name: /^[a-z0-9]$/i.test(char) ? char.toLowerCase() : "",
    text: char,
    ctrl: false,
  }));
}

/**
 * A screen: what a terminal shows of what is written to it. It knows the
 * escape codes the questions write, and no other.
 */
class Screen {
  readonly rows: string[][] = [];
  row = 0;
  column = 0;
  hidden = false;
  /** Whether the last column was written: the next character wraps. */
  #wrap = false;

  constructor(readonly columns: number) {}

  write(text: string): void {
    // deno-lint-ignore no-control-regex
    const part = /\x1b\[([0-9;?]*)([A-Za-z])|\r|\n|[^\x1b\r\n]/gu;
    for (const [all, argument = "", code] of text.matchAll(part)) {
      if (code !== undefined) {
        this.#escape(argument, code);
      } else if (all === "\r") {
        this.column = 0;
        this.#wrap = false;
      } else if (all === "\n") {
        this.row++;
        this.#wrap = false;
      } else {
        this.#put(all);
      }
    }
  }

  #put(char: string): void {
    if (this.#wrap) {
      this.row++;
      this.column = 0;
      this.#wrap = false;
    }
    (this.rows[this.row] ??= [])[this.column] = char;
    if (this.column === this.columns - 1) {
      this.#wrap = true;
    } else {
      this.column++;
    }
  }

  #escape(argument: string, code: string): void {
    const count = Number.parseInt(argument, 10) || 1;
    if (code === "A") {
      this.row = Math.max(0, this.row - count);
      this.#wrap = false;
    } else if (code === "C") {
      this.column = Math.min(this.columns - 1, this.column + count);
      this.#wrap = false;
    } else if (code === "J") {
      this.rows.length = Math.min(this.rows.length, this.row + 1);
      const row = this.rows[this.row];
      if (row) {
        row.length = Math.min(row.length, this.column);
      }
    } else if (argument === "?25" && (code === "l" || code === "h")) {
      this.hidden = code === "l";
    }
    // "m": a colour. The screen keeps the text alone.
  }

  lines(): string[] {
    const lines = Array.from(
      this.rows,
      (row) => Array.from(row ?? [], (char) => char ?? " ").join("").trimEnd(),
    );
    while (lines.length > 0 && lines[lines.length - 1] === "") {
      lines.pop();
    }
    return lines;
  }
}

/**
 * A terminal that answers with a script.
 *
 * Each question takes the keys it needs, in order, and leaves the others to
 * the next one. When the keys end and a question is still open, it is
 * cancelled, as with Ctrl+C: a test never waits for a key that does not
 * come.
 *
 * @param keys The keys to press, in order.
 * @param options The width of the screen, its colours, and whether it is
 *   interactive.
 * @returns The terminal, to give to `createPrompts`.
 *
 * @example
 * ```ts
 * const terminal = scriptedTerminal(["n", "return"]);
 * const { confirm } = createPrompts(terminal);
 * await confirm({ message: "Install dependencies now?" }); // false
 * terminal.screen(); // ["✔ Install dependencies now? · No"]
 * ```
 */
export function scriptedTerminal(
  keys: readonly ScriptedKey[] = [],
  options: ScriptedTerminalOptions = {},
): ScriptedTerminal {
  const { columns = 80, colors = false, interactive = true } = options;
  const pending = keys.flatMap(keys_of);
  const screen = new Screen(columns);
  const screens: string[][] = [];
  const written: string[] = [];
  let reading = false;
  return {
    interactive,
    columns,
    colors,
    write(text) {
      written.push(text);
      screen.write(text);
    },
    open(listener) {
      let open = true;
      reading = true;
      // After `open` returned, and the question was drawn.
      Promise.resolve().then(async () => {
        if (open) {
          screens.push(screen.lines());
        }
        while (open) {
          await listener(pending.shift() ?? CTRL_C);
          // A key that ended the question is seen when the next one opens.
          if (open) {
            screens.push(screen.lines());
          }
        }
      });
      return () => {
        open = false;
        reading = false;
      };
    },
    screen: () => screen.lines(),
    screens,
    written,
    get cursor() {
      return { row: screen.row, column: screen.column, hidden: screen.hidden };
    },
    get left() {
      return pending.length;
    },
    get reading() {
      return reading;
    },
  };
}
