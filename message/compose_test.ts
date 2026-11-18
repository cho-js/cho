/**
 * Tests for `compose.ts`: the chain of middlewares of a message.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compose } from "./compose.ts";
import { create_context } from "./context.ts";
import type { ChoMessageMiddlewareFn } from "./types.ts";

const ctx = () => create_context("orders.created");

describe("compose", () => {
  it("runs the endpoint alone when there is no middleware", async () => {
    const seen: string[] = [];
    const endpoint = () => {
      seen.push("endpoint");
      return Promise.resolve();
    };
    assert.equal(compose([], endpoint), endpoint);
    await compose([], endpoint)(ctx());
    assert.deepEqual(seen, ["endpoint"]);
  });

  it("runs the middlewares in order, around the endpoint", async () => {
    const seen: string[] = [];
    const mw = (name: string): ChoMessageMiddlewareFn => async (_ctx, next) => {
      seen.push(`${name} in`);
      await next();
      seen.push(`${name} out`);
    };
    await compose([mw("a"), mw("b")], () => {
      seen.push("endpoint");
      return Promise.resolve();
    })(ctx());
    assert.deepEqual(seen, ["a in", "b in", "endpoint", "b out", "a out"]);
  });

  it("gives every middleware and the endpoint the same context", async () => {
    const context = ctx();
    const seen: unknown[] = [];
    await compose(
      [(c, next) => {
        seen.push(c);
        c.state.set("user", "ada");
        return next();
      }],
      (c) => {
        seen.push(c, c.state.get("user"));
        return Promise.resolve();
      },
    )(context);
    assert.deepEqual(seen, [context, context, "ada"]);
  });

  it("skips the endpoint when a middleware returns without calling next()", async () => {
    const seen: string[] = [];
    await compose(
      [
        (_ctx, next) => {
          seen.push("a");
          return next();
        },
        () => {
          seen.push("b drops");
        },
        (_ctx, next) => {
          seen.push("c");
          return next();
        },
      ],
      () => {
        seen.push("endpoint");
        return Promise.resolve();
      },
    )(ctx());
    assert.deepEqual(seen, ["a", "b drops"]);
  });

  it("ignores what a middleware returns", async () => {
    let ran = false;
    await compose(
      [async (_ctx, next) => {
        await next();
        return "ignored";
      }],
      () => {
        ran = true;
        return Promise.resolve();
      },
    )(ctx());
    assert.equal(ran, true);
  });

  it("waits for the rest of the chain, even when a middleware does not", async () => {
    let done = false;
    await compose(
      [(_ctx, next) => {
        next(); // not awaited, not returned
      }],
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        done = true;
      },
    )(ctx());
    assert.equal(done, true);
  });

  it("rejects with the error of the endpoint", async () => {
    const failure = new Error("no database");
    await assert.rejects(
      compose([(_ctx, next) => next()], () => Promise.reject(failure))(ctx()),
      (error) => error === failure,
    );
  });

  it("rejects with the error of a middleware", async () => {
    const failure = new Error("denied");
    let ran = false;
    await assert.rejects(
      compose(
        [() => {
          throw failure;
        }],
        () => {
          ran = true;
          return Promise.resolve();
        },
      )(ctx()),
      (error) => error === failure,
    );
    assert.equal(ran, false);
  });

  it("lets a middleware see the error of the rest of the chain", async () => {
    const failure = new Error("no database");
    let caught: unknown;
    await assert.rejects(
      compose(
        [async (_ctx, next) => {
          try {
            await next();
          } catch (error) {
            caught = error;
            throw error;
          }
        }],
        () => Promise.reject(failure),
      )(ctx()),
    );
    assert.equal(caught, failure);
  });

  it("does not let a middleware hide the failure of the rest of the chain", async () => {
    const failure = new Error("no database");
    await assert.rejects(
      compose(
        [async (_ctx, next) => {
          try {
            await next();
          } catch {
            // swallowed: the message failed all the same
          }
        }],
        () => Promise.reject(failure),
      )(ctx()),
      (error) => error === failure,
    );
  });

  it("rejects the error a middleware throws after the rest has failed", async () => {
    const mine = new Error("mine");
    await assert.rejects(
      compose(
        [async (_ctx, next) => {
          await next().catch(() => {});
          throw mine;
        }],
        () => Promise.reject(new Error("theirs")),
      )(ctx()),
      (error) => error === mine,
    );
  });

  it("fails the message when a middleware calls next() twice", async () => {
    let runs = 0;
    async function twice(_ctx: unknown, next: () => Promise<void>) {
      await next();
      await next();
    }
    await assert.rejects(
      compose([twice], () => {
        runs++;
        return Promise.resolve();
      })(ctx()),
      {
        code: "CHO_CORE_NEXT_CALLED_TWICE",
        message: "middleware twice: next() called more than once",
      },
    );
    assert.equal(runs, 1);
  });

  it("runs each message on its own", async () => {
    const run = compose([(_ctx, next) => next()], () => Promise.resolve());
    await run(ctx());
    await run(ctx()); // next() of the second message is its first call
  });
});
