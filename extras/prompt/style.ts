/**
 * How a question looks: its marks and its colours, and the escape codes that
 * move the cursor. They are written here, by hand: there are a dozen.
 *
 * The marks say everything, and the colours only help: a terminal with no
 * colour shows the same text.
 *
 * @module
 */

/** The escape character. */
const ESC = "\x1b";

/** The codes that move the cursor and erase. */
export const CODES = {
  /** To the first column of the row. */
  start: "\r",
  /** To the first column of the next row. */
  line: "\r\n",
  /** Up `rows` rows; nothing for `0`. */
  up: (rows: number): string => rows > 0 ? `${ESC}[${rows}A` : "",
  /** Right `columns` columns; nothing for `0`. */
  right: (columns: number): string => columns > 0 ? `${ESC}[${columns}C` : "",
  /** Erase from the cursor to the end of the screen. */
  erase: `${ESC}[J`,
  /** Hide the cursor. */
  hide: `${ESC}[?25l`,
  /** Show the cursor. */
  show: `${ESC}[?25h`,
} as const;

/** The marks of a question. */
export const MARKS = {
  /** Before a question that is open. */
  open: "?",
  /** Before a question that was answered. */
  answered: "✔",
  /** Before a question that was cancelled, and before a mistake. */
  failed: "✖",
  /** Before the choice the cursor is on. */
  pointer: "❯",
  /** Between a question and what is typed. */
  input: "›",
  /** Between a question and its answer. */
  answer: "·",
  /** The answer of a yes or no that is taken, and the one that is not. */
  on: "●",
  off: "○",
} as const;

/** Colours a text, or leaves it as it is. */
export type Paint = (text: string) => string;

/** The colours of a question. */
export type Style = {
  /** Whether the terminal shows colours. */
  colors: boolean;
  /** The mark of an open question, and the pointer. */
  accent: Paint;
  /** The mark of an answered question. */
  good: Paint;
  /** The mark of a cancelled question, and a mistake. */
  bad: Paint;
  /** A hint, a default, a placeholder, an answer. */
  dim: Paint;
  /** The question. */
  bold: Paint;
};

/** A text between two codes of the Select Graphic Rendition. */
const sgr = (on: number, off: number): Paint => (text) =>
  `${ESC}[${on}m${text}${ESC}[${off}m`;

/** Leaves a text as it is. */
const plain: Paint = (text) => text;

/**
 * The colours of a terminal.
 *
 * @param colors Whether the terminal shows colours.
 * @returns What colours a text; with no colour, what leaves it as it is.
 */
export function make_style(colors: boolean): Style {
  return colors
    ? {
      colors,
      accent: sgr(36, 39),
      good: sgr(32, 39),
      bad: sgr(31, 39),
      dim: sgr(2, 22),
      bold: sgr(1, 22),
    }
    : {
      colors,
      accent: plain,
      good: plain,
      bad: plain,
      dim: plain,
      bold: plain,
    };
}

/** An escape code: of a colour, of the cursor. */
// deno-lint-ignore no-control-regex
const ESCAPE_CODE = /\x1b\[[0-9;?]*[A-Za-z]/g;

/**
 * The width of a text on the screen: its characters, without the escape
 * codes. A character counts for one column: a wide one (East Asian, an
 * emoji) is counted short.
 *
 * @param text A text of one line.
 * @returns The number of columns it takes.
 */
export function width_of(text: string): number {
  return [...text.replace(ESCAPE_CODE, "")].length;
}

/**
 * A text without its escape codes.
 *
 * @param text A text.
 * @returns What a terminal with no colour would show.
 */
export function strip_codes(text: string): string {
  return text.replace(ESCAPE_CODE, "");
}
