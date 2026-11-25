/**
 * Tests for the plan of `cho generate`: the files of a part, for each part
 * and each kind of application, and what the tool says of them. Nothing is
 * written: a plan is a list.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KINDS, make_project } from "../new/config.ts";
import { PARTS } from "./parts.ts";
import { explanation, type Generation, part_files } from "./plan.ts";
import { PART_TEMPLATES } from "./templates.gen.ts";

const web = make_project({ type: "application", kind: "web" }, "apps/api");
const tool = make_project({ type: "application", kind: "cli" }, "apps/tool");
const worker = make_project(
  { type: "application", kind: "message" },
  "apps/worker",
);
/** A project of each kind. */
const PROJECTS = { web, cli: tool, message: worker };

const generation = (given: Partial<Generation> = {}): Generation => ({
  part: "controller",
  name: "users",
  project: "api",
  folder: "apps/api",
  ...given,
});

/** The plan, as a record: the text of each file, by its path. */
const plan = (given: Partial<Generation> = {}, project = web) =>
  Object.fromEntries(
    part_files(generation(given), project).map((
      file,
    ) => [file.path, file.text]),
  );

describe("part_files", () => {
  it("writes a controller of a web application: a route, and its test", () => {
    const files = plan();
    assert.deepEqual(Object.keys(files), [
      "apps/api/users.ts",
      "apps/api/users_test.ts",
    ]);
    const text = files["apps/api/users.ts"]!;
    assert.match(text, /^import \{ Controller, Get \} from "@chojs\/web";$/m);
    assert.match(text, /^@Controller\(\{ route: "users" \}\)$/m);
    // the name, with no type in it
    assert.match(text, /^export class Users \{$/m);
    assert.match(text, /^ {2}@Get\(""\)$/m);
    const test = files["apps/api/users_test.ts"]!;
    assert.match(test, /^import \{ Users \} from "\.\/users\.ts";$/m);
    assert.ok(test.includes("new Users().hello()"));
  });

  it("writes a controller of a command-line tool: a command, and its test", () => {
    const files = plan({ name: "report", folder: "apps/tool" }, tool);
    const text = files["apps/tool/report.ts"]!;
    assert.match(text, /from "@chojs\/command";$/m);
    assert.match(text, /^@Controller\(\)$/m);
    assert.match(text, /^ {2}@Action\("report"\)$/m);
    assert.ok("apps/tool/report_test.ts" in files);
  });

  it("writes a service: a class with @Injectable, and its test", () => {
    for (const [project, cho] of [[web, "web"], [tool, "command"]] as const) {
      const files = plan({ part: "service", name: "userStore" }, project);
      assert.deepEqual(Object.keys(files), [
        "apps/api/user-store.ts",
        "apps/api/user-store_test.ts",
      ]);
      const text = files["apps/api/user-store.ts"]!;
      assert.ok(text.startsWith(`import { Injectable } from "@chojs/${cho}";`));
      assert.match(text, /^@Injectable\(\)\nexport class UserStore \{$/m);
      assert.match(
        files["apps/api/user-store_test.ts"]!,
        /^import \{ UserStore \} from "\.\/user-store\.ts";$/m,
      );
    }
  });

  it("writes a module: a class with @Module, and no test", () => {
    const files = plan({ part: "module", name: "Orders" });
    assert.deepEqual(Object.keys(files), ["apps/api/orders.ts"]);
    assert.match(
      files["apps/api/orders.ts"]!,
      /^@Module\(\{\}\)\nexport class Orders \{\}$/m,
    );
  });

  it("puts the files in the folder of the answers", () => {
    const files = plan({ part: "service", folder: "apps/api/users/store" });
    assert.deepEqual(Object.keys(files), [
      "apps/api/users/store/users.ts",
      "apps/api/users/store/users_test.ts",
    ]);
  });

  it("writes a controller of a message application: a topic, and its test", () => {
    const files = plan({ name: "orderEvents", folder: "apps/worker" }, worker);
    assert.deepEqual(Object.keys(files), [
      "apps/worker/order-events.ts",
      "apps/worker/order-events_test.ts",
    ]);
    const text = files["apps/worker/order-events.ts"]!;
    assert.match(
      text,
      /^import \{ Controller, Subscribe \} from "@chojs\/message";$/m,
    );
    // the name of the file is the topic of the controller
    assert.match(text, /^@Controller\(\{ topic: "order-events" \}\)$/m);
    assert.match(text, /^export class OrderEvents \{$/m);
    assert.match(text, /^ {2}@Subscribe\("hello"\)$/m);
  });

  it("takes the service and the module of a message application from its package", () => {
    for (const part of ["service", "module"] as const) {
      const files = plan({ part, folder: "apps/worker" }, worker);
      assert.match(
        files["apps/worker/users.ts"]!,
        /^import \{ \w+ \} from "@chojs\/message";$/m,
      );
    }
  });

  for (const kind of KINDS) {
    for (const part of PARTS) {
      it(`${part} of ${kind}: the template, with its two names, and no marker left`, () => {
        const project = PROJECTS[kind];
        const files = plan({ part, name: "userProfile" }, project);
        const template = PART_TEMPLATES[kind][part];
        assert.equal(Object.keys(files).length, Object.keys(template).length);
        for (const [name, text] of Object.entries(template)) {
          const path = `apps/api/${name.replace("__name__", "user-profile")}`;
          assert.equal(
            files[path],
            text.replaceAll("__Name__", "UserProfile")
              .replaceAll("__name__", "user-profile"),
          );
        }
        for (const [path, text] of Object.entries(files)) {
          assert.doesNotMatch(`${path}${text}`, /__name__|__Name__/i, path);
          assert.equal(text.endsWith("\n"), true, path);
        }
      });
    }
  }
});

describe("explanation", () => {
  it("says where a controller goes, and how its test runs", () => {
    assert.equal(
      explanation(generation(), web, "deno"),
      "Nothing uses it yet. Add it to a module, as the one of " +
        "apps/api/app.ts:\n\n" +
        '  import { Users } from "./users.ts";\n\n' +
        "  @Module({ controllers: [Users] })\n\n" +
        "Its test runs with the tests of the project, in apps/api:\n\n" +
        "  deno test --allow-env",
    );
  });

  it("says where a service goes, and how a class asks for it", () => {
    const text = explanation(
      generation({ part: "service", name: "userStore" }),
      web,
      "bun",
    );
    assert.ok(text.includes('  import { UserStore } from "./user-store.ts";'));
    assert.ok(text.includes("  @Module({ providers: [UserStore] })"));
    assert.ok(text.includes("  @Controller({ dependencies: [UserStore] })"));
    assert.ok(text.endsWith("\n\n  bun test"));
  });

  it("says where a module goes, and names no test: it has none", () => {
    const text = explanation(generation({ part: "module" }), web, "node");
    assert.ok(text.endsWith("  @Module({ imports: [Users] })"));
    assert.doesNotMatch(text, /test/);
  });

  it("imports the file from the module of the project, wherever it is", () => {
    const from = (folder: string, project = web) =>
      explanation(generation({ folder }), project, "deno")
        .match(/from "([^"]*)"/)![1];
    assert.equal(from("apps/api"), "./users.ts");
    assert.equal(from("apps/api/users/http"), "./users/http/users.ts");
    // the module cho.json names, in a folder of its own
    const nested = { ...web, module: "src/app.ts" };
    assert.equal(from("apps/api/src/users", nested), "./users/users.ts");
    assert.equal(from("apps/api/users", nested), "../users/users.ts");
    assert.ok(
      explanation(generation(), nested, "deno")
        .startsWith(
          "Nothing uses it yet. Add it to a module, as the one of " +
            "apps/api/src/app.ts:",
        ),
    );
  });
});
