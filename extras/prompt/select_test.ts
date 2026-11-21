/**
 * Tests for `select.ts`: the choice question, key by key and with no
 * terminal, and asked on a scripted terminal.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isChoError } from "@chojs/core";
import { loose } from "@chojs/core/utils/test_utils";
import { play, press, shows } from "./play.ts";
import { createPrompts } from "./prompts.ts";
import { select_question } from "./select.ts";
import { scriptedTerminal } from "./testing.ts";

/** Three choices: a label, a hint, and neither. */
const kind = (start?: "web" | "cli" | "worker") =>
  select_question({
    message: "Kind",
    choices: [
      { value: "web", label: "A web application", hint: "HTTP routes" },
      { value: "cli", label: "A command-line tool" },
      { value: "worker" },
    ],
    ...(start === undefined ? {} : { default: start }),
  });

describe("the keys of select()", () => {
  it("starts on the first choice, or on its default", () => {
    assert.equal(kind().start().index, 0);
    assert.equal(kind("cli").start().index, 1);
    assert.equal(kind("worker").start().index, 2);
  });

  it("moves down with Down and j, and up with Up and k", () => {
    for (const key of ["down", "j"]) {
      assert.equal(play(kind(), key).state.index, 1, key);
      assert.equal(play(kind(), key, key).state.index, 2, key);
    }
    for (const key of ["up", "k"]) {
      assert.equal(play(kind("worker"), key).state.index, 1, key);
      assert.equal(play(kind("worker"), key, key).state.index, 0, key);
    }
  });

  it("goes around the ends of the list", () => {
    assert.equal(play(kind(), "up").state.index, 2);
    assert.equal(play(kind("worker"), "down").state.index, 0);
  });

  it("keeps its state for a key that changes nothing", () => {
    const question = kind();
    const start = question.start();
    for (const key of ["a", "left", "right", "space", "tab", "J", "K"]) {
      assert.equal(press(question, start, key).state, start, key);
    }
    // a list of one choice has nowhere to go
    const one = select_question({ message: "Kind", choices: [{ value: 1 }] });
    const only = one.start();
    assert.equal(press(one, only, "down").state, only);
    assert.equal(press(one, only, "up").state, only);
  });

  it("answers with Enter the value the pointer is on", () => {
    assert.equal(play(kind(), "return").answer, "web");
    assert.equal(play(kind(), "down", "enter").answer, "cli");
    assert.equal(play(kind("cli"), "down", "return").answer, "worker");
  });

  it("answers with a value of any type, the same one", () => {
    const settings = { port: 80 };
    // Values of several types: the type of the answer is given.
    const question = select_question<number | boolean | object>({
      message: "Which",
      choices: [
        { value: 3 },
        { value: false, label: "Off" },
        { value: settings, label: "Custom" },
        { value: NaN, label: "Unknown" },
      ],
      default: NaN,
    });
    assert.equal(question.start().index, 3);
    assert.equal(question.shown(NaN), "Unknown");
    assert.equal(play(question, "up", "return").answer, settings);
    assert.equal(play(question, "down", "down", "return").answer, false);
  });
});

describe("what select() shows", () => {
  it("shows the question, and each choice on a line of its own", () => {
    const question = kind();
    assert.deepEqual(shows(question, question.start()), {
      lines: [
        "? Kind",
        "❯ A web application (HTTP routes)",
        "  A command-line tool",
        "  worker",
      ],
    });
  });

  it("puts the pointer before the choice it is on", () => {
    const question = kind();
    assert.deepEqual(shows(question, play(question, "down").state).lines, [
      "? Kind",
      "  A web application (HTTP routes)",
      "❯ A command-line tool",
      "  worker",
    ]);
  });

  it("writes a value with no label as a string", () => {
    const question = select_question<unknown>({
      message: "Port",
      choices: [{ value: 80 }, { value: true }, { value: null }],
    });
    assert.deepEqual(shows(question, question.start()).lines, [
      "? Port",
      "❯ 80",
      "  true",
      "  null",
    ]);
  });

  it("writes an answer as the label of its choice", () => {
    assert.equal(kind().shown("web"), "A web application");
    assert.equal(kind().shown("worker"), "worker");
  });
});

describe("select(), asked", () => {
  it("resolves to the value of the choice, and leaves one line", async () => {
    const terminal = scriptedTerminal(["down", "return"]);
    const answer = await createPrompts(terminal).select({
      message: "Kind",
      choices: [
        { value: "web", label: "A web application" },
        { value: "cli", label: "A command-line tool" },
      ],
    });
    // The type of the answer is the values of the choices.
    const typed: "web" | "cli" = answer;
    assert.equal(typed, "cli");
    assert.deepEqual(terminal.screen(), ["✔ Kind · A command-line tool"]);
    assert.deepEqual(terminal.screens, [
      ["? Kind", "❯ A web application", "  A command-line tool"],
      ["? Kind", "  A web application", "❯ A command-line tool"],
    ]);
  });

  it("starts on its default", async () => {
    const terminal = scriptedTerminal(["return"]);
    const answer = await createPrompts(terminal).select({
      message: "Port",
      choices: [{ value: 80 }, { value: 443 }],
      default: 443,
    });
    assert.equal(answer, 443);
    assert.deepEqual(terminal.screens, [["? Port", "  80", "❯ 443"]]);
  });
});

describe("the options of select()", () => {
  const { select } = createPrompts(scriptedTerminal());
  const invalid = (options: unknown, pattern: RegExp) =>
    assert.throws(
      () => select(loose(options)),
      (error) =>
        isChoError(error, "CHO_PROMPT_INVALID_OPTION") &&
        pattern.test((error as Error).message),
    );

  it("are an object, with the text of the question", () => {
    invalid(undefined, /select\(\): expected options/);
    invalid({ choices: [{ value: 1 }] }, /"message" must be the text/);
  });

  it("have one choice at least", () => {
    invalid({ message: "Kind" }, /"choices" must be a list of one choice/);
    invalid({ message: "Kind", choices: [] }, /"choices" must be a list/);
    invalid({ message: "Kind", choices: "web" }, /"choices" must be a list/);
  });

  it("have choices that are objects with a value", () => {
    invalid(
      { message: "Kind", choices: [{ value: "web" }, "cli"] },
      /choice 1 must be an object with a "value"/,
    );
    invalid(
      { message: "Kind", choices: [{ label: "Web" }] },
      /choice 0 must be an object with a "value"/,
    );
    invalid(
      { message: "Kind", choices: [{ value: "web", label: 3 }] },
      /the "label" of choice 0 must be a string/,
    );
    invalid(
      { message: "Kind", choices: [{ value: 1 }, { value: 2, hint: true }] },
      /the "hint" of choice 1 must be a string/,
    );
  });

  it("have no two choices of one value", () => {
    invalid(
      { message: "Kind", choices: [{ value: "web" }, { value: "web" }] },
      /two choices have the value/,
    );
  });

  it("have a default that is the value of a choice", () => {
    invalid(
      { message: "Kind", choices: [{ value: "web" }], default: "cli" },
      /"default" must be the value of a choice/,
    );
  });

  it("are known: an unknown one is refused, with the code of the core", () => {
    assert.throws(
      () => select(loose({ message: "Kind", choices: [{ value: 1 }], max: 3 })),
      (error) => isChoError(error, "CHO_CORE_UNKNOWN_OPTION"),
    );
  });
});
