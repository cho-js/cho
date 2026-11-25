/**
 * The plan of `cho add`: what adding a project changes in a workspace,
 * recorded on its tree.
 *
 * | File           | Change                                               |
 * | -------------- | ---------------------------------------------------- |
 * | The project    | Its files, created in a folder that does not exist   |
 * | `cho.json`     | The project, added to `projects`                     |
 * | `package.json` | The folder, added to `workspaces` when no pattern    |
 * |                | there has it                                         |
 *
 * Nothing is written here: the command commits the tree, or prints it.
 *
 * @module
 */

import {
  type ChoConfig,
  type ChoProject,
  CONFIG_FILE,
  make_project,
} from "../new/config.ts";
import { cli_error } from "../errors.ts";
import { json_text, MANIFEST, with_member } from "../new/manifests.ts";
import { project_files } from "../new/plan.ts";
import type { Tree } from "../tree.ts";
import { type Answers, folder_of, name_problem } from "./answers.ts";
import type { Workspace } from "./workspace.ts";

/**
 * Record a new project on the tree of a workspace: its files first, then the
 * two files of the root that name it.
 *
 * @param tree The tree of the workspace.
 * @param workspace The workspace, as it was read.
 * @param answers What `cho add` was told.
 * @param version The version of `cho`: an application depends on the package
 *   of CHO of that version.
 * @returns The project, as `cho.json` has it.
 * @throws {ChoError} `CHO_CLI_PROJECT_EXISTS` when the workspace has a
 *   project of that name, `CHO_CLI_TARGET_EXISTS` when its folder exists,
 *   and `CHO_CLI_INVALID_MANIFEST` when `workspaces` is not a list.
 */
export function plan_project(
  tree: Tree,
  workspace: Workspace,
  answers: Answers,
  version: string,
): ChoProject {
  const { name, choice } = answers;
  // Checked again here: the plan does not depend on who made the answers.
  const problem = name_problem(name, workspace, tree, choice);
  if (problem) {
    throw cli_error(problem.code, `${problem.mistake}. Nothing was written.`);
  }

  const root = `${folder_of(workspace.config, choice)}/${name}`;
  const project = make_project(choice, root);
  const input = { workspace: workspace.name, name, version };
  for (const file of project_files(input, project)) {
    tree.create(file.path, file.text);
  }

  const config: ChoConfig = {
    ...workspace.config,
    projects: { ...workspace.config.projects, [name]: project },
  };
  tree.update(CONFIG_FILE, json_text(config));

  const manifest = with_member(workspace.manifest, root);
  if (manifest !== undefined) {
    tree.update(MANIFEST, json_text(manifest));
  }
  return project;
}
