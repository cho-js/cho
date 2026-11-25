/**
 * Tests for `cho.json`: the settings of a new workspace, the check of what
 * was read, and the schema.
 *
 * The check and the schema are two readers of one definition: the last group
 * checks that the schema has the fields, the values and the rules of the
 * check.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isChoError } from "@chojs/command";
import {
  check_config,
  config_schema,
  CONFIG_VERSION,
  DEFAULTS,
  KINDS,
  make_config,
  make_project,
  RUNTIMES,
  SCHEMA_URL,
  TYPES,
} from "./config.ts";
import { NAME_PATTERN } from "./names.ts";

/** Settings that are right, with every field. */
const whole = () => ({
  $schema: SCHEMA_URL,
  version: 1,
  runtime: "deno",
  appsDir: "apps",
  libsDir: "libs",
  projects: {
    api: {
      type: "application",
      kind: "web",
      root: "apps/api",
      entry: "main.ts",
      module: "app.ts",
    },
    // an application, with the required fields alone
    tool: { kind: "cli", root: "tools/tool" },
    shared: { type: "library", root: "libs/shared", entry: "mod.ts" },
  },
});

/** The message of the error `check_config` throws. */
function mistake_of(value: unknown): string {
  try {
    check_config(value);
  } catch (error) {
    assert.equal(isChoError(error, "CHO_CLI_INVALID_CONFIG"), true);
    return (error as Error).message;
  }
  return "";
}

describe("make_config", () => {
  it("writes every field of a new workspace, the ones with a default too", () => {
    const config = make_config({
      runtime: "bun",
      appsDir: "services",
      project: "shop",
      kind: "cli",
    });
    assert.deepEqual(config, {
      $schema: "https://chojs.io/schema/cho.v1.json",
      version: 1,
      runtime: "bun",
      appsDir: "services",
      libsDir: "libs",
      projects: {
        shop: {
          type: "application",
          kind: "cli",
          root: "services/shop",
          entry: "main.ts",
          module: "app.ts",
        },
      },
    });
    assert.equal(check_config(config), config);
  });
});

describe("make_project", () => {
  it("writes every field of an application", () => {
    assert.deepEqual(
      make_project({ type: "application", kind: "web" }, "apps/api"),
      {
        type: "application",
        kind: "web",
        root: "apps/api",
        entry: "main.ts",
        module: "app.ts",
      },
    );
  });

  it("writes a library with no kind and no module", () => {
    assert.deepEqual(make_project({ type: "library" }, "libs/shared"), {
      type: "library",
      root: "libs/shared",
      entry: "mod.ts",
    });
  });
});

