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
import { PARTS } from "../generate/parts.ts";
import { PART_TEMPLATES } from "../generate/templates.gen.ts";
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

  it("generate/templates.gen.ts holds every file of every part, as it is", async () => {
    const folder = "../generate/templates";
    const files: Record<string, Record<string, Record<string, string>>> = {};
    for (const kind of await readdir(path(folder))) {
      files[kind] = {};
      for (const part of await readdir(path(`${folder}/${kind}`))) {
        const texts: Record<string, string> = {};
        for (const name of await readdir(path(`${folder}/${kind}/${part}`))) {
          texts[name] = await readFile(
            path(`${folder}/${kind}/${part}/${name}`),
            "utf8",
          );
        }
        files[kind]![part] = texts;
      }
    }
    assert.deepEqual(PART_TEMPLATES, files);
  });

  it("has every part for each kind: a class, and a test but for a module", () => {
    assert.deepEqual(Object.keys(PART_TEMPLATES).sort(), [...KINDS].sort());
    for (const kind of KINDS) {
      assert.deepEqual(
        Object.keys(PART_TEMPLATES[kind]).sort(),
        [...PARTS].sort(),
      );
      for (const part of PARTS) {
        const names = Object.keys(PART_TEMPLATES[kind][part]).sort();
        assert.deepEqual(
          names,
          part === "module"
            ? ["__name__.ts"]
            : ["__name__.ts", "__name___test.ts"],
          `${kind} ${part}`,
        );
        // the class has the marker of its name, and the decorator of the part
        const text = PART_TEMPLATES[kind][part]["__name__.ts"]!;
        assert.match(text, /^export class __Name__ /m);
        const decorator = {
          controller: "Controller",
          service: "Injectable",
          module: "Module",
        }[part];
        assert.match(text, new RegExp(`^@${decorator}\\(`, "m"));
      }
    }
  });

  it("cho.schema.json is the schema of config_schema()", async () => {
    const file = JSON.parse(await readFile(path("cho.schema.json"), "utf8"));
    assert.deepEqual(file, config_schema());
  });
});
