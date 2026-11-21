/**
 * What the tests of `cho new` share: a temporary folder, and what is in a
 * folder.
 *
 * Not part of the published package.
 *
 * @module
 */

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

/**
 * Run a function with a temporary folder, removed afterwards.
 *
 * @param fn The function: it gets the path of the folder.
 * @returns What the function returns.
 */
export async function with_folder<T>(
  fn: (folder: string) => Promise<T>,
): Promise<T> {
  const folder = await mkdtemp(join(tmpdir(), "cho-"));
  try {
    return await fn(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

/**
 * The files under a folder: their paths from it, with `/`, in order. What
 * git keeps in `.git` is left out.
 *
 * @param folder The folder.
 * @returns The paths. An empty list when the folder does not exist.
 */
export async function files_of(folder: string): Promise<string[]> {
  const entries = await readdir(folder, {
    recursive: true,
    withFileTypes: true,
  }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(folder, join(entry.parentPath, entry.name)).replaceAll("\\", "/")
    )
    .filter((path) => !path.startsWith(".git/"))
    .sort();
}

/**
 * Read a JSON file.
 *
 * @param path The path of the file, in parts.
 * @returns What the file holds.
 */
export async function read_json(...path: string[]): Promise<unknown> {
  return JSON.parse(await readFile(join(...path), "utf8"));
}
