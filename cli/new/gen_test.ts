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
import { config_schema, KINDS, TEMPLATE_NAMES } from "./config.ts";
import { TEMPLATES } from "./templates.gen.ts";

const path = (name: string) => fileURLToPath(new URL(name, import.meta.url));

describe("the generated files", () => {
  it("templates.gen.ts holds every file of every template, as it is", async () => {
    const files: Record<string, Record<string, string>> = {};
    for (const template of await readdir(path("templates"))) {
      const texts: Record<string, string> = {};
      for (const name of await readdir(path(`templates/${template}`))) {
        texts[name] = await readFile(
          path(`templates/${template}/${name}`),
          "utf8",
        );
      }
      files[template] = texts;
    }
    assert.deepEqual(TEMPLATES, files);
  });

  it("has a template for each kind, with the three files of an application", () => {
    assert.deepEqual(
      Object.keys(TEMPLATES).sort(),
      [...TEMPLATE_NAMES].sort(),
    );
    for (const kind of KINDS) {
      assert.deepEqual(Object.keys(TEMPLATES[kind]).sort(), [
        "app.ts",
        "app_test.ts",
        "main.ts",
      ]);
      // what cho.json says of an application: `module` exports AppModule
      assert.match(TEMPLATES[kind]["app.ts"]!, /export class AppModule /);
    }
  });

  it("has a template for a library: what it exports, and its test", () => {
    assert.deepEqual(Object.keys(TEMPLATES.library).sort(), [
      "mod.ts",
      "mod_test.ts",
    ]);
    // plain TypeScript: no package of CHO
    for (const text of Object.values(TEMPLATES.library)) {
      assert.doesNotMatch(text, /@chojs\//);
    }
  });

  it("cho.schema.json is the schema of config_schema()", async () => {
    const file = JSON.parse(await readFile(path("cho.schema.json"), "utf8"));
    assert.deepEqual(file, config_schema());
  });
});
