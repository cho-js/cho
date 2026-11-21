/**
 * The manifests of a workspace: what says, to each runtime, what the
 * workspace is, what a project depends on, and how it is run.
 *
 * | Runtime | The workspace                | A project                           |
 * | ------- | ---------------------------- | ----------------------------------- |
 * | Deno    | `deno.json`                  | `deno.json`                         |
 * | Node.js | `package.json`, and `.npmrc` | `package.json`, and `tsconfig.json` |
 * | Bun     | The same as Node.js          | The same as Node.js                 |
 *
 * The packages of CHO are those of JSR on the three. npm and Bun read them
 * through the npm registry of JSR, which `.npmrc` names.
 *
 * @module
 */

import type { Kind, Runtime } from "./config.ts";

/** The package of CHO a project of each kind is built with. */
export const PACKAGES: Record<Kind, string> = {
  web: "@chojs/web",
  cli: "@chojs/command",
};

/**
 * The versions of what a workspace installs, that is not of CHO.
 *
 * - `tsx` runs TypeScript with decorators on Node.js, which does not.
 * - The types are for the editor.
 */
export const VERSIONS = {
  "tsx": "^4.20.0",
  "@types/node": "^24.0.0",
  "@types/bun": "^1.3.0",
} as const;

/** The version of a new project. */
const PROJECT_VERSION = "0.1.0";

/** `.npmrc`: where npm and Bun find the packages of JSR. */
export const NPMRC = "@jsr:registry=https://npm.jsr.io\n";

/** What a manifest is made from. */
export type ManifestInput = {
  /** The name of the workspace. */
  name: string;
  /** The name of the project. */
  project: string;
  /** The kind of the project. */
  kind: Kind;
  /** The runtime of the workspace. */
  runtime: Runtime;
  /** The folder of the projects. */
  appsDir: string;
  /** The version of `cho`: the one of the packages of CHO. */
  version: string;
};

/** The text of a JSON file. */
export function json_text(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

/**
 * The name of a package of JSR in its npm registry: `@chojs/web` is
 * `@jsr/chojs__web`.
 */
function npm_name(jsr: string): string {
  return `@jsr/${jsr.slice(1).replace("/", "__")}`;
}

/** The permissions a project needs on Deno, to run. */
function deno_permissions(kind: Kind): string {
  // The packages of CHO read their debug settings in the environment.
  return kind === "web" ? "--allow-net --allow-env" : "--allow-env";
}

/**
 * The tasks of a project: what runs it, what runs it again when a file
 * changes, and what tests it.
 */
function tasks(kind: Kind, runtime: Runtime): Record<string, string> {
  switch (runtime) {
    case "deno": {
      const run = `deno run ${deno_permissions(kind)}`;
      return {
        dev: `${run} --watch main.ts`,
        start: `${run} main.ts`,
        test: "deno test --allow-env",
      };
    }
    case "node":
      return {
        dev: "tsx watch main.ts",
        start: "tsx main.ts",
        test: "tsx --test",
      };
    case "bun":
      return {
        dev: "bun --watch main.ts",
        start: "bun main.ts",
        test: "bun test",
      };
  }
}

/**
 * The manifest of the workspace: `deno.json` on Deno, `package.json` on
 * Node.js and on Bun.
 *
 * @param input The names, and the runtime.
 * @returns The manifest.
 */
export function workspace_manifest(input: ManifestInput): unknown {
  if (input.runtime === "deno") {
    return { workspace: [`./${input.appsDir}/${input.project}`] };
  }
  return {
    name: input.name,
    private: true,
    type: "module",
    workspaces: [`${input.appsDir}/*`],
  };
}

/**
 * The manifest of a project: its name, the package of CHO it depends on, and
 * its tasks.
 *
 * @param input The names, the kind, the runtime and the version of CHO.
 * @returns The manifest.
 */
export function project_manifest(input: ManifestInput): unknown {
  const name = `@${input.name}/${input.project}`;
  const cho = PACKAGES[input.kind];
  const range = `^${input.version}`;

  if (input.runtime === "deno") {
    return {
      name,
      version: PROJECT_VERSION,
      // Deno wants one of a package that has a name: the module of the
      // application is what another project would import.
      exports: "./app.ts",
      imports: { [cho]: `jsr:${cho}@${range}` },
      tasks: tasks(input.kind, "deno"),
    };
  }
  return {
    name,
    version: PROJECT_VERSION,
    private: true,
    type: "module",
    scripts: tasks(input.kind, input.runtime),
    dependencies: { [cho]: `npm:${npm_name(cho)}@${range}` },
    devDependencies: input.runtime === "node"
      ? { "@types/node": VERSIONS["@types/node"], tsx: VERSIONS.tsx }
      : { "@types/bun": VERSIONS["@types/bun"] },
  };
}

/**
 * `tsconfig.json` of a project, on Node.js and on Bun. It is for the editor,
 * and for a type check: nothing is compiled to a folder, and the files import
 * each other with their `.ts` extension.
 *
 * - `types` names the types of the runtime. TypeScript loads no types that
 *   are not named.
 * - The file is in the folder of the project, not at the root: Bun installs
 *   the packages of a project in its folder, and TypeScript looks for the
 *   types from where the file is.
 *
 * @param runtime The runtime of the workspace: `node` or `bun`.
 * @returns The settings.
 */
export function tsconfig(runtime: "node" | "bun"): unknown {
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
      types: [runtime],
    },
  };
}

/** What runs a task of a project, from its folder, on each runtime. */
export const RUN_TASK: Record<Runtime, string> = {
  deno: "deno task",
  node: "npm run",
  bun: "bun run",
};
