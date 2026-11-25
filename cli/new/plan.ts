/**
 * The plan of a workspace, and of a project: the list of the files, each
 * with its text.
 *
 * It is made from the answers alone, and reads nothing: what a command would
 * write is known, and tested, before a folder is created.
 *
 * - {@link project_files}: the files of one project, application or library.
 *   `cho new` and `cho add` both write a project with it.
 * - {@link plan_workspace}: the files of a new workspace, with its first
 *   application.
 * - {@link command_of}: the command that runs a project, on each runtime. A
 *   project has no scripts, so this is where the commands are.
 *
 * @module
 */

import type { Answers } from "./answers.ts";
import {
  type ChoProject,
  CONFIG_FILE,
  DEFAULTS,
  type Kind,
  make_config,
  type Runtime,
} from "./config.ts";
import {
  application_manifest,
  json_text,
  library_manifest,
  MANIFEST,
  type ManifestInput,
  NPMRC,
  PACKAGES,
  tsconfig,
  workspace_manifest,
} from "./manifests.ts";
import { INSTALL } from "./steps.ts";
import { TEMPLATES } from "./templates.gen.ts";

/** A file to write: its path from the root of the workspace, with `/`. */
export type PlannedFile = { path: string; text: string };

/** The marker of a template: the name of the project takes its place. */
const MARKER = "__name__";

/** `.gitignore`: what a runtime writes, and what is not shared. */
const GITIGNORE = "node_modules/\n.env\n";

/** What an application of each kind is, in the `README.md` of a workspace. */
const KIND_NAMES: Record<Kind, string> = {
  web: "A web application",
  cli: "A command-line tool",
};

/** The names of the runtimes. */
export const RUNTIME_NAMES: Record<Runtime, string> = {
  deno: "Deno",
  node: "Node.js",
  bun: "Bun",
};

/** What a project is run for. */
export type Task = "start" | "dev" | "test";

/**
 * The command that runs a project, from its folder.
 *
 * | Task    | Does                                                |
 * | ------- | --------------------------------------------------- |
 * | `start` | Runs the application                                |
 * | `dev`   | Runs it, and again when a file changes              |
 * | `test`  | Runs the tests of the project                       |
 *
 * - On Deno, a command has the permissions the project needs: `--allow-env`
 *   for a package of CHO, which reads its debug settings there, and
 *   `--allow-net` for a web application.
 * - On Node.js, `tsx` runs the project: Node.js does not run the decorators
 *   of TypeScript.
 * - A command-line tool is run with its first command, `hello`.
 *
 * @param runtime The runtime.
 * @param project The project, as `cho.json` has it. A library has tests, and
 *   nothing to start.
 * @param task What to run it for.
 * @returns The command line.
 */
export function command_of(
  runtime: Runtime,
  project: ChoProject,
  task: Task,
): string {
  if (task === "test") {
    switch (runtime) {
      case "deno":
        return project.type === "library"
          ? "deno test"
          : "deno test --allow-env";
      case "node":
        return "npx tsx --test";
      case "bun":
        return "bun test";
    }
  }
  const kind = project.type === "library" ? undefined : project.kind;
  const entry = project.entry ??
    (project.type === "library" ? DEFAULTS.libraryEntry : DEFAULTS.entry);
  const watch = task === "dev";
  // a command-line tool does nothing without a command
  const file = kind === "cli" ? `${entry} hello` : entry;
  switch (runtime) {
    case "deno": {
      const permissions = kind === "web"
        ? "--allow-net --allow-env"
        : "--allow-env";
      return `deno run ${permissions} ${watch ? "--watch " : ""}${file}`;
    }
    case "node":
      return `npx tsx ${watch ? "watch " : ""}${file}`;
    case "bun":
      return `bun ${watch ? "--watch " : ""}${file}`;
  }
}

/**
 * The files of one project: its manifest, its `tsconfig.json`, and the files
 * of its template.
 *
 * @param input The name of the workspace, the name of the project, and the
 *   version of `cho`.
 * @param project The project, as `cho.json` has it: its type, its kind, and
 *   its folder.
 * @returns The files, with paths from the root of the workspace.
 */
