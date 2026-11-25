/**
 * Tests for the names of the parts `cho generate` writes: the rule of a
 * name, and the file and the class it gives.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  class_name,
  file_name,
  part_mistake,
  PARTS,
  words_of,
} from "./parts.ts";

describe("the parts", () => {
  it("are a controller, a service and a module", () => {
    assert.deepEqual([...PARTS], ["controller", "service", "module"]);
  });
});

describe("part_mistake", () => {
  it("says nothing of a name in camelCase, PascalCase or kebab-case", () => {
    const names = ["users", "userProfile", "UserProfile", "user-profile", "v2"];
    for (const name of names) {
      assert.equal(part_mistake(name), undefined, name);
    }
  });

  it("refuses what is not letters and digits, starting with a letter", () => {
    const names = [
      "user profile",
      "2users",
      "-users",
      "users-",
      "user--profile",
      "users.controller",
      "apps/users",
      "user_profile",
    ];
    for (const name of names) {
      assert.equal(
        part_mistake(name),
        "Letters and digits, starting with a letter: users, userProfile or " +
          "user-profile",
        name,
      );
    }
  });

  it("refuses no name, and one that is too long", () => {
    assert.equal(part_mistake(""), "A name is needed");
    assert.equal(part_mistake("a".repeat(64)), undefined);
    assert.equal(part_mistake("a".repeat(65)), "64 characters at most");
  });
});

describe("the names of a part", () => {
  const names = [
    // as it is typed, its words, its file, its class
    ["users", ["users"], "users", "Users"],
    ["userProfile", ["user", "Profile"], "user-profile", "UserProfile"],
    ["UserProfile", ["User", "Profile"], "user-profile", "UserProfile"],
    ["user-profile", ["user", "profile"], "user-profile", "UserProfile"],
    ["HTTPClient", ["HTTP", "Client"], "http-client", "HTTPClient"],
    ["oauth2Token", ["oauth2", "Token"], "oauth2-token", "Oauth2Token"],
    ["v2-userStore", ["v2", "user", "Store"], "v2-user-store", "V2UserStore"],
  ] as const;

  for (const [name, words, file, cls] of names) {
    it(`${name}: the file ${file}.ts, and the class ${cls}`, () => {
      assert.deepEqual(words_of(name), words);
      assert.equal(file_name(name), file);
      assert.equal(class_name(name), cls);
    });
  }

  it("give one file to the ways a name is typed", () => {
    const files = ["userProfile", "UserProfile", "user-profile"].map(file_name);
    assert.deepEqual(new Set(files), new Set(["user-profile"]));
  });
});
