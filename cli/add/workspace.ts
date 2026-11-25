/**
 * The workspace `cho add` works in: where it is, and what its files say.
 *
 * A workspace is a folder with a `cho.json`. A command that works in one is
 * run from its root, or from any folder under it.
 *
 * @module
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { check_config, type ChoConfig, CONFIG_FILE } from "../new/config.ts";
import { type ChoCliErrorCode, cli_error } from "../errors.ts";
import { MANIFEST } from "../new/manifests.ts";
import { name_mistake } from "../new/names.ts";
import type { Tree } from "../tree.ts";

/** A workspace, as its files describe it. */
export type Workspace = {
  /** The name of the workspace: `name`, in its `package.json`. */
  name: string;
  /** The settings: `cho.json`, checked. */
  config: ChoConfig;
  /** `package.json` of the root, as it was read. */
  manifest: Record<string, unknown>;
};

/**
 * Find the workspace a folder is in: the folder, or the nearest one above
 * it, that has a `cho.json`.
 *
 * @param cwd The folder to start from.
 * @returns The root of the workspace.
 * @throws {ChoError} `CHO_CLI_NO_WORKSPACE` when no folder has one.
 */
export function find_workspace(cwd: string): string {
  let folder = cwd;
  while (!existsSync(join(folder, CONFIG_FILE))) {
    const parent = dirname(folder);
    // the root is its own parent
    if (parent === folder) {
      throw cli_error(
        "CHO_CLI_NO_WORKSPACE",
        `There is no ${CONFIG_FILE} here, or in a folder above: this is not ` +
          "a workspace. cho new creates one.",
      );
    }
    folder = parent;
  }
  return folder;
}

/**
 * Read a JSON file of the workspace, that holds an object.
 *
 * @param tree The tree of the workspace.
 * @param path The path of the file.
 * @param code The code of the error, for a file that is not an object of
 *   JSON.
 * @returns What the file holds, or `undefined` when there is no such file.
 */
function read_object(
  tree: Tree,
  path: string,
  code: ChoCliErrorCode,
): Record<string, unknown> | undefined {
  const text = tree.read(path);
  if (text === undefined) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (cause) {
    // A file with comments is not JSON: it is not written again without them.
    throw cli_error(
      code,
      `${path}: not JSON: ${(cause as Error).message}`,
      { cause },
    );
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw cli_error(code, `${path}: must be an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Read the settings of a workspace: its `cho.json`, checked.
 *
 * @param tree The tree of the workspace: its root is the one
 *   {@link find_workspace} found.
 * @returns The settings.
 * @throws {ChoError} `CHO_CLI_NO_WORKSPACE` when there is no `cho.json`;
 *   `CHO_CLI_INVALID_CONFIG` when it is not JSON, or not what `check_config`
 *   wants.
 */
export function read_config(tree: Tree): ChoConfig {
  const settings = read_object(tree, CONFIG_FILE, "CHO_CLI_INVALID_CONFIG");
  if (settings === undefined) {
    throw cli_error(
      "CHO_CLI_NO_WORKSPACE",
      `There is no ${CONFIG_FILE} here: this is not a workspace.`,
    );
  }
  return check_config(settings);
}

/**
 * Read a workspace: its settings, and its manifest.
 *
 * @param tree The tree of the workspace: its root is the one
 *   {@link find_workspace} found.
 * @returns The workspace.
 * @throws {ChoError} What {@link read_config} throws, and
 *   `CHO_CLI_INVALID_MANIFEST` when `package.json` is missing, is not an
 *   object of JSON, or has no name that is the name of a workspace.
 */
export function read_workspace(tree: Tree): Workspace {
  const config = read_config(tree);

  const manifest = read_object(tree, MANIFEST, "CHO_CLI_INVALID_MANIFEST");
  if (manifest === undefined) {
    throw cli_error(
      "CHO_CLI_INVALID_MANIFEST",
      tree.exists("deno.json")
        // what cho 3.7 created for Deno
        ? `${MANIFEST}: there is none at the root of the workspace. It has ` +
          `a deno.json: it was made for Deno alone, by an earlier cho. ` +
          `cho works in a workspace that has a ${MANIFEST}.`
        : `${MANIFEST}: there is none at the root of the workspace.`,
    );
  }
  const { name } = manifest;
  const mistake = typeof name === "string"
    ? name_mistake(name)
    : "It must be a text";
  if (mistake !== undefined) {
    throw cli_error(
      "CHO_CLI_INVALID_MANIFEST",
      `${MANIFEST}: name: not the name of a workspace. ${mistake}`,
    );
  }
  return { name: name as string, config, manifest };
}
