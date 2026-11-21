/**
 * Tests for `text.ts`: the editor of a text question, key by key and with no
 * terminal, and the question asked on a scripted terminal.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isChoError } from "@chojs/core";
import { loose } from "@chojs/core/utils/test_utils";
import { play, press, shows } from "./play.ts";
import { createPrompts } from "./prompts.ts";
import { scriptedTerminal } from "./testing.ts";
import { text_question } from "./text.ts";

/** A question with no option but its message. */
const name = () => text_question({ message: "Name" });

/** What was typed, and where the cursor is. */
const typed = (state: { chars: readonly string[]; cursor: number }) =>
  [state.chars.join(""), state.cursor] as const;

describe("the editor of text()", () => {
  it("starts empty, and types where the cursor is", () => {
    const question = name();
    assert.deepEqual(typed(question.start()), ["", 0]);
    assert.deepEqual(typed(play(question, "ab").state), ["ab", 2]);
    assert.deepEqual(typed(play(question, "ab", "left", "X").state), [
      "aXb",
      2,
    ]);
  });

  it("types a space, and what a key sends at once", () => {
    const question = name();
    assert.deepEqual(typed(play(question, "a", "space", "b").state), [
      "a b",
      3,
    ]);
    // a paste, or a keyboard that composes
    const pasted = { name: "", text: "my-app", ctrl: false };
    assert.deepEqual(typed(play(question, "<>", "left", pasted).state), [
      "<my-app>",
      7,
    ]);
  });

  it("counts a character once, whatever it takes to store it", () => {
    const question = name();
    const { state } = play(question, "é😀日");
    assert.deepEqual(typed(state), ["é😀日", 3]);
    assert.deepEqual(typed(press(question, state, "backspace").state), [
      "é😀",
      2,
    ]);
  });

  it("erases before the cursor with Backspace, and under it with Delete", () => {
    const question = name();
    const { state } = play(question, "abcd", "left", "left");
    assert.deepEqual(typed(press(question, state, "backspace").state), [
      "acd",
      1,
    ]);
    assert.deepEqual(typed(press(question, state, "delete").state), [
      "abd",
      2,
    ]);
    assert.deepEqual(typed(press(question, state, "ctrl+d").state), [
      "abd",
      2,
    ]);
  });

  it("moves the cursor, and keeps it inside the text", () => {
    const question = name();
    const { state } = play(question, "abc");
    assert.equal(press(question, state, "left").state.cursor, 2);
    assert.equal(press(question, state, "left", "right").state.cursor, 3);
    assert.equal(press(question, state, "home").state.cursor, 0);
    assert.equal(press(question, state, "ctrl+a").state.cursor, 0);
    assert.equal(press(question, state, "home", "end").state.cursor, 3);
    assert.equal(press(question, state, "home", "ctrl+e").state.cursor, 3);
    assert.equal(press(question, state, "home", "left").state.cursor, 0);
  });

  it("erases what is before the cursor with Ctrl+U", () => {
    const question = name();
    assert.deepEqual(
      typed(play(question, "abcd", "left", "ctrl+u").state),
      ["d", 0],
    );
  });

  it("keeps its state for a key that changes nothing", () => {
    const question = name();
    const { state } = play(question, "ab");
    for (const key of ["right", "end", "delete", "up", "down", "tab"]) {
      assert.equal(press(question, state, key).state, state, key);
    }
    const start = question.start();
    for (const key of ["backspace", "left", "home", "ctrl+u", "escape"]) {
      assert.equal(press(question, start, key).state, start, key);
    }
  });

  it("answers with Enter: what was typed, as it was typed", () => {
    assert.equal(play(name(), " my app ", "return").answer, " my app ");
    assert.equal(play(name(), "a", "enter").answer, "a");
  });

  it("answers an empty line with the default, or with an empty text", () => {
    assert.equal(play(name(), "return").answer, "");
    const question = text_question({ message: "Name", default: "app" });
    assert.equal(play(question, "return").answer, "app");
    assert.equal(play(question, "x", "backspace", "return").answer, "app");
    assert.equal(play(question, "x", "return").answer, "x");
  });

  it("cancels with Ctrl+D on an empty line only", () => {
    assert.equal(play(name(), "ctrl+d").cancel, true);
    assert.equal(play(name(), "a", "ctrl+d").cancel, undefined);
  });
});

describe("what text() shows", () => {
  it("shows the question, what was typed, and the cursor in it", () => {
    const question = name();
    assert.deepEqual(shows(question, question.start()), {
      lines: ["? Name ›"],
      cursor: { line: 0, column: 9 },
    });
    assert.deepEqual(shows(question, play(question, "abc", "left").state), {
      lines: ["? Name › abc"],
      cursor: { line: 0, column: 11 },
    });
  });

  it("leaves a column for the cursor after the text", () => {
    const question = name();
    const [line] = question.frame(play(question, "abc").state, {
      colors: false,
      accent: (text) => text,
      good: (text) => text,
      bad: (text) => text,
      dim: (text) => text,
      bold: (text) => text,
    }).lines;
    assert.equal(line, "? Name › abc ");
  });

  it("shows the default of an empty line between brackets", () => {
    const question = text_question({
      message: "Name",
      default: "app",
      placeholder: "my-app",
    });
    assert.deepEqual(shows(question, question.start()), {
      lines: ["? Name › (app)"],
      cursor: { line: 0, column: 9 },
    });
    assert.deepEqual(shows(question, play(question, "x").state).lines, [
      "? Name › x",
    ]);
  });

  it("shows the placeholder on a terminal with colours, and not without", () => {
    const question = text_question({ message: "Name", placeholder: "my-app" });
    const start = question.start();
    assert.deepEqual(shows(question, start, true).lines, ["? Name › my-app"]);
    assert.deepEqual(shows(question, start, false).lines, ["? Name ›"]);
    assert.equal(play(question, "return").answer, "");
  });

  it("shows a mistake under the question, until the text changes", () => {
    const question = name();
    const refused = question.refuse!(play(question, "A").state, "Lower case");
    assert.deepEqual(shows(question, refused).lines, [
      "? Name › A",
      "✖ Lower case",
    ]);
    assert.deepEqual(shows(question, press(question, refused, "left").state), {
      lines: ["? Name › A", "✖ Lower case"],
      cursor: { line: 0, column: 9 },
    });
    assert.deepEqual(
      shows(question, press(question, refused, "b").state).lines,
      ["? Name › Ab"],
    );
  });

  it("writes an answer as it is", () => {
    assert.equal(name().shown("my-app"), "my-app");
  });
});

