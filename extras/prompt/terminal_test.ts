/**
 * Tests for `terminal.ts`: the terminal of a process.
 *
 * The process is a stand-in: an input that is a stream of `node:stream`, and
 * an output that keeps what is written. The keys are real: bytes written to
 * the input, and turned into keys by the `node:readline` of the runtime.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { engine } from "@chojs/core/utils";
import { with_env } from "@chojs/core/utils/test_utils";
import { isInteractive } from "./prompts.ts";
import {
  is_interactive,
  make_terminal,
  no_color,
  process_terminal,
  type TerminalProcess,
  to_key,
} from "./terminal.ts";
import type { ChoPromptKey } from "./types.ts";

/** A Worker has no terminal, and its `node:readline` reads no key. */
const skip = engine() === "workerd";

/** A process whose input and output are terminals. */
function fake_process(columns?: number) {
  const calls: string[] = [];
  const written: string[] = [];
  const stdin = {
    isTTY: true,
    isRaw: false,
    setRawMode(raw: boolean) {
      this.isRaw = raw;
      calls.push(`raw ${raw}`);
    },
    resume: () => void calls.push("resume"),
    pause: () => void calls.push("pause"),
    on: () => void calls.push("on"),
    off: () => void calls.push("off"),
  };
  const stdout = {
    isTTY: true,
    ...(columns === undefined ? {} : { columns }),
    write: (text: string) => void written.push(text),
  };
  return { process: { stdin, stdout }, calls, written };
}

describe("a key, from what node:readline tells", () => {
  const key = (name: string, text = "", ctrl = false): ChoPromptKey => ({
    name,
    text,
    ctrl,
  });

  it("types its character", () => {
    assert.deepEqual(to_key("a", { name: "a" }), key("a", "a"));
    assert.deepEqual(to_key("A", { name: "a" }), key("a", "A"));
    assert.deepEqual(to_key(" ", { name: "space" }), key("space", " "));
    assert.deepEqual(to_key("-", {}), key("", "-"));
    assert.deepEqual(to_key("é", { name: undefined }), key("", "é"));
    assert.deepEqual(to_key("😀"), key("", "😀"));
  });

  it("types nothing when it is not a character", () => {
    assert.deepEqual(to_key("\r", { name: "return" }), key("return"));
    assert.deepEqual(to_key("\n", { name: "enter" }), key("enter"));
    assert.deepEqual(to_key("\x1b[A", { name: "up" }), key("up"));
    assert.deepEqual(to_key("\x7f", { name: "backspace" }), key("backspace"));
    assert.deepEqual(to_key("\t", { name: "tab" }), key("tab"));
    assert.deepEqual(to_key("\x1b", { name: "escape" }), key("escape"));
    assert.deepEqual(to_key(undefined, { name: "f1" }), key("f1"));
    assert.deepEqual(to_key(undefined), key(""));
  });

  it("types nothing with Ctrl or Alt", () => {
    assert.deepEqual(
      to_key("\x03", { name: "c", ctrl: true }),
      key("c", "", true),
    );
    assert.deepEqual(
      to_key("a", { name: "a", ctrl: true }),
      key("a", "", true),
    );
    assert.deepEqual(to_key("a", { name: "a", meta: true }), key("a"));
  });
});

describe("whether a process has a terminal", () => {
  it("has one when its input and its output are terminals", () => {
    assert.equal(is_interactive(fake_process().process), true);
  });

  it("has none when either is not, or when the input gives no single key", () => {
    const cases: TerminalProcess[] = [
      {},
      { stdin: fake_process().process.stdin },
      { stdout: fake_process().process.stdout },
    ];
    const piped_in = fake_process().process;
    piped_in.stdin.isTTY = false;
    const piped_out = fake_process().process;
    piped_out.stdout.isTTY = false;
    const { setRawMode: _, ...no_raw } = fake_process().process.stdin;
    cases.push(piped_in, piped_out, {
      stdin: no_raw,
      stdout: fake_process().process.stdout,
    });
    for (const process of cases) {
      assert.equal(is_interactive(process), false);
    }
    // Node.js and Bun say `undefined`, not `false`, for an input that is piped
    const { isTTY: __, ...undefined_tty } = fake_process().process.stdin;
    assert.equal(
      is_interactive({
        stdin: undefined_tty,
        stdout: fake_process().process.stdout,
      }),
      false,
    );
  });

  it("has none when the process cannot be read", () => {
    const broken = {
      get stdin(): never {
        throw new Error("no input");
      },
    };
    assert.equal(is_interactive(broken), false);
  });

  it("is what isInteractive() tells of the process of the runtime", async () => {
    assert.equal(typeof isInteractive(), "boolean");
    const terminal = await process_terminal();
    assert.equal(terminal.interactive, isInteractive());
    // there is one terminal: a question that is open is known to the next
    assert.equal(await process_terminal(), terminal);
  });
});

