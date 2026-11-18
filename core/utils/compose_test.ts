/**
 * Tests for `compose.ts`: running middlewares around an endpoint, for any
 * context and result (here the result is a number), and for a chain that has
 * no result.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compose,
  type MiddlewareFn,
  type VoidMiddlewareFn,
} from "./compose.ts";
import { loose } from "./test_utils.ts";

type Ctx = { log: string[] };
type Mw = MiddlewareFn<Ctx, number>;

const KIND = {
  is: (value: unknown): value is number => typeof value === "number",
  name: "an exit code",
  noun: "exit code",
};
const ctx = (): Ctx => ({ log: [] });
const endpoint = (c: Ctx) => {
  c.log.push("end");
  return Promise.resolve(0);
};
const run = (middlewares: Mw[], c = ctx(), end = endpoint) =>
  compose(middlewares, end, KIND)(c);

describe("compose", () => {
  it("is the endpoint itself without middlewares", () => {
    assert.equal(compose([], endpoint, KIND), endpoint);
  });

  it("runs the middlewares in order, around the endpoint", async () => {
    const mw = (name: string): Mw => async (c, next) => {
      c.log.push(`${name} in`);
      const result = await next();
      c.log.push(`${name} out`);
      return result;
    };
    const c = ctx();
    assert.equal(await run([mw("a"), mw("b")], c), 0);
    assert.deepEqual(c.log, ["a in", "b in", "end", "b out", "a out"]);
  });

  it("lets a middleware end the chain without calling next", async () => {
    const c = ctx();
    assert.equal(await run([() => 3], c), 3);
    assert.deepEqual(c.log, []);
  });

  it("lets a middleware replace the result", async () => {
    assert.equal(await run([async (_c, next) => (await next()) + 5]), 5);
  });

  it("recognizes a result with `is`: 0 is one", async () => {
    assert.equal(await run([() => 0]), 0);
  });

  it("passes the result on when a middleware returns nothing after next", async () => {
    const quiet: Mw = async (_c, next) => {
      await next();
    };
    assert.equal(await run([quiet]), 0);
  });

  it("rejects when a middleware returns nothing without calling next", async () => {
    const lost: Mw = function lost() {};
    await assert.rejects(run([lost]), {
      code: "CHO_CORE_MISSING_MIDDLEWARE_RESULT",
      message:
        "middleware lost returned no exit code: return an exit code or call next()",
    });
  });

  it("rejects when a middleware returns anything but a result", async () => {
    const wrong: Mw = loose(function wrong() {
      return "1";
    });
    await assert.rejects(run([wrong]), {
      code: "CHO_CORE_INVALID_MIDDLEWARE_RESULT",
      message:
        "middleware wrong must return an exit code or nothing, got string",
    });
  });

  it("rejects when next is called twice", async () => {
    const twice: Mw = async function twice(_c, next) {
      await next();
      return next();
    };
    await assert.rejects(run([twice]), {
      code: "CHO_CORE_NEXT_CALLED_TWICE",
      message: "middleware twice: next() called more than once",
    });
  });

  it("rejects with the error of a middleware or of the endpoint", async () => {
    const pass: Mw = (_c, next) => next();
    const fail: Mw = () => {
      throw new Error("mw");
    };
    await assert.rejects(run([pass, fail]), { message: "mw" });
    await assert.rejects(
      run([pass], ctx(), () => Promise.reject(new Error("end"))),
      { message: "end" },
    );
  });

  it("lets a middleware recover from an error down the chain", async () => {
    const recover: Mw = async (_c, next) => {
      try {
        return await next();
      } catch {
        return 9;
      }
    };
    assert.equal(
      await run([recover], ctx(), () => Promise.reject(new Error("end"))),
      9,
    );
  });

  it("does not leave an unhandled rejection when next is not awaited", async () => {
    const eager: Mw = (_c, next) => {
      next(); // not awaited, and it fails
      return 4;
    };
    assert.equal(
      await run([eager], ctx(), () => Promise.reject(new Error("end"))),
      4,
    );
  });
});

describe("compose, without a result", () => {
  type Step = VoidMiddlewareFn<Ctx>;
  const done = (c: Ctx) => {
    c.log.push("end");
    return Promise.resolve();
  };
  const go = (middlewares: Step[], c = ctx(), end = done) =>
    compose(middlewares, end)(c);

  it("is the endpoint itself without middlewares", () => {
    assert.equal(compose([], done), done);
  });

  it("runs the middlewares in order, around the endpoint", async () => {
    const mw = (name: string): Step => async (c, next) => {
      c.log.push(`${name} in`);
      await next();
      c.log.push(`${name} out`);
    };
    const c = ctx();
    assert.equal(await go([mw("a"), mw("b")], c), undefined);
    assert.deepEqual(c.log, ["a in", "b in", "end", "b out", "a out"]);
  });

  it("ends the chain when a middleware returns without calling next", async () => {
    const c = ctx();
    await go(
      [
        (c, next) => {
          c.log.push("a");
          return next();
        },
        (c) => {
          c.log.push("b stops");
        },
        (c, next) => {
          c.log.push("c");
          return next();
        },
      ],
      c,
    );
    assert.deepEqual(c.log, ["a", "b stops"]);
  });

  it("ignores what a middleware returns", async () => {
    for (const returned of [0, "text", {}, null, false]) {
      const c = ctx();
      // returned without next: the chain ends, whatever the value
      assert.equal(await go([() => returned], c), undefined);
      assert.deepEqual(c.log, []);
      // returned after next: the chain went on
      assert.equal(
        await go([async (_c, next) => {
          await next();
          return returned;
        }], c),
        undefined,
      );
      assert.deepEqual(c.log, ["end"]);
    }
  });

  it("waits for the rest of the chain, even when a middleware does not", async () => {
    const c = ctx();
    await go(
      [(_c, next) => {
        next(); // not awaited, not returned
      }],
      c,
      async (c) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        c.log.push("end");
      },
    );
    assert.deepEqual(c.log, ["end"]);
  });

  it("rejects when next is called twice", async () => {
    async function twice(_c: Ctx, next: () => Promise<void>) {
      await next();
      await next();
    }
    const c = ctx();
    await assert.rejects(go([twice], c), {
      code: "CHO_CORE_NEXT_CALLED_TWICE",
      message: "middleware twice: next() called more than once",
    });
    assert.deepEqual(c.log, ["end"]);
  });

  it("rejects with the error of a middleware or of the endpoint", async () => {
    const boom = new Error("boom");
    await assert.rejects(
      go([() => {
        throw boom;
      }]),
      (error) => error === boom,
    );
    await assert.rejects(
      go([(_c, next) => next()], ctx(), () => Promise.reject(boom)),
      (error) => error === boom,
    );
  });

  it("does not let a middleware hide an error down the chain", async () => {
    const boom = new Error("boom");
    let caught: unknown;
    await assert.rejects(
      go(
        [async (_c, next) => {
          try {
            await next();
          } catch (error) {
            caught = error; // seen, and swallowed
          }
        }],
        ctx(),
        () => Promise.reject(boom),
      ),
      (error) => error === boom,
    );
    assert.equal(caught, boom);
  });

  it("rejects with the error a middleware throws in place of one down the chain", async () => {
    const mine = new Error("mine");
    await assert.rejects(
      go(
        [async (_c, next) => {
          await next().catch(() => {});
          throw mine;
        }],
        ctx(),
        () => Promise.reject(new Error("theirs")),
      ),
      (error) => error === mine,
    );
  });

  it("does not leave an unhandled rejection when next is not awaited", async () => {
    await assert.rejects(
      go(
        [(_c, next) => {
          next();
        }],
        ctx(),
        () => Promise.reject(new Error("late")),
      ),
      { message: "late" },
    );
  });
});
