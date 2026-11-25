/**
 * `cho.json`: the settings of a workspace, at its root.
 *
 * - The constants say what a workspace can be: the types and the kinds of its
 *   projects, its runtimes.
 * - {@link make_config} makes the settings of a new workspace, and
 *   {@link make_project} those of a new project.
 * - {@link check_config} checks what was read from a file.
 * - {@link config_schema} is the JSON Schema of the file, made from the same
 *   constants: `cho.schema.json` is its text.
 *
 * @module
 */

import { cli_error } from "../errors.ts";
import { name_mistake, NAME_PATTERN } from "./names.ts";

/** The name of the file. */
export const CONFIG_FILE = "cho.json";

/** The version of the format of the file. */
export const CONFIG_VERSION = 1;

/**
 * The address of the schema. It has the version of the format: another
 * version gets another address.
 */
export const SCHEMA_URL = `https://chojs.io/schema/cho.v${CONFIG_VERSION}.json`;

/**
 * The types of a project. An application runs: it has an entry point. A
 * library does not: other projects import it.
 */
export const TYPES = ["application", "library"] as const;

/** The kinds of an application. */
export const KINDS = ["web", "cli"] as const;

/** The runtimes of a workspace. */
export const RUNTIMES = ["deno", "node", "bun"] as const;

/**
 * The templates of a project: one for each kind of application, and one for
 * a library.
 */
export const TEMPLATE_NAMES = [...KINDS, "library"] as const;

/**
 * What an application of each kind needs, to be run.
 *
 * - `net`: it uses the network. On Deno, it is run with `--allow-net`.
 * - `stays`: it stays up until it is stopped, as a server does. It is run
 *   again when a file changes. A kind that does not stay runs, and ends.
 *
 * A new kind is a row here: `cho serve` reads nothing else of a kind.
 */
export const KIND_TRAITS: Record<
  typeof KINDS[number],
  { net: boolean; stays: boolean }
> = {
  web: { net: true, stays: true },
  cli: { net: false, stays: false },
};

/** What a field that is not written means. */
export const DEFAULTS = {
  appsDir: "apps",
  libsDir: "libs",
  type: "application",
  entry: "main.ts",
  module: "app.ts",
  /** `entry`, for a library. */
  libraryEntry: "mod.ts",
} as const;

/** A type of project: whether it runs. */
export type ProjectType = typeof TYPES[number];

/** A kind of application: what it is built with. */
export type Kind = typeof KINDS[number];

/** A runtime: what installs a workspace, and runs its projects. */
export type Runtime = typeof RUNTIMES[number];

/** The name of a template. */
export type TemplateName = typeof TEMPLATE_NAMES[number];

/** An application of a workspace. */
export type ChoApplication = {
  /** The type of the project. Default: `application`. */
  type?: "application";
  /** What the application is built with. */
  kind: Kind;
  /** The folder of the project, from the root of the workspace. */
  root: string;
  /** The file that runs the project, from its folder. Default: `main.ts`. */
  entry?: string;
  /**
   * The file that exports the root module, as `AppModule`, from the folder
   * of the project. Default: `app.ts`.
   */
  module?: string;
};

/** A library of a workspace. It has no kind, and no module. */
export type ChoLibrary = {
  /** The type of the project. */
  type: "library";
  /** The folder of the project, from the root of the workspace. */
  root: string;
  /** The file the library exports, from its folder. Default: `mod.ts`. */
  entry?: string;
};

/** A project of a workspace. */
export type ChoProject = ChoApplication | ChoLibrary;

/** What a new project is: its type, and the kind of an application. */
export type ProjectChoice =
  | { type: "application"; kind: Kind }
  | { type: "library" };

/** The settings of a workspace: what `cho.json` holds. */
export type ChoConfig = {
  /** The address of the schema, for an editor. */
  $schema?: string;
  /** The version of the format. */
  version: typeof CONFIG_VERSION;
  /**
   * The runtime the workspace is installed with. A workspace is the same on
   * the three: this one is the tool `cho` installs it with.
   */
  runtime: Runtime;
  /** The folder a new application is created in. Default: `apps`. */
  appsDir?: string;
  /** The folder a new library is created in. Default: `libs`. */
  libsDir?: string;
  /** The projects, by name. */
  projects: Record<string, ChoProject>;
};

/**
 * The settings of a new project. Every field is written, the ones with a
 * default too.
 *
 * @param choice The type of the project, and the kind of an application.
 * @param root The folder of the project, from the root of the workspace.
 * @returns The settings.
 */
export function make_project(
  choice: { type: "application"; kind: Kind },
  root: string,
): ChoApplication;
export function make_project(
  choice: { type: "library" },
  root: string,
): ChoLibrary;
export function make_project(choice: ProjectChoice, root: string): ChoProject;
export function make_project(choice: ProjectChoice, root: string): ChoProject {
  if (choice.type === "library") {
    return { type: "library", root, entry: DEFAULTS.libraryEntry };
  }
  return {
    type: "application",
    kind: choice.kind,
    root,
    entry: DEFAULTS.entry,
    module: DEFAULTS.module,
  };
}