export function project_files(
  input: ManifestInput,
  project: ChoProject,
): PlannedFile[] {
  const library = project.type === "library";
  const manifest = library
    ? library_manifest(input, project.entry ?? DEFAULTS.libraryEntry)
    : application_manifest(input, project.kind);
  const template = TEMPLATES[library ? "library" : project.kind];

  const files: PlannedFile[] = [
    { path: `${project.root}/${MANIFEST}`, text: json_text(manifest) },
    { path: `${project.root}/tsconfig.json`, text: json_text(tsconfig()) },
  ];
  for (const [file, text] of Object.entries(template)) {
    files.push({
      path: `${project.root}/${file}`,
      text: text.replaceAll(MARKER, input.name),
    });
  }
  return files;
}

/** The commands of a project on one runtime, as a block of the `README.md`. */
function commands(runtime: Runtime, project: ChoProject): string {
  const lines = [
    INSTALL[runtime],
    command_of(runtime, project, "start"),
    command_of(runtime, project, "dev"),
    command_of(runtime, project, "test"),
  ];
  return `${RUNTIME_NAMES[runtime]}:\n\n\`\`\`sh\n${lines.join("\n")}\n\`\`\``;
}

/**
 * `README.md`: what the workspace is, and how its project is run on each
 * runtime.
 *
 * @param answers The answers.
 * @param project The first project of the workspace.
 * @param version The version of `cho`.
 * @returns The text of the file.
 */
function readme(
  answers: Answers,
  project: ChoProject,
  version: string,
): string {
  const { name, kind, runtime } = answers;
  return `# ${name}

A [CHO](https://chojs.io) workspace. It was created by \`cho new\`, of CHO
${version}.

- \`${project.root}/\`: ${KIND_NAMES[kind].toLowerCase()}, built with
  \`${PACKAGES[kind]}\`.
- \`${MANIFEST}\`: the workspace, and the folders of its projects.
- \`${CONFIG_FILE}\`: the settings of the workspace, read by \`cho\`.

The workspace is the same on Deno, on Node.js and on Bun: any of the three
installs it, and runs it. \`cho\` installs it with ${RUNTIME_NAMES[runtime]}
(\`runtime\`, in \`${CONFIG_FILE}\`).

## Running ${answers.project}

A project has no scripts: each runtime runs it with its own command. On each,
the first command installs the packages, once, at the root of the workspace.
The others run in \`${project.root}/\`: they run the project, run it again when
a file changes, and run its tests.

${commands("deno", project)}

${commands("node", project)}

${commands("bun", project)}

The project has three files:

- \`app.ts\`: the application, and its root module, \`AppModule\`.
- \`main.ts\`: the entry point, which runs the application.
- \`app_test.ts\`: the tests.

## Adding a project

\`\`\`sh
cho add
\`\`\`

It adds an application, or a library: plain TypeScript that the applications
of the workspace import.

## Formatting and linting

No formatter and no linter is installed. Deno has both, and they work on any
TypeScript project; Bun has a formatter.

\`\`\`sh
deno fmt
deno lint
bun fmt
\`\`\`
`;
}

/**
 * The files of a new workspace.
 *
 * @param answers What `cho new` was told.
 * @param version The version of `cho`: the projects depend on the packages
 *   of CHO of that version.
 * @returns The files, in the order they are written.
 */
export function plan_workspace(
  answers: Answers,
  version: string,
): PlannedFile[] {
  const { name, kind, runtime, appsDir } = answers;
  const config = make_config({
    runtime,
    appsDir,
    project: answers.project,
    kind,
  });
  // the one project of a new workspace
  const project = config.projects[answers.project]!;

  return [
    { path: CONFIG_FILE, text: json_text(config) },
    {
      path: MANIFEST,
      text: json_text(
        workspace_manifest(name, [appsDir, config.libsDir ?? DEFAULTS.libsDir]),
      ),
    },
    { path: ".npmrc", text: NPMRC },
    { path: ".gitignore", text: GITIGNORE },
    { path: "README.md", text: readme(answers, project, version) },
    ...project_files(
      { workspace: name, name: answers.project, version },
      project,
    ),
  ];
}
