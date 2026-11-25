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
  return new Promise((resolve) => {
    const child = spawn(program, args, {
      cwd,
      stdio: "inherit",
      // On Windows, `npm` is a script (`npm.cmd`), that a shell runs.
      shell: process.platform === "win32",
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
 *   shell.
 * @param cwd The folder to run it in.
 * @returns The exit code of the program. For one that a signal ended, 128
 *   and the number of the signal: `130` for Ctrl+C.
 * @throws {ChoError} `CHO_CLI_NOT_STARTED` (as a rejection) when the program
 *   could not be started: it is not installed.
 */
export function run_program(
  program: string,
  args: readonly string[],
  cwd: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(program, [...args], {
      cwd,
      stdio: "inherit",
      // On Windows, `npx` is a script (`npx.cmd`), that a shell runs.
      shell: process.platform === "win32",
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
