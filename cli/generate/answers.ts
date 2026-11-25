/**
 * The answers of `cho generate`: what the command line said, and what the
 * questions ask for the rest.
 *
 * | Answer  | On the command line | Default                              |
 * | ------- | ------------------- | ------------------------------------ |
 * | Part    | The first word      | None                                 |
 * | Name    | The second word     | None                                 |
 * | Project | `--project`         | The one of the current folder        |
 * | Folder  | `--path`            | The folder of the project            |
 *
 * The project is not asked when the workspace has one application. The
 * folder that is proposed is the one of the project, and another one can be
 * typed: a folder under it.
 *
 * @module
 */

import { type ChoPrompts, createPrompts } from "@chojs/prompt";
import { cli_error } from "../errors.ts";
import type { ChoApplication, ChoConfig } from "../new/config.ts";
import { project_at } from "../serve/project.ts";
import type { Tree } from "../tree.ts";
import { type Flags, path_mistake } from "./flags.ts";
import { file_name, part_mistake } from "./parts.ts";
import type { Generation } from "./plan.ts";

/** The applications of a workspace, by name. */
function applications_of(config: ChoConfig): Record<string, ChoApplication> {
  const applications: Record<string, ChoApplication> = {};
  for (const [name, project] of Object.entries(config.projects)) {
    if (project.type !== "library") {
      applications[name] = project;
    }
  }
  return applications;
}

/**
 * The application a part is for, by its name.
 *
 * @param config The settings of the workspace.
 * @param name The name of the project.
 * @returns The application.
 * @throws {ChoError} `CHO_CLI_UNKNOWN_PROJECT` when the workspace has no
 *   such project; `CHO_CLI_NOT_AN_APPLICATION` for a library, which has no
 *   package of CHO: no decorator to import.
 */
export function application_of(
  config: ChoConfig,
  name: string,
): ChoApplication {
  const project = config.projects[name];
  if (project === undefined) {
    const names = Object.keys(config.projects);
    throw cli_error(
      "CHO_CLI_UNKNOWN_PROJECT",
      `The workspace has no project named ${name}. Its projects: ` +
        (names.length === 0 ? "none" : names.join(", ")),
    );
  }
  if (project.type === "library") {
    throw cli_error(
      "CHO_CLI_NOT_AN_APPLICATION",
      `${name} is a library: it is plain TypeScript, with no package of ` +
        "CHO. A part is generated in an application.",
    );
  }
  return project;
}

/**
 * What is wrong with the folder of a part: it is not a folder of the
 * project, or the file of the part is there already.
 *
 * @param folder The folder, from the root of the workspace.
 * @param root The folder of the project.
 * @param file The name of the file of the part, with no extension.
 * @param tree The tree of the workspace.
 * @returns The mistake, as a sentence with no full stop, or `undefined`.
 */
export function folder_mistake(
  folder: string,
  root: string,
  file: string,
  tree: Tree,
): string | undefined {
  const mistake = path_mistake(folder);
  if (mistake !== undefined) {
    return mistake;
  }
  // the file imports the package of CHO of the project
  if (folder !== root && !folder.startsWith(`${root}/`)) {
    return `A folder of the project: ${root}, or one under it`;
  }
  return tree.exists(`${folder}/${file}.ts`)
    ? `${folder}/${file}.ts exists already`
    : undefined;
}

/**
 * Ask what the command line did not say.
 *
 * The questions are asked in the order of the table of this module. Nothing
 * is written while they are asked.
 *
 * @param flags What the command line said: `read_flags`.
 * @param config The settings of the workspace.
 * @param tree The tree of the workspace: a file that exists is refused.
 * @param inside The current folder, from the root of the workspace, with
 *   `/`: the project it is in is the one that is proposed.
 * @param ask The questions. Default: those of `@chojs/prompt`, on the
 *   terminal of the process. A test gives those of a scripted terminal.
 * @returns The answers.
 * @throws {ChoError} `CHO_CLI_UNKNOWN_PROJECT` for a `--project` that is not
 *   a project, and when `--yes` cannot say which; for a library,
 *   `CHO_CLI_NOT_AN_APPLICATION`; for a `--path` that is not in the project,
 *   `CHO_CLI_INVALID_OPTION`, and for a file that exists there,
 *   `CHO_CLI_TARGET_EXISTS`. As rejections of a question:
 *   `CHO_PROMPT_CANCELLED`, and `CHO_PROMPT_NO_TERMINAL`.
 */
export async function ask_answers(
  flags: Flags,
  config: ChoConfig,
  tree: Tree,
  inside: string,
  ask: ChoPrompts = createPrompts(),
): Promise<Generation> {
  const { yes } = flags;

  // The part and the name have no default: `--yes` does not answer them.
  const part = flags.part ?? await ask.select({
    message: "What are you generating?",
    choices: [
      { value: "controller", label: "A controller" },
      { value: "service", label: "A service", hint: "@Injectable" },
      { value: "module", label: "A module" },
    ],
  });
  const name = flags.name ?? await ask.text({
    message: "Name",
    validate: part_mistake,
  });

  const applications = applications_of(config);
  const names = Object.keys(applications);
  let project = flags.project;
  if (project === undefined) {
    // the application the current folder is in, when it is in one
    const here = project_at(config, inside);
    const proposed = here !== undefined && here in applications
      ? here
      : undefined;
    if (names.length === 1) {
      project = names[0];
    } else if (yes && proposed !== undefined) {
      project = proposed;
    } else if (yes || names.length === 0) {
      throw cli_error(
        "CHO_CLI_UNKNOWN_PROJECT",
        "Which project? Name one: --project <name>. The applications of " +
          `the workspace: ${names.length === 0 ? "none" : names.join(", ")}`,
      );
    } else {
      project = await ask.select({
        message: "Project",
        choices: names.map((name) => ({
          value: name,
          label: name,
          hint: applications[name]!.root,
        })),
        default: proposed ?? names[0]!,
      });
    }
  }
  const application = application_of(config, project!);

  const file = file_name(name);
  const { root } = application;
  let folder = flags.path;
  if (folder === undefined) {
    folder = yes ? root : await ask.text({
      message: "Folder",
      default: root,
      validate: (value) => folder_mistake(value, root, file, tree),
    });
  }
  // a flag, and the default of `--yes`, are checked as an answer is
  const mistake = folder_mistake(folder, root, file, tree);
  if (mistake !== undefined) {
    throw cli_error(
      mistake.endsWith("exists already")
        ? "CHO_CLI_TARGET_EXISTS"
        : "CHO_CLI_INVALID_OPTION",
      flags.path === undefined
        ? `${mistake}. Nothing was written.`
        : `--path ${folder}: ${mistake}. Nothing was written.`,
    );
  }

  return { part, name, project: project!, folder };
}
