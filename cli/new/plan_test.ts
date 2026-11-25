/**
 * Tests for the plan of a workspace, and of a project: the files `cho new`
 * would write, for each kind and each runtime, and the commands that run a
 * project. Nothing is written: a plan is a list.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { check_config, KINDS, make_project, RUNTIMES } from "./config.ts";
import type { Answers } from "./answers.ts";
import {
  command_line,
  command_of,
  needs_line,
  plan_workspace,
  project_files,
  run_command,
  serve_line,
} from "./plan.ts";
import { TEMPLATES } from "./templates.gen.ts";

const answers = (given: Partial<Answers> = {}): Answers => ({
  name: "shop",
  kind: "web",
  runtime: "deno",
  project: "api",
  appsDir: "apps",
  git: true,
  install: true,
  ...given,
});

/** The plan, as a record: the text of each file, by its path. */
const plan = (given: Partial<Answers> = {}, version = "3.6.0") =>
  Object.fromEntries(
    plan_workspace(answers(given), version).map((
      file,
    ) => [file.path, file.text]),
  );

const json = (text: string | undefined) => JSON.parse(text ?? "null");

/** The projects the commands are tested on. */
const web = make_project({ type: "application", kind: "web" }, "apps/api");
const cli = make_project({ type: "application", kind: "cli" }, "apps/tool");
const worker = make_project(
  { type: "application", kind: "message" },
  "apps/worker",
);
const library = make_project({ type: "library" }, "libs/shared");