describe("the terminal of a process", () => {
  it("writes to the output of the process", () => {
    const { process, written } = fake_process();
    const terminal = make_terminal(() => process, () => undefined);
    terminal.write("? Name");
    terminal.write(" › ");
    assert.deepEqual(written, ["? Name", " › "]);
  });

  it("has the width of the output, read when it is asked: 80 with none", () => {
    const { process } = fake_process(120);
    const terminal = make_terminal(() => process, () => undefined);
    assert.equal(terminal.columns, 120);
    process.stdout.columns = 40; // the window was resized
    assert.equal(terminal.columns, 40);
    process.stdout.columns = 0;
    assert.equal(terminal.columns, 80);
    assert.equal(
      make_terminal(() => fake_process().process, () => undefined).columns,
      80,
    );
  });

  it("has colours, unless NO_COLOR is set", () => {
    const terminal = make_terminal(
      () => fake_process().process,
      () => undefined,
    );
    const deno = (globalThis as { Deno?: { noColor: boolean } }).Deno;
    if (deno) {
      // Deno reads NO_COLOR when it starts, and tells with no permission.
      assert.equal(no_color(), deno.noColor);
      assert.equal(terminal.colors, !deno.noColor);
      return;
    }
    with_env({ NO_COLOR: undefined }, () => {
      assert.equal(terminal.colors, true);
    });
    with_env({ NO_COLOR: "" }, () => {
      assert.equal(terminal.colors, true);
    });
    with_env({ NO_COLOR: "1" }, () => {
      assert.equal(terminal.colors, false);
    });
  });

  it("has no colour when the output is not a terminal", () => {
    const { process } = fake_process();
    process.stdout.isTTY = false;
    const terminal = make_terminal(() => process, () => undefined);
    with_env({ NO_COLOR: undefined }, () => {
      assert.equal(terminal.colors, false);
    });
  });

  it("is a terminal with no keyboard where there is no process", () => {
    const terminal = make_terminal(() => undefined, () => undefined);
    assert.equal(terminal.interactive, false);
    assert.equal(terminal.columns, 80);
    assert.equal(terminal.colors, false);
    terminal.write("lost"); // nothing to write to: nothing is thrown
  });

  it("reads single keys, and puts the input back as it was", {
    skip,
  }, async () => {
    const { PassThrough } = await import("node:stream");
    const readline = await import("node:readline");
    const calls: string[] = [];
    const stdin = Object.assign(new PassThrough(), {
      isTTY: true,
      isRaw: false,
      setRawMode(raw: boolean) {
        stdin.isRaw = raw;
        calls.push(`raw ${raw}`);
      },
    });
    const process = { stdin, stdout: fake_process().process.stdout };
    const terminal = make_terminal(() => process, () => readline);

    const keys: ChoPromptKey[] = [];
    const three = Promise.withResolvers<void>();
    const close = terminal.open((key) => {
      keys.push(key);
      if (keys.length === 3) {
        three.resolve();
      }
    });
    assert.deepEqual(calls, ["raw true"]);
    assert.equal(stdin.isPaused(), false);

    // the bytes a keyboard sends: the down arrow, a letter, Enter
    stdin.write("\x1b[B");
    stdin.write("a");
    stdin.write("\r");
    await three.promise;
    assert.deepEqual(keys, [
      { name: "down", text: "", ctrl: false },
      { name: "a", text: "a", ctrl: false },
      { name: "return", text: "", ctrl: false },
    ]);

    close();
    assert.deepEqual(calls, ["raw true", "raw false"]);
    assert.equal(stdin.isPaused(), true);
    assert.equal(stdin.listenerCount("keypress"), 0);
  });

  it("leaves an input in raw mode when it found it so", () => {
    const { process, calls } = fake_process();
    process.stdin.isRaw = true;
    const terminal = make_terminal(
      () => process,
      () => ({ emitKeypressEvents: () => {} }),
    );
    terminal.open(() => {})();
    assert.deepEqual(calls, [
      "on",
      "raw true",
      "resume",
      "off",
      "raw true",
      "pause",
    ]);
  });
});
