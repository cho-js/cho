/**
 * The steps that follow the writing of a workspace: `git init`, and the
 * installation of the packages. Each runs a program, in the workspace.
 *
 * A step that fails does not undo the workspace: its files are right, and
 * the step can be run again by hand. So a step tells whether it succeeded,
 * and throws nothing.
 *
 * A dry run runs no step: {@link print_dry_run} says which would run.
 *
 * {@link run_program} is the other way to run a program: it is the project
 * `cho serve` runs, whose exit code is the one of `cho`.
 *
 * @module
 */

import { spawn } from "node:child_process";
import { constants } from "node:os";
import process from "node:process";
import { cli_error } from "../errors.ts";
import { type Change, list_changes } from "../tree.ts";
import type { Runtime } from "./config.ts";

/** The program that installs the packages of a workspace, on each runtime. */
export const INSTALL: Record<Runtime, string> = {
  deno: "deno install",
  node: "npm install",
  bun: "bun install",
};

/** The command that makes a repository of a workspace. No commit is made. */
export const GIT_INIT = "git init --quiet";

/**
 * The programs that are scripts on Windows (`npm.cmd`, `npx.cmd`), and not
 * programs: only a shell runs them there.
 */
const WINDOWS_SCRIPTS: ReadonlySet<string> = new Set(["npm", "npx"]);

/** An argument, as the shell of Windows takes one: in quotes when it has to be. */
function windows_word(word: string): string {
  return /^[\w@+=:,./\\-]+$/.test(word)
    ? word
    : `"${word.replaceAll('"', '\\"')}"`;
}

/**
 * How a program is started: as it is, or by a shell.
 *
 * A program is started as it is, with each argument as it is: no shell reads
 * them, so an argument with a space stays one, and a program that is not
 * installed is an error.
 *
 * The exception is `npm` and `npx` on Windows, which are scripts. A shell
 * runs them, and reads the command line again: an argument that is not a
 * plain word is written in quotes.
 *
 * @param program The program.
 * @param args Its arguments.
 * @param platform The platform, as `process.platform` names it. Default: the
 *   one of the process.
 * @returns What to give `spawn`: the program, its arguments, and whether a
 *   shell runs them.
 */
export function spawn_plan(
  program: string,
  args: readonly string[],
  platform: string = process.platform,
): { program: string; args: string[]; shell: boolean } {
  if (platform === "win32" && WINDOWS_SCRIPTS.has(program)) {
    return { program, args: args.map(windows_word), shell: true };
  }
  return { program, args: [...args], shell: false };
}

/**
 * Run a command in a folder, and wait for it to end. What it prints is shown
 * as it comes.
 *
 * `node:child_process` runs it: the three runtimes have it.
 *
 * @param command The program and its arguments, separated by spaces:
 *   `"npm install"`.
 * @param cwd The folder to run it in.
 * @returns `true` when it ended with the exit code `0`. `false` when it
 *   failed, and when it could not be started: the program is not installed.
 */
export function run(command: string, cwd: string): Promise<boolean> {
  const [program = "", ...args] = command.split(" ");
  const plan = spawn_plan(program, args);
  return new Promise((resolve) => {
    const child = spawn(plan.program, plan.args, {
      cwd,
      stdio: "inherit",
      shell: plan.shell,
    });
    child.once("error", () => resolve(false));
    child.once("close", (code) => resolve(code === 0));
  });
}

/**
 * Run steps in a folder, one after the other, each under a line that names
 * it. A step that fails does not stop the next one.
 *
 * @param steps The commands.
 * @param cwd The folder to run them in.
 * @returns The steps that failed.
 */
export async function run_steps(
  steps: readonly string[],
  cwd: string,
): Promise<string[]> {
  const failed: string[] = [];
  for (const step of steps) {
    console.log(`Running ${step}`);
    if (!await run(step, cwd)) {
      failed.push(step);
    }
  }
  return failed;
}

/**
 * Print what a command would do, for `--dry-run`: the files it would write,
 * and the steps it would run.
 *
 * @param changes The changes of the tree of the command.
 * @param steps The steps.
 */
export function print_dry_run(
  changes: readonly Change[],
  steps: readonly string[],
): void {
  console.log("Dry run: nothing is written, and nothing is run.");
  console.log(`\n${list_changes(changes)}\n`);
  for (const step of steps) {
    console.log(`Would run ${step}`);
  }
}

/**
 * Run a program in a folder, on the terminal of `cho`, and wait for it to
 * end: its input, its output and its error output are those of `cho`.
 *
 * Ctrl+C in a terminal goes to the program and to `cho` alike. `cho` ignores
 * it while the program runs: the program ends as it chooses, a server by
 * closing, and `cho` ends after it, with its exit code. A request to end
 * `cho` alone (`SIGTERM`) is passed to the program.
 *
 * @param program The program.
 * @param args Its arguments, each as it is: none is split, or read by a
 *   shell (but for `npx` on Windows: see {@link spawn_plan}).
 * @param cwd The folder to run it in.
 * @returns The exit code of the program. For one that a signal ended, 128
 *   and the number of the signal: `130` for Ctrl+C.
 * @throws {ChoError} `CHO_CLI_NOT_STARTED` (as a rejection) when the program
 *   could not be started: it is not installed. On Windows, a shell starts
 *   `npx`: there, the shell says that it is not installed, and the exit code
 *   is the one of the shell.
 */
export function run_program(
  program: string,
  args: readonly string[],
  cwd: string,
): Promise<number> {
  const plan = spawn_plan(program, args);
  return new Promise((resolve, reject) => {
    const child = spawn(plan.program, plan.args, {
      cwd,
      stdio: "inherit",
      shell: plan.shell,
    });
    const ignore = () => {};
    const pass = () => void child.kill("SIGTERM");
    process.on("SIGINT", ignore);
    process.on("SIGTERM", pass);
    const done = () => {
      process.off("SIGINT", ignore);
      process.off("SIGTERM", pass);
    };
    child.once("error", (cause) => {
      done();
      reject(cli_error(
        "CHO_CLI_NOT_STARTED",
        `Could not start ${program}: ${cause.message}. Is it installed?`,
        { cause },
      ));
    });
    child.once("close", (code, signal) => {
      done();
      resolve(code ?? 128 + (signal ? constants.signals[signal] : 0));
    });
  });
}
