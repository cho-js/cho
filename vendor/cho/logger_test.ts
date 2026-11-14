/** Tests for `logger.ts`. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { capture } from "@chojs/core/utils/test_utils";
import { logger, type LoggerEntry } from "./logger.ts";
import { run } from "./testing.ts";

describe("logger", () => {
  it("writes one line when the request is done, without the query string", async () => {
    const lines: string[] = [];
    const { response } = await run(
      logger({ log: (line) => lines.push(line) }),
      { path: "/users/42?token=secret", method: "PUT", body: "{}" },
      () => new Response(null, { status: 204 }),
    );
    assert.equal(response.status, 204);
    assert.equal(lines.length, 1);
    assert.match(lines[0]!, /^PUT \/users\/42 204 \d+ms$/);
  });

  it("writes to console.log by default", async () => {
    const { output } = await capture(() => run(logger()));
    assert.match(output.log[0]!, /^GET \/ 200 \d+ms$/);
  });

  it("logs a request that fails, and passes its error on", async () => {
    const lines: string[] = [];
    const boom = new Error("boom");
    await assert.rejects(
      run(logger({ log: (line) => lines.push(line) }), { path: "/x" }, () => {
        throw boom;
      }),
      (error) => error === boom,
    );
    assert.match(lines[0]!, /^GET \/x failed \d+ms$/);
  });

  it("makes the line with format, from what is known of the request", async () => {
    const entries: LoggerEntry[] = [];
    const lines: string[] = [];
    const custom = logger({
      log: (line) => lines.push(line),
      format: (entry) => {
        entries.push(entry);
        return JSON.stringify({ method: entry.method, status: entry.status });
      },
    });
    const { ctx } = await run(custom, { path: "/users?page=2" });
    assert.deepEqual(lines, ['{"method":"GET","status":200}']);
    const [entry] = entries;
    assert.deepEqual(
      [entry!.method, entry!.path, entry!.status, "error" in entry!],
      ["GET", "/users", 200, false],
    );
    assert.equal(typeof entry!.ms, "number");
    assert.equal(entry!.ctx, ctx);

    const boom = new Error("boom");
    await run(custom, {}, () => {
      throw boom;
    }).catch(() => {});
    assert.deepEqual(
      [entries[1]!.status, entries[1]!.error],
      [undefined, boom],
    );
  });
});
