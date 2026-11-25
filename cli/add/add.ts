/**
 * The `add` command: `cho add <name>` adds a project to the workspace it is
 * run in.
 *
 * A project is an application, which runs, or a library, which is plain
 * TypeScript that other projects import.
 *
 * It reads top to bottom:
 *
 * 1. `read_flags` checks what the command line said (`flags.ts`).
 * 2. `find_workspace` and `read_workspace` find the workspace, and read its
 *    `cho.json` and its `package.json` (`workspace.ts`).
 * 3. `ask_answers` asks for the rest (`answers.ts`).
 * 4. `plan_project` records the files of the project, and the two files of
 *    the root that change, on a tree (`plan.ts`).
 * 5. `commit` writes the tree (`../tree.ts`). With `--dry-run`, it is
 *    printed.
 * 6. `run_steps` installs the packages, when asked for.
 *
 * Nothing is written before the last answer, and a failure leaves the
 * workspace as it was. See `specs.md`, section 4.
 *
 * @module
 */

import { relative } from "node:path";
import process from "node:process";
import {
  Action,
  Catch,
  type ChoCommandContext,
  Controller,
  Help,
} from "@chojs/command";
import config from "../deno.json" with { type: "json" };
import type { ChoProject, Runtime } from "../new/config.ts";
import { print_error } from "../errors.ts";
import { package_name } from "../new/manifests.ts";
import { command_of, serve_line } from "../new/plan.ts";
import { INSTALL, print_dry_run, run_steps } from "../new/steps.ts";
import { commit, disk_host, Tree } from "../tree.ts";
import { type Answers, ask_answers } from "./answers.ts";
import { ADD_FLAGS, read_flags } from "./flags.ts";
import { plan_project } from "./plan.ts";
import { find_workspace, read_workspace, type Workspace } from "./workspace.ts";

/** Where a command runs: the root of the workspace, and the current folder. */
export type Where = { root: string; cwd: string };

/** `cd`, from a folder to another: `undefined` when they are the same. */
function cd(from: string, to: string): string | undefined {
  const path = relative(from, to).replaceAll("\\", "/");
  return path === "" ? undefined : `cd ${path}`;
}

/**
 * The commands that say what to do next, each on its line.
 *
 * An application is run by `cho serve`, from any folder of the workspace. A
 * library has nothing to run: its tests are, in its folder.
 *
 * @param name The name of the project that was added.
 * @param project The project.
 * @param runtime The runtime of the workspace.
 * @param where The root of the workspace, and the current folder.
 * @param installed Whether the packages were installed. When they were not,
 *   the first command installs them, at the root of the workspace.
 * @returns The lines, indented.
 */
export function next_steps(
  name: string,
  project: ChoProject,
  runtime: Runtime,
  where: Where,
  installed: boolean,
): string {
  const folder = `${where.root}/${project.root}`;
  const lines = installed ? [] : [cd(where.cwd, where.root), INSTALL[runtime]];
  if (project.type === "library") {
    lines.push(
      installed ? cd(where.cwd, folder) : `cd ${project.root}`,
      command_of(runtime, project, "test"),
    );
  } else {
    lines.push(serve_line(name, project.kind));
  }
  return lines.filter((line) => line !== undefined)
    .map((line) => `  ${line}`).join("\n");
}

/**
 * How an application uses a library that was added.
 *
 * @param name The name of the package of the library: `@shop/shared`.
 * @param runtime The runtime of the workspace.
 * @returns The text.
 */
export function usage(name: string, runtime: Runtime): string {
  return "To use it in an application, add it to the dependencies of the\n" +
    `package.json of the application, and run ${INSTALL[runtime]} at the ` +
    "root of the\nworkspace:\n\n" +
    `  "dependencies": { "${name}": "*" }\n\n` +
    `  import { greet } from "${name}";`;
}

/**
 * Add a project to a workspace, from the answers: plan it, write it, then
 * install.
 *
 * An installation that fails leaves the workspace, which is whole: the
 * command to run by hand is printed.
 *
 * @param tree The tree of the workspace.
 * @param workspace The workspace, as it was read.
 * @param answers The answers.
 * @param where The root of the workspace, and the current folder.
 * @param dry_run `true` for `--dry-run`: what would be written and run is
 *   printed, and nothing is done.
 * @returns The exit code: `0`, or `1` when the installation failed.
 * @throws {ChoError} What `plan_project` and `commit` throw: the workspace
 *   is as it was.
 */
export async function add_project(
  tree: Tree,
  workspace: Workspace,
  answers: Answers,
  where: Where,
  dry_run = false,
): Promise<number> {
  const { runtime } = workspace.config;
  const project = plan_project(tree, workspace, answers, config.version);
  const steps = answers.install ? [INSTALL[runtime]] : [];

  const changes = tree.changes();
  if (dry_run) {
    print_dry_run(changes, steps);
    return 0;
  }
  await commit(tree);

  const created = changes.filter((change) => change.kind === "create");
  const updated = changes.filter((change) => change.kind === "update");
  console.log(
    `Added ${answers.name} in ${project.root} (${created.length} files)`,
  );
  console.log(`Updated ${updated.map((change) => change.path).join(", ")}`);

  const failed = await run_steps(steps, where.root);
  for (const step of failed) {
    console.error(
      `Error: ${step} failed. The workspace is whole: run it at its root.`,
    );
  }

  const installed = answers.install && failed.length === 0;
  console.log(
    `\n${next_steps(answers.name, project, runtime, where, installed)}`,
  );
  if (project.type === "library") {
    const name = package_name(workspace.name, answers.name);
    console.log(`\n${usage(name, runtime)}`);
  }
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
  return print_error(error, "cho add");
}

/** The command that adds a project to a workspace. */
@Catch(report_error)
@Controller()
export class AddCommand {
  /**
   * `cho add [name]`.
   *
   * @param ctx The context of the run: the name, and the flags.
   * @returns The exit code: `0`, or `1` when the installation failed. What
   *   it throws goes to {@link report_error}.
   */
  @Help(
    "Add a project to the workspace: an application, or a library\n\n" +
      "  cho add                         asks for everything\n" +
      "  cho add <name>                  asks for the rest\n" +
      "  cho add <name> --type library   adds a library\n\n" +
      "It runs in a workspace: a folder with a cho.json, or any folder under\n" +
      "it. An application runs. A library is plain TypeScript, that the\n" +
      "applications import. The project <name> must not exist.",
  )
  @Action("add", ADD_FLAGS)
  async add(ctx: ChoCommandContext): Promise<number> {
    const cwd = process.cwd();
    const flags = read_flags(ctx.args);
    const root = find_workspace(cwd);
    const tree = new Tree(disk_host(root));
    const workspace = read_workspace(tree);
    const answers = await ask_answers(flags, workspace, tree);
    return add_project(tree, workspace, answers, { root, cwd }, flags.dryRun);
  }
}
