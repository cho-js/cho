/**
 * What the tests of the tool share: a temporary folder, what is in a folder,
 * and a folder in memory for a tree.
 *
 * Not part of the published package.
 *
 * @module
 */

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import type { Host } from "../tree.ts";
import type { Answers } from "./answers.ts";
import { plan_workspace } from "./plan.ts";

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

/** An error of the system, as `node:fs` throws one: with a `code`. */
function system_error(code: string, path: string): Error {
  return Object.assign(new Error(`${code}: ${path}`), { code });
}

/**
 * A folder in memory, as the host of a tree: a test plans on it, and reads
 * what a `commit` wrote, with no disk.
 *
 * @param files The files of the folder, by path. The folders above a file
 *   exist.
 * @returns The host, with its files: `files` is the record that was given,
 *   and a `commit` changes it.
 */
export function memory_host(
  files: Record<string, string> = {},
): Host & { files: Record<string, string> } {
  const folders = new Set<string>();
  const is_folder = (path: string) =>
    folders.has(path) ||
    Object.keys(files).some((file) => file.startsWith(`${path}/`));
  const exists = (path: string) => path in files || is_folder(path);
  return {
    files,
    read: (path) => files[path],
    exists,
    mkdir(path) {
      if (exists(path)) {
        return Promise.reject(system_error("EEXIST", path));
      }
      folders.add(path);
      return Promise.resolve();
    },
    create(path, text) {
      if (exists(path)) {
        return Promise.reject(system_error("EEXIST", path));
      }
      files[path] = text;
      return Promise.resolve();
    },
    write(path, text) {
      files[path] = text;
      return Promise.resolve();
    },
    remove(path) {
      delete files[path];
      folders.delete(path);
      return Promise.resolve();
    },
  };
}

/**
 * The files of a workspace `cho new` would write, by path: a workspace for a
 * host in memory. By default, `shop`, on Deno, with the web application
 * `api` in `apps`.
 *
 * @param given The answers that are not the default ones.
 * @param version The version of `cho`.
 * @returns The files.
 */
export function new_workspace(
  given: Partial<Answers> = {},
  version = "3.6.0",
): Record<string, string> {
  const answers: Answers = {
    name: "shop",
    kind: "web",
    runtime: "deno",
    project: "api",
    appsDir: "apps",
    git: false,
    install: false,
    ...given,
  };
  return Object.fromEntries(
    plan_workspace(answers, version).map((file) => [file.path, file.text]),
  );
}
