/**
 * Tests for `cho add`: the project it adds to a workspace of the disk, what
 * it prints, and the command itself, run as `main.ts` runs it.
 *
 * The workspace is one `cho new` created, in a temporary folder. The
 * installation is not run here: it downloads packages.
 */

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { describe, it } from "node:test";
import { ChoError, isChoError } from "@chojs/command";
import { capture } from "@chojs/core/utils/test_utils";
import { run_cli } from "../app.ts";
import { check_config, make_project } from "../new/config.ts";
import { create_workspace } from "../new/new.ts";
import { files_of, read_json, with_folder } from "../new/testing.ts";
import { disk_host, Tree } from "../tree.ts";
import { add_project, next_steps, report_error, usage } from "./add.ts";
import type { Answers } from "./answers.ts";
import { read_workspace } from "./workspace.ts";

/** The files of the workspace `shop`, as `cho new` wrote it. */
const NEW_FILES = [
  ".gitignore",
  ".npmrc",
  "README.md",
  "apps/api/app.ts",
  "apps/api/app_test.ts",
  "apps/api/main.ts",
  "apps/api/package.json",
  "apps/api/tsconfig.json",
  "cho.json",
  "package.json",
];

/** The files of a library named `shared`. */
const LIBRARY_FILES = [
  "libs/shared/mod.ts",
  "libs/shared/mod_test.ts",
  "libs/shared/package.json",
  "libs/shared/tsconfig.json",
];

const LIBRARY: Answers = {
  name: "shared",
  choice: { type: "library" },
  install: false,
};

/** Run a function in the workspace `shop`, on Deno, in a temporary folder. */
function with_workspace<T>(fn: (root: string) => Promise<T>): Promise<T> {
  return with_folder(async (folder) => {
    await capture(() =>
      create_workspace({
        name: "shop",
        kind: "web",
        runtime: "deno",
        project: "api",
        appsDir: "apps",
        git: false,
        install: false,
      }, folder)
    );
    return fn(join(folder, "shop"));
  });
}

/** Add a project to a workspace, from its root, and give what was printed. */
function add(root: string, answers: Answers, dry_run = false, cwd = root) {
  const tree = new Tree(disk_host(root));
  return capture(() =>
    add_project(tree, read_workspace(tree), answers, { root, cwd }, dry_run)
  );
}

/** Every file of a folder, with its text. */
async function texts_of(folder: string): Promise<Record<string, string>> {
  const texts: Record<string, string> = {};
  for (const path of await files_of(folder)) {
    texts[path] = await readFile(join(folder, ...path.split("/")), "utf8");
  }
  return texts;
}

describe("add_project", () => {
  it("adds a library, and says how it is tested and used", () =>
    with_workspace(async (root) => {
      const { result, output } = await add(root, LIBRARY);
      assert.equal(result, 0);
      assert.deepEqual(output, {
        log: [
          "Added shared in libs/shared (4 files)",
          "Updated cho.json",
          "\n  deno install\n  cd libs/shared\n  deno test",
          "\nTo use it in an application, add it to the dependencies of the\n" +
          "package.json of the application, and run deno install at the " +
          "root of the\nworkspace:\n\n" +
          '  "dependencies": { "@shop/shared": "*" }\n\n' +
          '  import { greet } from "@shop/shared";',
        ],
        error: [],
      });
      assert.deepEqual(
        await files_of(root),
        [...NEW_FILES, ...LIBRARY_FILES].sort(),
      );
      const config = check_config(await read_json(root, "cho.json"));
      assert.deepEqual(config.projects.shared, {
        type: "library",
        root: "libs/shared",
        entry: "mod.ts",
      });
    }));

  it("adds an application, and says how it is run", () =>
    with_workspace(async (root) => {
      const { result, output } = await add(root, {
        name: "admin",
        choice: { type: "application", kind: "cli" },
        install: false,
      });
      assert.equal(result, 0);
      assert.deepEqual(output.log, [
        "Added admin in apps/admin (5 files)",
        "Updated cho.json",
        "\n  deno install\n  cho serve admin -- hello",
      ]);
      const config = check_config(await read_json(root, "cho.json"));
      assert.deepEqual(Object.keys(config.projects), ["api", "admin"]);
      assert.deepEqual(await read_json(root, "apps", "admin", "package.json"), {
        name: "@shop/admin",
        version: "0.1.0",
        private: true,
        type: "module",
        dependencies: {
          "@chojs/command": await cho_range(root),
        },
        devDependencies: { "@types/node": "^24.0.0", tsx: "^4.20.0" },
      });
    }));

  it("prints what it would write and run, and does nothing, for a dry run", () =>
    with_workspace(async (root) => {
      const before = await texts_of(root);
      const { result, output } = await add(
        root,
        { ...LIBRARY, install: true },
        true,
      );
      assert.equal(result, 0);
      assert.deepEqual(output, {
        log: [
          "Dry run: nothing is written, and nothing is run.",
          "\n  create  libs/shared/package.json\n" +
          "  create  libs/shared/tsconfig.json\n" +
          "  create  libs/shared/mod.ts\n" +
          "  create  libs/shared/mod_test.ts\n" +
          "  update  cho.json\n",
          "Would run deno install",
        ],
        error: [],
      });
      assert.deepEqual(await texts_of(root), before);
    }));

  it("leaves the workspace as it was when it cannot be written: CHO_CLI_WRITE_FAILED", () =>
    with_workspace(async (root) => {
      // `libs` is a file: the library has no folder to be in
      await writeFile(join(root, "libs"), "a file");
      const before = await texts_of(root);
      await assert.rejects(
        add(root, LIBRARY),
        (error) => isChoError(error, "CHO_CLI_WRITE_FAILED"),
      );
      assert.deepEqual(await texts_of(root), before);
    }));

  it("refuses a project that exists, and a folder that exists", () =>
    with_workspace(async (root) => {
      await mkdir(join(root, "libs", "shared"), { recursive: true });
      await writeFile(join(root, "libs", "shared", "mine.txt"), "kept");
      const before = await texts_of(root);
      await assert.rejects(
        add(root, LIBRARY),
        (error) => isChoError(error, "CHO_CLI_TARGET_EXISTS"),
      );
      await assert.rejects(
        add(root, { ...LIBRARY, name: "api" }),
        (error) => isChoError(error, "CHO_CLI_PROJECT_EXISTS"),
      );
      assert.deepEqual(await texts_of(root), before);
    }));
});

