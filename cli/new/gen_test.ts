/**
 * Tests for the files that are made from others: `templates.gen.ts`, from
 * `templates/`, and `cho.schema.json`, from `config_schema()`.
 *
 * Both are kept in git. These tests fail when one is not what `gen.ts` would
 * write: `deno task --cwd cli gen` writes them again.
 */

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { config_schema, KINDS } from "./config.ts";
import { TEMPLATES } from "./templates.gen.ts";

const path = (name: string) => fileURLToPath(new URL(name, import.meta.url));

describe("the generated files", () => {
  it("templates.gen.ts holds every file of every template, as it is", async () => {
    const files: Record<string, Record<string, string>> = {};
    for (const kind of await readdir(path("templates"))) {
      files[kind] = {};
      for (const name of await readdir(path(`templates/${kind}`))) {
        files[kind][name] = await readFile(
          path(`templates/${kind}/${name}`),
          "utf8",
        );
      }
    }
    assert.deepEqual(TEMPLATES, files);
  });

  it("has a template for each kind, with the three files of a project", () => {
    assert.deepEqual(Object.keys(TEMPLATES).sort(), [...KINDS].sort());
    for (const kind of KINDS) {
      assert.deepEqual(Object.keys(TEMPLATES[kind]).sort(), [
        "app.ts",
        "app_test.ts",
        "main.ts",
      ]);
      // what cho.json says of a project: `module` exports AppModule
      assert.match(TEMPLATES[kind]["app.ts"]!, /export class AppModule /);
    }
  });

  it("cho.schema.json is the schema of config_schema()", async () => {
    const file = JSON.parse(await readFile(path("cho.schema.json"), "utf8"));
    assert.deepEqual(file, config_schema());
  });
});
