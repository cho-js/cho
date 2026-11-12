/**
 * Tests for `tokens.ts`: injection tokens, `isToken` and `provider`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isToken, provider, token } from "./tokens.ts";

describe("token", () => {
  it("has the given description", () => {
    assert.equal(token("API_URL").description, "API_URL");
  });

  it("prints as InjectionToken(<description>)", () => {
    const t = token("API_URL");
    assert.equal(String(t), "InjectionToken(API_URL)");
    assert.equal(`${t}`, "InjectionToken(API_URL)");
  });

  it("is frozen", () => {
    assert.ok(Object.isFrozen(token("API_URL")));
  });

  it("is unique: two tokens with the same description are different", () => {
    assert.notEqual(token("API_URL"), token("API_URL"));
  });

  it("is recognized by isToken", () => {
    assert.ok(isToken(token("API_URL")));
  });
});

describe("isToken", () => {
  it("accepts classes and functions", () => {
    class Foo {}
    abstract class Base {}
    assert.ok(isToken(Foo));
    assert.ok(isToken(Base));
    assert.ok(isToken(function factory() {}));
  });

  it("accepts symbols", () => {
    assert.ok(isToken(Symbol("cache")));
    assert.ok(isToken(Symbol.for("cache")));
  });

  it("accepts injection tokens created by another copy of the package", () => {
    const foreign = { description: "x", [Symbol.for("chojs.token")]: true };
    assert.ok(isToken(foreign));
  });

  it("rejects strings", () => {
    assert.ok(!isToken("API_URL"));
  });

  it("rejects plain objects, even shaped like a token", () => {
    assert.ok(!isToken({}));
    assert.ok(!isToken({ description: "API_URL" }));
  });

  it("rejects other values", () => {
    for (const value of [null, undefined, 0, 1, true, false, []]) {
      assert.ok(!isToken(value), `${String(value)} should not be a token`);
    }
  });
});

describe("provider", () => {
  it("defaults deps to []", () => {
    const p = provider({
      provide: token("x"),
      factory: () => Promise.resolve(1),
    });
    assert.deepEqual(p.deps, []);
  });

  it("keeps provide, deps and factory", () => {
    class Config {}
    const API_URL = token<string>("API_URL");
    const factory = (_config: Config) => Promise.resolve("url");
    const p = provider({ provide: API_URL, deps: [Config], factory });
    assert.equal(p.provide, API_URL);
    assert.deepEqual(p.deps, [Config]);
    assert.equal(p.factory, factory);
  });

  it("returns a new object, without changing the input", () => {
    const input = {
      provide: token<number>("x"),
      factory: () => Promise.resolve(1),
    };
    const p = provider(input);
    assert.notEqual(p, input);
    assert.ok(!("deps" in input));
  });

  it("keeps a factory that can be called", async () => {
    const p = provider({
      provide: token<number>("x"),
      deps: [token<number>("a"), token<number>("b")],
      factory: (a, b) => Promise.resolve(a + b),
    });
    assert.equal(await p.factory(1, 2), 3);
  });
});
