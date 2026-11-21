#!/usr/bin/env -S deno run
/**
 * The three questions of `@chojs/prompt`: a text, a choice of a list, and a
 * yes or no.
 *
 * - A question waits for its answer: each is awaited before the next one.
 * - `validate` refuses an answer, and says why. The question stays open.
 * - Ctrl+C cancels: the question rejects with `CHO_PROMPT_CANCELLED`, and the
 *   script decides what that means. Here: the exit code of a cancelled
 *   command, `130`.
 * - Without a terminal (`echo | ...`, CI) nothing can be asked:
 *   `isInteractive()` tells before asking.
 *
 * ```sh
 * deno run examples/prompt.ts
 * bun examples/prompt.ts
 * npx tsx examples/prompt.ts
 * ```
 *
 * `tools/pty.sh` runs this file in a real terminal, on the three runtimes.
 *
 * @module
 */
import process from "node:process";
import { isChoError } from "@chojs/core";
import { confirm, isInteractive, select, text } from "@chojs/prompt";

if (!isInteractive()) {
  console.error("No terminal: there is nobody to ask.");
  process.exit(2);
}

try {
  const name = await text({
    message: "Project name",
    default: "my-app",
    validate: (value) =>
      /^[a-z][a-z0-9_-]*$/.test(value)
        ? undefined
        : "Lower case letters, digits, - and _, starting with a letter",
  });

  const kind = await select({
    message: "What are you building?",
    choices: [
      { value: "web", label: "A web application", hint: "@chojs/web" },
      { value: "cli", label: "A command-line tool", hint: "@chojs/command" },
      { value: "worker", label: "A message worker", hint: "@chojs/message" },
    ],
  }); // "web" | "cli" | "worker"

  const git = await confirm({
    message: "Initialize a git repository?",
    default: true,
  });

  console.log(JSON.stringify({ name, kind, git }));
} catch (error) {
  if (!isChoError(error, "CHO_PROMPT_CANCELLED")) {
    throw error;
  }
  console.error("Cancelled.");
  process.exit(130);
}
