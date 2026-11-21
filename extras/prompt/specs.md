# @chojs/prompt

Questions in a terminal: a text, a yes or no, a choice of a list. It runs on
Deno, Node.js and Bun, and depends on `@chojs/core` alone.

This document describes what an application gets, and how the package is built.
The source code is the reference: when this document and the code disagree, the
code wins.

## 1. Overview

```ts
import { confirm, select, text } from "@chojs/prompt";

const name = await text({ message: "Project name", default: "my-app" });
const kind = await select({
  message: "What are you building?",
  choices: [{ value: "web" }, { value: "cli" }],
}); // "web" | "cli"
const git = await confirm({ message: "Initialize a git repository?" });
```

- **A question is a function** that resolves to its answer. It is awaited before
  the next one.
- **Three questions**: `text`, `select`, `confirm`.
- **The logic and the terminal are apart.** A question is pure functions over a
  state (section 3). One runner draws it and gives it the keys (section 4), on a
  terminal that is an interface (section 5). So a question is tested with no
  terminal, and an application is tested with a scripted one (section 7).
- **Nothing is installed with it.** The keys come from `node:readline`, which
  Deno, Node.js and Bun have, and the escape codes are written by hand.

## 2. The questions

### 2.1 `text(options)`

```console
? Project name › my-app
```

| Option        | Type       | Default            | What it is                      |
| ------------- | ---------- | ------------------ | ------------------------------- |
| `message`     | `string`   | required           | The question                    |
| `default`     | `string`   | none               | The answer of an empty line     |
| `placeholder` | `string`   | none               | An example of an answer         |
| `validate`    | a function | every answer taken | Checks the answer (section 4.3) |

| Key                       | What it does                           |
| ------------------------- | -------------------------------------- |
| A character               | Typed where the cursor is              |
| Backspace                 | Erases the character before the cursor |
| Delete, Ctrl+D            | Erases the character under the cursor  |
| Left, Right               | Move the cursor                        |
| Home, Ctrl+A; End, Ctrl+E | To the start, and to the end           |
| Ctrl+U                    | Erases what is before the cursor       |
| Enter                     | Answers                                |
| Ctrl+D, on an empty line  | Cancels                                |

- The answer is what was typed, as it was typed: no space is removed.
- An empty line answers `default`, or `""` when there is none.
- While nothing is typed, the line shows `default` between brackets:
  `? Project name › (my-app)`. With no `default`, it shows `placeholder`,
  dimmed. A placeholder is told from a typed text by its colour alone, so a
  terminal with no colour does not show it.
- A key that sends several characters at once (a paste) types them all.
- A character is counted once, whatever it takes to store it: the editor works
  on code points. A wide character (East Asian, an emoji) takes two columns on
  the screen and is counted for one: the cursor is then drawn short of where it
  is.

### 2.2 `select(options)`

```console
? What are you building?
❯ A web application (@chojs/web)
  A command-line tool (@chojs/command)
```

| Option    | Type     | Default          | What it is                          |
| --------- | -------- | ---------------- | ----------------------------------- |
| `message` | `string` | required         | The question                        |
| `choices` | a list   | required         | The choices, one at least           |
| `default` | a value  | the first choice | The value of the choice to start on |

A choice is `{ value, label?, hint? }`. Its text is `label`, or the value as a
string. `hint` is written after it, between brackets.

| Key       | What it does                                     |
| --------- | ------------------------------------------------ |
| Up, `k`   | To the choice above; from the first, to the last |
| Down, `j` | To the choice below; from the last, to the first |
| Enter     | Answers with the choice the pointer is on        |

- The answer is the `value` of the choice: the same value, of any type.
- The type of the answer is the values of the choices: `select<const T>`.
  TypeScript infers it from values of one type (`"web" | "cli"`); for values of
  several types it is named: `select<number | "auto">(...)`.
- Two choices cannot have one value: the answer would not say which was taken.
  Values are compared as a `Set` does.

### 2.3 `confirm(options)`

