/**
 * Tests for `schemas.ts`: a validator gives its schema, or the application
 * does, or there is none; and a schema is made one that can be written
 * anywhere in a document.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { debuglog } from "./debuglog.ts";
import { Schemas, type ToJsonSchema } from "./schemas.ts";
import {
  capture,
  json_schema_only,
  json_schema_validator,
  loose,
  parse_validator,
  with_env,
} from "./test_utils.ts";

/** The schemas of a document, with a logger that is off. */
function schemas(to_json_schema?: ToJsonSchema) {
  return new Schemas("draft-2020-12", to_json_schema, debuglog("cho:test"));
}

describe("Schemas.of, where a schema comes from", () => {
  it("asks a validator that implements Standard JSON Schema, for the direction", () => {
    const calls: string[] = [];
    const validator = json_schema_validator({ type: "string" }, {
      type: "number",
    }, calls);
    const all = schemas();
    assert.deepEqual(all.of(validator, "input", "x"), { type: "string" });
    assert.deepEqual(all.of(validator, "output", "x"), { type: "number" });
    assert.deepEqual(calls, ["input draft-2020-12", "output draft-2020-12"]);
  });

  it("asks for the dialect of the document", () => {
    const calls: string[] = [];
    const validator = json_schema_validator(
      { type: "string" },
      undefined,
      calls,
    );
    const all = new Schemas("draft-07", undefined, debuglog("cho:test"));
    assert.deepEqual(all.of(validator, "input", "x"), { type: "string" });
    assert.deepEqual(calls, ["input draft-07"]);
  });

  it("asks a Standard Schema that has no parse method", () => {
    const validator = json_schema_only({ type: "string" });
    const all = schemas();
    assert.deepEqual(all.of(validator, "input", "x"), { type: "string" });
    assert.deepEqual(all.of(validator, "output", "x"), { type: "string" });
  });

  it("asks the application for a validator that gives none", () => {
    const validator = parse_validator();
    const seen: unknown[] = [];
    const all = schemas((given, io) => {
      seen.push([given === validator, io]);
      return { type: io === "input" ? "string" : "number" };
    });
    assert.deepEqual(all.of(validator, "input", "x"), { type: "string" });
    assert.deepEqual(all.of(validator, "output", "x"), { type: "number" });
    assert.deepEqual(seen, [[true, "input"], [true, "output"]]);
  });

  it("asks the validator first, then the application", () => {
    const all = schemas(() => ({ type: "number" }));
    assert.deepEqual(
      all.of(json_schema_validator({ type: "string" }), "input", "x"),
      {
        type: "string",
      },
    );
  });

  it("gives nothing for a validator nobody knows", () => {
    assert.equal(schemas().of(parse_validator(), "input", "x"), undefined);
    assert.equal(
      schemas(() => undefined).of(parse_validator(), "input", "x"),
      undefined,
    );
    // what is not a schema is not one
    for (const not_a_schema of ["string", null, 7, []]) {
      assert.equal(
        schemas(() => loose(not_a_schema)).of(parse_validator(), "input", "x"),
        undefined,
      );
    }
  });

  it("goes on when a conversion throws", () => {
    const failing = loose({
      parse: (v: unknown) => v,
      "~standard": {
        jsonSchema: {
          input: () => {
            throw new Error("not supported");
          },
        },
      },
    });
    // the application is asked next
    assert.deepEqual(
      schemas(() => ({ type: "string" })).of(failing, "input", "x"),
      { type: "string" },
    );
    // and when it throws too, there is no schema
    assert.equal(
      schemas(() => {
        throw new Error("no");
      }).of(failing, "input", "x"),
      undefined,
    );
    // a validator with a converter for one direction only
    assert.equal(schemas().of(failing, "output", "x"), undefined);
  });

  it("converts a validator once for each direction", () => {
    const calls: string[] = [];
    const validator = json_schema_validator({ type: "string" }, {
      type: "string",
    }, calls);
    const all = schemas();
    all.of(validator, "input", "a");
    all.of(validator, "input", "b");
    all.of(validator, "output", "c");
    all.of(validator, "output", "d");
    assert.equal(calls.length, 2);
    // also one that has no schema
    let asked = 0;
    const none = schemas(() => void asked++);
    const unknown = parse_validator();
    none.of(unknown, "input", "a");
    none.of(unknown, "input", "b");
    assert.equal(asked, 1);
  });

  it("gives each use a copy, and leaves the schema of the application as it is", () => {
    const given = { $schema: "x", type: "object", properties: { a: {} } };
    const validator = json_schema_validator(given);
    const all = schemas();
    const first = all.of(validator, "input", "x")!;
    const second = all.of(validator, "input", "x")!;
    assert.notEqual(first, second);
    assert.notEqual(first.properties, second.properties);
    (first.properties as Record<string, unknown>).b = {};
    assert.deepEqual(second, { type: "object", properties: { a: {} } });
    assert.equal(given.$schema, "x");
  });

  it("logs a validator with no schema, and a conversion that failed", async () => {
    const { output } = await capture(() => {
      with_env({ CHO_DEBUG: undefined, CHO_DEBUGLOG: "cho:test" }, () => {
        const all = new Schemas("draft-2020-12", () => {
          throw new Error("boom");
        }, debuglog("cho:test"));
        all.of(parse_validator(), "input", "Users.get, query page");
      });
      return Promise.resolve();
    });
    const logs = output.error.map(String).join(" ");
    assert.match(
      logs,
      /ERROR Users\.get, query page: toJsonSchema could not give a schema: Error: boom/,
    );
    assert.match(
      logs,
      /Users\.get, query page: no schema for the validator: it is documented as any/,
    );
  });
});

