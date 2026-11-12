/**
 * Tests for `debuglog.ts`: debug logging by context, enabled from the
 * environment.
 *
 * `CHO_DEBUG` and `CHO_DEBUGLOG` are set explicitly in every test, so the
 * results do not depend on the environment the tests run in.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { debuglog, isEnabled } from "./debuglog.ts";
import { capture, with_env } from "./test_utils.ts";
import { set_env } from "./env.ts";

/** Neither variable set. */
const OFF = { CHO_DEBUG: undefined, CHO_DEBUGLOG: undefined };

describe("isEnabled", () => {
  it("is off by default", () => {
    with_env(OFF, () => assert.equal(isEnabled("cho"), false));
  });

  it("enables every context with CHO_DEBUG", () => {
    with_env({ ...OFF, CHO_DEBUG: "1" }, () => {
      assert.equal(isEnabled("cho"), true);
      assert.equal(isEnabled("anything"), true);
    });
  });

  it("enables the listed contexts with CHO_DEBUGLOG", () => {
    with_env({ ...OFF, CHO_DEBUGLOG: "cho, web" }, () => {
      assert.equal(isEnabled("cho"), true);
      assert.equal(isEnabled("web"), true);
      assert.equal(isEnabled("di"), false);
      assert.equal(isEnabled("chos"), false);
    });
  });

  it("matches prefixes with a trailing *, and everything with *", () => {
    with_env({ ...OFF, CHO_DEBUGLOG: "di:*" }, () => {
      assert.equal(isEnabled("di:graph"), true);
      assert.equal(isEnabled("di:"), true);
      assert.equal(isEnabled("cho"), false);
    });
    with_env({ ...OFF, CHO_DEBUGLOG: "*" }, () => {
      assert.equal(isEnabled("cho"), true);
    });
  });

  it("reads the environment given to set_env", () => {
    with_env(OFF, () => {
      set_env({ CHO_DEBUGLOG: "cho" });
      try {
        assert.equal(isEnabled("cho"), true);
      } finally {
        set_env(undefined);
      }
    });
  });

  it("does not enable anything with CHO_DEBUG=0", () => {
    with_env({ ...OFF, CHO_DEBUG: "0" }, () => {
      assert.equal(isEnabled("cho"), false);
    });
  });
});

describe("debuglog", () => {
  it("returns a logger that does nothing when the context is off", async () => {
    let log!: ReturnType<typeof debuglog>;
    with_env(OFF, () => {
      log = debuglog("cho");
    });
    const { output } = await capture(() => {
      log("hidden");
      log.error("hidden");
      log.start()("hidden");
    });
    assert.equal(log.enabled, false);
    assert.deepEqual(output, { log: [], error: [] });
  });

  it("writes to stderr with a timestamp and the context", async () => {
    let log!: ReturnType<typeof debuglog>;
    with_env({ ...OFF, CHO_DEBUGLOG: "cho" }, () => {
      log = debuglog("cho");
    });
    const { output } = await capture(() => log("hello", 42));
    assert.equal(log.enabled, true);
    const [time, context, ...args] = output.error;
    assert.match(String(time), /^\d\d:\d\d:\d\d\.\d{3}$/);
    assert.equal(context, "cho");
    assert.deepEqual(args, ["hello", 42]);
    assert.deepEqual(output.log, []);
  });

  it("marks errors with ERROR", async () => {
    let log!: ReturnType<typeof debuglog>;
    with_env({ ...OFF, CHO_DEBUG: "1" }, () => {
      log = debuglog("cho");
    });
    const { output } = await capture(() => log.error("failed"));
    assert.deepEqual(output.error.slice(1), ["cho", "ERROR", "failed"]);
  });

  it("adds the elapsed time with start()", async () => {
    let log!: ReturnType<typeof debuglog>;
    with_env({ ...OFF, CHO_DEBUG: "1" }, () => {
      log = debuglog("cho");
    });
    const { output } = await capture(() => log.start()("done"));
    assert.equal(output.error[2], "done");
    assert.match(String(output.error[3]), /^\+\d+ms$/);
  });

  it("reads the environment when the logger is created", () => {
    let log!: ReturnType<typeof debuglog>;
    with_env(OFF, () => {
      log = debuglog("cho");
    });
    let enabled = false;
    with_env({ ...OFF, CHO_DEBUG: "1" }, () => {
      enabled = log.enabled;
    });
    assert.equal(enabled, false);
  });
});
