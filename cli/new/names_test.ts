import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NAME_LENGTH, name_mistake } from "./names.ts";

describe("the rule of a name", () => {
  it("accepts lower case letters, digits and -, starting with a letter", () => {
    for (const name of ["a", "shop", "my-app", "api2", "a-1-b", "x--y-"]) {
      assert.equal(name_mistake(name), undefined, name);
    }
  });

  it("refuses an empty name", () => {
    assert.equal(name_mistake(""), "A name is needed");
  });

  it("refuses what is not a folder and a package everywhere", () => {
    const names = [
      "Shop", // upper case
      "2fast", // starts with a digit
      "-app", // starts with -
      "my app", // a space
      "my_app", // not a name of a package of JSR
      "my.app",
      "a/b", // a path
      "../a",
      "@shop",
      "café",
    ];
    for (const name of names) {
      assert.equal(
        name_mistake(name),
        "Lower case letters, digits and -, starting with a letter",
        name,
      );
    }
  });

  it("refuses a name that is too long", () => {
    assert.equal(name_mistake("a".repeat(NAME_LENGTH)), undefined);
    assert.equal(
      name_mistake("a".repeat(NAME_LENGTH + 1)),
      "64 characters at most",
    );
  });

  it("refuses the names Windows keeps for a device", () => {
    for (const name of ["con", "prn", "aux", "nul", "com1", "com9", "lpt1"]) {
      assert.equal(
        name_mistake(name),
        `Windows keeps the name "${name}" for a device`,
      );
    }
    // not kept: they are names like any other
    for (const name of ["com", "com10", "console", "lpt0"]) {
      assert.equal(name_mistake(name), undefined, name);
    }
  });
});