/**
 * The settings of a new workspace, with one application. Every field is
 * written, the ones with a default too.
 *
 * @param workspace The runtime, the folder of the applications, and the
 *   first one: its name and its kind.
 * @returns The settings.
 */
export function make_config(workspace: {
  runtime: Runtime;
  appsDir: string;
  project: string;
  kind: Kind;
}): ChoConfig {
  return {
    $schema: SCHEMA_URL,
    version: CONFIG_VERSION,
    runtime: workspace.runtime,
    appsDir: workspace.appsDir,
    libsDir: DEFAULTS.libsDir,
    projects: {
      [workspace.project]: make_project(
        { type: "application", kind: workspace.kind },
        `${workspace.appsDir}/${workspace.project}`,
      ),
    },
  };
}

// Checking
// -----------------------------------------------------------------------------

/** The fields of the file, of an application, and of a library. */
const FIELDS = [
  "$schema",
  "version",
  "runtime",
  "appsDir",
  "libsDir",
  "projects",
];
const APPLICATION_FIELDS = ["type", "kind", "root", "entry", "module"];
const LIBRARY_FIELDS = ["type", "root", "entry"];

/** The error of a field that is not what it must be. */
function invalid(field: string, what: string): Error {
  return cli_error(
    "CHO_CLI_INVALID_CONFIG",
    field === ""
      ? `${CONFIG_FILE}: ${what}`
      : `${CONFIG_FILE}: ${field}: ${what}`,
  );
}

/** `"a"`, `"b"` or `"c"`. */
function one_of(values: readonly unknown[]): string {
  const quoted = values.map((value) => JSON.stringify(value));
  return `${quoted.slice(0, -1).join(", ")} or ${quoted.at(-1)}`;
}

/**
 * Check that a value is an object with known fields only.
 *
 * @param field The path of the value, for the message: `""` for the file.
 * @param value The value.
 * @param known The fields it may have, or `undefined` when any name is one.
 * @returns The value, as a record.
 */
function check_object(
  field: string,
  value: unknown,
  known?: readonly string[],
): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalid(field, "must be an object");
  }
  for (const key of Object.keys(value)) {
    if (known && !known.includes(key)) {
      throw invalid(
        field === "" ? key : `${field}.${key}`,
        `unknown field. Known fields: ${known.join(", ")}`,
      );
    }
  }
  return value as Record<string, unknown>;
}

/**
 * Whether a text is a path that stays in the workspace: relative, with `/`,
 * and no `.` or `..` in it.
 *
 * @param path The text.
 */
export function is_inside(path: string): boolean {
  return path !== "" && !path.includes("\\") && !/^[a-zA-Z]:/.test(path) &&
    path.split("/").every((part) =>
      part !== "" && part !== "." && part !== ".."
    );
}

/** Check a path of a project: `root`, `entry` or `module`. */
function check_path(field: string, value: unknown, example: string): void {
  if (typeof value !== "string" || !is_inside(value)) {
    throw invalid(
      field,
      `must be a relative path that stays in the workspace, such as ${
        JSON.stringify(example)
      }`,
    );
  }
}

/**
 * Check one project. Its type says which fields it has: a library has no
 * `kind` and no `module`.
 */
function check_project(field: string, value: unknown): void {
  const { type } = check_object(field, value);
  if (type !== undefined && !(TYPES as readonly unknown[]).includes(type)) {
    throw invalid(`${field}.type`, `must be ${one_of(TYPES)}`);
  }
  if (type === "library") {
    const library = check_object(field, value, LIBRARY_FIELDS);
    check_path(`${field}.root`, library.root, "libs/shared");
    if (library.entry !== undefined) {
      check_path(`${field}.entry`, library.entry, DEFAULTS.libraryEntry);
    }
    return;
  }
  const project = check_object(field, value, APPLICATION_FIELDS);
  if (!(KINDS as readonly unknown[]).includes(project.kind)) {
    throw invalid(`${field}.kind`, `must be ${one_of(KINDS)}`);
  }
  check_path(`${field}.root`, project.root, "apps/api");
  if (project.entry !== undefined) {
    check_path(`${field}.entry`, project.entry, DEFAULTS.entry);
  }
  if (project.module !== undefined) {
    check_path(`${field}.module`, project.module, DEFAULTS.module);
  }
}

/** Check a folder of new projects: `appsDir`, `libsDir`. */
function check_folder(field: string, value: unknown): void {
  if (value === undefined) {
    return;
  }
  const mistake = typeof value === "string"
    ? name_mistake(value)
    : "It must be a text";
  if (mistake) {
    throw invalid(field, `not a name of a folder. ${mistake}`);
  }
}