describe("text(), asked", () => {
  it("resolves to the answer, and leaves one line", async () => {
    const terminal = scriptedTerminal(["my-app", "return"]);
    const answer = await createPrompts(terminal).text({ message: "Name" });
    assert.equal(answer, "my-app");
    assert.deepEqual(terminal.screen(), ["✔ Name · my-app"]);
    assert.deepEqual(terminal.screens, [
      ["? Name ›"],
      ["? Name › m"],
      ["? Name › my"],
      ["? Name › my-"],
      ["? Name › my-a"],
      ["? Name › my-ap"],
      ["? Name › my-app"],
    ]);
  });

  it("keeps the question open while validate finds a mistake", async () => {
    const seen: string[] = [];
    const terminal = scriptedTerminal(["App", "return", "home", "delete", "a"]);
    const asked = createPrompts(terminal).text({
      message: "Name",
      validate(value) {
        seen.push(value);
        return /^[a-z]/.test(value) ? undefined : "Start with a lower case";
      },
    });
    // the keys end with the question open: it is cancelled
    await assert.rejects(
      asked,
      (error) => isChoError(error, "CHO_PROMPT_CANCELLED"),
    );
    assert.deepEqual(seen, ["App"]);
    assert.deepEqual(terminal.screens.slice(3), [
      ["? Name › App"],
      ["? Name › App", "✖ Start with a lower case"],
      ["? Name › App", "✖ Start with a lower case"],
      ["? Name › pp"],
      ["? Name › app"],
    ]);
  });

  it("takes the answer once validate accepts it: now, or later", async () => {
    const terminal = scriptedTerminal([
      "A",
      "return",
      "backspace",
      "a",
      "return",
    ]);
    const answer = await createPrompts(terminal).text({
      message: "Name",
      validate: (value) =>
        Promise.resolve(value === "a" ? undefined : "Not this one"),
    });
    assert.equal(answer, "a");
    assert.deepEqual(terminal.screen(), ["✔ Name · a"]);
  });

  it("takes an answer for which validate returns no text", async () => {
    for (const result of [undefined, "", null, false, 0]) {
      const terminal = scriptedTerminal(["a", "return"]);
      const answer = await createPrompts(terminal).text({
        message: "Name",
        validate: () => loose(result),
      });
      assert.equal(answer, "a", String(result));
    }
  });

  it("validates the default of an empty line too", async () => {
    const seen: string[] = [];
    const terminal = scriptedTerminal(["return"]);
    const answer = await createPrompts(terminal).text({
      message: "Name",
      default: "app",
      validate: (value) => void seen.push(value),
    });
    assert.equal(answer, "app");
    assert.deepEqual(seen, ["app"]);
    assert.deepEqual(terminal.screen(), ["✔ Name · app"]);
  });

  it("rejects with what validate throws, and puts the terminal back", async () => {
    const broken = new Error("the disk is gone");
    const terminal = scriptedTerminal(["a", "return", "b"]);
    await assert.rejects(
      createPrompts(terminal).text({
        message: "Name",
        validate() {
          throw broken;
        },
      }),
      (error) => error === broken,
    );
    assert.equal(terminal.reading, false);
    assert.equal(terminal.cursor.hidden, false);
    // the question stays as it was, and the next output starts under it
    assert.deepEqual(terminal.screen(), ["? Name › a"]);
    assert.deepEqual(terminal.cursor, { row: 1, column: 0, hidden: false });
    assert.equal(terminal.left, 1);
  });
});

describe("the options of text()", () => {
  const { text } = createPrompts(scriptedTerminal());
  const invalid = (options: unknown, pattern: RegExp) =>
    assert.throws(
      () => text(loose(options)),
      (error) =>
        isChoError(error, "CHO_PROMPT_INVALID_OPTION") &&
        pattern.test((error as Error).message),
    );

  it("are an object, with the text of the question", () => {
    invalid(undefined, /text\(\): expected options/);
    invalid("Name", /text\(\): expected options/);
    invalid({}, /"message" must be the text of the question/);
    invalid({ message: "  " }, /"message" must be the text of the question/);
    invalid({ message: 3 }, /"message" must be the text of the question/);
  });

  it("have the types they must have", () => {
    invalid({ message: "Name", default: 3 }, /"default" must be a string/);
    invalid(
      { message: "Name", placeholder: true },
      /"placeholder" must be a string/,
    );
    invalid(
      { message: "Name", validate: /^a/ },
      /"validate" must be a function/,
    );
  });

  it("are known: an unknown one is refused, with the code of the core", () => {
    assert.throws(
      () => text(loose({ message: "Name", initial: "x" })),
      (error) => isChoError(error, "CHO_CORE_UNKNOWN_OPTION"),
    );
  });
});