```console
? Initialize a git repository? › ● Yes / ○ No
```

| Option    | Type      | Default  | What it is                        |
| --------- | --------- | -------- | --------------------------------- |
| `message` | `string`  | required | The question                      |
| `default` | `boolean` | none     | The answer the question starts on |

| Key        | What it does                     |
| ---------- | -------------------------------- |
| `y`, Left  | Takes yes                        |
| `n`, Right | Takes no                         |
| Enter      | Answers, once yes or no is taken |

With no `default`, neither is taken at first: `○ Yes / ○ No`. Enter then does
not answer, and the question says so: `✖ Press y for yes, or n for no`.

## 3. A question, inside

A question is an object of `question.ts`, with a state of its own type:

| Function                 | What it gives                                   |
| ------------------------ | ----------------------------------------------- |
| `start()`                | The state the question starts in                |
| `press(state, key)`      | A new state, an answer, or a cancel             |
| `frame(state, style)`    | The lines of the state, and where the cursor is |
| `check(answer)`          | The text of a mistake, or nothing (optional)    |
| `refuse(state, mistake)` | The state that shows the mistake (optional)     |
| `shown(answer)`          | The answer, as it is written on the last line   |

They are pure: no key is read and nothing is written. A key that changes nothing
returns the same state, and nothing is drawn for it.

## 4. Asking

`run.ts` asks a question on a terminal.

### 4.1 Drawing

1. The keys are read first, then the question is drawn: what is typed while it
   appears is neither lost nor echoed by the terminal.
2. For each key that changes the state, the frame is drawn again from its first
   row: the cursor goes up to it, the screen is erased from there, and the lines
   are written.
3. A line longer than the terminal takes more than one row. The rows are counted
   on the text without its escape codes, with the width the terminal has at that
   time.
4. A frame with a cursor (`text`) puts it where the next character goes. A frame
   with none (`select`, `confirm`) hides it.
5. At the end, the frame is replaced by one line, and the next output starts
   under it:

| The question was | Its last line           |
| ---------------- | ----------------------- |
| answered         | `✔ Project name · shop` |
| cancelled        | `✖ Project name`        |

Lines are ended with a carriage return and a line feed: a terminal in raw mode
may not add the first.

### 4.2 The terminal is put back

Whatever ends a question, the keys are no longer read, the input is as it was
found (raw mode off), and the cursor is shown: on an answer, on a cancel, and
when `validate` throws. The input is paused, so a process that has nothing else
to do ends.

### 4.3 `validate`

`validate(value)` is called with the answer, the `default` of an empty line
included. It returns the text of a mistake, or nothing; it may return a promise.
A mistake is shown under the question, which stays open, until the text changes.
Anything that is not a text that has characters takes the answer.

What it throws rejects the question, as it is. The question is left on the
screen as it was, and the next output starts under it.

The keys are handled one after the other: a key pressed while `validate` is
waiting is handled after it.

### 4.4 Cancelling

Ctrl+C cancels any question, and Ctrl+D an empty text. The question rejects with
`CHO_PROMPT_CANCELLED`. The process is not ended, and no signal is sent: in raw
mode Ctrl+C is a key, and the application decides what it means.

### 4.5 One question at a time

A question asked on a terminal that has an open one rejects with
`CHO_PROMPT_BUSY`. The open question is not disturbed.

## 5. The terminal

A question is asked on a `ChoPromptTerminal`:

| Member           | What it is                                                   |
| ---------------- | ------------------------------------------------------------ |
| `interactive`    | Whether somebody can answer                                  |
| `columns`        | The width, in characters                                     |
| `colors`         | Whether colours are shown                                    |
| `write(text)`    | Writes a text, with its escape codes                         |
| `open(listener)` | Reads the keys, with no echo; returns what stops the reading |

A key is `{ name, text, ctrl }`: the name `node:readline` gives it (`"return"`,
`"up"`, `"a"`; `""` when it has none), what it types (`""` for a key that types
nothing, and for any key with Ctrl or Alt), and whether Ctrl was held.

