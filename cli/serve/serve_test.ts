/**
 * Tests for `cho serve`: the command it would run, with a runner that runs
 * nothing, and the command itself, run as `main.ts` runs it.
 *
 * The last group runs a real project, on the runtime of the test. On Node.js
 * a project is run by `tsx`, which a workspace installs and a test does not:
 * there, the test stops before the project runs.
 */

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { describe, it } from "node:test";
import { ChoError, isChoError } from "@chojs/command";
import { capture } from "@chojs/core/utils/test_utils";
import { run_cli } from "../app.ts";
import { current_runtime } from "../new/answers.ts";
import type { ChoConfig } from "../new/config.ts";
import { memory_host, with_folder } from "../new/testing.ts";
import { Tree } from "../tree.ts";
import type { Flags } from "./flags.ts";
import { report_error, serve_project } from "./serve.ts";

/** A workspace with a web application, a tool, and a library. */
const config: ChoConfig = {
  version: 1,
  runtime: "deno",
  projects: {
    api: { kind: "web", root: "apps/api" },
    tool: { kind: "cli", root: "apps/tool", entry: "run.ts" },
    shared: { type: "library", root: "libs/shared" },
  },
};

/** The files of the workspace, installed. */
const FILES = {
  "cho.json": JSON.stringify(config),
  "package.json": "{}",
  "apps/api/main.ts": "",
  "apps/tool/run.ts": "",
  "libs/shared/mod.ts": "",
  "node_modules/.package-lock.json": "{}",
};

/** What a command line said: nothing, but for what is given. */
const flags = (given: Partial<Flags> = {}): Flags => ({
  name: undefined,
  args: [],
  runtime: undefined,
  watch: true,
  ...given,
});

const root = join("/", "work", "shop");

/** Serve, with a runner that runs nothing, and give what it was asked. */
async function serve(given: Partial<Flags>, cwd = root, code = 0) {
  const ran: { program: string; args: readonly string[]; cwd: string }[] = [];
  const { result, output } = await capture(() =>
    serve_project(
      new Tree(memory_host({ ...FILES })),
      config,
      flags(given),
      { root, cwd },
      (program, args, cwd) => {
        ran.push({ program, args, cwd });
        return Promise.resolve(code);
      },
    )
  );
  return { code: result, ran, log: output.log, error: output.error };
}

describe("serve_project", () => {
  it("runs the entry of a web application in its folder, and watches it", async () => {
    assert.deepEqual(await serve({ name: "api" }), {
      code: 0,
      ran: [{
        program: "deno",
        args: ["run", "--allow-net", "--allow-env", "--watch", "main.ts"],
        cwd: join(root, "apps", "api"),
      }],
      // the standard output is the one of the project
      log: [],
      error: ["Running deno run --allow-net --allow-env --watch main.ts"],
    });
  });

  it("does not watch with --no-watch", async () => {
    const { ran } = await serve({ name: "api", watch: false });
    assert.deepEqual(ran[0]?.args, [
      "run",
      "--allow-net",
      "--allow-env",
      "main.ts",
    ]);
  });

  it("runs a command-line tool once, with its arguments: it is never watched", async () => {
    const { ran, error } = await serve({
      name: "tool",
      args: ["hello", "--name", "Ada Lovelace"],
    });
    assert.deepEqual(ran, [{
      program: "deno",
      args: ["run", "--allow-env", "run.ts", "hello", "--name", "Ada Lovelace"],
      cwd: join(root, "apps", "tool"),
    }]);
    assert.deepEqual(error, [
      'Running deno run --allow-env run.ts hello --name "Ada Lovelace"',
    ]);
  });

  it("starts a message consumer as a server: watched, and reading files on Deno", async () => {
    const workspace: ChoConfig = {
      version: 1,
      runtime: "deno",
      projects: { worker: { kind: "message", root: "apps/worker" } },
    };
    const ran: string[][] = [];
    await capture(() =>
      serve_project(
        new Tree(memory_host({
          "cho.json": JSON.stringify(workspace),
          "package.json": "{}",
          "apps/worker/main.ts": "",
          "node_modules/.package-lock.json": "{}",
        })),
        workspace,
        flags(), // no name: the one application of the workspace
        { root, cwd: root },
        (program, args) => {
          ran.push([program, ...args]);
          return Promise.resolve(0);
        },
      )
    );
    assert.deepEqual(ran, [[
      "deno",
      "run",
      "--allow-net",
      "--allow-env",
      "--allow-read",
      "--watch",
      "main.ts",
    ]]);
  });

  it("runs on the runtime of --runtime, for this run", async () => {
    const node = await serve({ name: "api", runtime: "node" });
    assert.deepEqual(
      [node.ran[0]?.program, node.ran[0]?.args],
      ["npx", ["tsx", "watch", "main.ts"]],
    );
    const bun = await serve({ name: "tool", runtime: "bun", args: ["hello"] });
    assert.deepEqual(
      [bun.ran[0]?.program, bun.ran[0]?.args],
      ["bun", ["run.ts", "hello"]],
    );
  });

  it("runs the project of the current folder, when none is named", async () => {
    const { ran } = await serve({}, join(root, "apps", "tool", "src"));
    assert.equal(ran[0]?.cwd, join(root, "apps", "tool"));
  });

  it("gives the exit code of the project", async () => {
    assert.equal((await serve({ name: "tool" }, root, 3)).code, 3);
    assert.equal((await serve({ name: "api" }, root, 130)).code, 130);
  });

  it("runs nothing for a library, a name it does not know, or no name", async () => {
    const refused = [
      [{ name: "shared" }, "CHO_CLI_NOT_AN_APPLICATION"],
      [{ name: "nosuch" }, "CHO_CLI_UNKNOWN_PROJECT"],
      [{}, "CHO_CLI_UNKNOWN_PROJECT"],
    ] as const;
    for (const [given, code] of refused) {
      await assert.rejects(
        serve(given),
        (error) => isChoError(error, code),
        code,
      );
    }
  });

  it("runs nothing in a workspace that is not installed: CHO_CLI_NOT_INSTALLED", async () => {
    const { "node_modules/.package-lock.json": _, ...files } = FILES;
    let ran = false;
    await assert.rejects(
      capture(() =>
        serve_project(
          new Tree(memory_host(files)),
          config,
          flags({ name: "api", runtime: "node" }),
          { root, cwd: root },
          () => {
            ran = true;
            return Promise.resolve(0);
          },
        )
      ),
      (error) =>
        isChoError(error, "CHO_CLI_NOT_INSTALLED") &&
        error.message.includes("Run npm install at its root"),
    );
    assert.equal(ran, false);
  });
});

