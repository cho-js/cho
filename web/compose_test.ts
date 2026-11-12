/**
 * Tests for `compose.ts`: running middlewares around an endpoint.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { loose } from "@chojs/core/utils/test_utils";
import { compose } from "./compose.ts";
import { create_context } from "./context.ts";
import type { ChoWebMiddlewareFn } from "./types.ts";

const ctx = () => create_context(new Request("http://localhost/"));
const endpoint = () => Promise.resolve(new Response("end"));

describe("compose", () => {
  it("is the endpoint itself without middlewares", () => {
    assert.equal(compose([], endpoint), endpoint);
  });

  it("runs the middlewares in order, around the endpoint", async () => {
    const order: string[] = [];
    const mw = (name: string): ChoWebMiddlewareFn => async (_ctx, next) => {
      order.push(`${name} in`);
      const response = await next();
      order.push(`${name} out`);
      return response;
    };
    const run = compose([mw("a"), mw("b")], () => {
      order.push("end");
      return endpoint();
    });
    assert.equal(await (await run(ctx())).text(), "end");
    assert.deepEqual(order, ["a in", "b in", "end", "b out", "a out"]);
  });

  it("gives every middleware and the endpoint the same context", async () => {
    const context = ctx();
    const seen: unknown[] = [];
    const mw: ChoWebMiddlewareFn = (c, next) => {
      seen.push(c);
      c.state.set("user", "ada");
      return next();
    };
    await compose([mw, mw], (c) => {
      seen.push(c, c.state.get("user"));
      return endpoint();
    })(context);
    assert.deepEqual(seen, [context, context, context, "ada"]);
  });

  it("lets a middleware answer without calling next", async () => {
    let reached = false;
    const deny: ChoWebMiddlewareFn = () => new Response("no", { status: 401 });
    const run = compose([deny], () => {
      reached = true;
      return endpoint();
    });
    assert.equal((await run(ctx())).status, 401);
    assert.equal(reached, false);
  });

  it("lets a middleware replace the response", async () => {
    const wrap: ChoWebMiddlewareFn = async (_ctx, next) =>
      new Response(`[${await (await next()).text()}]`);
    assert.equal(
      await (await compose([wrap], endpoint)(ctx())).text(),
      "[end]",
    );
  });

  it("passes the response on when a middleware returns nothing after next", async () => {
    const quiet: ChoWebMiddlewareFn = async (_ctx, next) => {
      await next();
    };
    assert.equal(await (await compose([quiet], endpoint)(ctx())).text(), "end");
  });

  it("rejects when a middleware returns nothing without calling next", async () => {
    const lost: ChoWebMiddlewareFn = function lost() {};
    await assert.rejects(compose([lost], endpoint)(ctx()), {
      message:
        "middleware lost returned no response: return a Response or call next()",
    });
  });

  it("rejects when a middleware returns anything but a Response", async () => {
    const wrong: ChoWebMiddlewareFn = loose(function wrong() {
      return { ok: true };
    });
    await assert.rejects(compose([wrong], endpoint)(ctx()), {
      name: "TypeError",
      message: "middleware wrong must return a Response or nothing, got object",
    });
  });

  it("rejects when next is called twice", async () => {
    const twice: ChoWebMiddlewareFn = async function twice(_ctx, next) {
      await next();
      return next();
    };
    await assert.rejects(compose([twice], endpoint)(ctx()), {
      message: "middleware twice: next() called more than once",
    });
  });

  it("rejects with the error of a middleware or of the endpoint", async () => {
    const pass: ChoWebMiddlewareFn = (_ctx, next) => next();
    const fail: ChoWebMiddlewareFn = () => {
      throw new Error("mw");
    };
    await assert.rejects(compose([pass, fail], endpoint)(ctx()), {
      message: "mw",
    });
    await assert.rejects(
      compose([pass], () => Promise.reject(new Error("end")))(ctx()),
      { message: "end" },
    );
  });

  it("lets a middleware recover from an error down the chain", async () => {
    const recover: ChoWebMiddlewareFn = async (_ctx, next) => {
      try {
        return await next();
      } catch {
        return new Response("recovered");
      }
    };
    const run = compose([recover], () => Promise.reject(new Error("end")));
    assert.equal(await (await run(ctx())).text(), "recovered");
  });
});