### 5.1 The terminal of the process

`text`, `select` and `confirm` ask on it, and so does `createPrompts()` with no
argument. `terminal.ts`:

| Member        | Where it comes from                                                       |
| ------------- | ------------------------------------------------------------------------- |
| `interactive` | `stdin.isTTY` and `stdout.isTTY` are `true`, and `stdin` has `setRawMode` |
| `columns`     | `stdout.columns`; `80` when there is none                                 |
| `colors`      | `stdout.isTTY` is `true`, and `NO_COLOR` is not set                       |
| `write`       | `stdout.write`                                                            |
| `open`        | `readline.emitKeypressEvents(stdin)`, raw mode, the `keypress` event      |

- **`isTTY` is compared with `true`.** For an input that is a pipe, Deno says
  `false`, and Node.js and Bun say `undefined`.
- **Nothing is imported when the package is.** The process is the global
  `process`, which the three runtimes have, and `node:readline` is loaded with a
  dynamic `import` when the first question is asked on a terminal that is
  interactive. So the package loads where there is neither: a Worker.
- **`NO_COLOR` on Deno is `Deno.noColor`**, not the variable. In a terminal,
  Deno stops and asks the user to allow each variable a program reads with no
  `--allow-env`: a question would start with a question of Deno.
- **Reading the keyboard needs no permission on Deno.**
- The width is read at each drawing: a window that was resized is drawn at its
  new width from the next key.

`isInteractive()` is `interactive` of this terminal.

## 6. The options, checked

The options of a question are checked when it is asked, before anything is drawn
and before the terminal is looked at. A mistake is thrown, not rejected.

| Mistake                                            | Code                        |
| -------------------------------------------------- | --------------------------- |
| The options are not an object                      | `CHO_PROMPT_INVALID_OPTION` |
| `message` is not a text, or is empty               | `CHO_PROMPT_INVALID_OPTION` |
| An option has the wrong type                       | `CHO_PROMPT_INVALID_OPTION` |
| `choices` is not a list, or is empty               | `CHO_PROMPT_INVALID_OPTION` |
| A choice is not an object with a `value`           | `CHO_PROMPT_INVALID_OPTION` |
| Two choices have one value                         | `CHO_PROMPT_INVALID_OPTION` |
| `default` of `select` is not the value of a choice | `CHO_PROMPT_INVALID_OPTION` |
| An option does not exist                           | `CHO_CORE_UNKNOWN_OPTION`   |

## 7. Testing

`@chojs/prompt/testing` exports `scriptedTerminal(keys, options?)`: a
`ChoPromptTerminal` that presses the keys of a script.

- The questions run as on a real terminal: the same runner, the same escape
  codes. The terminal reads those codes on a screen of its own (the cursor, the
  erasing, the wrapping at the last column), so `screen()` is what a user would
  see.
- Each question takes the keys it needs, and leaves the others to the next.
- A key is sent when the one before was handled, `validate` included.
- When the keys end and a question is open, it is cancelled, as with Ctrl+C.
- `screens` keeps the screen when a question opened, and after each key that
  left it open. The key that ended a question is seen when the next one opens,
  and in `screen()`.

| Option        | Default | What it is                            |
| ------------- | ------- | ------------------------------------- |
| `columns`     | `80`    | The width of the screen               |
| `colors`      | `false` | Whether the terminal shows colours    |
| `interactive` | `true`  | `false`: a terminal nobody answers on |

The tests of the package ask on this terminal, on the four runtimes.
`terminal_test.ts` gives the terminal of the process a stand-in for the process,
whose input is a stream: the keys are bytes, read by the `node:readline` of the
runtime.

`tools/pty.sh` asks the questions of `examples/prompt.ts` in a real terminal,
made by `script(1)`, on Deno, Node.js and Bun: every question to its answer, and
a cancel. It runs in CI.

## 8. Public API

