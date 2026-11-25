/**
 * The `generate` command: `cho generate <part> <name>` writes a part of an
 * application, in a file of its own: a controller, a service, or a module.
 *
 * It writes new files, and changes none: the part is not added to a module.
 * The tool says what to add, and where.
 *
 * It reads top to bottom:
 *
 * 1. `read_flags` checks what the command line said (`flags.ts`).
 * 2. `find_workspace` and `read_config` find the workspace, and read its
 *    `cho.json` (`../add/workspace.ts`).
 * 3. `ask_answers` asks for the rest (`answers.ts`).
 * 4. `part_files` lists the files of the part (`plan.ts`).
 * 5. The files are recorded on a tree, and `commit` writes them
 *    (`../tree.ts`). With `--dry-run`, they are printed.
 *
 * See `specs.md`, section 6.
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
import { find_workspace, read_config } from "../add/workspace.ts";
import { print_error } from "../errors.ts";
import type { ChoConfig } from "../new/config.ts";
import { print_dry_run } from "../new/steps.ts";
import { commit, disk_host, Tree } from "../tree.ts";
import { application_of, ask_answers } from "./answers.ts";
import { GENERATE_FLAGS, read_flags } from "./flags.ts";
import { explanation, type Generation, part_files } from "./plan.ts";

/**
 * Write a part of an application, from the answers, and say what to do with
 * it.
 *
 * @param tree The tree of the workspace.
 * @param config The settings of the workspace.
 * @param generation The answers.
 * @param dry_run `true` for `--dry-run`: what would be written is printed,
 *   and nothing is done.
 * @returns The exit code: `0`.
 * @throws {ChoError} `CHO_CLI_TARGET_EXISTS` when a file of the part exists,
 *   and `CHO_CLI_WRITE_FAILED` when one cannot be written: nothing is left.
 */
export async function generate_part(
  tree: Tree,
  config: ChoConfig,
  generation: Generation,
  dry_run = false,
): Promise<number> {
  const project = application_of(config, generation.project);
  const files = part_files(generation, project);
  for (const file of files) {
    tree.create(file.path, file.text);
  }
  if (dry_run) {
    print_dry_run(tree.changes(), []);
    return 0;
  }
  await commit(tree);
  console.log(`Created ${files.map((file) => file.path).join(", ")}`);
  console.log(`\n${explanation(generation, project, config.runtime)}`);
  return 0;
}

/**
 * The error handler of the command: what it prints for an error, and the
 * exit code.
 *
 * @param error What the command threw.
 * @returns `130` for a question that was cancelled, `1` for anything else.
 */
export function report_error(error: unknown): number {
  return print_error(error, "cho generate");
}

/** The command that writes a part of an application. */
@Catch(report_error)
@Controller()
export class GenerateCommand {
  /**
   * `cho generate [part] [name]`.
   *
   * @param ctx The context of the run: the part, the name, and the flags.
   * @returns The exit code: `0`. What it throws goes to
   *   {@link report_error}.
   */
  @Help(
    "Write a part of an application: a controller, a service or a module\n\n" +
      "  cho generate                      asks for everything\n" +
      "  cho generate controller users     writes users.ts, and its test\n" +
      "  cho generate service userStore    writes user-store.ts, and its test\n" +
      "  cho generate module orders        writes orders.ts\n\n" +
      "The name is the name of the file and of the class: no type is added\n" +
      "to it. The part is not added to a module: the command says what to add.",
  )
  @Action("generate", GENERATE_FLAGS)
  async generate(ctx: ChoCommandContext): Promise<number> {
    const cwd = process.cwd();
    const flags = read_flags(ctx.args);
    const root = find_workspace(cwd);
    const tree = new Tree(disk_host(root));
    const config = read_config(tree);
    const inside = relative(root, cwd).replaceAll("\\", "/");
    const generation = await ask_answers(flags, config, tree, inside);
    return generate_part(tree, config, generation, flags.dryRun);
  }
}
