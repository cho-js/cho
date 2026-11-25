/**
 * The project `cho serve` runs: which one, and whether it can be run.
 *
 * @module
 */

import {
  type ChoApplication,
  type ChoConfig,
  CONFIG_FILE,
  DEFAULTS,
  type Runtime,
} from "../new/config.ts";
import { cli_error } from "../errors.ts";
import { MANIFEST } from "../new/manifests.ts";
import { command_of } from "../new/plan.ts";
import { INSTALL } from "../new/steps.ts";
import type { Tree } from "../tree.ts";

/** An application of a workspace, with its name. */
export type Picked = { name: string; project: ChoApplication };

/** The names of a list, for a message: `api, admin`. */
function names_of(names: readonly string[]): string {
  return names.length === 0 ? "none" : names.join(", ");
}

/**
 * The project to run.
 *
 * 1. The one that is named.
 * 2. Else the one the current folder is in: its folder, or one under it.
 * 3. Else the application of the workspace, when it has one only.
 *
 * @param config The settings of the workspace.
 * @param name The name that was given, or `undefined`.
 * @param inside The current folder, from the root of the workspace, with
 *   `/`: `apps/api/src`, or `""` at the root.
 * @param runtime The runtime of the run: the message for a library has the
 *   command of its tests.
 * @returns The application, and its name.
 * @throws {ChoError} `CHO_CLI_UNKNOWN_PROJECT` when the name is not a
 *   project of the workspace, and when no name was given and none of the
 *   rules says which; `CHO_CLI_NOT_AN_APPLICATION` for a library.
 */
export function pick_project(
  config: ChoConfig,
  name: string | undefined,
  inside: string,
  runtime: Runtime,
): Picked {
  const projects = Object.entries(config.projects);
  const applications = projects
    .filter(([, project]) => project.type !== "library")
    .map(([name]) => name);

  let picked = name;
  if (picked === undefined) {
    // the project the current folder is in: the deepest one, if two are
    const here = projects
      .filter(([, { root }]) =>
        inside === root || inside.startsWith(`${root}/`)
      )
      .sort(([, a], [, b]) => b.root.length - a.root.length)[0];
    picked = here?.[0] ?? (applications.length === 1 ? applications[0] : name);
  }
  if (picked === undefined) {
    throw cli_error(
      "CHO_CLI_UNKNOWN_PROJECT",
      "Which project? Name one: cho serve <project>. The applications of " +
        `the workspace: ${names_of(applications)}`,
    );
  }

  const project = config.projects[picked];
  if (project === undefined) {
    throw cli_error(
      "CHO_CLI_UNKNOWN_PROJECT",
      `The workspace has no project named ${picked}. Its projects: ` +
        names_of(projects.map(([name]) => name)),
    );
  }
  if (project.type === "library") {
    throw cli_error(
      "CHO_CLI_NOT_AN_APPLICATION",
      `${picked} is a library: it does not run. Its tests do, in ` +
        `${project.root}: ${command_of(runtime, project, "test")}`,
    );
  }
  return { name: picked, project };
}

/**
 * Check that an application can be run: its entry is a file, and the
 * packages of the workspace are installed.
 *
 * The second is checked in a workspace that has a `package.json`: there, a
 * runtime finds the packages in `node_modules`, and `npx` would propose to
 * download `tsx` when it is not there.
 *
 * @param tree The tree of the workspace.
 * @param picked The application, and its name.
 * @param runtime The runtime of the run: the one that installs.
 * @throws {ChoError} `CHO_CLI_INVALID_CONFIG` when the entry is not a file;
 *   `CHO_CLI_NOT_INSTALLED` when the packages are not installed.
 */
export function check_ready(
  tree: Tree,
  picked: Picked,
  runtime: Runtime,
): void {
  const { name, project } = picked;
  const entry = `${project.root}/${project.entry ?? DEFAULTS.entry}`;
  if (tree.read(entry) === undefined) {
    throw cli_error(
      "CHO_CLI_INVALID_CONFIG",
      `${CONFIG_FILE}: projects.${name}.entry: there is no file ${entry}`,
    );
  }
  if (tree.exists(MANIFEST) && !tree.exists("node_modules")) {
    throw cli_error(
      "CHO_CLI_NOT_INSTALLED",
      "The packages of the workspace are not installed. Run " +
        `${INSTALL[runtime]} at its root, then cho serve again.`,
    );
  }
}
