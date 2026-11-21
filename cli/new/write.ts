/**
 * Writing a workspace: its folder, and the files of its plan.
 *
 * The folder is one the tool creates. A folder that exists is never written
 * in, so nothing of the user is ever replaced; and since the tool created
 * the folder, it can remove it when a file fails.
 *
 * @module
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { cli_error } from "./errors.ts";
import type { PlannedFile } from "./plan.ts";

/** The code of an error of the system: `EEXIST`, `ENOENT`. */
export function system_code(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

/**
 * Create the folder of a workspace, and write its files.
 *
 * @param target The folder to create. Its parent exists.
 * @param files The files, with paths from the folder.
 * @throws {ChoError} `CHO_CLI_TARGET_EXISTS` when the folder exists: nothing
 *   was touched. `CHO_CLI_WRITE_FAILED` when the folder or a file cannot be
 *   written: the folder was removed, and the `cause` is the error of the
 *   system.
 */
export async function write_workspace(
  target: string,
  files: readonly PlannedFile[],
): Promise<void> {
  try {
    // Not recursive: it fails when the folder exists, whatever was checked
    // before.
    await mkdir(target);
  } catch (cause) {
    if (system_code(cause) === "EEXIST") {
      throw cli_error(
        "CHO_CLI_TARGET_EXISTS",
        `${target} exists already. Nothing was written.`,
        { cause },
      );
    }
    throw cli_error(
      "CHO_CLI_WRITE_FAILED",
      `Could not create the folder ${target}: ${message_of(cause)}`,
      { cause },
    );
  }

  let path = target;
  try {
    for (const file of files) {
      path = join(target, ...file.path.split("/"));
      await mkdir(dirname(path), { recursive: true });
      // `wx`: a file is written once
      await writeFile(path, file.text, { flag: "wx" });
    }
  } catch (cause) {
    await rm(target, { recursive: true, force: true }).catch(() => {});
    throw cli_error(
      "CHO_CLI_WRITE_FAILED",
      `Could not write ${path}: ${message_of(cause)}. ` +
        `The folder ${target} was removed.`,
      { cause },
    );
  }
}

/** The message of what was thrown. */
function message_of(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
