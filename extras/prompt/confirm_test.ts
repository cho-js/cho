/**
 * Tests for `confirm.ts`: the yes or no question, key by key and with no
 * terminal, and asked on a scripted terminal.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isChoError } from "@chojs/core";
import { loose } from "@chojs/core/utils/test_utils";
import { confirm_question } from "./confirm.ts";
import { play, press, shows } from "./play.ts";
import { createPrompts } from "./prompts.ts";
import { scriptedTerminal } from "./testing.ts";

/** A question with no default. */
const git = () => confirm_question({ message: "Git?" });

describe("the keys of confirm()", () => {
  it("starts on its default, or on nothing", () => {
    assert.equal(git().start().value, undefined);
    for (const value of [true, false]) {
      const question = confirm_question({ message: "Git?", default: value });
      assert.equal(question.start().value, value);
    }
  });

  it("takes yes with y and Left, and no with n and Right", () => {
    for (const key of ["y", "Y", "left"]) {
      assert.equal(play(git(), key).state.value, true, key);
      assert.equal(play(git(), "n", key).state.value, true, key);
    }
    for (const key of ["n", "N", "right"]) {
      assert.equal(play(git(), key).state.value, false, key);
      assert.equal(play(git(), "y", key).state.value, false, key);
    }
  });

  it("keeps its state for a key that changes nothing", () => {
    const question = git();
    const start = question.start();
    for (const key of ["a", "up", "down", "space", "tab", "backspace"]) {
      assert.equal(press(question, start, key).state, start, key);
    }
    const yes = press(question, start, "y").state;
    assert.equal(press(question, yes, "y").state, yes);
    assert.equal(press(question, yes, "left").state, yes);
  });

  it("answers with Enter what is taken", () => {
    assert.equal(play(git(), "y", "return").answer, true);
    assert.equal(play(git(), "n", "enter").answer, false);
    assert.equal(play(git(), "y", "n", "return").answer, false);
    const yes = confirm_question({ message: "Git?", default: true });
    assert.equal(play(yes, "return").answer, true);
    assert.equal(play(yes, "n", "return").answer, false);
  });

  it("does not answer with Enter while nothing is taken", () => {
    const question = git();
    const { state, answer } = play(question, "return");
    assert.equal(answer, undefined);
    assert.deepEqual(state, {
      value: undefined,
      mistake: "Press y for yes, or n for no",
    });
    // taking an answer clears the message
    assert.deepEqual(press(question, state, "y").state, { value: true });
  });
});

describe("what confirm() shows", () => {
  it("shows yes and no, and marks the one that is taken", () => {
    const question = git();
    const start = question.start();
    assert.deepEqual(shows(question, start), {
      lines: ["? Git? › ○ Yes / ○ No"],
    });
    assert.deepEqual(shows(question, press(question, start, "y").state).lines, [
      "? Git? › ● Yes / ○ No",
    ]);
    assert.deepEqual(shows(question, press(question, start, "n").state).lines, [
      "? Git? › ○ Yes / ● No",
    ]);
  });

  it("has no cursor: it is hidden while the question is open", () => {
    const question = git();
    assert.equal(shows(question, question.start()).cursor, undefined);
  });

  it("shows what Enter was told, under the question", () => {
    const question = git();
    assert.deepEqual(shows(question, play(question, "return").state).lines, [
      "? Git? › ○ Yes / ○ No",
      "✖ Press y for yes, or n for no",
    ]);
  });

  it("writes an answer as Yes or No", () => {
    assert.equal(git().shown(true), "Yes");
    assert.equal(git().shown(false), "No");
  });
});

describe("confirm(), asked", () => {
  it("resolves to true for yes, and leaves one line", async () => {
    const terminal = scriptedTerminal(["y", "return"]);
    const answer = await createPrompts(terminal).confirm({ message: "Git?" });
    assert.equal(answer, true);
    assert.deepEqual(terminal.screen(), ["✔ Git? · Yes"]);
    assert.deepEqual(terminal.screens, [
      ["? Git? › ○ Yes / ○ No"],
      ["? Git? › ● Yes / ○ No"],
    ]);
  });

  it("resolves to its default with Enter alone", async () => {
    const terminal = scriptedTerminal(["return"]);
    const answer = await createPrompts(terminal).confirm({
      message: "Git?",
      default: false,
    });
    assert.equal(answer, false);
    assert.deepEqual(terminal.screen(), ["✔ Git? · No"]);
  });

  it("waits for an answer when it has no default", async () => {
    const terminal = scriptedTerminal(["return", "return", "n", "return"]);
    const answer = await createPrompts(terminal).confirm({ message: "Git?" });
    assert.equal(answer, false);
    assert.deepEqual(terminal.screens, [
      ["? Git? › ○ Yes / ○ No"],
      ["? Git? › ○ Yes / ○ No", "✖ Press y for yes, or n for no"],
      ["? Git? › ○ Yes / ○ No", "✖ Press y for yes, or n for no"],
      ["? Git? › ○ Yes / ● No"],
    ]);
  });
});

describe("the options of confirm()", () => {
  const { confirm } = createPrompts(scriptedTerminal());

  it("are an object, with the text of the question", () => {
    for (const options of [undefined, null, "Git?", {}, { message: "" }]) {
      assert.throws(
        () => confirm(loose(options)),
        (error) =>
          isChoError(error, "CHO_PROMPT_INVALID_OPTION") &&
          /^confirm\(\): /.test((error as Error).message),
      );
    }
  });

  it("have a default that is a boolean", () => {
    assert.throws(
      () => confirm(loose({ message: "Git?", default: "yes" })),
      (error) =>
        isChoError(error, "CHO_PROMPT_INVALID_OPTION") &&
        /"default" must be a boolean, got/.test((error as Error).message),
    );
  });

  it("are known: an unknown one is refused, with the code of the core", () => {
    assert.throws(
      () => confirm(loose({ message: "Git?", validate: () => undefined })),
      (error) => isChoError(error, "CHO_CORE_UNKNOWN_OPTION"),
    );
  });
});
