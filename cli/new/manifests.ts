/**
 * The manifests of a workspace: what says what the workspace is, and what a
 * project depends on.
 *
 * A workspace is the same on Deno, on Node.js and on Bun: the three read
 * `package.json`, its `workspaces`, and `.npmrc`. So a workspace that was
 * installed with one is installed with another the day after, and nothing
 * here depends on the runtime.
 *
 * | File            | Where        | What it holds                             |
 * | --------------- | ------------ | ----------------------------------------- |
 * | `package.json`  | The root     | The name, and the folders of the projects |
 * | `.npmrc`        | The root     | The npm registry of JSR                   |
 * | `package.json`  | Each project | Its name, and what it depends on          |
 * | `tsconfig.json` | Each project | The settings of TypeScript                |
 *
 * The packages of CHO are those of JSR. The three tools read them through
 * the npm registry of JSR, which `.npmrc` names.
 *
 * A project has no scripts: no one command runs it on the three. The
 * `README.md` of a workspace has the command of each runtime (`plan.ts`).
 *
 * @module
 */

import type { Kind } from "./config.ts";
import { cli_error } from "../errors.ts";

/** The manifest of a workspace, and of a project. */
export const MANIFEST = "package.json";

/** The package of CHO an application of each kind is built with. */
export const PACKAGES: Record<Kind, string> = {
  web: "@chojs/web",
  cli: "@chojs/command",
};

/**
 * The versions of what a project installs, that is not of CHO.
 *
 * - `tsx` runs TypeScript with decorators on Node.js, which does not.
 * - `@types/node` is for the editor, and for Deno: it checks the types of a
 *   test, which imports `node:test`.
 */
export const VERSIONS = {
  "@types/node": "^24.0.0",
  "tsx": "^4.20.0",
} as const;

/** The version of a new project. */
const PROJECT_VERSION = "0.1.0";

/** `.npmrc`: where the three tools find the packages of JSR. */
export const NPMRC = "@jsr:registry=https://npm.jsr.io\n";

/** What the manifest of a project is made from. */
export type ManifestInput = {
  /** The name of the workspace. */
  workspace: string;
  /** The name of the project. */
  name: string;
  /** The version of `cho`: the one of the packages of CHO. */
  version: string;
};

/** The text of a JSON file. */
export function json_text(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * The name of the package of a project: `@shop/api`. It is the name another
 * project imports it by.
 *
 * @param workspace The name of the workspace.
 * @param name The name of the project.
 */
export function package_name(workspace: string, name: string): string {
  return `@${workspace}/${name}`;
}

/**
 * The name of a package of JSR in its npm registry: `@chojs/web` is
 * `@jsr/chojs__web`.
 */
function npm_name(jsr: string): string {
  return `@jsr/${jsr.slice(1).replace("/", "__")}`;
}

/**
 * The manifest of a workspace.
 *
 * @param name The name of the workspace.
 * @param folders The folders of its projects: `apps`, `libs`. One that has
 *   no project yet is not a mistake.
 * @returns The manifest.
 */
export function workspace_manifest(
  name: string,
  folders: readonly string[],
): unknown {
  return {
    name,
    private: true,
    type: "module",
    workspaces: [...new Set(folders)].map((folder) => `${folder}/*`),
  };
}

/**
 * The manifest of an application: its name, and the package of CHO it is
 * built with.
 *
 * @param input The names, and the version of CHO.
 * @param kind The kind of the application.
 * @returns The manifest.
 */
export function application_manifest(
  input: ManifestInput,
  kind: Kind,
): unknown {
  const cho = PACKAGES[kind];
  return {
    name: package_name(input.workspace, input.name),
    version: PROJECT_VERSION,
    private: true,
    type: "module",
    dependencies: { [cho]: `npm:${npm_name(cho)}@^${input.version}` },
    devDependencies: VERSIONS,
  };
}

/**
 * The manifest of a library: its name, and the file it exports. It depends
 * on no package of CHO.
 *
 * @param input The names.
 * @param entry The file the library exports, from its folder.
 * @returns The manifest.
 */
export function library_manifest(input: ManifestInput, entry: string): unknown {
  return {
    name: package_name(input.workspace, input.name),
    version: PROJECT_VERSION,
    private: true,
    type: "module",
    exports: `./${entry}`,
    devDependencies: VERSIONS,
  };
}

/**
 * `tsconfig.json` of a project. It is for the editor, and for a type check:
 * nothing is compiled to a folder, and the files import each other with
 * their `.ts` extension.
 *
 * - `types` names the types of Node.js: the templates use `node:` modules,
 *   which the three runtimes have. TypeScript loads no types that are not
 *   named.
 * - The file is in the folder of the project, not at the root: Bun installs
 *   the packages of a project in its folder, and TypeScript looks for the
 *   types from where the file is.
 *
 * @returns The settings.
 */
export function tsconfig(): unknown {
  return {
    compilerOptions: {
      target: "ES2022",
      module: "Preserve",
      moduleResolution: "Bundler",
      allowImportingTsExtensions: true,
      verbatimModuleSyntax: true,
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      types: ["node"],
    },
  };
}

/**
 * The manifest of a workspace, with the folder of a project among its
 * `workspaces`.
 *
 * @param manifest The manifest of the workspace, as it was read.
 * @param root The folder of the project, from the root: `libs/shared`.
 * @returns The manifest to write, or `undefined` when a pattern of
 *   `workspaces` has the project already: the file is not changed.
 * @throws {ChoError} `CHO_CLI_INVALID_MANIFEST` when `workspaces` is not a
 *   list of folders.
 */
export function with_member(
  manifest: Record<string, unknown>,
  root: string,
): Record<string, unknown> | undefined {
  const { workspaces } = manifest;
  if (
    !Array.isArray(workspaces) ||
    workspaces.some((one) => typeof one !== "string")
  ) {
    throw cli_error(
      "CHO_CLI_INVALID_MANIFEST",
      `${MANIFEST}: workspaces: must be a list of folders, such as ` +
        `["apps/*"]. Nothing was written.`,
    );
  }
  // `libs/shared` is in `libs/*`, and in `libs/shared`
  const folder = root.slice(0, root.lastIndexOf("/"));
  const patterns = workspaces.map((one: string) => one.replace(/^\.\//, ""));
  if (patterns.includes(`${folder}/*`) || patterns.includes(root)) {
    return undefined;
  }
  return { ...manifest, workspaces: [...workspaces, `${folder}/*`] };
}
