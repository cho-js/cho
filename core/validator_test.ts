/**
 * Tests for `validator.ts`: what a validator is, how one is run, and what
 * its issues become.
 *
 * The validators are written by hand, in the two shapes CHO accepts: a
 * Standard Schema, and an object with a `parse` method.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { standard_schema } from "./utils/test_utils.ts";
import {
  type ChoInput,
  type ChoOutput,
  type ChoParseValidator,
  type ChoValidator,
  error_issues,
  is_validator,
  run_validator,
  type StandardSchemaV1,
  to_issues,
} from "./validator.ts";

/** A number above zero, as a Standard Schema. */
const positive = standard_schema<number>((value) => {
  const n = Number(value);
  return n > 0
    ? { value: n }
    : { issues: [{ message: "expected a positive number" }] };
});

/** A number above zero, as an object with a `parse` method. */
const parsed: ChoValidator<number> = {
  parse(value) {
    const n = Number(value);
    if (!(n > 0)) {
      throw new Error("expected a positive number");
    }
    return n;
  },
};

/** Whether two types are the same. */
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends
  (<T>() => T extends B ? 1 : 2) ? true : false;

/** Compiles only for `true`. */
const same = <T extends true>(): T | undefined => undefined;

describe("is_validator", () => {
  it("takes a Standard Schema, and an object with a parse method", () => {
    assert.equal(is_validator(positive), true);
    assert.equal(is_validator(parsed), true);
  });

  it("takes a function, and an instance of a class", () => {
    // a schema of ArkType is a function
    const callable = Object.assign(() => {}, {
      "~standard": positive["~standard"],
    });
    assert.equal(is_validator(callable), true);
    class Schema {
      parse(value: unknown) {
        return value;
      }
    }
    assert.equal(is_validator(new Schema()), true);
  });

  it("takes a parse method next to a ~standard that only documents", () => {
    const documented = {
      parse: (value: unknown) => value,
      "~standard": { version: 1, vendor: "test", jsonSchema: {} },
    };
    assert.equal(is_validator(documented), true);
  });

  it("refuses everything else", () => {
    for (
      const value of [
        undefined,
        null,
        1,
        "parse",
        true,
        {},
        [],
        () => {},
        { parse: true },
        { "~standard": {} },
        { "~standard": null },
        { "~standard": { version: 1, vendor: "test" } },
        { "~standard": { validate: "no" } },
        { validate: () => ({ value: 1 }) },
      ]
    ) {
      assert.equal(is_validator(value), false, String(value));
    }
  });
});