describe("check_config", () => {
  it("gives the settings it was given, when they are right", () => {
    const config = whole();
    assert.equal(check_config(config), config);
    // the required fields alone
    assert.doesNotThrow(() =>
      check_config({ version: 1, runtime: "node", projects: {} })
    );
  });

  it("takes a file that cho 3.7 wrote: no type, and no libsDir", () => {
    assert.doesNotThrow(() =>
      check_config({
        $schema: SCHEMA_URL,
        version: 1,
        runtime: "deno",
        appsDir: "apps",
        projects: {
          api: {
            kind: "web",
            root: "apps/api",
            entry: "main.ts",
            module: "app.ts",
          },
        },
      })
    );
  });

  it("refuses what is not an object: CHO_CLI_INVALID_CONFIG", () => {
    for (const value of [null, undefined, "text", 1, [], [whole()]]) {
      assert.equal(mistake_of(value), "cho.json: must be an object");
    }
  });

  it("refuses a field it does not know, at any depth, and names it", () => {
    assert.equal(
      mistake_of({ ...whole(), runtimee: "deno" }),
      "cho.json: runtimee: unknown field. Known fields: $schema, version, " +
        "runtime, appsDir, libsDir, projects",
    );
    const config = whole();
    Object.assign(config.projects.api, { port: 3000 });
    assert.equal(
      mistake_of(config),
      "cho.json: projects.api.port: unknown field. Known fields: type, " +
        "kind, root, entry, module",
    );
  });

  it("refuses a type that is not one of the two", () => {
    for (const type of ["app", 1, null]) {
      const config = whole();
      Object.assign(config.projects.api, { type });
      assert.equal(
        mistake_of(config),
        'cho.json: projects.api.type: must be "application" or "library"',
      );
    }
  });

  it("refuses a kind and a module on a library: it has none", () => {
    for (const field of ["kind", "module"]) {
      const config = whole();
      Object.assign(config.projects.shared, { [field]: "web" });
      assert.equal(
        mistake_of(config),
        `cho.json: projects.shared.${field}: unknown field. Known fields: ` +
          "type, root, entry",
      );
    }
    // its folder is required, and its paths are checked as any
    const config = whole();
    Object.assign(config.projects.shared, { root: "../shared" });
    assert.match(
      mistake_of(config),
      /^cho\.json: projects\.shared\.root: must be a relative path .* "libs\/shared"$/,
    );
    Object.assign(config.projects.shared, { root: "libs/shared", entry: "/m" });
    assert.match(mistake_of(config), /^cho\.json: projects\.shared\.entry: /);
  });

  it("refuses a version it does not know, and says who wrote it", () => {
    assert.equal(
      mistake_of({ ...whole(), version: 2 }),
      "cho.json: version: 2 is not a version this cho knows (it knows 1): " +
        "the file was written by another version of cho",
    );
    assert.equal(
      mistake_of({ ...whole(), version: "1" }),
      "cho.json: version: must be 1",
    );
    const { version: _, ...rest } = whole();
    assert.equal(mistake_of(rest), "cho.json: version: must be 1");
  });

  it("refuses a runtime that is not one of the three", () => {
    for (const runtime of ["pnpm", "Deno", undefined, 1]) {
      assert.equal(
        mistake_of({ ...whole(), runtime }),
        'cho.json: runtime: must be "deno", "node" or "bun"',
      );
    }
  });

  it("refuses a folder of the projects that is not a name", () => {
    for (const field of ["appsDir", "libsDir"]) {
      assert.equal(
        mistake_of({ ...whole(), [field]: "my apps" }),
        `cho.json: ${field}: not a name of a folder. Lower case letters, ` +
          "digits and -, starting with a letter",
      );
      assert.equal(
        mistake_of({ ...whole(), [field]: 1 }),
        `cho.json: ${field}: not a name of a folder. It must be a text`,
      );
    }
  });

  it("refuses a $schema that is not a text", () => {
    assert.equal(
      mistake_of({ ...whole(), $schema: 1 }),
      "cho.json: $schema: must be a text",
    );
  });

  it("refuses projects that are missing, or not an object", () => {
    const { projects: _, ...rest } = whole();
    for (const config of [rest, { ...rest, projects: [] }]) {
      assert.equal(mistake_of(config), "cho.json: projects: must be an object");
    }
    assert.equal(
      mistake_of({ ...rest, projects: { api: "apps/api" } }),
      "cho.json: projects.api: must be an object",
    );
  });

  it("refuses a name of a project that is not a name", () => {
    const { projects: _, ...rest } = whole();
    assert.equal(
      mistake_of({ ...rest, projects: { Api: { kind: "web", root: "a" } } }),
      "cho.json: projects.Api: not a name of a project. Lower case " +
        "letters, digits and -, starting with a letter",
    );
    assert.equal(
      mistake_of({ ...rest, projects: { nul: { kind: "web", root: "a" } } }),
      "cho.json: projects.nul: not a name of a project. Windows keeps the " +
        'name "nul" for a device',
    );
  });

  it("refuses a kind that is not one of the two", () => {
    for (const kind of ["message", undefined]) {
      const config = whole();
      Object.assign(config.projects.api, { kind });
      assert.equal(
        mistake_of(config),
        'cho.json: projects.api.kind: must be "web" or "cli"',
      );
    }
  });

  it("refuses a path that leaves the workspace, or is not relative", () => {
    const paths = [
      undefined, // root is required
      1,
      "",
      "/apps/api",
      "../api",
      "apps/../../api",
      "./apps/api",
      "apps//api",
      "apps/api/",
      "apps\\api",
      "C:/apps/api",
    ];
    for (const root of paths) {
      const config = whole();
      Object.assign(config.projects.api, { root });
      assert.equal(
        mistake_of(config),
        "cho.json: projects.api.root: must be a relative path that stays " +
          'in the workspace, such as "apps/api"',
        String(root),
      );
    }
    for (const field of ["entry", "module"]) {
      const config = whole();
      Object.assign(config.projects.api, { [field]: "../main.ts" });
      assert.match(
        mistake_of(config),
        new RegExp(`^cho.json: projects.api.${field}: must be a relative path`),
      );
    }
  });
});

