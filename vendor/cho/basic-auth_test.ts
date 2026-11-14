/** Tests for `basic-auth.ts`. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loose } from "@chojs/core/utils/test_utils";
import { basicAuth } from "./basic-auth.ts";
import { run } from "./testing.ts";

/** An `Authorization: Basic` header for a name and a password. */
function basic(username: string, password: string): RequestInit {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  return {
    headers: { authorization: `Basic ${btoa(String.fromCharCode(...bytes))}` },
  };
}

describe("basicAuth", () => {
  const one_user = basicAuth({ username: "ada", password: "s3:cret" });

  it("lets the right name and password in", async () => {
    const { response, called } = await run(one_user, basic("ada", "s3:cret"));
    assert.deepEqual([response.status, called], [200, 1]);
  });

  it("answers 401, with a challenge, to anything else", async () => {
    for (
      const init of [
        {}, // no header
        basic("ada", "wrong"),
        basic("eve", "s3:cret"),
        basic("", ""),
        { headers: { authorization: "Bearer abc" } },
        { headers: { authorization: "Basic !!!not-base64!!!" } },
        { headers: { authorization: `Basic ${btoa("no-colon")}` } },
        { headers: { authorization: "Basic" } },
      ]
    ) {
      const { response, called } = await run(one_user, init);
      assert.deepEqual(
        [response.status, called, response.headers.get("www-authenticate")],
        [401, 0, 'Basic realm="Secure Area", charset="UTF-8"'],
        JSON.stringify(init),
      );
    }
  });

  it("reads names and passwords as UTF-8, with colons in the password", async () => {
    const middleware = basicAuth({ username: "añá", password: "p:à:ss" });
    assert.equal((await run(middleware, basic("añá", "p:à:ss"))).called, 1);
    assert.equal((await run(middleware, basic("añá", "p"))).called, 0);
  });

  it("checks with verify, which receives the context", async () => {
    const seen: unknown[] = [];
    const middleware = basicAuth({
      realm: 'The "admin" area',
      verify: (username, password, ctx) => {
        seen.push([username, password, ctx.url.pathname]);
        ctx.state.set("user", username);
        return Promise.resolve(password === "open");
      },
    });
    const allowed = await run(middleware, {
      path: "/admin",
      ...basic("ada", "open"),
    });
    assert.deepEqual(
      [allowed.called, allowed.ctx.state.get("user")],
      [1, "ada"],
    );
    const refused = await run(middleware, basic("ada", "closed"));
    assert.deepEqual(
      [
        refused.response.status,
        refused.response.headers.get("www-authenticate"),
      ],
      [401, 'Basic realm="The \\"admin\\" area", charset="UTF-8"'],
    );
    assert.deepEqual(seen, [["ada", "open", "/admin"], ["ada", "closed", "/"]]);
  });

  it("needs a user or a verify function", () => {
    for (
      const options of [{}, { username: "ada" }, { password: "x" }, undefined]
    ) {
      assert.throws(() => basicAuth(loose(options)), {
        name: "TypeError",
        message:
          "basicAuth(): give a username and a password, or a verify function",
      });
    }
  });
});