/** The range of a package of CHO in the application `cho new` wrote. */
async function cho_range(root: string): Promise<string> {
  const manifest = await read_json(root, "apps", "api", "package.json") as {
    dependencies: Record<string, string>;
  };
  // the same version, of the other package
  return manifest.dependencies["@chojs/web"]!.replace("web", "command");
}

describe("next_steps", () => {
  const web = make_project({ type: "application", kind: "web" }, "apps/api");
  const tool = make_project({ type: "application", kind: "cli" }, "apps/tool");
  const library = make_project({ type: "library" }, "libs/shared");
  const root = join("/", "work", "shop");
  const deep = join(root, "apps", "api");

  it("runs an application with cho serve, from where the command ran", () => {
    assert.equal(
      next_steps("api", web, "bun", { root, cwd: deep }, true),
      "  cho serve api",
    );
    // a command-line tool, with its first command
    assert.equal(
      next_steps("tool", tool, "deno", { root, cwd: root }, true),
      "  cho serve tool -- hello",
    );
  });

  it("goes to a library, and runs its tests", () => {
    assert.equal(
      next_steps("shared", library, "bun", { root, cwd: root }, true),
      "  cd libs/shared\n  bun test",
    );
    assert.equal(
      next_steps("shared", library, "node", { root, cwd: deep }, true),
      "  cd ../../libs/shared\n  npx tsx --test",
    );
  });

  it("installs first, at the root, when the packages were not installed", () => {
    assert.equal(
      next_steps("shared", library, "node", { root, cwd: deep }, false),
      "  cd ../..\n  npm install\n  cd libs/shared\n  npx tsx --test",
    );
    assert.equal(
      next_steps("shared", library, "bun", { root, cwd: root }, false),
      "  bun install\n  cd libs/shared\n  bun test",
    );
    assert.equal(
      next_steps("api", web, "deno", { root, cwd: deep }, false),
      "  cd ../..\n  deno install\n  cho serve api",
    );
  });
});

describe("usage", () => {
  it("names the package, and the program that installs", () => {
    const text = usage("@shop/shared", "bun");
    assert.match(text, /run bun install at the root/);
    assert.ok(text.includes('"dependencies": { "@shop/shared": "*" }'));
    assert.ok(text.includes('import { greet } from "@shop/shared";'));
  });
});

describe("report_error", () => {
  it("names the command, for a question with no terminal", async () => {
    const { result, output } = await capture(() =>
      report_error(new ChoError("CHO_PROMPT_NO_TERMINAL", "no terminal"))
    );
    assert.equal(result, 1);
    assert.deepEqual(output.error, [
      "Error: There is no terminal to ask on. Give every answer as a " +
      "flag, or --yes for the defaults: see cho add --help",
    ]);
  });
});

