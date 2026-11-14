/** Tests for `secure-headers.ts`. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loose } from "@chojs/core/utils/test_utils";
import { secureHeaders } from "./secure-headers.ts";
import { run } from "./testing.ts";

describe("secureHeaders", () => {
  it("adds the default headers to the response", async () => {
    const { response, called } = await run(secureHeaders());
    assert.deepEqual(
      Object.fromEntries(
        [...response.headers].filter(([name]) => name !== "content-type"),
      ),
      {
        "cross-origin-opener-policy": "same-origin",
        "cross-origin-resource-policy": "same-origin",
        "origin-agent-cluster": "?1",
        "referrer-policy": "no-referrer",
        "strict-transport-security": "max-age=15552000; includeSubDomains",
        "x-content-type-options": "nosniff",
        "x-dns-prefetch-control": "off",
        "x-download-options": "noopen",
        "x-frame-options": "SAMEORIGIN",
        "x-permitted-cross-domain-policies": "none",
        "x-xss-protection": "0",
      },
    );
    assert.deepEqual([called, await response.text()], [1, "ok"]);
  });

  it("changes, adds and leaves out headers, in any case", async () => {
    const { response: { headers } } = await run(secureHeaders({
      "X-Frame-Options": "DENY",
      "content-security-policy": "default-src 'self'",
      "Strict-Transport-Security": false,
    }));
    assert.equal(headers.get("x-frame-options"), "DENY");
    assert.equal(headers.get("content-security-policy"), "default-src 'self'");
    assert.equal(headers.get("strict-transport-security"), null);
    assert.equal(headers.get("x-content-type-options"), "nosniff");
  });

  it("keeps a header the response already has", async () => {
    const { response: { headers } } = await run(
      secureHeaders(),
      {},
      () => new Response("ok", { headers: { "x-frame-options": "DENY" } }),
    );
    assert.equal(headers.get("x-frame-options"), "DENY");
  });

  it("works on a response whose headers cannot be changed", async () => {
    const { response } = await run(
      secureHeaders(),
      {},
      () => Response.redirect("http://localhost/elsewhere"),
    );
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  });

  it("rejects a value that is not a string or false", () => {
    assert.throws(() => secureHeaders(loose({ "x-frame-options": true })), {
      name: "TypeError",
      message:
        'secureHeaders(): the value of "x-frame-options" must be a string or false',
    });
  });
});
