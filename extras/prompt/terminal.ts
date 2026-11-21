/**
 * The terminal of the process: the keyboard, and the screen.
 *
 * It is made of what Deno, Node.js and Bun all have: the `process` of the
 * runtime, and `node:readline`, which turns the bytes of the keyboard into
 * keys (`emitKeypressEvents`). Neither is imported when this file is: the
 * process is the global one, and `node:readline` is loaded when the first
 * question is asked. So the package loads where there is no terminal at all,
 * a Cloudflare Worker for one.
 *
 * @module
 */

import { env } from "@chojs/core/utils";
import type { ChoPromptKey, ChoPromptTerminal } from "./types.ts";

/** The input of a process, as far as it is used. */
export type TerminalInput = {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?(raw: boolean): unknown;
  resume(): unknown;
  pause(): unknown;
  on(event: "keypress", listener: KeypressListener): unknown;
  off(event: "keypress", listener: KeypressListener): unknown;
};

/** The output of a process, as far as it is used. */
export type TerminalOutput = {
  isTTY?: boolean;
  columns?: number;
  write(text: string): unknown;
};

/** A process, as far as it is used. */
export type TerminalProcess = {
  stdin?: TerminalInput;
  stdout?: TerminalOutput;
};

/** What `node:readline` tells of a key. */
export type Keypress = {
  name?: string | undefined;
  ctrl?: boolean | undefined;
  meta?: boolean | undefined;
};

/** A listener of the `keypress` event of `node:readline`. */
type KeypressListener = (text: string | undefined, key?: Keypress) => void;

/** `node:readline`, as far as it is used. */
export type Readline = {
  // deno-lint-ignore no-explicit-any
  emitKeypressEvents(stream: any): void;
};

/** The width of a terminal that does not tell its own. */
const DEFAULT_COLUMNS = 80;

/** The process of the runtime, when it has one. */
function runtime_process(): TerminalProcess | undefined {
  return (globalThis as { process?: TerminalProcess }).process;
}

/**
 * Whether colours were asked not to be shown: `NO_COLOR` is set, and not
 * empty (https://no-color.org).
 *
 * Deno tells it with no permission (`Deno.noColor`). It is not read from the
 * environment there: in a terminal, Deno stops and asks the user to allow
 * each variable a program reads without `--allow-env`.
 */
export function no_color(): boolean {
  const deno = (globalThis as { Deno?: { noColor?: unknown } }).Deno;
  if (typeof deno?.noColor === "boolean") {
    return deno.noColor;
  }
  const value = env("NO_COLOR");
  return value !== undefined && value !== "";
}

/**
 * Whether a text is one that a key types: no control character in it.
 *
 * @param text What the keyboard sent for the key.
 */
function is_typed(text: string): boolean {
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code < 0x20 || (code >= 0x7f && code < 0xa0)) {
      return false;
    }
  }
  return text !== "";
}

/**
 * A key, from what `node:readline` tells of it.
 *
 * @param text What the keyboard sent for the key.
 * @param key Its name, and whether Ctrl or Alt was held.
 * @returns The key. It types nothing with Ctrl or Alt, and when what was
 *   sent has a control character: an arrow, Enter.
 */
export function to_key(text: string | undefined, key?: Keypress): ChoPromptKey {
  const ctrl = key?.ctrl === true;
  const typed = text !== undefined && !ctrl && key?.meta !== true &&
    is_typed(text);
  return { name: key?.name ?? "", text: typed ? text : "", ctrl };
}

/**
 * Whether a process has a terminal somebody can answer on: its input and its
 * output are terminals, and its input gives single keys.
 *
 * @param process The process; default: the one of the runtime.
 */
export function is_interactive(
  process: TerminalProcess | undefined = runtime_process(),
): boolean {
  try {
    return process?.stdin?.isTTY === true &&
      process.stdout?.isTTY === true &&
      typeof process.stdin.setRawMode === "function";
  } catch {
    return false;
  }
}

/**
 * The terminal of a process.
 *
 * @param process What gives the process: its input and its output are read
 *   when they are used, not before.
 * @param readline What gives `node:readline`, once it is loaded.
 * @returns The terminal.
 */
export function make_terminal(
  process: () => TerminalProcess | undefined,
  readline: () => Readline | undefined,
): ChoPromptTerminal {
  return {
    get interactive() {
      return is_interactive(process());
    },
    get columns() {
      const columns = process()?.stdout?.columns;
      return typeof columns === "number" && columns > 0
        ? columns
        : DEFAULT_COLUMNS;
    },
    get colors() {
      return process()?.stdout?.isTTY === true && !no_color();
    },
    write(text) {
      process()?.stdout?.write(text);
    },
    open(listener) {
      const stdin = process()!.stdin!;
      const was_raw = stdin.isRaw === true;
      const on_keypress: KeypressListener = (text, key) => {
        listener(to_key(text, key));
      };
      readline()!.emitKeypressEvents(stdin);
      stdin.on("keypress", on_keypress);
      stdin.setRawMode!(true);
      stdin.resume();
      return () => {
        stdin.off("keypress", on_keypress);
        stdin.setRawMode!(was_raw);
        // A paused input lets the process end.
        stdin.pause();
      };
    },
  };
}

/** `node:readline`, once the first question was asked. */
let loaded: Readline | undefined;

/** The terminal of the process of the runtime: there is one. */
const TERMINAL = make_terminal(runtime_process, () => loaded);

/**
 * The terminal of the process of the runtime, ready for a question.
 *
 * @returns The terminal. `node:readline` is loaded when the terminal is
 *   interactive, and only then.
 */
export async function process_terminal(): Promise<ChoPromptTerminal> {
  if (loaded === undefined && TERMINAL.interactive) {
    loaded = await import("node:readline");
  }
  return TERMINAL;
}
