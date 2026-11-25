/**
 * The tree: how a command of `cho` writes files.
 *
 * A tree is a layer in memory over a folder. A command reads through it, and
 * records what it would write: nothing is written while it works. When the
 * command is done, {@link commit} writes every change, or leaves the folder
 * as it was.
 *
 * ```ts
 * const tree = new Tree(disk_host(root));
 * const config = JSON.parse(tree.read("cho.json") ?? "{}");
 * tree.create("libs/shared/mod.ts", text); // a new file
 * tree.update("cho.json", json_text(config)); // a file that exists
 * await commit(tree);
 * ```
 *
 * - A command that fails while it plans has written nothing.
 * - `--dry-run` prints {@link Tree.changes}, and does not call `commit`.
 * - A test gives the tree a folder in memory (`memory_host`, in
 *   `new/testing.ts`), and reads the changes.
 *
 * A path is from the root of the tree, with `/`: `libs/shared/mod.ts`.
 *
 * What a tree does not do: it removes nothing and renames nothing, since no
 * command does; and it does not run what it wrote. The steps of a command
 * (`git init`, the installation) run after `commit`, in the folder.
 *
 * @module
 */

import { existsSync, readFileSync } from "node:fs";
import { lstat, mkdir, rmdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cli_error } from "./errors.ts";

/**
 * One thing `commit` does.
 *
 * - `folder`: creates a folder. Its parent exists.
 * - `create`: writes a file that does not exist.
 * - `update`: replaces the text of a file that exists.
 */
export type Change =
  | { kind: "folder"; path: string }
  | { kind: "create"; path: string; text: string }
  | { kind: "update"; path: string; text: string };

/**
 * The folder under a tree: what a tree reads, and what `commit` writes.
 *
 * {@link disk_host} is the one of a folder of the disk.
 */
export type Host = {
  /** The text of a file, or `undefined` when there is no file at the path. */
  read(path: string): string | undefined;
  /** Whether there is a file or a folder at the path. */
  exists(path: string): boolean;
  /** Create a folder. It fails when the path exists, or has no parent. */
  mkdir(path: string): Promise<void>;
  /** Write a new file. It fails when the path exists. */
  create(path: string, text: string): Promise<void>;
  /** Replace the text of a file. */
  write(path: string, text: string): Promise<void>;
  /** Remove a file, or a folder that is empty. */
  remove(path: string): Promise<void>;
};

