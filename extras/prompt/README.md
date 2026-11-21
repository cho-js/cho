# @chojs/prompt

[![JSR](https://jsr.io/badges/@chojs/prompt)](https://jsr.io/@chojs/prompt)
[![JSR score](https://jsr.io/badges/@chojs/prompt/score)](https://jsr.io/@chojs/prompt)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

Questions in a terminal: a text, a yes or no, a choice of a list. A question is
a function that resolves to its answer.

It runs on Deno, Node.js and Bun, on what the three have in common: `process`
and `node:readline`. **It has no dependency** but `@chojs/core`.

```console
✔ Project name · shop
? What are you building?
  A web application (@chojs/web)
❯ A command-line tool (@chojs/command)
  A message worker (@chojs/message)
```

## Contents

- [Installation](#installation)
- [The three questions](#the-three-questions)
  - [`text`](#text)
  - [`select`](#select)
  - [`confirm`](#confirm)
- [Cancelling](#cancelling)
- [Without a terminal](#without-a-terminal)
- [In an application, and in its tests](#in-an-application-and-in-its-tests)
- [Colours](#colours)
- [Errors](#errors)
- [Runtime support](#runtime-support)
- [Documentation](#documentation)

## Installation

```sh
deno add jsr:@chojs/prompt    # Deno
npx jsr add @chojs/prompt     # Node.js
bunx jsr add @chojs/prompt    # Bun
```

## The three questions

```ts
import { confirm, select, text } from "@chojs/prompt";

const name = await text({ message: "Project name", default: "my-app" });

const kind = await select({
  message: "What are you building?",
  choices: [
    { value: "web", label: "A web application" },
    { value: "cli", label: "A command-line tool" },
  ],
}); // "web" | "cli"

const git = await confirm({
  message: "Initialize a git repository?",
  default: true,
}); // boolean
```

A question waits for its answer: await each before the next one. Once answered,
it takes one line, and the next output starts under it.

### `text`

```console
? Project name › (my-app)
```

| Option        | What it is                                                   |
| ------------- | ------------------------------------------------------------ |
| `message`     | The question                                                 |
| `default`     | The answer of an empty line; shown between brackets          |
| `placeholder` | An example of an answer, dimmed; never the answer            |
| `validate`    | Checks the answer: returns the text of a mistake, or nothing |

`validate` may be asynchronous. A mistake is shown under the question, which
stays open:

```ts
const name = await text({
  message: "Project name",
  validate: (value) =>
    /^[a-z][a-z0-9_-]*$/.test(value)
      ? undefined
      : "Lower case letters, digits, - and _, starting with a letter",
});
```

```console
? Project name › My App
✖ Lower case letters, digits, - and _, starting with a letter
```

| Key                       | What it does                           |
| ------------------------- | -------------------------------------- |
| A character               | Typed where the cursor is              |
| Backspace                 | Erases the character before the cursor |
| Delete, Ctrl+D            | Erases the character under the cursor  |
| Left, Right               | Move the cursor                        |
| Home, Ctrl+A; End, Ctrl+E | To the start, and to the end           |
| Ctrl+U                    | Erases what is before the cursor       |
| Enter                     | Answers                                |

The answer is what was typed, as it was typed: spaces are kept.

### `select`

```console
? What are you building?
❯ A web application (@chojs/web)
  A command-line tool (@chojs/command)
```

| Option    | What it is                                                     |
| --------- | -------------------------------------------------------------- |
| `message` | The question                                                   |
| `choices` | The choices, one at least: `{ value, label?, hint? }`          |
| `default` | The value of the choice to start on; the first one, by default |

The answer is the `value` of the choice, and its type is the values of the
choices: `"web" | "cli"` above. A value can be of any type. A choice with no
`label` shows its value.

For values of several types, name the type of the answer:

```ts
const port = await select<number | "auto">({
  message: "Port",
  choices: [{ value: 80 }, { value: 443 }, { value: "auto" }],
});
```

| Key       | What it does                                     |
| --------- | ------------------------------------------------ |
| Up, `k`   | To the choice above; from the first, to the last |
| Down, `j` | To the choice below; from the last, to the first |
| Enter     | Answers with the choice the pointer is on        |

### `confirm`

```console
? Initialize a git repository? › ● Yes / ○ No
```

| Option    | What it is                        |
| --------- | --------------------------------- |
| `message` | The question                      |
| `default` | The answer the question starts on |

| Key        | What it does |
| ---------- | ------------ |
| `y`, Left  | Takes yes    |
| `n`, Right | Takes no     |
| Enter      | Answers      |

With no `default`, neither is taken at first, and Enter does not answer before
`y` or `n`.

## Cancelling

Ctrl+C cancels a question, and so does Ctrl+D on an empty text. The terminal is
put back as it was, and the question rejects with `CHO_PROMPT_CANCELLED`. The
process is not ended: the application decides what a cancel means.

```ts
import { isChoError } from "@chojs/core";

try {
  const name = await text({ message: "Project name" });
} catch (error) {
  if (!isChoError(error, "CHO_PROMPT_CANCELLED")) throw error;
  process.exit(130); // the exit code of a command that was interrupted
}
```

```console
✖ Project name
```

## Without a terminal

In CI, or when the input or the output is a pipe or a file, nobody can answer. A
question asked there rejects with `CHO_PROMPT_NO_TERMINAL`: no default is taken
silently. `isInteractive()` tells before asking:

```ts
import { isInteractive, text } from "@chojs/prompt";

const name = flags.name ??
  (isInteractive() ? await text({ message: "Project name" }) : "my-app");
```

## In an application, and in its tests

`createPrompts()` gives the three questions as one object. An application
provides it behind a token, and its commands ask through it:

```ts
import { Action, Controller, Module, provider, token } from "@chojs/command";
import { type ChoPrompts, createPrompts } from "@chojs/prompt";

export const ASK = token<ChoPrompts>("ASK");

@Controller({ dependencies: [ASK] })
class NewCommand {
  constructor(readonly ask: ChoPrompts) {}

  @Action("new")
  async create() {
    const name = await this.ask.text({ message: "Project name" });
    // ...
  }
}

@Module({
  providers: [provider({ provide: ASK, factory: () => createPrompts() })],
  controllers: [NewCommand],
})
export class AppModule {}
```

Its tests give a terminal that answers with a script: `scriptedTerminal`, of
`@chojs/prompt/testing`. The questions run as on a real terminal, with the same
keys, and the terminal keeps what was drawn:

```ts
import { ChoCommand, provider } from "@chojs/command";
import { createPrompts } from "@chojs/prompt";
import { scriptedTerminal } from "@chojs/prompt/testing";

const terminal = scriptedTerminal(["shop", "return", "down", "return"]);
const app = ChoCommand.create(AppModule, {
  overrides: [
    provider({ provide: ASK, factory: () => createPrompts(terminal) }),
  ],
});

await app.run(["new"]);
terminal.screen(); // ["✔ Project name · shop", "✔ What are you building? · ..."]
```

| A key of a script                    | What it presses                  |
| ------------------------------------ | -------------------------------- |
| `"return"`, `"up"`, `"backspace"`, … | The key of that name             |
| `"ctrl+c"`                           | A letter with Ctrl               |
| Any other text: `"shop"`             | Its characters, one key for each |
| `{ name, text, ctrl }`               | That key                         |

| Of the terminal | What it is                                                              |
| --------------- | ----------------------------------------------------------------------- |
| `screen()`      | What the screen shows now: its lines, with no colour                    |
| `screens`       | The screen when a question opened, and after each key that left it open |
| `written`       | Everything that was written, with its escape codes                      |
| `cursor`        | Where the cursor is, and whether it is hidden                           |
| `left`          | The number of keys that were not pressed yet                            |
| `reading`       | Whether a question is open                                              |

When the keys end and a question is still open, it is cancelled: a test never
waits for a key that does not come.

The options of `scriptedTerminal(keys, options)`: `columns` (default `80`),
`colors` (default `false`), and `interactive` (default `true`; `false` is a
terminal nobody can answer on).

## Colours

A terminal with colours gets them. Nothing depends on them: the marks (`?`, `✔`,
`✖`, `❯`, `●`) say the same with none. No colour is written when the output is
not a terminal, or when [`NO_COLOR`](https://no-color.org) is set.

## Errors

A `ChoError` of `@chojs/core`, with a `code`:

| Code                        | When                                           |
| --------------------------- | ---------------------------------------------- |
| `CHO_PROMPT_CANCELLED`      | The question was cancelled                     |
| `CHO_PROMPT_NO_TERMINAL`    | A question was asked with no terminal          |
| `CHO_PROMPT_BUSY`           | A question was asked while another one is open |
| `CHO_PROMPT_INVALID_OPTION` | An option is not what it must be               |
| `CHO_CORE_UNKNOWN_OPTION`   | An option does not exist                       |

A mistake in the options is thrown when the question is asked, before anything
is drawn. The others are rejections.

## Runtime support

| Runtime            | Asks questions                                                                                        |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| Deno               | Yes. Reading the keyboard needs no permission                                                         |
| Node.js 24         | Yes                                                                                                   |
| Bun                | Yes                                                                                                   |
| Cloudflare Workers | No: a Worker has no terminal. The package loads, and a question rejects with `CHO_PROMPT_NO_TERMINAL` |

The tests ask their questions on a scripted terminal, on the four runtimes.
[`tools/pty.sh`](../../tools/pty.sh) asks them in a real terminal, on Deno,
Node.js and Bun.

Not tested on Windows.

## Documentation

- [Specification](./specs.md): what is drawn, the terminal, the decisions, and
  what is not in this version.
- [`examples/prompt.ts`](../../examples/prompt.ts): the three questions.