// The schema
// -----------------------------------------------------------------------------

describe("the schema of cho.json", () => {
  type Schema = {
    $schema: string;
    $id: string;
    required: string[];
    additionalProperties: boolean;
    properties: Record<string, Record<string, unknown>>;
    definitions: { application: Schema; library: Schema };
  };
  const schema = config_schema() as Schema;
  const { application, library } = schema.definitions;

  it("is a draft-07 schema, at the address a file names", () => {
    assert.equal(schema.$schema, "http://json-schema.org/draft-07/schema#");
    assert.equal(schema.$id, "https://chojs.io/schema/cho.v1.json");
    assert.equal(whole().$schema, schema.$id);
  });

  it("has the fields check_config knows, and no other", () => {
    assert.deepEqual(Object.keys(schema.properties), [
      "$schema",
      "version",
      "runtime",
      "appsDir",
      "libsDir",
      "projects",
    ]);
    assert.deepEqual(Object.keys(application.properties), [
      "type",
      "kind",
      "root",
      "entry",
      "module",
    ]);
    assert.deepEqual(Object.keys(library.properties), [
      "type",
      "root",
      "entry",
    ]);
    // a field that is not known is a mistake, as in check_config
    assert.equal(schema.additionalProperties, false);
    assert.equal(application.additionalProperties, false);
    assert.equal(library.additionalProperties, false);
  });

  it("requires what check_config requires", () => {
    assert.deepEqual(schema.required, ["version", "runtime", "projects"]);
    assert.deepEqual(application.required, ["kind", "root"]);
    // a library says its type: a project with none is an application
    assert.deepEqual(library.required, ["type", "root"]);
  });

  it("makes a project one of the two: an application, or a library", () => {
    assert.deepEqual(schema.properties.projects?.additionalProperties, {
      oneOf: [
        { $ref: "#/definitions/application" },
        { $ref: "#/definitions/library" },
      ],
    });
    assert.deepEqual(
      [application.properties.type?.const, library.properties.type?.const],
      [...TYPES],
    );
  });

  it("takes its values from the constants of the tool", () => {
    assert.equal(schema.properties.version?.const, CONFIG_VERSION);
    assert.deepEqual(schema.properties.runtime?.enum, [...RUNTIMES]);
    assert.deepEqual(application.properties.kind?.enum, [...KINDS]);
    // the rule of a name: the folders of the projects, and their names
    assert.equal(schema.properties.appsDir?.pattern, NAME_PATTERN);
    assert.equal(schema.properties.libsDir?.pattern, NAME_PATTERN);
    assert.deepEqual(schema.properties.projects?.propertyNames, {
      pattern: NAME_PATTERN,
    });
    assert.equal(schema.properties.appsDir?.default, DEFAULTS.appsDir);
    assert.equal(schema.properties.libsDir?.default, DEFAULTS.libsDir);
    assert.equal(application.properties.type?.default, DEFAULTS.type);
    assert.equal(application.properties.entry?.default, DEFAULTS.entry);
    assert.equal(application.properties.module?.default, DEFAULTS.module);
    assert.equal(library.properties.entry?.default, DEFAULTS.libraryEntry);
  });

  it("describes every property, for an editor", () => {
    const properties = [
      ...Object.entries(schema.properties),
      ...Object.entries(application.properties),
      ...Object.entries(library.properties),
    ];
    for (const [name, property] of properties) {
      assert.equal(typeof property.description, "string", name);
    }
  });
});