/**
 * Check the settings of a workspace: what was parsed from `cho.json`.
 *
 * A field that is not known is refused, at any depth: a field that was
 * mistyped is not ignored.
 *
 * @param value What was read.
 * @returns The same value, as settings.
 * @throws {ChoError} `CHO_CLI_INVALID_CONFIG`, with the field in its message.
 */
export function check_config(value: unknown): ChoConfig {
  const config = check_object("", value, FIELDS);

  if (config.$schema !== undefined && typeof config.$schema !== "string") {
    throw invalid("$schema", "must be a text");
  }
  if (config.version !== CONFIG_VERSION) {
    throw invalid(
      "version",
      typeof config.version === "number"
        ? `${config.version} is not a version this cho knows (it knows ` +
          `${CONFIG_VERSION}): the file was written by another version of cho`
        : `must be ${CONFIG_VERSION}`,
    );
  }
  if (!(RUNTIMES as readonly unknown[]).includes(config.runtime)) {
    throw invalid("runtime", `must be ${one_of(RUNTIMES)}`);
  }
  check_folder("appsDir", config.appsDir);
  check_folder("libsDir", config.libsDir);
  if (config.projects === undefined) {
    throw invalid("projects", "must be an object");
  }
  const projects = check_object("projects", config.projects);
  for (const [name, project] of Object.entries(projects)) {
    const mistake = name_mistake(name);
    if (mistake) {
      throw invalid(`projects.${name}`, `not a name of a project. ${mistake}`);
    }
    check_project(`projects.${name}`, project);
  }
  return value as ChoConfig;
}

// The schema
// -----------------------------------------------------------------------------

/**
 * The JSON Schema of `cho.json` (draft-07, the one editors read best).
 *
 * It is made from the constants {@link check_config} reads, so the two say
 * the same. `cho.schema.json` is this value, written by `gen.ts`.
 *
 * What it does not say, and `check_config` checks: a path that leaves the
 * workspace, and a name that is too long or kept by Windows.
 *
 * @returns The schema.
 */
export function config_schema(): Record<string, unknown> {
  return {
    $schema: "http://json-schema.org/draft-07/schema#",
    $id: SCHEMA_URL,
    title: CONFIG_FILE,
    description:
      "The settings of a CHO workspace, read by the cho command-line tool.",
    type: "object",
    required: ["version", "runtime", "projects"],
    additionalProperties: false,
    properties: {
      $schema: {
        description: "The address of this schema, for an editor.",
        type: "string",
      },
      version: {
        description: "The version of the format of this file.",
        const: CONFIG_VERSION,
      },
      runtime: {
        description:
          "The runtime the workspace is installed with. A workspace is the same on the three.",
        enum: [...RUNTIMES],
      },
      appsDir: {
        description: "The folder a new application is created in.",
        type: "string",
        pattern: NAME_PATTERN,
        default: DEFAULTS.appsDir,
      },
      libsDir: {
        description: "The folder a new library is created in.",
        type: "string",
        pattern: NAME_PATTERN,
        default: DEFAULTS.libsDir,
      },
      projects: {
        description: "The projects of the workspace, by name.",
        type: "object",
        propertyNames: { pattern: NAME_PATTERN },
        // A library says its type, so a project matches one of the two.
        additionalProperties: {
          oneOf: [
            { $ref: "#/definitions/application" },
            { $ref: "#/definitions/library" },
          ],
        },
      },
    },
    definitions: {
      application: {
        description: "An application: a project that runs.",
        type: "object",
        required: ["kind", "root"],
        additionalProperties: false,
        properties: {
          type: {
            description: "The type of the project: it runs.",
            const: "application",
            default: DEFAULTS.type,
          },
          kind: {
            description:
              "What the application is: a web application (@chojs/web), or a command-line tool (@chojs/command).",
            enum: [...KINDS],
          },
          root: {
            description:
              "The folder of the project, from the root of the workspace.",
            type: "string",
          },
          entry: {
            description: "The file that runs the project, from its folder.",
            type: "string",
            default: DEFAULTS.entry,
          },
          module: {
            description:
              "The file that exports the root module of the project, as AppModule, from its folder.",
            type: "string",
            default: DEFAULTS.module,
          },
        },
      },
      library: {
        description:
          "A library: a project that does not run, and that others import.",
        type: "object",
        required: ["type", "root"],
        additionalProperties: false,
        properties: {
          type: {
            description: "The type of the project: other projects import it.",
            const: "library",
          },
          root: {
            description:
              "The folder of the project, from the root of the workspace.",
            type: "string",
          },
          entry: {
            description: "The file the library exports, from its folder.",
            type: "string",
            default: DEFAULTS.libraryEntry,
          },
        },
      },
    },
  };
}
