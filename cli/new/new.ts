/**
 * The `new` command: `cho new <name>` creates a workspace, with a first
 * project in it.
 *
 * It reads top to bottom:
 *
 * 1. `read_flags` checks what the command line said (`flags.ts`).
 * 2. `ask_answers` asks for the rest (`answers.ts`).
 * 3. `plan_workspace` lists the files of the workspace (`plan.ts`).
 * 4. The files are recorded on a tree, and `commit` writes them, in a folder
 *    it creates (`../tree.ts`). With `--dry-run`, they are printed.
 * 5. `run_steps` runs the steps that were asked for: `git init`, and the
 *    installation of the packages (`steps.ts`).
 *
 * Nothing is written before the last answer. See `specs.md`, section 3.
 *
 * @module
 */

import { join } from "node:path";
import process from "node:process";
import {
  Action,
  Catch,
  type ChoCommandContext,
  Controller,
  Help,
} from "@chojs/command";
import config from "../deno.json" with { type: "json" };
import { commit, disk_host, Tree } from "../tree.ts";
import { type Answers, ask_answers } from "./answers.ts";
import { cli_error, print_error } from "../errors.ts";
import { NEW_FLAGS, read_flags } from "./flags.ts";
import { plan_workspace, serve_line } from "./plan.ts";
import { GIT_INIT, INSTALL, print_dry_run, run_steps } from "./steps.ts";

/**
 * The commands that say what to do next, each on its line: the workspace,
 * then `cho serve`, which runs the project on any runtime.
 *
 * @param answers The answers.
 * @param installed Whether the packages were installed. When they were not,
 *   the first command installs them.
 * @returns The lines, indented.
 */
export function next_steps(answers: Answers, installed: boolean): string {
  const { name, project, runtime, kind } = answers;
  const lines = installed ? [`cd ${name}`] : [`cd ${name}`, INSTALL[runtime]];
  // `cho serve` runs from any folder of the workspace, on its runtime
  lines.push(serve_line(project, kind));
  return lines.map((line) => `  ${line}`).join("\n");
}

/**
 * Create a workspace from the answers: write it, then run its steps.
 *
 * The files are recorded on a tree of the current folder, under the folder
 * of the workspace: so the folder is a change like any file, a dry run shows
 * it, and a failure removes it.
 *
 * A step that fails leaves the workspace, which is whole: the command to run
 * by hand is printed.
 *
 * @param answers The answers.
 * @param cwd The folder to create the workspace in.
 * @param dry_run `true` for `--dry-run`: what would be written and run is
 *   printed, and nothing is done.
 * @returns The exit code: `0`, or `1` when a step failed.
 * @throws {ChoError} `CHO_CLI_TARGET_EXISTS` and `CHO_CLI_WRITE_FAILED`:
 *   nothing is left.
 */
export async function create_workspace(
  answers: Answers,
  cwd: string,
  dry_run = false,
): Promise<number> {
  const tree = new Tree(disk_host(cwd));
  // Even an empty one: the workspace is written in a folder `cho` created.
  if (tree.exists(answers.name)) {
    throw cli_error(
      "CHO_CLI_TARGET_EXISTS",
      `The folder ${answers.name} exists already. Nothing was written.`,
    );
  }
  const files = plan_workspace(answers, config.version);
  for (const file of files) {
    tree.create(`${answers.name}/${file.path}`, file.text);
  }

  // The installation is last: it is the long one, and Ctrl+C there leaves
  // a workspace that is whole.
  const steps: string[] = [];
  if (answers.git) {
    steps.push(GIT_INIT);
  }
  if (answers.install) {
    steps.push(INSTALL[answers.runtime]);
  }

  if (dry_run) {
    print_dry_run(tree.changes(), steps);
    return 0;
  }
  await commit(tree);
  console.log(`Created ${answers.name} (${files.length} files)`);

  const failed = await run_steps(steps, join(cwd, answers.name));
  for (const step of failed) {
    console.error(
      `Error: ${step} failed. The workspace is whole: run it in ` +
        `${answers.name}.`,
    );
  }

  const installed = answers.install &&
    !failed.includes(INSTALL[answers.runtime]);
  console.log(`\n${next_steps(answers, installed)}`);
  return failed.length === 0 ? 0 : 1;
}

/**
 * The error handler of the command: what it prints for an error, and the
 * exit code.
 *
 * @param error What the command threw.
 * @returns `130` for a question that was cancelled, `1` for anything else.
 */
export function report_error(error: unknown): number {
  return print_error(error, "cho new");
}

/** The command that creates a workspace. */
@Catch(report_error)
@Controller()
export class NewCommand {
  /**
   * `cho new [name]`.
   *
   * @param ctx The context of the run: the name, and the flags.
   * @returns The exit code: `0`, or `1` when a step failed. What it throws
   *   goes to {@link report_error}.
   */
  @Help(
    "Create a new workspace, with a first project\n\n" +
      "  cho new                asks for everything\n" +
      "  cho new <name>         creates the folder <name>, and asks for the rest\n" +
      "  cho new <name> --yes   takes the default of every question\n\n" +
      "A flag answers its question. The folder <name> must not exist.\n" +
      "The workspace is the same on Deno, on Node.js and on Bun.",
  )
  @Action("new", NEW_FLAGS)
  async create(ctx: ChoCommandContext): Promise<number> {
    const cwd = process.cwd();
    const flags = read_flags(ctx.args);
    const answers = await ask_answers(flags, cwd);
    return create_workspace(answers, cwd, flags.dryRun);
  }
}