| Export                             | From                    | What it is                                       |
| ---------------------------------- | ----------------------- | ------------------------------------------------ |
| `text`, `select`, `confirm`        | `@chojs/prompt`         | The questions, on the terminal of the process    |
| `isInteractive`                    | `@chojs/prompt`         | Whether somebody can answer                      |
| `createPrompts(terminal?)`         | `@chojs/prompt`         | The questions, bound to a terminal: `ChoPrompts` |
| `scriptedTerminal(keys, options?)` | `@chojs/prompt/testing` | A terminal that answers with a script            |

Types: `TextOptions`, `SelectOptions`, `ConfirmOptions`, `ChoPromptChoice`,
`ChoPromptMistake`, `ChoPrompts`, `ChoPromptTerminal`, `ChoPromptKey`,
`ChoPromptErrorCode`; and of the testing entry point: `ScriptedTerminal`,
`ScriptedTerminalOptions`, `ScriptedKey`.

## 9. Errors

Every error is a `ChoError` of `@chojs/core`, with one of these codes
(`ChoPromptErrorCode`):

| Code                        | When                                                           | Thrown or rejected |
| --------------------------- | -------------------------------------------------------------- | ------------------ |
| `CHO_PROMPT_BUSY`           | A question is asked while another one is open                  | Rejected           |
| `CHO_PROMPT_CANCELLED`      | The question was cancelled: Ctrl+C, or Ctrl+D on an empty text | Rejected           |
| `CHO_PROMPT_INVALID_OPTION` | An option is not what it must be (section 6)                   | Thrown             |
| `CHO_PROMPT_NO_TERMINAL`    | The terminal is not interactive                                | Rejected           |

An option that does not exist has a code of the core: `CHO_CORE_UNKNOWN_OPTION`.

## 10. Runtime support

| Runtime            | Asks questions | The tests                                            |
| ------------------ | -------------- | ---------------------------------------------------- |
| Deno               | Yes            | `deno test`; `tools/pty.sh`                          |
| Node.js 24         | Yes            | `tsx --test`; `tools/pty.sh`                         |
| Bun                | Yes            | `bun test`; `tools/pty.sh`                           |
| Cloudflare Workers | No             | `tools/workerd/run.sh`: all but the keys of a stream |

A Worker has no terminal: the package loads there, `isInteractive()` is `false`,
and a question rejects with `CHO_PROMPT_NO_TERMINAL`.

Windows: the same code, not tested.

## 11. Decisions

1. **Named `prompt`**, not `readline`: `readline` is the module of Node.js, and
   promises its API. This package asks questions, and `prompt` is the word of
   every library that does.
2. **An extra.** It reads nothing of the framework. It is here because `cho`, a
   package of this repository, is built on it and released with it
   (`extras/README.md`).
3. **Functions, and one object.** The functions are for a script. The object of
   `createPrompts` is for an application: it is what a token provides, and what
   a test replaces.
4. **Pure questions, one runner.** The keys and the screen of a question are
   tested with no terminal. The escape codes are in one file.
5. **`readline.emitKeypressEvents`, not a parser of keys.** The runtime already
   knows the bytes of an arrow on every terminal.
6. **Every question is drawn in raw mode**, `text` included, with an editor of
   its own. `rl.question` has the editor of the runtime, but a text would then
   look, and be tested, differently from the other two.
7. **Cancelling is a rejection**, not a value to check after each question, and
   not the end of the process.
8. **No terminal is an error.** A default that is taken silently hides that
   nobody was asked.
9. **The marks say everything.** Colours help, and nothing depends on them: a
   default is between brackets, the answer of a yes or no has a mark of its own.
10. **The standard output**, as the other libraries do.
11. **The scripted terminal reads the escape codes.** A test compares the
    screen, not what was written: the drawing itself is tested.

## 12. Not in this version

- More questions: several choices of a list, a secret, a number, a search in a
  long list.
- A list longer than the screen: a window that scrolls.
- The width of wide characters.
- A spinner, a progress line, a group of questions with a summary.
- Answers from a pipe, a line for each question.
- A test on Windows.