describe("run_validator", () => {
  it("gives the value a Standard Schema gives", async () => {
    assert.deepEqual(await run_validator(positive, "7"), { value: 7 });
  });

  it("gives the issues of a Standard Schema, and no error", async () => {
    assert.deepEqual(await run_validator(positive, "x"), {
      issues: [{ message: "expected a positive number" }],
    });
  });

  it("awaits a Standard Schema that gives a promise", async () => {
    const later = standard_schema<string>(async (value) => {
      await Promise.resolve();
      return value === "ok"
        ? { value: "checked" }
        : { issues: [{ message: "not ok", path: ["v"] }] };
    });
    assert.deepEqual(await run_validator(later, "ok"), { value: "checked" });
    assert.deepEqual(await run_validator(later, "no"), {
      issues: [{ message: "not ok", path: ["v"] }],
    });
  });

  it("throws on what a Standard Schema throws, unchanged", async () => {
    const down = new Error("the database is down");
    const sync = standard_schema(() => {
      throw down;
    });
    const later = standard_schema(() => Promise.reject(down));
    await assert.rejects(run_validator(sync, 1), (error) => error === down);
    await assert.rejects(run_validator(later, 1), (error) => error === down);
  });

  it("gives a value that is falsy, and undefined", async () => {
    const zero = standard_schema(() => ({ value: 0 }));
    const nothing = standard_schema(() => ({ value: undefined }));
    assert.deepEqual(await run_validator(zero, "x"), { value: 0 });
    assert.deepEqual(await run_validator(nothing, "x"), { value: undefined });
  });

  it("gives one issue for a result with an empty list of issues", async () => {
    const empty = standard_schema(() => ({ issues: [] }));
    assert.deepEqual(await run_validator(empty, 1), {
      issues: [{ message: "Invalid value" }],
    });
  });

  it("calls validate as a method of the ~standard object", async () => {
    const schema = {
      "~standard": {
        version: 1 as const,
        vendor: "test",
        factor: 2,
        validate(this: { factor: number }, value: unknown) {
          return { value: Number(value) * this.factor };
        },
      },
    };
    assert.deepEqual(await run_validator(schema, 4), { value: 8 });
  });

  it("gives what a parse method returns, awaited", async () => {
    assert.deepEqual(await run_validator(parsed, "7"), { value: 7 });
    const later: ChoValidator<string> = {
      parse: (value) => Promise.resolve(`<${value}>`),
    };
    assert.deepEqual(await run_validator(later, "a"), { value: "<a>" });
  });

  it("gives what a parse method throws as issues, with the error", async () => {
    const result = await run_validator(parsed, "x");
    assert.deepEqual(result.issues, [{
      message: "expected a positive number",
    }]);
    assert.ok("error" in result && result.error instanceof Error);

    const rejects: ChoValidator = { parse: () => Promise.reject("no") };
    assert.deepEqual(await run_validator(rejects, 1), {
      issues: [{ message: "no" }],
      error: "no",
    });
    // what was thrown is kept, whatever it is
    const nothing: ChoValidator = {
      parse: () => {
        throw undefined;
      },
    };
    const thrown = await run_validator(nothing, 1);
    assert.equal("error" in thrown, true);
    assert.deepEqual(thrown.issues, [{ message: "undefined" }]);
  });

  it("calls parse as a method of the validator", async () => {
    class Above {
      constructor(readonly min: number) {}
      parse(value: unknown) {
        if (!(Number(value) > this.min)) {
          throw new Error(`expected more than ${this.min}`);
        }
        return Number(value);
      }
    }
    assert.deepEqual(await run_validator(new Above(5), 6), { value: 6 });
    assert.deepEqual((await run_validator(new Above(5), 5)).issues, [{
      message: "expected more than 5",
    }]);
  });

  it("runs an object with both shapes as a Standard Schema", async () => {
    let parses = 0;
    const both = {
      ...standard_schema((value) =>
        value === "ok"
          ? { value: "standard" }
          : { issues: [{ message: "from standard" }] }
      ),
      parse() {
        parses++;
        throw new Error("from parse");
      },
    };
    assert.deepEqual(await run_validator(both, "ok"), { value: "standard" });
    assert.deepEqual(await run_validator(both, "no"), {
      issues: [{ message: "from standard" }],
    });
    assert.equal(parses, 0);
  });

  it("runs parse when ~standard has no validate function", async () => {
    const documented = {
      parse: (value: unknown) => `parsed ${value}`,
      "~standard": { version: 1, vendor: "test", jsonSchema: {} },
    };
    assert.deepEqual(await run_validator(documented, "a"), {
      value: "parsed a",
    });
  });
});

describe("to_issues", () => {
  it("keeps the message and the path, and nothing else", () => {
    assert.deepEqual(
      to_issues([{
        code: "invalid_type",
        expected: "string",
        input: 1,
        message: "Expected a string",
        path: ["user", "name"],
      }]),
      [{ message: "Expected a string", path: ["user", "name"] }],
    );
  });

  it("gives each key of a path as a string or a number", () => {
    assert.deepEqual(
      to_issues([{
        message: "bad",
        path: [
          "items",
          0,
          { key: "price" },
          { key: 2, type: "array", value: 1 },
          Symbol("tag"),
          { key: Symbol("inner") },
          Symbol(),
        ],
      }]),
      [{
        message: "bad",
        path: ["items", 0, "price", 2, "tag", "inner", ""],
      }],
    );
  });

  it("gives a plain list for a path of a class of its own", () => {
    // as the path of an issue of ArkType is
    class Path extends Array<PropertyKey> {
      cache = {};
    }
    const [issue] = to_issues([{ message: "bad", path: Path.from(["a", 1]) }]);
    assert.equal(Object.getPrototypeOf(issue?.path), Array.prototype);
    assert.deepEqual(issue, { message: "bad", path: ["a", 1] });
  });

  it("leaves the path out when the whole value is what is wrong", () => {
    assert.deepEqual(to_issues([{ message: "bad", path: [] }]), [{
      message: "bad",
    }]);
    assert.deepEqual(to_issues([{ message: "bad", path: "name" }]), [{
      message: "bad",
    }]);
  });

  it("gives a message to an issue that has none", () => {
    assert.deepEqual(
      to_issues([{}, null, "text", { message: "" }, {
        message: 1,
        path: ["a"],
      }]),
      [
        { message: "Invalid value" },
        { message: "Invalid value" },
        { message: "Invalid value" },
        { message: "Invalid value" },
        { message: "Invalid value", path: ["a"] },
      ],
    );
  });

  it("gives one issue for an empty list", () => {
    assert.deepEqual(to_issues([]), [{ message: "Invalid value" }]);
  });
});

