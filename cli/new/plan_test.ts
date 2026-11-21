/**
 * Tests for the plan of a workspace: the files `cho new` would write, for
 * each kind and each runtime. Nothing is written: a plan is a list.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { check_config, KINDS, RUNTIMES } from "./config.ts";
import type { Answers } from "./answers.ts";
import { plan_workspace, task_command } from "./plan.ts";
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

describe("plan_workspace", () => {
  it("plans a workspace of Deno: a deno.json for it, and one for the project", () => {
    const files = plan();
    assert.deepEqual(Object.keys(files), [
      "cho.json",
      "deno.json",
      ".gitignore",
      "README.md",
      "apps/api/deno.json",
      "apps/api/app.ts",
      "apps/api/app_test.ts",
      "apps/api/main.ts",
    ]);
    assert.deepEqual(json(files["deno.json"]), { workspace: ["./apps/api"] });
    assert.deepEqual(json(files["apps/api/deno.json"]), {
      name: "@shop/api",
      version: "0.1.0",
      exports: "./app.ts",
      imports: { "@chojs/web": "jsr:@chojs/web@^3.6.0" },
      tasks: {
        dev: "deno run --allow-net --allow-env --watch main.ts",
        start: "deno run --allow-net --allow-env main.ts",
        test: "deno test --allow-env",
      },
    });
  });

  it("plans a workspace of Node.js: package.json, .npmrc, tsconfig.json, and tsx", () => {
    const files = plan({ runtime: "node" });
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
    assert.deepEqual(json(files["package.json"]), {
      name: "shop",
      private: true,
      type: "module",
      workspaces: ["apps/*"],
    });
    // the npm registry of JSR, as `npx jsr add` writes it
    assert.equal(files[".npmrc"], "@jsr:registry=https://npm.jsr.io\n");
    assert.deepEqual(json(files["apps/api/package.json"]), {
      name: "@shop/api",
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        dev: "tsx watch main.ts",
        start: "tsx main.ts",
        test: "tsx --test",
      },
      dependencies: { "@chojs/web": "npm:@jsr/chojs__web@^3.6.0" },
      devDependencies: { "@types/node": "^24.0.0", tsx: "^4.20.0" },
    });
    // in the folder of the project, with the types of the runtime
    const { compilerOptions } = json(files["apps/api/tsconfig.json"]);
    assert.equal(compilerOptions.noEmit, true);
    assert.equal(compilerOptions.allowImportingTsExtensions, true);
    assert.deepEqual(compilerOptions.types, ["node"]);
  });

  it("plans a workspace of Bun: as Node.js, with the tasks and the types of Bun", () => {
    const files = plan({ runtime: "bun", kind: "cli", project: "tool" });
    assert.deepEqual(
      Object.keys(files),
      Object.keys(plan({ runtime: "node", kind: "cli", project: "tool" })),
    );
    assert.deepEqual(json(files["apps/tool/package.json"]), {
      name: "@shop/tool",
      version: "0.1.0",
      private: true,
      type: "module",
      scripts: {
        dev: "bun --watch main.ts",
        start: "bun main.ts",
        test: "bun test",
      },
      dependencies: { "@chojs/command": "npm:@jsr/chojs__command@^3.6.0" },
      devDependencies: { "@types/bun": "^1.3.0" },
    });
    assert.deepEqual(
      json(files["apps/tool/tsconfig.json"]).compilerOptions.types,
      ["bun"],
    );
  });

  it("gives a command-line tool on Deno the permission it needs, and no more", () => {
    const manifest = json(plan({ kind: "cli" })["apps/api/deno.json"]);
    assert.deepEqual(manifest.imports, {
      "@chojs/command": "jsr:@chojs/command@^3.6.0",
    });
    assert.equal(manifest.tasks.start, "deno run --allow-env main.ts");
  });

  it("depends on the packages of the version of cho", () => {
    const files = plan({}, "4.1.2");
    assert.deepEqual(json(files["apps/api/deno.json"]).imports, {
      "@chojs/web": "jsr:@chojs/web@^4.1.2",
    });
    assert.match(files["README.md"]!, /of CHO 4\.1\.2\./);
  });

  it("puts the project where the answers say: its name, and the folder", () => {
    const files = plan({
      runtime: "node",
      project: "orders",
      appsDir: "services",
    });
    assert.ok("services/orders/main.ts" in files);
    assert.deepEqual(json(files["package.json"]).workspaces, ["services/*"]);
    assert.equal(
      json(files["services/orders/package.json"]).name,
      "@shop/orders",
    );
    assert.deepEqual(json(files["cho.json"]).projects, {
      orders: {
        kind: "web",
        root: "services/orders",
        entry: "main.ts",
        module: "app.ts",
      },
    });
  });

  for (const kind of KINDS) {
    for (const runtime of RUNTIMES) {
      it(`plans ${kind} on ${runtime}: a cho.json that is right, and the template with its name`, () => {
        const files = plan({ kind, runtime, project: "orders" });
        const config = json(files["cho.json"]);
        assert.doesNotThrow(() => check_config(config));
        assert.equal(config.runtime, runtime);
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
        assert.equal(files[".gitignore"], "node_modules/\n.env\n");
      });
    }
  }

  it("writes a README.md that names the commands of the runtime", () => {
    const deno = plan()["README.md"]!;
    assert.match(deno, /^# shop\n/);
    assert.match(deno, /A \[CHO\]\(https:\/\/chojs\.io\) workspace, on Deno\./);
    assert.match(deno, /^deno install$/m);
    assert.match(deno, /^deno task dev\ndeno task start\ndeno task test$/m);

    const node = plan({ runtime: "node", kind: "cli" })["README.md"]!;
    assert.match(node, /workspace, on Node\.js\./);
    assert.match(node, /^npm install$/m);
    assert.match(node, /^npm run start -- hello$/m);
    assert.ok(node.includes("a command-line tool, built with"));
    assert.ok(node.includes("`@chojs/command`"));
  });

  it("names the formatter of the runtime, and installs none", () => {
    const commands = (runtime: Answers["runtime"]) =>
      plan({ runtime })["README.md"]!.split("## Formatting and linting")[1]!
        .match(/```sh\n([^`]*)```/)![1]!.trim().split("\n");
    assert.deepEqual(commands("deno"), ["deno fmt", "deno lint"]);
    assert.deepEqual(commands("bun"), ["bun fmt"]);
    // Node.js has none: it is pointed to those of Deno
    assert.deepEqual(commands("node"), ["deno fmt", "deno lint"]);
    for (const runtime of ["node", "bun"] as const) {
      const manifest = json(plan({ runtime })["apps/api/package.json"]);
      const installed = Object.keys(manifest.devDependencies).join(" ");
      assert.doesNotMatch(installed, /prettier|eslint|biome/);
    }
  });
});

describe("task_command", () => {
  it("is how a task of a project is run, on each runtime", () => {
    const tasks = ["dev", "start", "test"] as const;
    assert.deepEqual(tasks.map((task) => task_command("deno", "web", task)), [
      "deno task dev",
      "deno task start",
      "deno task test",
    ]);
    assert.deepEqual(tasks.map((task) => task_command("node", "web", task)), [
      "npm run dev",
      "npm run start",
      "npm run test",
    ]);
    assert.equal(task_command("bun", "web", "dev"), "bun run dev");
  });

  it("starts a command-line tool with its first command", () => {
    assert.equal(task_command("deno", "cli", "start"), "deno task start hello");
    assert.equal(task_command("bun", "cli", "start"), "bun run start hello");
    // npm wants `--` before the arguments of a script
    assert.equal(
      task_command("node", "cli", "start"),
      "npm run start -- hello",
    );
    assert.equal(task_command("node", "cli", "test"), "npm run test");
  });
});