/** The code of an error of the system: `EEXIST`, `ENOENT`. */
export function system_code(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

/** The codes of a read that found no file: nothing, or a folder. */
const NO_FILE = ["ENOENT", "EISDIR", "ENOTDIR"];

/**
 * A folder of the disk, as the host of a tree.
 *
 * `node:fs` does the work: the three runtimes have it.
 *
 * @param root The folder. It does not have to exist: a tree can create it,
 *   when its parent is the root (`cho new`).
 * @returns The host.
 */
export function disk_host(root: string): Host {
  const at = (path: string) => join(root, ...path.split("/"));
  return {
    read(path) {
      try {
        return readFileSync(at(path), "utf8");
      } catch (error) {
        if (NO_FILE.includes(system_code(error) ?? "")) {
          return undefined;
        }
        throw error;
      }
    },
    exists: (path) => existsSync(at(path)),
    // Not recursive: it fails when the folder exists.
    mkdir: async (path) => void await mkdir(at(path)),
    // `wx`: a file is written once, and never over another.
    create: (path, text) => writeFile(at(path), text, { flag: "wx" }),
    write: (path, text) => writeFile(at(path), text),
    async remove(path) {
      const target = at(path);
      // `rmdir` removes an empty folder only: nothing in it is lost.
      await ((await lstat(target)).isDirectory()
        ? rmdir(target)
        : unlink(target));
    },
  };
}

/** A tree: the changes of a command, over a folder. */
export class Tree {
  /** The folder under the tree. */
  readonly host: Host;
  /** The changes, in the order they were recorded. */
  readonly #changes: Change[] = [];
  /** The change of each file that was recorded, by its path. */
  readonly #files = new Map<string, Change & { text: string }>();
  /** The folders that were recorded. */
  readonly #folders = new Set<string>();

  /** @param host The folder under the tree. */
  constructor(host: Host) {
    this.host = host;
  }

  /**
   * The text of a file: what was recorded for it, else what the folder has.
   *
   * @param path The path of the file.
   * @returns The text, or `undefined` when there is no such file.
   */
  read(path: string): string | undefined {
    return this.#files.get(path)?.text ?? this.host.read(path);
  }

  /**
   * Whether there is a file or a folder at a path: recorded, or in the
   * folder.
   *
   * @param path The path.
   */
  exists(path: string): boolean {
    return this.#files.has(path) || this.#folders.has(path) ||
      this.host.exists(path);
  }

  /**
   * Record a new file. Each folder above it that does not exist is recorded
   * too, before it.
   *
   * @param path The path of the file.
   * @param text Its text.
   * @throws {ChoError} `CHO_CLI_TARGET_EXISTS` when there is a file or a
   *   folder at the path: nothing is recorded.
   */
  create(path: string, text: string): void {
    if (this.exists(path)) {
      throw cli_error(
        "CHO_CLI_TARGET_EXISTS",
        `${path} exists already. Nothing was written.`,
      );
    }
    const parts = path.split("/");
    for (let depth = 1; depth < parts.length; depth++) {
      const folder = parts.slice(0, depth).join("/");
      if (!this.exists(folder)) {
        this.#folders.add(folder);
        this.#changes.push({ kind: "folder", path: folder });
      }
    }
    const change: Change = { kind: "create", path, text };
    this.#files.set(path, change);
    this.#changes.push(change);
  }

  /**
   * Record the new text of a file that exists. A file is changed once: a
   * second text for it takes the place of the first.
   *
   * @param path The path of the file.
   * @param text Its new text.
   * @throws {ChoError} `CHO_CLI_WRITE_FAILED` when there is no such file.
   */
  update(path: string, text: string): void {
    const recorded = this.#files.get(path);
    if (recorded) {
      recorded.text = text;
      return;
    }
    if (this.host.read(path) === undefined) {
      throw cli_error(
        "CHO_CLI_WRITE_FAILED",
        `Could not update ${path}: there is no such file. Nothing was written.`,
      );
    }
    const change: Change = { kind: "update", path, text };
    this.#files.set(path, change);
    this.#changes.push(change);
  }

  /**
   * What `commit` would do, in order.
   *
   * @returns The changes: a copy, that the tree does not change later.
   */
  changes(): Change[] {
    return this.#changes.map((change) => ({ ...change }));
  }
}

/**
 * The files of a list of changes, each on its line: what `--dry-run` prints.
 * The folders are not listed: a file says where it is.
 *
 * @param changes The changes.
 * @returns The lines, indented: `  create  libs/shared/mod.ts`.
 */
export function list_changes(changes: readonly Change[]): string {
  return changes
    .filter((change) => change.kind !== "folder")
    .map((change) => `  ${change.kind}  ${change.path}`)
    .join("\n");
}

/** The message of what was thrown. */
function message_of(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Write the changes of a tree in its folder, in the order they were recorded.
 *
 * When a change fails, the ones before it are undone, last first: a file
 * that was created is removed, a folder that was created is removed, and a
 * file that was updated gets its text back. So the folder is whole after a
 * `commit`, or as it was before.
 *
 * @param tree The tree.
 * @throws {ChoError} `CHO_CLI_TARGET_EXISTS` when a path to create is there:
 *   it appeared since it was recorded. `CHO_CLI_WRITE_FAILED` for any other
 *   failure, with the error of the system as its `cause`.
 */
export async function commit(tree: Tree): Promise<void> {
  const { host } = tree;
  /** What undoes each change that was applied. */
  const undo: (() => Promise<void>)[] = [];
  let path = "";
  try {
    for (const change of tree.changes()) {
      path = change.path;
      switch (change.kind) {
        case "folder":
          await host.mkdir(path);
          undo.push(() => host.remove(change.path));
          break;
        case "create":
          try {
            await host.create(path, change.text);
          } catch (error) {
            // A write that failed half way left a file: it is this one's.
            // A file that was there (`EEXIST`) is not.
            if (system_code(error) !== "EEXIST") {
              await host.remove(path).catch(() => {});
            }
            throw error;
          }
          undo.push(() => host.remove(change.path));
          break;
        case "update": {
          const before = host.read(path);
          if (before === undefined) {
            throw new Error("there is no such file");
          }
          // Before the write: one that fails half way is undone too.
          undo.push(() => host.write(change.path, before));
          await host.write(path, change.text);
          break;
        }
      }
    }
  } catch (cause) {
    for (const step of undo.reverse()) {
      await step().catch(() => {});
    }
    if (system_code(cause) === "EEXIST") {
      throw cli_error(
        "CHO_CLI_TARGET_EXISTS",
        `${path} exists already. Nothing was written.`,
        { cause },
      );
    }
    throw cli_error(
      "CHO_CLI_WRITE_FAILED",
      `Could not write ${path}: ${message_of(cause)}. Nothing was written.`,
      { cause },
    );
  }
}
