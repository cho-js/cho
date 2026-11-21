/**
 * Tests for `testing.ts`: the scripted terminal, its keys and its screen.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isChoError } from "@chojs/core";
import { createPrompts } from "./prompts.ts";
import { keys_of, scriptedTerminal } from "./testing.ts";

describe("the keys of a script", () => {
  it("are named keys, which type nothing but the space", () => {
    for (
      const name of [
        "return",
        "enter",
        "up",
        "down",
        "left",
        "right",
        "backspace",
        "delete",
        "home",
        "end",
        "tab",
        "escape",
      ]
    ) {
      assert.deepEqual(keys_of(name), [{ name, text: "", ctrl: false }]);
    }
    assert.deepEqual(keys_of("space"), [
      { name: "space", text: " ", ctrl: false },
    ]);
  });

  it("are letters with Ctrl", () => {
    assert.deepEqual(keys_of("ctrl+c"), [{ name: "c", text: "", ctrl: true }]);
    assert.deepEqual(keys_of("ctrl+u"), [{ name: "u", text: "", ctrl: true }]);
  });

  it("are a text to type, a key for each character", () => {
    assert.deepEqual(keys_of("a-B é"), [
      { name: "a", text: "a", ctrl: false },
      { name: "", text: "-", ctrl: false },
      { name: "b", text: "B", ctrl: false },
      { name: "", text: " ", ctrl: false },
      { name: "", text: "é", ctrl: false },
    ]);
    assert.equal(keys_of("😀").length, 1);
    assert.deepEqual(keys_of(""), []);
  });

  it("are keys, taken as they are", () => {
    const key = { name: "f1", text: "", ctrl: false };
    assert.deepEqual(keys_of(key), [key]);
  });

  it("type a word that is the name of a key, given by its characters", async () => {
    const terminal = scriptedTerminal([..."home", "return"]);
    const answer = await createPrompts(terminal).text({ message: "Folder" });
    assert.equal(answer, "home");
  });
});

describe("the screen of a scripted terminal", () => {
  it("shows what is written, a line for each row", () => {
    const terminal = scriptedTerminal();
    terminal.write("one\r\ntwo");
    assert.deepEqual(terminal.screen(), ["one", "two"]);
    assert.deepEqual(terminal.cursor, { row: 1, column: 3, hidden: false });
    assert.deepEqual(terminal.written, ["one\r\ntwo"]);
  });

  it("moves the cursor, and writes over what is there", () => {
    const terminal = scriptedTerminal();
    terminal.write("abcdef\r\nsecond");
    terminal.write("\r\x1b[1A\x1b[2CXY");
    assert.deepEqual(terminal.screen(), ["abXYef", "second"]);
    assert.deepEqual(terminal.cursor, { row: 0, column: 4, hidden: false });
  });

  it("erases from the cursor to the end of the screen", () => {
    const terminal = scriptedTerminal();
    terminal.write("abcdef\r\nsecond\r\nthird");
    terminal.write("\r\x1b[2A\x1b[3C\x1b[J");
    assert.deepEqual(terminal.screen(), ["abc"]);
  });

  it("goes to the next row after the last column", () => {
    const terminal = scriptedTerminal([], { columns: 4 });
    terminal.write("abcd");
    // the last column is written, and the cursor waits on it
    assert.deepEqual(terminal.cursor, { row: 0, column: 3, hidden: false });
    terminal.write("ef");
    assert.deepEqual(terminal.screen(), ["abcd", "ef"]);
    assert.deepEqual(terminal.cursor, { row: 1, column: 2, hidden: false });
  });

  it("keeps the text alone: no colour, no space at the end of a line", () => {
    const terminal = scriptedTerminal();
    terminal.write("\x1b[36m?\x1b[39m \x1b[1mName\x1b[22m   \r\n\r\n");
    assert.deepEqual(terminal.screen(), ["? Name"]);
  });

  it("hides and shows the cursor", () => {
    const terminal = scriptedTerminal();
    terminal.write("\x1b[?25l");
    assert.equal(terminal.cursor.hidden, true);
    terminal.write("\x1b[?25h");
    assert.equal(terminal.cursor.hidden, false);
  });
});

describe("a scripted terminal", () => {
  it("is interactive, 80 columns wide and with no colour, by default", () => {
    const terminal = scriptedTerminal();
    assert.equal(terminal.interactive, true);
    assert.equal(terminal.columns, 80);
    assert.equal(terminal.colors, false);
    assert.equal(terminal.reading, false);
    assert.equal(terminal.left, 0);
    assert.deepEqual(terminal.screen(), []);
  });

  it("takes its width, its colours and its keyboard from its options", () => {
    const terminal = scriptedTerminal([], {
      columns: 20,
      colors: true,
      interactive: false,
    });
    assert.equal(terminal.interactive, false);
    assert.equal(terminal.columns, 20);
    assert.equal(terminal.colors, true);
  });

  it("counts the keys that are left, a key for each character", () => {
    assert.equal(scriptedTerminal(["abc", "return", "ctrl+c"]).left, 5);
  });

  it("keeps the screen when a question opens, and after each key", async () => {
    const terminal = scriptedTerminal(["n", "y", "return", "return"]);
    const { confirm } = createPrompts(terminal);
    await confirm({ message: "One?" });
    await confirm({ message: "Two?", default: false });
    assert.deepEqual(terminal.screens, [
      ["? One? › ○ Yes / ○ No"],
      ["? One? › ○ Yes / ● No"],
      ["? One? › ● Yes / ○ No"],
      // the key that answered is seen when the next question opens
      ["✔ One? · Yes", "? Two? › ○ Yes / ● No"],
    ]);
    assert.deepEqual(terminal.screen(), ["✔ One? · Yes", "✔ Two? · No"]);
  });

  it("is reading while a question is open, and not after", async () => {
    const terminal = scriptedTerminal(["return"]);
    const seen: boolean[] = [];
    await createPrompts(terminal).text({
      message: "Name",
      validate: () => void seen.push(terminal.reading),
    });
    assert.deepEqual(seen, [true]);
    assert.equal(terminal.reading, false);
  });

  it("cancels a question that is open when its keys end", async () => {
    const terminal = scriptedTerminal(["abc"]);
    await assert.rejects(
      createPrompts(terminal).text({ message: "Name" }),
      (error) => isChoError(error, "CHO_PROMPT_CANCELLED"),
    );
    assert.deepEqual(terminal.screen(), ["✖ Name"]);
    assert.equal(terminal.reading, false);
  });

  it("cancels at once a question asked with no key", async () => {
    const terminal = scriptedTerminal();
    const { select } = createPrompts(terminal);
    await assert.rejects(
      select({ message: "Kind", choices: [{ value: 1 }] }),
      (error) => isChoError(error, "CHO_PROMPT_CANCELLED"),
    );
    await assert.rejects(
      select({ message: "Again", choices: [{ value: 1 }] }),
      (error) => isChoError(error, "CHO_PROMPT_CANCELLED"),
    );
    assert.deepEqual(terminal.screen(), ["✖ Kind", "✖ Again"]);
  });
});
