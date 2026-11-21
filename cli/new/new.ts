/**
 * The `new` command: `cho new <name>` creates a workspace, with a first
 * project in it.
 *
 * It reads top to bottom:
 *
 * 1. `read_flags` checks what the command line said (`flags.ts`).
 * 2. `ask_answers` asks for the rest (`answers.ts`).
 * 3. `plan_workspace` lists the files of the workspace (`plan.ts`).
 * 4. `write_workspace` writes them, in a folder it creates (`write.ts`).
 * 5. `run` runs the steps that were asked for: `git init`, and the
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
  isChoError,
} from "@chojs/command";
import { type Answers, ask_answers } from "./answers.ts";
import config from "../deno.json" with { type: "json" };
import { NEW_FLAGS, read_flags } from "./flags.ts";
import { plan_workspace, task_command } from "./plan.ts";
import { GIT_INIT, INSTALL, run } from "./steps.ts";
import { write_workspace } from "./write.ts";

/** The exit code of a command that was interrupted: 128, and the signal. */
const CANCELLED = 130;

/**
 * The commands that say what to do next, each on its line.
 *
 * @param answers The answers.
 * @param installed Whether the packages were installed. When they were not,
 *   the first command installs them.
 * @returns The lines, indented.
 */
export function next_steps(answers: Answers, installed: boolean): string {
  const { name, appsDir, project, runtime, kind } = answers;
  const lines = installed
    ? [`cd ${name}/${appsDir}/${project}`]
    : [`cd ${name}`, INSTALL[runtime], `cd ${appsDir}/${project}`];
  // a server is run, and a command-line tool is started with a command
  lines.push(task_command(runtime, kind, kind === "web" ? "dev" : "start"));
  return lines.map((line) => `  ${line}`).join("\n");
}

/**
 * Create a workspace from the answers: write it, then run its steps.
 *
 * A step that fails leaves the workspace, which is whole: the command to run
 * by hand is printed.
 *
 * @param answers The answers.
 * @param cwd The folder to create the workspace in.
 * @returns The exit code: `0`, or `1` when a step failed.
 * @throws {ChoError} `CHO_CLI_TARGET_EXISTS` and `CHO_CLI_WRITE_FAILED`:
 *   nothing is left.
 */
export async function create_workspace(
  answers: Answers,
  cwd: string,
): Promise<number> {
  const files = plan_workspace(answers, config.version);
  const target = join(cwd, answers.name);
  await write_workspace(target, files);
  console.log(`Created ${answers.name} (${files.length} files)`);

  // The installation is last: it is the long one, and Ctrl+C there leaves
  // a workspace that is whole.
  const steps: string[] = [];
  if (answers.git) {
    steps.push(GIT_INIT);
  }
  if (answers.install) {
    steps.push(INSTALL[answers.runtime]);
  }

  const failed: string[] = [];
  for (const step of steps) {
    console.log(`Running ${step}`);
    if (!await run(step, target)) {
      failed.push(step);
    }
  }
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
  if (isChoError(error, "CHO_PROMPT_CANCELLED")) {
    console.error("Cancelled.");
    return CANCELLED;
  }
  if (isChoError(error, "CHO_PROMPT_NO_TERMINAL")) {
    console.error(
      "Error: There is no terminal to ask on. Give every answer as a flag, " +
        "or --yes for the defaults: see cho new --help",
    );
    return 1;
  }
  console.error(
    `Error: ${error instanceof Error ? error.message : String(error)}`,
  );
  return 1;
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
      "A flag answers its question. The folder <name> must not exist.",
  )
  @Action("new", NEW_FLAGS)
  async create(ctx: ChoCommandContext): Promise<number> {
    const cwd = process.cwd();
    const flags = read_flags(ctx.args);
    const answers = await ask_answers(flags, cwd);
    return create_workspace(answers, cwd);
  }
}
