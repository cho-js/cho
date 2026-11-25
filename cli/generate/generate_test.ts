/**
 * Tests for `cho generate`: the files it writes in a workspace, what it
 * prints, and the command itself, run as `main.ts` runs it.
 *
 * What it writes is tested as source too: the templates are files of the
 * repository, with tests of their own.
 */

import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { describe, it } from "node:test";
import { ChoError, isChoError } from "@chojs/command";
import { capture } from "@chojs/core/utils/test_utils";
import { run_cli } from "../app.ts";
import { check_config } from "../new/config.ts";
import { create_workspace } from "../new/new.ts";
import {
  files_of,
  memory_host,
  new_workspace,
  with_folder,
} from "../new/testing.ts";
import { Tree } from "../tree.ts";
import { generate_part, report_error } from "./generate.ts";
import type { Generation } from "./plan.ts";

const USERS: Generation = {
  part: "controller",
  name: "users",
  project: "api",
  folder: "apps/api",
};

/** Generate a part in the workspace `shop`, in memory. */
async function generate(generation: Generation, dry_run = false) {
  const files = new_workspace();
  const host = memory_host({ ...files });
  const tree = new Tree(host);
  const config = check_config(JSON.parse(files["cho.json"]!));
  const { result, output } = await capture(() =>
    generate_part(tree, config, generation, dry_run)
  );
  // what was written: the files that were not there
  const written = Object.keys(host.files).filter((path) => !(path in files));
  return { code: result, log: output.log, error: output.error, written, host };
}

describe("generate_part", () => {
  it("writes a controller and its test, and says what to add to a module", async () => {
    const { code, log, error, written, host } = await generate(USERS);
    assert.equal(code, 0);
    assert.deepEqual(error, []);
    assert.deepEqual(log, [
      "Created apps/api/users.ts, apps/api/users_test.ts",
      "\nNothing uses it yet. Add it to a module, as the one of " +
      "apps/api/app.ts:\n\n" +
      '  import { Users } from "./users.ts";\n\n' +
      "  @Module({ controllers: [Users] })\n\n" +
      "Its test runs with the tests of the project, in apps/api:\n\n" +
      "  deno test --allow-env",
    ]);
    assert.deepEqual(written, ["apps/api/users.ts", "apps/api/users_test.ts"]);
    assert.match(host.files["apps/api/users.ts"]!, /^export class Users \{$/m);
  });

  it("changes no file of the workspace: the part is not added to a module", async () => {
    const before = new_workspace();
    const { host } = await generate({ ...USERS, part: "service" });
    for (const [path, text] of Object.entries(before)) {
      assert.equal(host.files[path], text, path);
    }
  });

  it("writes a module with no test, in a folder that does not exist", async () => {
    const { log, written } = await generate({
      part: "module",
      name: "OrdersFeature",
      project: "api",
      folder: "apps/api/orders",
    });
    assert.deepEqual(written, ["apps/api/orders/orders-feature.ts"]);
    assert.equal(log[0], "Created apps/api/orders/orders-feature.ts");
    assert.ok(
      log[1]!.includes(
        '  import { OrdersFeature } from "./orders/orders-feature.ts";',
      ),
    );
  });

  it("prints what it would write, and writes nothing, for a dry run", async () => {
    const { code, log, written } = await generate(USERS, true);
    assert.equal(code, 0);
    assert.deepEqual(log, [
      "Dry run: nothing is written, and nothing is run.",
      "\n  create  apps/api/users.ts\n  create  apps/api/users_test.ts\n",
    ]);
    assert.deepEqual(written, []);
  });

  it("refuses a file that exists, and writes neither file: CHO_CLI_TARGET_EXISTS", async () => {
    const files: Record<string, string> = {
      ...new_workspace(),
      "apps/api/users_test.ts": "mine\n",
    };
    const host = memory_host(files);
    const config = check_config(JSON.parse(files["cho.json"]!));
    await assert.rejects(
      capture(() => generate_part(new Tree(host), config, USERS)),
      (error) => isChoError(error, "CHO_CLI_TARGET_EXISTS"),
    );
    assert.equal("apps/api/users.ts" in host.files, false);
    assert.equal(host.files["apps/api/users_test.ts"], "mine\n");
  });

  it("refuses a library: CHO_CLI_NOT_AN_APPLICATION", async () => {
    const files = new_workspace();
    const settings = JSON.parse(files["cho.json"]!);
    settings.projects.shared = { type: "library", root: "libs/shared" };
    await assert.rejects(
      capture(() =>
        generate_part(new Tree(memory_host(files)), check_config(settings), {
          ...USERS,
          project: "shared",
          folder: "libs/shared",
        })
      ),
      (error) => isChoError(error, "CHO_CLI_NOT_AN_APPLICATION"),
    );
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
      "flag, or --yes for the defaults: see cho generate --help",
    ]);
  });
});