describe("cho add, as a command line", () => {
  /** Run a command line of `cho` in a folder, as `main.ts` runs it. */
  async function cho_in(folder: string, ...argv: string[]) {
    const back = process.cwd();
    process.chdir(folder);
    try {
      const { result, output } = await capture(() => run_cli(argv));
      return { code: result, log: output.log, error: output.error };
    } finally {
      process.chdir(back);
    }
  }

  it("adds a library to the workspace of the current folder", () =>
    with_workspace(async (root) => {
      const run = await cho_in(
        root,
        "add",
        "shared",
        "--type",
        "library",
        "--no-install",
      );
      assert.equal(run.code, 0);
      assert.deepEqual(run.error, []);
      assert.equal(run.log[0], "Added shared in libs/shared (4 files)");
      assert.deepEqual(
        await files_of(root),
        [...NEW_FILES, ...LIBRARY_FILES].sort(),
      );
    }));

  it("finds the workspace from a folder under it", () =>
    with_workspace(async (root) => {
      const run = await cho_in(
        join(root, "apps", "api"),
        "add",
        "admin",
        "--kind=web",
        "--no-install",
      );
      assert.deepEqual(run, {
        code: 0,
        log: [
          "Added admin in apps/admin (5 files)",
          "Updated cho.json",
          "\n  cd ../..\n  deno install\n  cho serve admin",
        ],
        error: [],
      });
      // in the workspace, not in the current folder
      assert.equal(
        (await files_of(root)).includes("apps/admin/main.ts"),
        true,
      );
    }));

  it("writes nothing with --dry-run", () =>
    with_workspace(async (root) => {
      const before = await texts_of(root);
      const run = await cho_in(
        root,
        "add",
        "shared",
        "--type",
        "library",
        "--yes",
        "--dry-run",
      );
      assert.equal(run.code, 0);
      assert.equal(
        run.log[0],
        "Dry run: nothing is written, and nothing is run.",
      );
      assert.equal(run.log[2], "Would run deno install");
      assert.deepEqual(await texts_of(root), before);
    }));

  it("prints the mistake, writes nothing, and exits with 1", () =>
    with_workspace(async (root) => {
      const before = await texts_of(root);
      const wrong = [
        [
          ["shared", "--type", "lib"],
          "--type lib: not one of application, library",
        ],
        [
          ["shared", "--runtime", "bun"],
          "--runtime: cho add has no such flag. See cho add --help",
        ],
        [
          ["shared", "--type", "library", "--kind", "web"],
          "--kind web: a library has no kind. It is plain TypeScript",
        ],
        [
          ["api", "--yes"],
          "The workspace has a project named api already. Nothing was written.",
        ],
        [
          ["My-Lib", "--yes"],
          'The name of the project "My-Lib": Lower case letters, digits ' +
          "and -, starting with a letter",
        ],
      ] as const;
      for (const [argv, message] of wrong) {
        assert.deepEqual(await cho_in(root, "add", ...argv), {
          code: 1,
          log: [],
          error: [`Error: ${message}`],
        });
      }
      assert.deepEqual(await texts_of(root), before);
    }));

  it("refuses a folder that is not in a workspace: CHO_CLI_NO_WORKSPACE", () =>
    with_folder(async (folder) => {
      assert.deepEqual(await cho_in(folder, "add", "shared", "--yes"), {
        code: 1,
        log: [],
        error: [
          "Error: There is no cho.json here, or in a folder above: this is " +
          "not a workspace. cho new creates one.",
        ],
      });
      assert.deepEqual(await files_of(folder), []);
    }));

  it("refuses a cho.json that is not right, and a workspace with no package.json", () =>
    with_workspace(async (root) => {
      const settings = await readFile(join(root, "cho.json"), "utf8");
      await writeFile(
        join(root, "cho.json"),
        settings.replace('"deno"', '"pnpm"'),
      );
      assert.deepEqual((await cho_in(root, "add", "shared", "--yes")).error, [
        'Error: cho.json: runtime: must be "deno", "node" or "bun"',
      ]);

      await writeFile(join(root, "cho.json"), settings);
      await writeFile(join(root, "package.json"), "{ // mine\n}");
      const run = await cho_in(root, "add", "shared", "--yes");
      assert.equal(run.code, 1);
      assert.match(String(run.error[0]), /^Error: package\.json: not JSON: /);
      assert.deepEqual(
        (await files_of(root)).filter((path) => path.startsWith("libs/")),
        [],
      );
    }));
});
