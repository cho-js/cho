/**
 * Tests for what `@chojs/message` gives an application to read its environment
 * with: `env`, `envBool`, `envNum`, `setEnv` and `engine`. They are the
 * core's, and are tested there (`core/utils/env_test.ts`): this checks that
 * the package exports them, under the names of a public API.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as core from "@chojs/core/utils";
import {
  engine,
  type EngineType,
  env,
  envBool,
  envNum,
  type EnvSource,
  setEnv,
} from "./mod.ts";

describe("the environment, from @chojs/message", () => {
  it("exports the functions of the core", () => {
    assert.equal(env, core.env);
    assert.equal(envBool, core.envBool);
    assert.equal(envNum, core.envNum);
    assert.equal(setEnv, core.setEnv);
    assert.equal(engine, core.engine);
  });

  it("reads what setEnv was given", () => {
    const source: EnvSource = { CHO_TEST_PORT: "8080", CHO_TEST_ON: "yes" };
    setEnv(source);
    try {
      assert.equal(env("CHO_TEST_PORT"), "8080");
      assert.equal(envNum("CHO_TEST_PORT"), 8080);
      assert.equal(envBool("CHO_TEST_ON"), true);
    } finally {
      setEnv(undefined);
    }
    assert.equal(env("CHO_TEST_PORT"), undefined);
  });

  it("names the runtime", () => {
    const runtime: EngineType = engine();
    assert.notEqual(runtime, "unknown");
  });
});
