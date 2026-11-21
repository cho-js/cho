/**
 * Tests for `run.ts`: a question on a terminal, from its first drawing to
 * its last line. The terminal is the scripted one, which reads the escape
 * codes on a screen of its own: the tests compare what a user would see.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isChoError } from "@chojs/core";
import { createPrompts } from "./prompts.ts";
import { CODES } from "./style.ts";
import { scriptedTerminal } from "./testing.ts";

/** Whether a text has the escape code of a colour. */
// deno-lint-ignore no-control-regex
const COLOUR = /\x1b\[[0-9;]*m/;

describe("a question on a terminal", () => {
  it("leaves each answered question on a line, one under the other", async () => {
    const terminal = scriptedTerminal([
      "my-app",
      "return",
      "down",
      "return",
      "y",
      "return",
    ]);
    const { text, select, confirm } = createPrompts(terminal);
    assert.equal(await text({ message: "Name" }), "my-app");
    assert.equal(
      await select({
        message: "Kind",
        choices: [{ value: "web" }, { value: "cli" }],
      }),
      "cli",
    );
    assert.equal(await confirm({ message: "Git?" }), true);
    assert.deepEqual(terminal.screen(), [
      "✔ Name · my-app",
      "✔ Kind · cli",
      "✔ Git? · Yes",
    ]);
    // the next output starts on a line of its own
    assert.deepEqual(terminal.cursor, { row: 3, column: 0, hidden: false });
    assert.equal(terminal.left, 0);
    assert.equal(terminal.reading, false);
  });

  it("takes the keys it needs, and leaves the others to the next one", async () => {
    const terminal = scriptedTerminal(["a", "return", "b", "return"]);
    const { text } = createPrompts(terminal);
    assert.equal(await text({ message: "First" }), "a");
    assert.equal(terminal.left, 2);
    assert.equal(await text({ message: "Second" }), "b");
  });

  it("draws a list again in place, with nothing left of the one before", async () => {
    const terminal = scriptedTerminal(["down", "down", "up", "return"]);
    await createPrompts(terminal).select({
      message: "Kind",
      choices: [{ value: "web" }, { value: "cli" }, { value: "worker" }],
    });
    assert.deepEqual(terminal.screens, [
      ["? Kind", "❯ web", "  cli", "  worker"],
      ["? Kind", "  web", "❯ cli", "  worker"],
      ["? Kind", "  web", "  cli", "❯ worker"],
      ["? Kind", "  web", "❯ cli", "  worker"],
    ]);
    assert.deepEqual(terminal.screen(), ["✔ Kind · cli"]);
  });

  it("writes nothing for a key that changes nothing", async () => {
    const terminal = scriptedTerminal(["x", "left", "return"]);
    await createPrompts(terminal).select({
      message: "Kind",
      choices: [{ value: "web" }, { value: "cli" }],
    });
    // the first drawing, and the last line
    assert.equal(terminal.written.length, 2);
  });
});

describe("the cursor of a question", () => {
  it("is hidden while a list is shown, and shown again after", async () => {
    const terminal = scriptedTerminal(["down", "return"]);
    await createPrompts(terminal).select({
      message: "Kind",
      choices: [{ value: "web" }, { value: "cli" }],
    });
    assert.equal(terminal.written[0]!.startsWith(CODES.hide), true);
    assert.equal(terminal.written.at(-1)!.endsWith(CODES.show), true);
    assert.equal(
      terminal.written.slice(1, -1).some((text) => text.includes(CODES.hide)),
      false,
    );
    assert.equal(terminal.cursor.hidden, false);
  });

  it("is where the next character goes, in a text", async () => {
    const seen: unknown[] = [];
    const terminal = scriptedTerminal(["abc", "left", "left", "return"]);
    await createPrompts(terminal).text({
      message: "Name",
      // called with the question open: the screen is the one of the answer
      validate: () => void seen.push(terminal.cursor),
    });
    // "? Name › " takes nine columns, and one character is before the cursor
    assert.deepEqual(seen, [{ row: 0, column: 10, hidden: false }]);
    assert.equal(
      terminal.written.some((text) => text.includes(CODES.hide)),
      false,
    );
  });

  it("is shown again after a question that hid it was cancelled", async () => {
    const terminal = scriptedTerminal(["ctrl+c"]);
    await assert.rejects(
      createPrompts(terminal).confirm({ message: "Git?" }),
    );
    assert.equal(terminal.cursor.hidden, false);
  });
});

describe("a line longer than the terminal", () => {
  it("is counted by its rows: a list is drawn again from its first row", async () => {
    const terminal = scriptedTerminal(["down", "up", "down", "return"], {
      columns: 12,
    });
    const answer = await createPrompts(terminal).select({
      message: "What are you building?",
      choices: [
        { value: "web", label: "A web application" },
        { value: "cli" },
      ],
    });
    assert.equal(answer, "cli");
    const opened = [
      "? What are y",
      "ou building?",
      "❯ A web appl",
      "ication",
      "  cli",
    ];
    const moved = [
      "? What are y",
      "ou building?",
      "  A web appl",
      "ication",
      "❯ cli",
    ];
    assert.deepEqual(terminal.screens, [opened, moved, opened, moved]);
    assert.deepEqual(terminal.screen(), [
      "✔ What are y",
      "ou building?",
      " · cli",
    ]);
  });

  it("keeps the cursor of a text in the row it is on", async () => {
    const seen: unknown[] = [];
    // "? N › " takes six columns of ten
    const terminal = scriptedTerminal(
      ["abcdef", "return", "left", "left", "left", "return"],
      { columns: 10 },
    );
    const refused: string[] = [];
    await createPrompts(terminal).text({
      message: "N",
      validate(value) {
        seen.push(terminal.cursor);
        if (refused.length === 0) {
          refused.push(value);
          return "No";
        }
      },
    });
    assert.deepEqual(seen, [
      // after the sixth character: the third column of the second row
      { row: 1, column: 2, hidden: false },
      // three characters back: the last column of the first row
      { row: 0, column: 9, hidden: false },
    ]);
    assert.deepEqual(terminal.screens.at(-1), ["? N › abcd", "ef", "✖ No"]);
    assert.deepEqual(terminal.screen(), ["✔ N · abcd", "ef"]);
  });

  it("gives the cursor a row when the text fills the last column", async () => {
    const seen: unknown[] = [];
    const terminal = scriptedTerminal(["abcd", "return"], { columns: 10 });
    await createPrompts(terminal).text({
      message: "N",
      validate: () => void seen.push(terminal.cursor),
    });
    assert.deepEqual(seen, [{ row: 1, column: 0, hidden: false }]);
    assert.deepEqual(terminal.screen(), ["✔ N · abcd"]);
  });
});

describe("the colours of a question", () => {
  it("are written to a terminal that shows them", async () => {
    const terminal = scriptedTerminal(["a", "return"], { colors: true });
    await createPrompts(terminal).text({ message: "Name" });
    assert.match(terminal.written.join(""), COLOUR);
    // the screen keeps the text alone
    assert.deepEqual(terminal.screen(), ["✔ Name · a"]);
  });

  it("are not written to a terminal that does not", async () => {
    const terminal = scriptedTerminal(["a", "return", "down", "return"]);
    const { text, select } = createPrompts(terminal);
    await text({ message: "Name" });
    await select({ message: "Kind", choices: [{ value: 1 }, { value: 2 }] });
    assert.doesNotMatch(terminal.written.join(""), COLOUR);
  });

  it("change no text: the screen is the same with and without", async () => {
    const screens = [];
    for (const colors of [true, false]) {
      const terminal = scriptedTerminal(
        ["return", "n", "return", "down", "return"],
        { colors },
      );
      const { confirm, select } = createPrompts(terminal);
      await confirm({ message: "Git?" });
      await select({
        message: "Kind",
        choices: [{ value: "web", hint: "HTTP" }, { value: "cli" }],
      });
      screens.push(terminal.screens);
    }
    assert.deepEqual(screens[0], screens[1]);
  });
});

describe("cancelling a question", () => {
  it("rejects with CHO_PROMPT_CANCELLED, for Ctrl+C", async () => {
    for (
      const asked of [
        (terminal = scriptedTerminal(["ab", "ctrl+c", "x"])) =>
          [
            terminal,
            createPrompts(terminal).text({ message: "Name" }),
          ] as const,
        (terminal = scriptedTerminal(["y", "ctrl+c", "x"])) =>
          [
            terminal,
            createPrompts(terminal).confirm({ message: "Name" }),
          ] as const,
        (terminal = scriptedTerminal(["down", "ctrl+c", "x"])) =>
          [
            terminal,
            createPrompts(terminal).select({
              message: "Name",
              choices: [{ value: 1 }, { value: 2 }],
            }),
          ] as const,
      ]
    ) {
      const [terminal, answer] = asked();
      await assert.rejects(
        answer,
        (error) =>
          isChoError(error, "CHO_PROMPT_CANCELLED") &&
          /\(\): "Name" was cancelled$/.test((error as Error).message),
      );
      assert.deepEqual(terminal.screen(), ["✖ Name"]);
      assert.deepEqual(terminal.cursor, { row: 1, column: 0, hidden: false });
      assert.equal(terminal.reading, false);
      // the key after Ctrl+C was not taken
      assert.equal(terminal.left, 1);
    }
  });

  it("rejects for Ctrl+D on an empty text", async () => {
    const terminal = scriptedTerminal(["ctrl+d"]);
    await assert.rejects(
      createPrompts(terminal).text({ message: "Name" }),
      (error) => isChoError(error, "CHO_PROMPT_CANCELLED"),
    );
    assert.deepEqual(terminal.screen(), ["✖ Name"]);
  });

  it("leaves the terminal ready for the next question", async () => {
    const terminal = scriptedTerminal(["ctrl+c", "b", "return"]);
    const { text } = createPrompts(terminal);
    await assert.rejects(text({ message: "First" }));
    assert.equal(await text({ message: "Second" }), "b");
    assert.deepEqual(terminal.screen(), ["✖ First", "✔ Second · b"]);
  });
});

describe("a question that cannot be asked", () => {
  it("rejects with CHO_PROMPT_NO_TERMINAL when nobody can answer", async () => {
    const terminal = scriptedTerminal(["a", "return"], { interactive: false });
    const { text, confirm, select } = createPrompts(terminal);
    for (
      const [answer, caller] of [
        [text({ message: "Name" }), "text"],
        [confirm({ message: "Name" }), "confirm"],
        [select({ message: "Name", choices: [{ value: 1 }] }), "select"],
      ] as const
    ) {
      await assert.rejects(
        answer,
        (error) =>
          isChoError(error, "CHO_PROMPT_NO_TERMINAL") &&
          (error as Error).message.startsWith(
            `${caller}(): "Name" cannot be asked: there is no terminal`,
          ),
      );
    }
    // nothing was drawn, and no key was taken
    assert.deepEqual(terminal.written, []);
    assert.equal(terminal.left, 2);
  });

  it("rejects with CHO_PROMPT_BUSY while another question is open", async () => {
    const terminal = scriptedTerminal(["a", "return"]);
    const { text, confirm } = createPrompts(terminal);
    const first = text({ message: "First" });
    await assert.rejects(
      confirm({ message: "Second" }),
      (error) =>
        isChoError(error, "CHO_PROMPT_BUSY") &&
        /confirm\(\): "Second" cannot be asked while another question is open/
          .test((error as Error).message),
    );
    // the open question is not disturbed
    assert.equal(await first, "a");
    assert.deepEqual(terminal.screen(), ["✔ First · a"]);
  });

  it("is asked once the other one ended", async () => {
    const terminal = scriptedTerminal(["a", "return", "y", "return"]);
    const { text, confirm } = createPrompts(terminal);
    await text({ message: "First" });
    assert.equal(await confirm({ message: "Second" }), true);
  });

  it("checks its options first: a mistake in them is thrown as it is", () => {
    const terminal = scriptedTerminal([], { interactive: false });
    assert.throws(
      () => createPrompts(terminal).text({ message: "" }),
      (error) => isChoError(error, "CHO_PROMPT_INVALID_OPTION"),
    );
  });
});