describe("report_error", () => {
  it("prints the message of an error, with exit code 1", async () => {
    const { result, output } = await capture(() =>
      report_error(new ChoError("CHO_CLI_NOT_STARTED", "Could not start bun"))
    );
    assert.equal(result, 1);
    assert.deepEqual(output.error, ["Error: Could not start bun"]);
  });
});

describe("cho serve, as a command line", () => {
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

  /** The arguments the tool of the workspace expects. */
  const ARGS = ["hello", "--name", "Ada Lovelace"];

  /**
   * Run a function in a workspace of the disk, with a tool that has no
   * dependency, and needs no permission: it exits with `0` when its
   * arguments are {@link ARGS}, with `3` for `fail`, and with `7` otherwise.
   */
  function with_workspace<T>(fn: (root: string) => Promise<T>): Promise<T> {
    return with_folder(async (folder) => {
      const tool = join(folder, "apps", "tool");
      await mkdir(tool, { recursive: true });
      await mkdir(join(folder, "libs", "shared"), { recursive: true });
      await writeFile(
        join(folder, "cho.json"),
        JSON.stringify({
          version: 1,
          runtime: current_runtime(),
          projects: {
            tool: { kind: "cli", root: "apps/tool" },
            shared: { type: "library", root: "libs/shared" },
          },
        }),
      );
      await writeFile(
        join(tool, "main.ts"),
        'import process from "node:process";\n' +
          "const args: string[] = process.argv.slice(2);\n" +
          `const same = JSON.stringify(args) === '${JSON.stringify(ARGS)}';\n` +
          'process.exit(same ? 0 : args[0] === "fail" ? 3 : 7);\n',
      );
      return fn(folder);
    });
  }

  it("prints the mistake, runs nothing, and exits with 1", () =>
    with_workspace(async (root) => {
      const wrong = [
        [
          ["shared"],
          "shared is a library: it does not run. Its tests do, in libs/shared: ",
        ],
        [
          ["nosuch"],
          "The workspace has no project named nosuch. Its projects: ",
        ],
        [["tool", "--port", "1"], "--port: cho serve has no such flag. "],
        [["tool", "--runtime", "pnpm"], "--runtime pnpm: not one of "],
      ] as const;
      for (const [argv, message] of wrong) {
        const run = await cho_in(root, "serve", ...argv);
        assert.equal(run.code, 1, argv.join(" "));
        assert.deepEqual(run.log, []);
        assert.equal(run.error.length, 1);
        assert.ok(
          String(run.error[0]).startsWith(`Error: ${message}`),
          message,
        );
      }
    }));

  it("refuses a folder that is not in a workspace: CHO_CLI_NO_WORKSPACE", () =>
    with_folder(async (folder) => {
      const run = await cho_in(folder, "serve", "api");
      assert.equal(run.code, 1);
      assert.match(String(run.error[0]), /^Error: There is no cho\.json here/);
    }));

  it("refuses an entry that is not there", () =>
    with_workspace(async (root) => {
      const settings = JSON.parse(
        await readFile(join(root, "cho.json"), "utf8"),
      );
      settings.projects.tool.entry = "start.ts";
      await writeFile(join(root, "cho.json"), JSON.stringify(settings));
      assert.deepEqual((await cho_in(root, "serve", "tool")).error, [
        "Error: cho.json: projects.tool.entry: there is no file " +
        "apps/tool/start.ts",
      ]);
    }));

  // Node.js runs a project with `tsx`, which this workspace does not have.
  const real = current_runtime() === "node" ? it.skip : it;

  real(
    "runs the tool of the workspace, with its arguments, and gives its exit code",
    () =>
      with_workspace(async (root) => {
        // by its name, from another folder of the workspace
        const run = await cho_in(
          join(root, "libs"),
          "serve",
          "tool",
          "hello",
          "--",
          "--name",
          "Ada Lovelace",
        );
        assert.deepEqual(run.log, []);
        assert.match(
          String(run.error[0]),
          /^Running .* main\.ts hello --name "Ada Lovelace"$/,
        );
        // the tool got the three arguments, as they were typed
        assert.equal(run.code, 0);

        // with no name: the one application; and the exit code of the project
        assert.equal((await cho_in(root, "serve", "--", "fail")).code, 3);
        assert.equal((await cho_in(root, "serve", "--", "other")).code, 7);
      }),
  );
});
