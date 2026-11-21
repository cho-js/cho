/**
 * The plan of a workspace: the list of its files, each with its text.
 *
 * It is made from the answers alone, and reads nothing: what `cho new` would
 * write is known, and tested, before a folder is created.
 *
 * @module
 */

import type { Answers } from "./answers.ts";
import { CONFIG_FILE, type Kind, make_config, type Runtime } from "./config.ts";
import {
  json_text,
  type ManifestInput,
  NPMRC,
  PACKAGES,
  project_manifest,
  RUN_TASK,
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

/** What a project of each kind is, in the `README.md` of a workspace. */
const KIND_NAMES: Record<Kind, string> = {
  web: "A web application",
  cli: "A command-line tool",
};

/** The names of the runtimes. */
const RUNTIME_NAMES: Record<Runtime, string> = {
  deno: "Deno",
  node: "Node.js",
  bun: "Bun",
};

/**
 * The formatter and the linter a workspace is pointed to. None is installed:
 * Deno and Bun have their own, and Node.js, which has none, is pointed to
 * those of Deno.
 */
const FORMATTING: Record<Runtime, { text: string; commands: string[] }> = {
  deno: {
    text: "Deno formats and lints the code: nothing more is installed.",
    commands: ["deno fmt", "deno lint"],
  },
  bun: {
    text: "Bun formats the code: nothing more is installed.",
    commands: ["bun fmt"],
  },
  node: {
    text:
      "Node.js has no formatter and no linter, and none is installed. Those of\n" +
      "Deno work on any TypeScript project, with nothing to set up.",
    commands: ["deno fmt", "deno lint"],
  },
};

/**
 * How a task of a project is run, from its folder.
 *
 * A command-line tool is started with its first command, `hello`: npm wants
 * `--` before the arguments of a script.
 *
 * @param runtime The runtime of the workspace.
 * @param kind The kind of the project.
 * @param task The task.
 * @returns The command line.
 */
export function task_command(
  runtime: Runtime,
  kind: Kind,
  task: "dev" | "start" | "test",
): string {
  const command = `${RUN_TASK[runtime]} ${task}`;
  if (kind === "cli" && task === "start") {
    return runtime === "node" ? `${command} -- hello` : `${command} hello`;
  }
  return command;
}

/**
 * `README.md`: what the workspace is, and how its project is run.
 *
 * @param answers The answers.
 * @param version The version of `cho`.
 * @returns The text of the file.
 */
function readme(answers: Answers, version: string): string {
  const { name, project, appsDir, runtime, kind } = answers;
  const manifest = runtime === "deno" ? "deno.json" : "package.json";
  const formatting = FORMATTING[runtime];
  return `# ${name}

A [CHO](https://chojs.io) workspace, on ${RUNTIME_NAMES[runtime]}. It was
created by \`cho new\`, of CHO ${version}.

- \`${appsDir}/${project}/\`: ${KIND_NAMES[kind].toLowerCase()}, built with
  \`${PACKAGES[kind]}\`.
- \`${manifest}\`: the workspace, and the projects it holds.
- \`${CONFIG_FILE}\`: the settings of the workspace, read by \`cho\`.

## Running ${project}

Install the packages once, at the root of the workspace:

\`\`\`sh
${INSTALL[runtime]}
\`\`\`

Then, in \`${appsDir}/${project}/\`:

\`\`\`sh
${task_command(runtime, kind, "dev")}
${task_command(runtime, kind, "start")}
${task_command(runtime, kind, "test")}
\`\`\`

- \`dev\` runs the project, and again when a file changes.
- \`start\` runs it.
- \`test\` runs its tests.

The project has three files:

- \`app.ts\`: the application, and its root module, \`AppModule\`.
- \`main.ts\`: the entry point, which runs the application.
- \`app_test.ts\`: the tests.

## Formatting and linting

${formatting.text}

\`\`\`sh
${formatting.commands.join("\n")}
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
  const { name, kind, runtime, project, appsDir } = answers;
  const input: ManifestInput = {
    name,
    project,
    kind,
    runtime,
    appsDir,
    version,
  };
  const manifest = runtime === "deno" ? "deno.json" : "package.json";
  const root = `${appsDir}/${project}`;

  const files: PlannedFile[] = [
    {
      path: CONFIG_FILE,
      text: json_text(make_config({ runtime, appsDir, project, kind })),
    },
    { path: manifest, text: json_text(workspace_manifest(input)) },
  ];
  if (runtime !== "deno") {
    files.push({ path: ".npmrc", text: NPMRC });
  }
  files.push(
    { path: ".gitignore", text: GITIGNORE },
    { path: "README.md", text: readme(answers, version) },
    { path: `${root}/${manifest}`, text: json_text(project_manifest(input)) },
  );
  if (runtime !== "deno") {
    files.push({
      path: `${root}/tsconfig.json`,
      text: json_text(tsconfig(runtime)),
    });
  }
  for (const [file, text] of Object.entries(TEMPLATES[kind])) {
    files.push({
      path: `${root}/${file}`,
      text: text.replaceAll(MARKER, project),
    });
  }
  return files;
}
