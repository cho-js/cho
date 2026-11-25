/**
 * The plan of `cho generate`: the files of a part, and what the tool says of
 * them.
 *
 * It is made from the answers alone, and reads nothing. A part is written
 * from its template: `templates/<kind>/<part>/`, real TypeScript of the
 * repository, held as text in `templates.gen.ts`.
 *
 * No file of the user is changed: a part is not added to a module. The tool
 * says what to add, and where.
 *
 * @module
 */

import { posix } from "node:path";
import { type ChoApplication, DEFAULTS, type Runtime } from "../new/config.ts";
import { command_of, type PlannedFile } from "../new/plan.ts";
import { class_name, file_name, type Part } from "./parts.ts";
import { PART_TEMPLATES } from "./templates.gen.ts";

/** The markers of a template: the name of the file, and the one of the class. */
const FILE_MARKER = "__name__";
const CLASS_MARKER = "__Name__";

/** What `cho generate` writes a part from: every question, answered. */
export type Generation = {
  /** The part. */
  part: Part;
  /** The name, as it was typed. */
  name: string;
  /** The name of the project the part is for. */
  project: string;
  /** The folder of the file, from the root of the workspace. */
  folder: string;
};

/**
 * The files of a part: the class, and its test when the part has one.
 *
 * The two markers are replaced in the text of a file, and in its name:
 * `__name__.ts` is `users.ts`.
 *
 * @param generation The answers.
 * @param project The application the part is for: its kind says which
 *   package of CHO the decorators come from.
 * @returns The files, with paths from the root of the workspace.
 */
export function part_files(
  generation: Generation,
  project: ChoApplication,
): PlannedFile[] {
  const file = file_name(generation.name);
  const name = class_name(generation.name);
  const mark = (text: string) =>
    text.replaceAll(CLASS_MARKER, name).replaceAll(FILE_MARKER, file);

  const template = PART_TEMPLATES[project.kind][generation.part];
  return Object.entries(template).map(([path, text]) => ({
    path: `${generation.folder}/${mark(path)}`,
    text: mark(text),
  }));
}

/** Where each part goes, in the `@Module` of a module. */
const FIELDS: Record<Part, string> = {
  controller: "controllers",
  service: "providers",
  module: "imports",
};

/**
 * What the tool says after it wrote a part: nothing uses it yet, and what to
 * add to a module for that.
 *
 * @param generation The answers.
 * @param project The application the part is for.
 * @param runtime The runtime of the workspace: the command of the tests is
 *   the one of it.
 * @returns The text.
 */
export function explanation(
  generation: Generation,
  project: ChoApplication,
  runtime: Runtime,
): string {
  const { part, folder } = generation;
  const name = class_name(generation.name);
  const module = `${project.root}/${project.module ?? DEFAULTS.module}`;
  // how the module of the project imports the file: `./users/users.ts`
  const from = posix.relative(
    posix.dirname(module),
    `${folder}/${file_name(generation.name)}.ts`,
  );

  const lines = [
    `Nothing uses it yet. Add it to a module, as the one of ${module}:`,
    "",
    `  import { ${name} } from "${from.startsWith(".") ? from : `./${from}`}";`,
    "",
    `  @Module({ ${FIELDS[part]}: [${name}] })`,
  ];
  if (part === "service") {
    lines.push(
      "",
      "A class that uses it names it in its dependencies, and takes it in its",
      "constructor:",
      "",
      `  @Controller({ dependencies: [${name}] })`,
    );
  }
  if (part !== "module") {
    lines.push(
      "",
      `Its test runs with the tests of the project, in ${project.root}:`,
      "",
      `  ${command_of(runtime, project, "test")}`,
    );
  }
  return lines.join("\n");
}
