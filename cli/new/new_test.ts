/**
 * Tests for `cho new`: the workspace it creates from the answers, what it
 * prints for an error, and the command itself, run as `main.ts` runs it.
 *
 * The questions are tested in `answers_test.ts`, and the flags in
 * `flags_test.ts`. Here nothing is asked: every answer is given.
 */

import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { describe, it } from "node:test";
import { ChoError, isChoError } from "@chojs/command";
import { capture } from "@chojs/core/utils/test_utils";
import { run_cli } from "../app.ts";
import type { Answers } from "./answers.ts";
import { check_config } from "./config.ts";
import { create_workspace, next_steps, report_error } from "./new.ts";
import { files_of, read_json, with_folder } from "./testing.ts";

/** Answers: a web project on Deno, with no step to run. */
const answers = (given: Partial<Answers> = {}): Answers => ({
  name: "shop",
  kind: "web",
  runtime: "deno",
  project: "api",
  appsDir: "apps",
  git: false,
  install: false,
  ...given,
});

/** The files of a workspace with a project named `api`, in `apps`. */
const FILES = [
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

describe("create_workspace", () => {
  it("writes the workspace, and says what to run next", () =>
    with_folder(async (cwd) => {
      const { result, output } = await capture(() =>
        create_workspace(answers(), cwd)
      );
      assert.equal(result, 0);
      assert.deepEqual(output, {
        log: [
          "Created shop (10 files)",
          "\n  cd shop\n  deno install\n  cho serve api",
        ],
        error: [],
      });
      assert.deepEqual(await files_of(join(cwd, "shop")), FILES);

      const config = check_config(await read_json(cwd, "shop", "cho.json"));
      assert.deepEqual(config.projects, {
        api: {
          type: "application",
          kind: "web",
          root: "apps/api",
          entry: "main.ts",
          module: "app.ts",
        },
      });
    }));

  it("runs git init in the workspace, when it is asked for", () =>
    with_folder(async (cwd) => {
      const { result, output } = await capture(() =>
        create_workspace(answers({ git: true }), cwd)
      );
      assert.equal(result, 0);
      assert.deepEqual(output.log.slice(0, 2), [
        "Created shop (10 files)",
        "Running git init --quiet",
      ]);
      assert.equal(existsSync(join(cwd, "shop", ".git")), true);
      // the repository is the workspace, not the folder it is in
      assert.equal(existsSync(join(cwd, ".git")), false);
    }));

  it("refuses a folder that exists, and touches nothing: CHO_CLI_TARGET_EXISTS", () =>
    with_folder(async (cwd) => {
      await mkdir(join(cwd, "shop"));
      await writeFile(join(cwd, "shop", "mine.txt"), "kept");
      await assert.rejects(
        capture(() => create_workspace(answers(), cwd)),
        (error) => isChoError(error, "CHO_CLI_TARGET_EXISTS"),
      );
      assert.deepEqual(await files_of(cwd), ["shop/mine.txt"]);
    }));

  it("leaves nothing when the workspace cannot be written: CHO_CLI_WRITE_FAILED", () =>
    with_folder(async (cwd) => {
      // the folder to create it in does not exist
      await assert.rejects(
        capture(() => create_workspace(answers(), join(cwd, "gone"))),
        (error) => isChoError(error, "CHO_CLI_WRITE_FAILED"),
      );
      assert.deepEqual(await files_of(cwd), []);
    }));

  it("prints what it would write and run, and does nothing, for a dry run", () =>
    with_folder(async (cwd) => {
      const { result, output } = await capture(() =>
        create_workspace(answers({ git: true, install: true }), cwd, true)
      );
      assert.equal(result, 0);
      assert.deepEqual(output, {
        log: [
          "Dry run: nothing is written, and nothing is run.",
          "\n" + [
            "cho.json",
            "package.json",
            ".npmrc",
            ".gitignore",
            "README.md",
            "apps/api/package.json",
            "apps/api/tsconfig.json",
            "apps/api/app.ts",
            "apps/api/app_test.ts",
            "apps/api/main.ts",
          ].map((path) => `  create  shop/${path}`).join("\n") + "\n",
          "Would run git init --quiet",
          "Would run deno install",
        ],
        error: [],
      });
      assert.equal(existsSync(join(cwd, "shop")), false);
    }));

  it("refuses a folder that exists in a dry run too", () =>
    with_folder(async (cwd) => {
      await mkdir(join(cwd, "shop"));
      await assert.rejects(
        capture(() => create_workspace(answers(), cwd, true)),
        (error) => isChoError(error, "CHO_CLI_TARGET_EXISTS"),
      );
    }));
});

describe("next_steps", () => {
  it("goes to the workspace, and runs the project with cho serve", () => {
    assert.equal(next_steps(answers(), true), "  cd shop\n  cho serve api");
  });

  it("installs first, when the packages were not installed", () => {
    assert.equal(
      next_steps(answers({ runtime: "bun" }), false),
      "  cd shop\n  bun install\n  cho serve api",
    );
  });

  it("says what a message consumer needs, under the commands", () => {
    assert.equal(
      next_steps(answers({ kind: "message", project: "worker" }), true),
      "  cd shop\n  cho serve worker\n\n" +
        "worker reads from Kafka, at localhost:9092: the variable " +
        "KAFKA_BROKERS names another address.",
    );
  });

  it("starts a command-line tool with its first command", () => {
    assert.equal(
      next_steps(answers({ kind: "cli", project: "tool" }), true),
      "  cd shop\n  cho serve tool -- hello",
    );
    assert.equal(
      next_steps(answers({ kind: "cli", runtime: "node" }), false),
      "  cd shop\n  npm install\n  cho serve api -- hello",
    );
  });
});

describe("report_error", () => {
  /** What the handler returns and prints for an error. */
  async function report(error: unknown) {
    const { result, output } = await capture(() => report_error(error));
    assert.deepEqual(output.log, []);
    return { code: result, error: output.error };
  }

  it("says Cancelled., with exit code 130, for a question that was cancelled", async () => {
    const cancelled = new ChoError("CHO_PROMPT_CANCELLED", "cancelled");
    assert.deepEqual(await report(cancelled), {
      code: 130,
      error: ["Cancelled."],
    });
  });

  it("says how to answer without a terminal, when there is none", async () => {
    const nobody = new ChoError("CHO_PROMPT_NO_TERMINAL", "no terminal");
    assert.deepEqual(await report(nobody), {
      code: 1,
      error: [
        "Error: There is no terminal to ask on. Give every answer as a " +
        "flag, or --yes for the defaults: see cho new --help",
      ],
    });
  });

  it("prints the message of any other error, with exit code 1", async () => {
    assert.deepEqual(await report(new Error("it broke")), {
      code: 1,
      error: ["Error: it broke"],
    });
    assert.deepEqual(await report("a text"), {
      code: 1,
      error: ["Error: a text"],
    });
  });
});

describe("cho new, as a command line", () => {
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

  it("creates a workspace in the current folder, with every answer as a flag", () =>
    with_folder(async (cwd) => {
      const run = await cho_in(
        cwd,
        "new",
        "tool",
        "--kind",
        "cli",
        "--runtime=node",
        "--project",
        "tool",
        "--apps-dir",
        "packages",
        "--no-git",
        "--no-install",
      );
      assert.deepEqual(run, {
        code: 0,
        log: [
          "Created tool (10 files)",
          "\n  cd tool\n  npm install\n  cho serve tool -- hello",
        ],
        error: [],
      });
      const files = await files_of(join(cwd, "tool"));
      assert.equal(files.length, 10);
      assert.ok(files.includes("packages/tool/package.json"));
    }));

  it("takes the defaults with --yes", () =>
    with_folder(async (cwd) => {
      const run = await cho_in(
        cwd,
        "new",
        "shop",
        "-y",
        "--no-git",
        "--no-install",
        "--runtime",
        "deno",
      );
      assert.equal(run.code, 0);
      assert.deepEqual(await files_of(join(cwd, "shop")), FILES);
    }));

  it("writes nothing with --dry-run", () =>
    with_folder(async (cwd) => {
      const run = await cho_in(cwd, "new", "shop", "--yes", "--dry-run");
      assert.equal(run.code, 0);
      assert.equal(
        run.log[0],
        "Dry run: nothing is written, and nothing is run.",
      );
      assert.ok(run.log[1]!.startsWith("\n  create  shop/cho.json\n"));
      assert.deepEqual(await files_of(cwd), []);
    }));

  it("prints the mistake of a flag, writes nothing, and exits with 1", () =>
    with_folder(async (cwd) => {
      const wrong = [
        [
          ["shop", "--kind", "mobile"],
          "--kind mobile: not one of web, cli, message",
        ],
        [
          ["shop", "--kindd", "web"],
          "--kindd: cho new has no such flag. See cho new --help",
        ],
        [
          ["My-Shop", "--yes"],
          'The name of the workspace "My-Shop": Lower case letters, digits ' +
          "and -, starting with a letter",
        ],
      ] as const;
      for (const [argv, message] of wrong) {
        assert.deepEqual(await cho_in(cwd, "new", ...argv), {
          code: 1,
          log: [],
          error: [`Error: ${message}`],
        });
      }
      assert.deepEqual(await files_of(cwd), []);
    }));

  it("refuses a folder that exists, before any question", () =>
    with_folder(async (cwd) => {
      await mkdir(join(cwd, "shop"));
      assert.deepEqual(await cho_in(cwd, "new", "shop"), {
        code: 1,
        log: [],
        error: ["Error: The folder shop exists already. Nothing was written."],
      });
    }));
});
