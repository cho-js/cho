/** Tests for `bearer-auth.ts`. */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loose } from "@chojs/core/utils/test_utils";
import { bearerAuth } from "./bearer-auth.ts";
import { run } from "./testing.ts";

const bearer = (token: string): RequestInit => ({
  headers: { authorization: `Bearer ${token}` },
});

describe("bearerAuth", () => {
  it("lets a request with the token in", async () => {
    const { response, called } = await run(
      bearerAuth({ token: "t0ken.abc-123" }),
      bearer("t0ken.abc-123"),
    );
    assert.deepEqual([response.status, called], [200, 1]);
  });

  it("accepts any of a list of tokens", async () => {
    const middleware = bearerAuth({ token: ["first", "second"] });
    assert.equal((await run(middleware, bearer("second"))).called, 1);
    assert.equal((await run(middleware, bearer("third"))).called, 0);
  });

  it("answers 401 with a challenge to a request without the header", async () => {
    const { response, called } = await run(bearerAuth({ token: "t" }));
    assert.deepEqual(
      [response.status, called, response.headers.get("www-authenticate")],
      [401, 0, "Bearer"],
    );
  });

  it("answers 401 with invalid_token to a token that is not accepted", async () => {
    for (
      const authorization of [
        "Bearer wrong",
        "Bearer",
        "Bearer two tokens",
        "Basic dDo=",
        "t",
      ]
    ) {
      const { response, called } = await run(bearerAuth({ token: "t" }), {
        headers: { authorization },
      });
      assert.deepEqual(
        [response.status, called, response.headers.get("www-authenticate")],
        [401, 0, 'Bearer error="invalid_token"'],
        authorization,
      );
    }
  });

  it("reads the scheme in any case", async () => {
    const { called } = await run(bearerAuth({ token: "t" }), {
      headers: { authorization: "bearer t" },
    });
    assert.equal(called, 1);
  });

  it("checks with verify, which receives the context", async () => {
    const middleware = bearerAuth({
      verify: (token, ctx) => {
        ctx.state.set("claims", { sub: token });
        return Promise.resolve(token.startsWith("ok"));
      },
    });
    const allowed = await run(middleware, bearer("ok-1"));
    assert.deepEqual(
      [allowed.called, allowed.ctx.state.get("claims")],
      [1, { sub: "ok-1" }],
    );
    assert.equal((await run(middleware, bearer("no-1"))).response.status, 401);
  });

  it("needs a token or a verify function", () => {
    for (const options of [{}, { token: "" }, { token: [] }, { token: [1] }]) {
      assert.throws(() => bearerAuth(loose(options)), {
        name: "TypeError",
        message:
          "bearerAuth(): give a token, a list of tokens, or a verify function",
      });
    }
  });
});