describe("cho generate, as a command line", () => {
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

  /** The files of the project `api` that `cho new` did not write. */
  const added = async (root: string) =>
    (await files_of(join(root, "apps", "api"))).filter((path) =>
      !["app.ts", "app_test.ts", "main.ts", "package.json", "tsconfig.json"]
        .includes(path)
    );

  it("writes a part in the project of the workspace, with --yes", () =>
    with_workspace(async (root) => {
      const run = await cho_in(root, "generate", "service", "userStore", "-y");
      assert.equal(run.code, 0);
      assert.deepEqual(run.error, []);
      assert.equal(
        run.log[0],
        "Created apps/api/user-store.ts, apps/api/user-store_test.ts",
      );
      assert.deepEqual(await added(root), [
        "user-store.ts",
        "user-store_test.ts",
      ]);
      const text = await readFile(
        join(root, "apps", "api", "user-store.ts"),
        "utf8",
      );
      assert.match(text, /^@Injectable\(\)\nexport class UserStore \{$/m);
    }));

  it("finds the workspace from a folder of it, and writes where --path says", () =>
    with_workspace(async (root) => {
      const run = await cho_in(
        join(root, "apps", "api"),
        "generate",
        "controller",
        "Orders",
        "--project",
        "api",
        "--path=apps/api/orders/http",
      );
      assert.equal(run.code, 0);
      assert.deepEqual(await added(root), [
        "orders/http/orders.ts",
        "orders/http/orders_test.ts",
      ]);
      assert.ok(
        run.log[1]!.includes(
          '  import { Orders } from "./orders/http/orders.ts";',
        ),
      );
    }));

  it("writes nothing with --dry-run", () =>
    with_workspace(async (root) => {
      const run = await cho_in(
        root,
        "generate",
        "module",
        "orders",
        "--yes",
        "--dry-run",
      );
      assert.deepEqual(run, {
        code: 0,
        log: [
          "Dry run: nothing is written, and nothing is run.",
          "\n  create  apps/api/orders.ts\n",
        ],
        error: [],
      });
      assert.deepEqual(await added(root), []);
    }));

  it("prints the mistake, writes nothing, and exits with 1", () =>
    with_workspace(async (root) => {
      await mkdir(join(root, "apps", "api", "http"));
      await writeFile(join(root, "apps", "api", "http", "users.ts"), "mine\n");
      const wrong = [
        [["users"], "The part users: not one of controller, service, module"],
        [
          ["controller", "users.controller", "--yes"],
          'The name "users.controller": Letters and digits, starting with ' +
          "a letter: users, userProfile or user-profile",
        ],
        [
          ["controller", "users", "--yes", "--project", "web"],
          "The workspace has no project named web. Its projects: api",
        ],
        [
          ["controller", "users", "--yes", "--path", "libs/shared"],
          "--path libs/shared: A folder of the project: apps/api, or one " +
          "under it. Nothing was written.",
        ],
        [
          ["controller", "users", "--yes", "--path", "apps/api/http"],
          "--path apps/api/http: apps/api/http/users.ts exists already. " +
          "Nothing was written.",
        ],
        [
          ["controller", "users", "--yes", "--kind", "web"],
          "--kind: cho generate has no such flag. See cho generate --help",
        ],
      ] as const;
      for (const [argv, message] of wrong) {
        assert.deepEqual(await cho_in(root, "generate", ...argv), {
          code: 1,
          log: [],
          error: [`Error: ${message}`],
        });
      }
      assert.deepEqual(await added(root), ["http/users.ts"]);
    }));

  it("refuses a folder that is not in a workspace: CHO_CLI_NO_WORKSPACE", () =>
    with_folder(async (folder) => {
      const run = await cho_in(folder, "generate", "module", "orders", "-y");
      assert.equal(run.code, 1);
      assert.match(String(run.error[0]), /^Error: There is no cho\.json here/);
      assert.deepEqual(await files_of(folder), []);
    }));
});
