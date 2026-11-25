/**
 * The `serve` command: `cho serve <project>` runs an application of the
 * workspace it is run in.
 *
 * A project has no scripts: no one command runs it on the three runtimes.
 * `cho serve` is that command. It runs the entry of the project (`main.ts`)
 * with the runtime of the workspace, in a child process, on the terminal of
 * `cho`: a web application is started, and a command-line tool runs and
 * ends. A library does not run.
 *
 * It reads top to bottom:
 *
 * 1. `read_flags` checks what the command line said (`flags.ts`).
 * 2. `find_workspace` and `read_config` find the workspace, and read its
 *    `cho.json` (`../add/workspace.ts`).
 * 3. `pick_project` says which project, and `check_ready` that it can run
 *    (`project.ts`).
 * 4. `run_command` is the command of the runtime (`../new/plan.ts`).
 * 5. `run_program` runs it, and waits (`../new/steps.ts`).
 *
 * Nothing is written. See `specs.md`, section 5.
 *
 * @module
 */

import { join, relative } from "node:path";
import process from "node:process";
import {
  Action,
  Catch,
  type ChoCommandContext,
  Controller,
  Help,
} from "@chojs/command";
import { find_workspace, read_config } from "../add/workspace.ts";
import { print_error } from "../errors.ts";
import { type ChoConfig, KIND_TRAITS } from "../new/config.ts";
import { command_line, run_command } from "../new/plan.ts";
import { run_program } from "../new/steps.ts";
import { disk_host, Tree } from "../tree.ts";
import { type Flags, read_flags, SERVE_FLAGS } from "./flags.ts";
import { check_ready, pick_project } from "./project.ts";

/** Where a command runs: the root of the workspace, and the current folder. */
export type Where = { root: string; cwd: string };

/**
 * Run an application of a workspace, and wait for it to end.
 *
 * - The runtime is the one of `--runtime`, else the one of `cho.json`.
 * - An application that stays up, as a server does, is run again when a file
 *   changes, unless `--no-watch` says no. One that runs and ends, as a
 *   command-line tool does, is never watched: a watcher would keep it open.
 * - The line that names the command goes to the error output: the standard
 *   output is the one of the project.
 *
 * @param tree The tree of the workspace: nothing is recorded on it.
 * @param config The settings of the workspace.
 * @param flags What the command line said.
 * @param where The root of the workspace, and the current folder.
 * @param run What runs the program. Default: `run_program`. A test gives
 *   one that runs nothing.
 * @returns The exit code of the project.
 * @throws {ChoError} What `pick_project`, `check_ready` and `run_program`
 *   throw: nothing was run.
 */
export function serve_project(
  tree: Tree,
  config: ChoConfig,
  flags: Flags,
  where: Where,
  run: typeof run_program = run_program,
): Promise<number> {
  const runtime = flags.runtime ?? config.runtime;
  const inside = relative(where.root, where.cwd).replaceAll("\\", "/");
  const picked = pick_project(config, flags.name, inside, runtime);
  check_ready(tree, picked, runtime);

  const { project } = picked;
  const command = run_command(runtime, project, {
    watch: flags.watch && KIND_TRAITS[project.kind].stays,
    args: flags.args,
  });
  console.error(`Running ${command_line(command)}`);
  const folder = join(where.root, ...project.root.split("/"));
  return run(command.program, command.args, folder);
}

/**
 * The error handler of the command: what it prints for an error, and the
 * exit code.
 *
 * @param error What the command threw.
 * @returns `1`.
 */
export function report_error(error: unknown): number {
  return print_error(error, "cho serve");
}

/** The command that runs an application of a workspace. */
@Catch(report_error)
@Controller()
export class ServeCommand {
  /**
   * `cho serve [project]`.
   *
   * @param ctx The context of the run: the name, the flags, and the command
   *   line as it was given.
   * @returns The exit code of the project. What it throws goes to
   *   {@link report_error}.
   */
  @Help(
    "Run an application of the workspace\n\n" +
      "  cho serve <project>             runs it, on the runtime of the workspace\n" +
      "  cho serve                       the project of the current folder\n" +
      "  cho serve <project> -- <args>   gives it arguments\n\n" +
      "A web application is started, and again when a file changes. A\n" +
      "command-line tool runs, and ends. A library does not run.",
  )
  @Action("serve", SERVE_FLAGS)
  async serve(ctx: ChoCommandContext): Promise<number> {
    const cwd = process.cwd();
    const flags = read_flags(ctx.args, ctx.argv);
    const root = find_workspace(cwd);
    const tree = new Tree(disk_host(root));
    const config = read_config(tree);
    return await serve_project(tree, config, flags, { root, cwd });
  }
}