describe("error_issues", () => {
  it("gives the issues of an error that has a list of them", () => {
    const error = Object.assign(new Error("2 issues"), {
      issues: [
        { code: "too_small", message: "Too small", path: ["age"] },
        { message: "Required", path: [{ key: "name" }] },
      ],
    });
    assert.deepEqual(error_issues(error), [
      { message: "Too small", path: ["age"] },
      { message: "Required", path: ["name"] },
    ]);
  });

  it("gives one issue with the message of any other error", () => {
    assert.deepEqual(error_issues(new Error("not ok")), [{
      message: "not ok",
    }]);
    assert.deepEqual(error_issues(new SyntaxError("Unexpected token")), [{
      message: "Unexpected token",
    }]);
    // a list that is empty, and what is not a list, are no issues
    assert.deepEqual(
      error_issues(Object.assign(new Error("empty"), { issues: [] })),
      [{ message: "empty" }],
    );
    assert.deepEqual(
      error_issues(Object.assign(new Error("text"), { issues: "many" })),
      [{ message: "text" }],
    );
  });

  it("gives one issue for what is not an error", () => {
    assert.deepEqual(error_issues("no"), [{ message: "no" }]);
    assert.deepEqual(error_issues(404), [{ message: "404" }]);
    assert.deepEqual(error_issues(null), [{ message: "null" }]);
    assert.deepEqual(error_issues(undefined), [{ message: "undefined" }]);
    assert.deepEqual(error_issues(new Error("")), [{
      message: "Invalid value",
    }]);
    // a value String() cannot convert
    assert.deepEqual(error_issues(Object.create(null)), [{
      message: "Invalid value",
    }]);
  });
});

describe("the types of a validator", () => {
  type User = { name: string; age: number };
  type NewUser = { name: string; age?: number };

  it("gives the output and the input of a Standard Schema", () => {
    const schema = standard_schema<User, NewUser>((value) => ({
      value: { age: 18, ...(value as NewUser) },
    }));
    same<Same<ChoOutput<typeof schema>, User>>();
    same<Same<ChoInput<typeof schema>, NewUser>>();
    // @ts-expect-error: the output is not the input
    same<Same<ChoOutput<typeof schema>, NewUser>>();
    assert.equal(typeof schema, "object");
  });

  it("gives what a parse method returns, for both", () => {
    const sync = { parse: (_value: unknown): User => ({ name: "", age: 1 }) };
    const later = {
      parse: (_value: unknown): Promise<User> =>
        Promise.resolve({ name: "", age: 1 }),
    };
    same<Same<ChoOutput<typeof sync>, User>>();
    same<Same<ChoInput<typeof sync>, User>>();
    same<Same<ChoOutput<typeof later>, User>>();
    same<Same<ChoOutput<ChoParseValidator<number>>, number>>();
    assert.equal(typeof sync, "object");
  });

  it("gives the types of the Standard Schema of an object with both", () => {
    const both = {
      ...standard_schema<User, NewUser>(() => ({
        value: { name: "", age: 1 },
      })),
      parse: (_value: unknown): string => "",
    };
    same<Same<ChoOutput<typeof both>, User>>();
    same<Same<ChoInput<typeof both>, NewUser>>();
    assert.equal(typeof both, "object");
  });

  it("gives never for what is not a validator", () => {
    same<Same<ChoOutput<string>, never>>();
    same<Same<ChoInput<{ validate(): void }>, never>>();
  });

  it("takes a schema of any types where a validator is expected", () => {
    const schema = standard_schema<User, NewUser>(() => ({
      value: { name: "", age: 1 },
    }));
    const any: ChoValidator = schema;
    const typed: ChoValidator<User> = schema;
    const full: ChoValidator<User, NewUser> = schema;
    const standard: StandardSchemaV1 = schema;
    // @ts-expect-error: it does not give a string
    const wrong: ChoValidator<string> = schema;
    assert.deepEqual([any, typed, full, standard, wrong].length, 5);
  });

  it("types a validator written by hand, in both shapes", () => {
    const by_parse: ChoValidator<number> = { parse: (value) => Number(value) };
    const by_standard: ChoValidator<number> = {
      "~standard": {
        version: 1,
        vendor: "app",
        validate: (value) => ({ value: Number(value) }),
      },
    };
    assert.equal(is_validator(by_parse) && is_validator(by_standard), true);
  });
});