describe("plan_workspace", () => {
  it("plans a workspace: package.json and .npmrc for it, and a project", () => {
    const files = plan();
    assert.deepEqual(Object.keys(files), [
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
    ]);
    // the folder of the libraries is there from the first day
    assert.deepEqual(json(files["package.json"]), {
      name: "shop",
      private: true,
      type: "module",
      workspaces: ["apps/*", "libs/*"],
    });
    // the npm registry of JSR, as `npx jsr add` writes it
    assert.equal(files[".npmrc"], "@jsr:registry=https://npm.jsr.io\n");
    assert.equal(files[".gitignore"], "node_modules/\n.env\n");
  });

  it("plans the same workspace on the three runtimes, but for cho.json and the README.md", () => {
    const deno = plan({ runtime: "deno" });
    for (const runtime of ["node", "bun"] as const) {
      const files = plan({ runtime });
      assert.deepEqual(Object.keys(files), Object.keys(deno));
      for (const [path, text] of Object.entries(files)) {
        if (path !== "cho.json" && path !== "README.md") {
          assert.equal(text, deno[path], `${path} on ${runtime}`);
        }
      }
      assert.equal(json(files["cho.json"]).runtime, runtime);
    }
  });

  it("gives an application the package of CHO of its kind, tsx and the types of Node.js", () => {
    assert.deepEqual(json(plan()["apps/api/package.json"]), {
      name: "@shop/api",
      version: "0.1.0",
      private: true,
      type: "module",
      dependencies: { "@chojs/web": "npm:@jsr/chojs__web@^3.6.0" },
      devDependencies: { "@types/node": "^24.0.0", tsx: "^4.20.0" },
    });
    const tool = plan({ kind: "cli", project: "tool" });
    assert.deepEqual(json(tool["apps/tool/package.json"]).dependencies, {
      "@chojs/command": "npm:@jsr/chojs__command@^3.6.0",
    });
  });

  it("gives a message consumer its package, and the adapter of Kafka", () => {
    const files = plan({ kind: "message", project: "worker" });
    assert.deepEqual(json(files["apps/worker/package.json"]).dependencies, {
      "@chojs/message": "npm:@jsr/chojs__message@^3.6.0",
      "@chojs/vendor-kafka": "npm:@jsr/chojs__vendor-kafka@^3.6.0",
    });
    // the group of the application is its name, and so is its first topic
    assert.ok(files["apps/worker/main.ts"]!.includes('groupId: "worker"'));
    assert.match(
      files["apps/worker/app.ts"]!,
      /^@Controller\(\{ topic: "worker" \}\)$/m,
    );
  });

  it("says in the README.md what a message consumer needs to run: Kafka", () => {
    const readme = plan({ kind: "message", project: "worker" })["README.md"]!;
    assert.ok(
      readme.includes(
        "- `apps/worker/`: a message consumer, built with\n" +
          "  `@chojs/message`, on `@chojs/vendor-kafka`.",
      ),
    );
    assert.match(readme, /^## Kafka$/m);
    assert.ok(readme.includes("the topic `worker.hello`"));
    assert.ok(readme.includes("`KAFKA_BROKERS`"));
    assert.ok(
      readme.includes("deno run --allow-net --allow-env --allow-read main.ts"),
    );
    // one empty line between two sections, and no more
    assert.doesNotMatch(readme, /\n\n\n/);

    // the other kinds need nothing: no such section
    for (const kind of ["web", "cli"] as const) {
      const other = plan({ kind })["README.md"]!;
      assert.doesNotMatch(other, /Kafka/);
      assert.doesNotMatch(other, /\n\n\n/);
    }
  });

  it("gives a project no scripts: no one command runs it on the three", () => {
    for (const kind of KINDS) {
      const manifest = json(plan({ kind })["apps/api/package.json"]);
      assert.equal("scripts" in manifest, false);
    }
  });

  it("writes a tsconfig.json in the folder of the project, with the types of Node.js", () => {
    const { compilerOptions } = json(plan()["apps/api/tsconfig.json"]);
    assert.equal(compilerOptions.noEmit, true);
    assert.equal(compilerOptions.allowImportingTsExtensions, true);
    assert.deepEqual(compilerOptions.types, ["node"]);
  });

  it("depends on the packages of the version of cho", () => {
    const files = plan({}, "4.1.2");
    assert.deepEqual(json(files["apps/api/package.json"]).dependencies, {
      "@chojs/web": "npm:@jsr/chojs__web@^4.1.2",
    });
    assert.match(files["README.md"]!, /of CHO\n4\.1\.2\./);
  });

  it("puts the project where the answers say: its name, and the folder", () => {
    const files = plan({ project: "orders", appsDir: "services" });
    assert.ok("services/orders/main.ts" in files);
    assert.deepEqual(json(files["package.json"]).workspaces, [
      "services/*",
      "libs/*",
    ]);
    assert.equal(
      json(files["services/orders/package.json"]).name,
      "@shop/orders",
    );
    assert.deepEqual(json(files["cho.json"]).projects, {
      orders: {
        type: "application",
        kind: "web",
        root: "services/orders",
        entry: "main.ts",
        module: "app.ts",
      },
    });
    // one folder for both is named once
    assert.deepEqual(
      json(plan({ appsDir: "libs" })["package.json"]).workspaces,
      ["libs/*"],
    );
  });

  for (const kind of KINDS) {
    for (const runtime of RUNTIMES) {
      it(`plans ${kind} on ${runtime}: a cho.json that is right, and the template with its name`, () => {
        const files = plan({ kind, runtime, project: "orders" });
        const config = json(files["cho.json"]);
        assert.doesNotThrow(() => check_config(config));
        assert.equal(config.runtime, runtime);
        assert.equal(config.libsDir, "libs");
        assert.equal(config.projects.orders.type, "application");
        assert.equal(config.projects.orders.kind, kind);
        // the files `cho.json` names are in the plan
        const { root, entry, module } = config.projects.orders;
        assert.ok(`${root}/${entry}` in files);
        assert.ok(`${root}/${module}` in files);

        for (const [name, text] of Object.entries(TEMPLATES[kind])) {
          assert.equal(
            files[`apps/orders/${name}`],
            text.replaceAll("__name__", "orders"),
          );
        }
        for (const [path, text] of Object.entries(files)) {
          assert.doesNotMatch(text, /__name__/, path);
          assert.equal(text.endsWith("\n"), true, path);
        }
      });
    }
  }

  it("writes a README.md with the commands of each runtime", () => {
    const readme = plan()["README.md"]!;
    assert.match(readme, /^# shop\n/);
    assert.match(readme, /A \[CHO\]\(https:\/\/chojs\.io\) workspace\./);
    assert.match(readme, /the same on Deno, on Node\.js and on Bun/);
    assert.ok(readme.includes("`cho` installs it with Deno"));
    // `cho serve` first: one command, on any runtime
    assert.ok(readme.includes("```sh\ncho serve api\n```"));
    const blocks = [
      "Deno:\n\n```sh\ndeno install\n" +
      "deno run --allow-net --allow-env main.ts\n" +
      "deno run --allow-net --allow-env --watch main.ts\n" +
      "deno test --allow-env\n```",
      "Node.js:\n\n```sh\nnpm install\nnpx tsx main.ts\n" +
      "npx tsx watch main.ts\nnpx tsx --test\n```",
      "Bun:\n\n```sh\nbun install\nbun main.ts\nbun --watch main.ts\n" +
      "bun test\n```",
    ];
    for (const block of blocks) {
      assert.ok(readme.includes(block), block);
    }

    const tool = plan({ runtime: "node", kind: "cli" })["README.md"]!;
    assert.ok(tool.includes("`cho` installs it with Node.js"));
    assert.ok(tool.includes("a command-line tool, built with"));
    assert.ok(tool.includes("`@chojs/command`"));
    assert.match(tool, /^npx tsx main\.ts hello$/m);
    assert.match(tool, /^cho serve api -- hello$/m);
  });

  it("names the formatters of the runtimes, and installs none", () => {
    const commands = plan()["README.md"]!
      .split("## Formatting and linting")[1]!
      .match(/```sh\n([^`]*)```/)![1]!.trim().split("\n");
    assert.deepEqual(commands, ["deno fmt", "deno lint", "bun fmt"]);
    const manifest = json(plan()["apps/api/package.json"]);
    const installed = Object.keys(manifest.devDependencies).join(" ");
    assert.doesNotMatch(installed, /prettier|eslint|biome/);
  });
});

describe("project_files", () => {
  const input = { workspace: "shop", name: "shared", version: "3.6.0" };

  it("gives a library a manifest that exports it, and its template", () => {
    const files = Object.fromEntries(
      project_files(input, library).map((file) => [file.path, file.text]),
    );
    assert.deepEqual(Object.keys(files), [
      "libs/shared/package.json",
      "libs/shared/tsconfig.json",
      "libs/shared/mod.ts",
      "libs/shared/mod_test.ts",
    ]);
    // no package of CHO: a library is plain TypeScript
    assert.deepEqual(json(files["libs/shared/package.json"]), {
      name: "@shop/shared",
      version: "0.1.0",
      private: true,
      type: "module",
      exports: "./mod.ts",
      devDependencies: { "@types/node": "^24.0.0", tsx: "^4.20.0" },
    });
    assert.equal(
      files["libs/shared/mod.ts"],
      TEMPLATES.library["mod.ts"]!.replaceAll("__name__", "shared"),
    );
    assert.match(files["libs/shared/mod_test.ts"]!, /from "\.\/mod\.ts"/);
  });

  it("gives an application the files of a new workspace's project", () => {
    const project = make_project(
      { type: "application", kind: "web" },
      "apps/api",
    );
    const files = project_files({ ...input, name: "api" }, project);
    const planned = plan_workspace(answers(), "3.6.0");
    assert.deepEqual(files, planned.slice(-files.length));
  });
});

describe("command_of", () => {
  const tasks = ["start", "dev", "test"] as const;

  it("is how a web application is run, on each runtime", () => {
    assert.deepEqual(tasks.map((task) => command_of("deno", web, task)), [
      "deno run --allow-net --allow-env main.ts",
      "deno run --allow-net --allow-env --watch main.ts",
      "deno test --allow-env",
    ]);
    assert.deepEqual(tasks.map((task) => command_of("node", web, task)), [
      "npx tsx main.ts",
      "npx tsx watch main.ts",
      "npx tsx --test",
    ]);
    assert.deepEqual(tasks.map((task) => command_of("bun", web, task)), [
      "bun main.ts",
      "bun --watch main.ts",
      "bun test",
    ]);
  });

  it("runs a command-line tool with its first command, and no network", () => {
    assert.equal(
      command_of("deno", cli, "start"),
      "deno run --allow-env main.ts hello",
    );
    assert.equal(command_of("node", cli, "start"), "npx tsx main.ts hello");
    assert.equal(command_of("bun", cli, "start"), "bun main.ts hello");
    assert.equal(command_of("node", cli, "test"), "npx tsx --test");
  });

  it("tests a library, which reads nothing of the environment", () => {
    assert.equal(command_of("deno", library, "test"), "deno test");
    assert.equal(command_of("node", library, "test"), "npx tsx --test");
    assert.equal(command_of("bun", library, "test"), "bun test");
  });

  it("runs the entry cho.json names", () => {
    assert.equal(
      command_of("bun", { ...web, entry: "server.ts" }, "start"),
      "bun server.ts",
    );
  });

  it("has nothing to start in a library: its tests are what runs", () => {
    assert.equal(command_of("deno", library, "start"), "deno test");
    assert.equal(command_of("bun", library, "dev"), "bun test");
  });
});

describe("run_command", () => {
  it("is the program of the runtime, and its arguments as a list", () => {
    assert.deepEqual(run_command("deno", web, { watch: true }), {
      program: "deno",
      args: ["run", "--allow-net", "--allow-env", "--watch", "main.ts"],
    });
    assert.deepEqual(run_command("node", web, { watch: true }), {
      program: "npx",
      args: ["tsx", "watch", "main.ts"],
    });
    assert.deepEqual(run_command("bun", web, { watch: true }), {
      program: "bun",
      args: ["--watch", "main.ts"],
    });
  });

  it("does not watch when it is not asked to", () => {
    assert.deepEqual(run_command("deno", web, { watch: false }).args, [
      "run",
      "--allow-net",
      "--allow-env",
      "main.ts",
    ]);
    assert.deepEqual(run_command("node", web, { watch: false }).args, [
      "tsx",
      "main.ts",
    ]);
    assert.deepEqual(run_command("bun", web, { watch: false }).args, [
      "main.ts",
    ]);
  });

  it("gives a kind that uses no network no permission for it, on Deno", () => {
    assert.deepEqual(run_command("deno", cli, { watch: false }).args, [
      "run",
      "--allow-env",
      "main.ts",
    ]);
  });

  it("starts a message consumer as a server is, and lets it read files on Deno", () => {
    // the client library of Kafka reads a file when it loads
    assert.deepEqual(run_command("deno", worker, { watch: true }).args, [
      "run",
      "--allow-net",
      "--allow-env",
      "--allow-read",
      "--watch",
      "main.ts",
    ]);
    assert.deepEqual(run_command("node", worker, { watch: true }).args, [
      "tsx",
      "watch",
      "main.ts",
    ]);
    assert.deepEqual(run_command("bun", worker, { watch: true }).args, [
      "--watch",
      "main.ts",
    ]);
    // its tests give it messages of their own: they need no more than the
    // tests of any application
    assert.equal(command_of("deno", worker, "test"), "deno test --allow-env");
  });

  it("puts the arguments of the project after its entry, each as it is", () => {
    const args = ["hello", "--name", "Ada Lovelace", "--watch"];
    for (const runtime of RUNTIMES) {
      const command = run_command(runtime, cli, { watch: false, args });
      assert.deepEqual(command.args.slice(-5), ["main.ts", ...args], runtime);
    }
  });
});

describe("needs_line", () => {
  it("says that a message consumer reads from Kafka, and where", () => {
    assert.equal(
      needs_line("worker", "message"),
      "worker reads from Kafka, at localhost:9092: the variable " +
        "KAFKA_BROKERS names another address.",
    );
  });

  it("says nothing for a kind that needs nothing", () => {
    assert.equal(needs_line("api", "web"), undefined);
    assert.equal(needs_line("tool", "cli"), undefined);
  });
});

describe("command_line", () => {
  it("is the command as it is typed, with quotes where a word needs them", () => {
    assert.equal(
      command_line({ program: "bun", args: ["--watch", "main.ts"] }),
      "bun --watch main.ts",
    );
    assert.equal(
      command_line({
        program: "npx",
        args: ["tsx", "main.ts", "--name", "Ada Lovelace", "", "a=b", "$HOME"],
      }),
      'npx tsx main.ts --name "Ada Lovelace" "" a=b "$HOME"',
    );
  });
});

describe("serve_line", () => {
  it("runs an application with cho serve, a tool with its first command", () => {
    assert.equal(serve_line("api", "web"), "cho serve api");
    assert.equal(serve_line("tool", "cli"), "cho serve tool -- hello");
  });
});
