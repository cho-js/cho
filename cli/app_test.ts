/**
 * Tests for the `cho` tool: its command lines, end to end, as `main.ts` runs
 * them.
 *
 * The modules of the tool are declared with decorator syntax, so these tests
 * also check that syntax on each runtime. `console.log` and `console.error`
 * are captured (see `capture`): the tests check what a user would see.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { capture } from "@chojs/core/utils/test_utils";
import { run_cli } from "./app.ts";
import config from "./deno.json" with { type: "json" };

/** The help of the tool: every command. */
const GLOBAL_HELP = `Usage: cho <command> [options] [args]

Commands:
  new   Create a new workspace, with a first project
  help  Show the help of cho, or of one of its commands

Options:
  --help     Show this help
  --version  Show the version

Run 'cho <command> --help' for help on a command.`;

/** The help of the `help` command. */
const HELP_OF_HELP = `Usage: cho help [options] [args]

Show the help of cho, or of one of its commands

  cho help            every command
  cho help <command>  one command, and its options

Options:
  --help     Show this help
  --version  Show the version`;

/** The help of the `new` command: its text, and its flags. */
const HELP_OF_NEW = `Usage: cho new [options] [args]

Create a new workspace, with a first project

  cho new                asks for everything
  cho new <name>         creates the folder <name>, and asks for the rest
  cho new <name> --yes   takes the default of every question

A flag answers its question. The folder <name> must not exist.

Options:
  -y, --yes           Take the default of every question
  --[no-]git          Run git init (default: true)
  --[no-]install      Install the packages (default: true)
  --kind <value>      What the project is: web or cli
  --runtime <value>   The runtime of the workspace: deno, node, bun
  --project <value>   The name of the project
  --apps-dir <value>  The folder of the projects
  --help              Show this help
  --version           Show the version`;

/** Run a command line, and give its exit code and what it printed. */
async function cho(...argv: string[]) {
  const { result, output } = await capture(() => run_cli(argv));
  return { code: result, log: output.log, error: output.error };
}

describe("cho", () => {
  it("prints the help of the tool with no command", async () => {
    assert.deepEqual(await cho(), { code: 0, log: [GLOBAL_HELP], error: [] });
  });

  it("prints the same help for --help and for the help command", async () => {
    assert.deepEqual(await cho("--help"), {
      code: 0,
      log: [GLOBAL_HELP],
      error: [],
    });
    assert.deepEqual(await cho("help"), {
      code: 0,
      log: [GLOBAL_HELP],
      error: [],
    });
  });

  it("prints the help of a command: help <command>, and <command> --help", async () => {
    assert.deepEqual(await cho("help", "help"), {
      code: 0,
      log: [HELP_OF_HELP],
      error: [],
    });
    assert.deepEqual(await cho("help", "--help"), {
      code: 0,
      log: [HELP_OF_HELP],
      error: [],
    });
  });

  it("prints the help of new, with a flag for each question", async () => {
    assert.deepEqual(await cho("help", "new"), {
      code: 0,
      log: [HELP_OF_NEW],
      error: [],
    });
    assert.deepEqual(await cho("new", "--help"), {
      code: 0,
      log: [HELP_OF_NEW],
      error: [],
    });
  });

  it("prints the help of the tool for the help of a command it does not have", async () => {
    // as `cho nosuch --help` does
    assert.deepEqual(await cho("help", "nosuch"), {
      code: 0,
      log: [GLOBAL_HELP],
      error: [],
    });
  });

  it("prints its version, the one of its package", async () => {
    assert.match(config.version, /^\d+\.\d+\.\d+/);
    assert.deepEqual(await cho("--version"), {
      code: 0,
      log: [`cho version ${config.version}`],
      error: [],
    });
  });

  it("refuses a command it does not have, with exit code 1", async () => {
    const { code, log, error } = await cho("nosuch");
    assert.equal(code, 1);
    assert.deepEqual(log, []);
    assert.deepEqual(error, [
      "Error: Action 'nosuch' not found. Use --help for usage information.",
    ]);
  });
});
