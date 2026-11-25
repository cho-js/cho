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
 * @module
 */

import { spawn } from "node:child_process";
import process from "node:process";
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
