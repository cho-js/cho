/**
 * Tests for `env.ts`: reading environment variables on every runtime.
 *
 * The variables are overridden with `with_env`, which never touches the real
 * environment, so the tests need no permission (Deno's `--allow-env`).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { env, env_bool, env_num, type EnvSource, set_env } from "./env.ts";
import { with_env } from "./test_utils.ts";

/** Run `fn` with `globalThis.process` replaced, then restore it. */
function with_process(value: unknown, fn: () => void): void {
  const saved = Object.getOwnPropertyDescriptor(globalThis, "process");
  Object.defineProperty(globalThis, "process", {
    value,
    configurable: true,
    writable: true,
  });
  try {
    fn();
  } finally {
    if (saved) Object.defineProperty(globalThis, "process", saved);
    else delete (globalThis as { process?: unknown }).process;
  }
}

const KEY = "CHO_TEST_ENV";

describe("env", () => {
  it("returns the variable's value", () => {
    with_env({ [KEY]: "value" }, () => {
      assert.equal(env(KEY), "value");
    });
  });

  it("returns undefined for a missing variable", () => {
    with_env({ [KEY]: undefined }, () => {
      assert.equal(env(KEY), undefined);
    });
  });

  it("returns undefined on a runtime without process", () => {
    with_process(undefined, () => {
      assert.equal(env(KEY), undefined);
    });
  });

  it("returns undefined when the environment cannot be read", () => {
    // Deno without --allow-env throws on access.
    const denied = {
      get env(): never {
        throw new Error("permission denied");
      },
    };
    with_process(denied, () => {
      assert.equal(env(KEY), undefined);
    });
  });
});

describe("env_bool", () => {
  for (const value of ["1", "true", "TRUE", "yes", "Yes", "on", "ON"]) {
    it(`is true for ${JSON.stringify(value)}`, () => {
      with_env({ [KEY]: value }, () => assert.equal(env_bool(KEY), true));
    });
  }

  for (const value of [undefined, "", "0", "false", "no", "off", "2"]) {
    it(`is false for ${JSON.stringify(value)}`, () => {
      with_env({ [KEY]: value }, () => assert.equal(env_bool(KEY), false));
    });
  }
});

describe("env_num", () => {
  it("parses a number", () => {
    with_env({ [KEY]: "42" }, () => assert.equal(env_num(KEY), 42));
    with_env({ [KEY]: "-1.5" }, () => assert.equal(env_num(KEY), -1.5));
  });

  it("is NaN for a missing or non-numeric variable", () => {
    with_env({ [KEY]: undefined }, () => assert.ok(Number.isNaN(env_num(KEY))));
    with_env({ [KEY]: "abc" }, () => assert.ok(Number.isNaN(env_num(KEY))));
  });
});

/** Run `fn` with a `set_env` source, then remove it. */
function with_source(source: EnvSource, fn: () => void): void {
  set_env(source);
  try {
    fn();
  } finally {
    set_env(undefined);
  }
}

describe("set_env", () => {
  it("reads a record source", () => {
    with_env({ [KEY]: undefined }, () => {
      with_source({ [KEY]: "from source" }, () => {
        assert.equal(env(KEY), "from source");
      });
    });
  });

  it("reads a function source", () => {
    with_env({ [KEY]: undefined }, () => {
      with_source((key) => key === KEY ? "from function" : undefined, () => {
        assert.equal(env(KEY), "from function");
      });
    });
  });

  it("is read before process.env", () => {
    with_env({ [KEY]: "from process" }, () => {
      with_source({ [KEY]: "from source" }, () => {
        assert.equal(env(KEY), "from source");
      });
    });
  });

  it("falls back to process.env for a variable the source does not have", () => {
    with_env({ [KEY]: "from process" }, () => {
      with_source({}, () => assert.equal(env(KEY), "from process"));
    });
  });

  it("ignores values that are not strings, and a source that throws", () => {
    with_env({ [KEY]: "from process" }, () => {
      // e.g. a Cloudflare Workers binding, which is an object
      with_source({ [KEY]: { binding: true } }, () => {
        assert.equal(env(KEY), "from process");
      });
      with_source(() => {
        throw new Error("boom");
      }, () => assert.equal(env(KEY), "from process"));
    });
  });

  it("works on a runtime without process", () => {
    with_process(undefined, () => {
      with_source({ [KEY]: "1" }, () => {
        assert.equal(env(KEY), "1");
        assert.equal(env_bool(KEY), true);
        assert.equal(env_num(KEY), 1);
      });
    });
  });

  it("stops reading the source once it is removed", () => {
    with_env({ [KEY]: undefined }, () => {
      set_env({ [KEY]: "x" });
      set_env(undefined);
      assert.equal(env(KEY), undefined);
    });
  });
});
