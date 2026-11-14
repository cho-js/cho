/** Tests for `timeout.ts`. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loose } from "@chojs/core/utils/test_utils";
import { run } from "./testing.ts";
import { timeout } from "./timeout.ts";

/** Resolves after some milliseconds. */
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("timeout", () => {
  it("lets a request that is fast enough through", async () => {
    const { response, called } = await run(
      timeout({ ms: 200 }),
      {},
      async () => {
        await wait(5);
        return new Response("fast");
      },
    );
    assert.deepEqual([await response.text(), called], ["fast", 1]);
  });

  it("answers 504 when the rest of the chain takes too long", async () => {
    const started = Date.now();
    const { response } = await run(timeout({ ms: 20 }), {}, async () => {
      await wait(200);
      return new Response("slow");
    });
    assert.deepEqual(
      [response.status, await response.text()],
      [504, "Gateway Timeout"],
    );
    // answered at the limit, not when the handler ends
    assert.ok(Date.now() - started < 150);
  });

  it("drops the error of what was still running after the limit", async () => {
    const { response } = await run(timeout({ ms: 10 }), {}, async () => {
      await wait(40);
      throw new Error("late failure");
    });
    assert.equal(response.status, 504);
    await wait(60); // the late failure must not surface
  });

  it("passes on an error that comes before the limit", async () => {
    await assert.rejects(
      run(timeout({ ms: 200 }), {}, () => {
        throw new Error("down");
      }),
      { message: "down" },
    );
  });

  it("answers with onTimeout, which receives the context", async () => {
    const { response } = await run(
      timeout({
        ms: 10,
        onTimeout: (ctx) =>
          Response.json({ slow: ctx.url.pathname }, { status: 503 }),
      }),
      { path: "/report" },
      async () => {
        await wait(60);
        return new Response("slow");
      },
    );
    assert.deepEqual([response.status, await response.json()], [503, {
      slow: "/report",
    }]);
    await wait(70);
  });

  it("needs a positive number of milliseconds", () => {
    for (const ms of [0, -1, "10", NaN, Infinity, undefined]) {
      assert.throws(() => timeout(loose({ ms })), {
        name: "TypeError",
        message: "timeout(): ms must be a positive number of milliseconds",
      });
    }
  });
});