describe("Schemas.of, a schema for a document", () => {
  it("removes $schema", () => {
    const schema = schemas().of(
      json_schema_validator({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        type: "string",
      }),
      "input",
      "x",
    );
    assert.deepEqual(schema, { type: "string" });
  });

  it("moves the definitions to the components, and rewrites the references", () => {
    const all = schemas();
    const schema = all.of(
      json_schema_validator({
        type: "object",
        properties: {
          owner: { $ref: "#/$defs/User" },
          members: { type: "array", items: { $ref: "#/$defs/User" } },
        },
        $defs: {
          User: {
            type: "object",
            properties: { team: { $ref: "#/$defs/Team" } },
          },
          Team: { type: "object", properties: { name: { type: "string" } } },
        },
      }),
      "input",
      "x",
    );
    assert.deepEqual(schema, {
      type: "object",
      properties: {
        owner: { $ref: "#/components/schemas/User" },
        members: {
          type: "array",
          items: { $ref: "#/components/schemas/User" },
        },
      },
    });
    assert.deepEqual(all.components, {
      User: {
        type: "object",
        properties: { team: { $ref: "#/components/schemas/Team" } },
      },
      Team: { type: "object", properties: { name: { type: "string" } } },
    });
  });

  it("reads the definitions of an older draft too", () => {
    const all = schemas();
    const schema = all.of(
      json_schema_validator({
        $ref: "#/definitions/User",
        definitions: { User: { type: "object" } },
      }),
      "input",
      "x",
    );
    assert.deepEqual(schema, { $ref: "#/components/schemas/User" });
    assert.deepEqual(all.components, { User: { type: "object" } });
  });

  it("keeps one component for one schema, and two for two with one name", () => {
    const all = schemas();
    const with_user = (user: Record<string, unknown>) =>
      json_schema_validator({ $ref: "#/$defs/User", $defs: { User: user } });
    const same = { type: "object", properties: { id: { type: "string" } } };

    assert.deepEqual(all.of(with_user(same), "input", "a"), {
      $ref: "#/components/schemas/User",
    });
    assert.deepEqual(all.of(with_user({ ...same }), "input", "b"), {
      $ref: "#/components/schemas/User",
    });
    assert.deepEqual(all.of(with_user({ type: "string" }), "input", "c"), {
      $ref: "#/components/schemas/User2",
    });
    assert.deepEqual(all.of(with_user({ type: "number" }), "input", "d"), {
      $ref: "#/components/schemas/User3",
    });
    assert.deepEqual(Object.keys(all.components), ["User", "User2", "User3"]);
    assert.deepEqual(all.components.User2, { type: "string" });
  });

  it("gives a component a name OpenAPI accepts", () => {
    const all = schemas();
    const schema = all.of(
      json_schema_validator({
        $ref: "#/$defs/a~1b%20c",
        $defs: { "a/b c": { type: "string" } },
      }),
      "input",
      "x",
    );
    assert.deepEqual(schema, { $ref: "#/components/schemas/a_b_c" });
    assert.deepEqual(all.components, { a_b_c: { type: "string" } });
  });

  it("makes a component of a schema that refers to itself", () => {
    const all = schemas();
    const schema = all.of(
      json_schema_validator({
        type: "object",
        properties: { children: { type: "array", items: { $ref: "#" } } },
      }),
      "input",
      "x",
    );
    assert.deepEqual(schema, { $ref: "#/components/schemas/Schema" });
    assert.deepEqual(all.components, {
      Schema: {
        type: "object",
        properties: {
          children: {
            type: "array",
            items: { $ref: "#/components/schemas/Schema" },
          },
        },
      },
    });
  });

  it("leaves other references as they are", () => {
    const schema = schemas().of(
      json_schema_validator({ $ref: "https://example.com/user.json" }),
      "input",
      "x",
    );
    assert.deepEqual(schema, { $ref: "https://example.com/user.json" });
  });
});

describe("Schemas.resolve", () => {
  it("follows a reference to a component", () => {
    const all = schemas();
    const schema = all.of(
      json_schema_validator({
        $ref: "#/$defs/Page",
        $defs: { Page: { type: "object" } },
      }),
      "input",
      "x",
    )!;
    assert.deepEqual(all.resolve(schema), { type: "object" });
    assert.deepEqual(all.resolve({ type: "string" }), { type: "string" });
    const unknown = { $ref: "#/components/schemas/Nope" };
    assert.equal(all.resolve(unknown), unknown);
  });
});
