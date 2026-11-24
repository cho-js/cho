/**
 * Tests for the middlewares of an application: the `middlewares` option of
 * `ChoMessage.create` and of `ChoMessage.from`. They are the first of the
 * chain of every handler.
 *
 * Decorators are applied as plain function calls, so the tests run on every
 * runtime. Messages are delivered by hand, with `app.handle`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Injectable, Injector } from "@chojs/core/di";
import { capture, legacy, loose } from "@chojs/core/utils/test_utils";
import type { ChoMessageContext } from "./context.ts";
import {
  Catch,
  Controller,
  Middlewares,
  Module,
  Subscribe,
} from "./decorators.ts";
import { ChoMessage, type ChoMessageOptions } from "./message.ts";
import type { ChoMessageMiddlewareFn, ChoMessageNext } from "./types.ts";
import { validate } from "./validate.ts";

type Class = new (...args: never[]) => object;

/** A middleware that records its name and the topic, around the rest. */
const record = (seen: string[], name: string): ChoMessageMiddlewareFn =>
async (
  ctx,
  next,
) => {
  seen.push(`${name} in ${ctx.topic}`);
  await next();
  seen.push(`${name} out`);
};

/**
 * An application with two controllers, in two modules: `orders.created`,
 * which says what the middlewares left in the state, and `mail.sent`, which
 * fails.
 */
function shop(decorate: { orders?: (ctrl: Class) => void } = {}): Class {
  class Orders {
    created(ctx: ChoMessageContext) {
      return { user: ctx.state.get("user") ?? null };
    }
  }
  legacy(Subscribe("created"), Orders, "created");
  decorate.orders?.(Orders);
  Controller({ topic: "orders" })(Orders);
  class OrdersModule {}
  Module({ controllers: [Orders] })(OrdersModule);

  class Mail {
    sent() {
      throw new Error("the mail is down");
    }
  }
  legacy(Subscribe("sent"), Mail, "sent");
  Controller({ topic: "mail" })(Mail);
  class App {}
  Module({ imports: [OrdersModule], controllers: [Mail] })(App);
  return App;
}

/** The reply of a message, as a value. */
async function reply_of(
  app: ChoMessage<unknown>,
  topic: string,
): Promise<unknown> {
  const reply = await app.handle(topic, { value: "{}" });
  return reply && JSON.parse(new TextDecoder().decode(reply.value));
}

describe("the middlewares of a message application", () => {
  it("run for every message, of every module, in order", async () => {
    const seen: string[] = [];
    const app = await ChoMessage.create(shop(), {
      middlewares: [record(seen, "a"), record(seen, "b")],
    });
    await app.handle("orders.created", { value: "{}" });
    await capture(() =>
      assert.rejects(app.handle("mail.sent", { value: "{}" }), {
        message: "the mail is down",
      })
    );
    assert.deepEqual(seen, [
      "a in orders.created",
      "b in orders.created",
      "b out",
      "a out",
      // a message that fails: `next()` rejects, and nothing runs after it
      "a in mail.sent",
      "b in mail.sent",
    ]);
    await app.close();
  });

  it("run before the middlewares of the feature, the controller and the handler", async () => {
    const seen: string[] = [];
    const app = await ChoMessage.create(
      shop({ orders: (ctrl) => Middlewares(record(seen, "controller"))(ctrl) }),
      { middlewares: [record(seen, "app")] },
    );
    await app.handle("orders.created", { value: "{}" });
    assert.deepEqual(seen, [
      "app in orders.created",
      "controller in orders.created",
      "controller out",
      "app out",
    ]);
    await app.close();
  });

  it("share the context of the message with its handler", async () => {
    const app = await ChoMessage.create(shop(), {
      middlewares: [(ctx, next) => {
        ctx.state.set("user", "ada");
        return next();
      }],
    });
    assert.deepEqual(await reply_of(app, "orders.created"), { user: "ada" });
    await app.close();
  });

  it("skip the handler when one returns without next()", async () => {
    const app = await ChoMessage.create(shop(), { middlewares: [() => {}] });
    assert.equal(await reply_of(app, "orders.created"), undefined);
    // also the handler that fails: it is not called
    assert.equal(await app.handle("mail.sent", { value: "{}" }), undefined);
    await app.close();
  });

  it("give an error they throw to the error handlers, like any middleware", async () => {
    const errors: unknown[] = [];
    const app = await ChoMessage.create(
      shop({
        orders: (ctrl) =>
          Catch((error) => {
            errors.push((error as Error).message);
            return true;
          })(ctrl),
      }),
      {
        middlewares: [() => {
          throw new Error("no tenant");
        }],
      },
    );
    await capture(() => app.handle("orders.created", { value: "{}" }));
    assert.deepEqual(errors, ["no tenant"]);
    await app.close();
  });

  it("can be a class, created in the scope of the root module", async () => {
    class Names {
      readonly user = "grace";
    }
    Injectable()(Names);
    class SetUser {
      constructor(readonly names: Names) {}
      handle(ctx: ChoMessageContext, next: ChoMessageNext) {
        ctx.state.set("user", this.names.user);
        return next();
      }
    }
    Injectable([Names])(SetUser);
    class Orders {
      created(ctx: ChoMessageContext) {
        return { user: ctx.state.get("user") };
      }
    }
    legacy(Subscribe("orders"), Orders, "created");
    Controller()(Orders);
    class App {}
    Module({ providers: [Names, SetUser], controllers: [Orders] })(App);

    const app = await ChoMessage.create(App, { middlewares: [SetUser] });
    assert.deepEqual(await reply_of(app, "orders"), { user: "grace" });
    assert.equal(app.graph.middlewares.length, 1);
    assert.equal(typeof app.graph.middlewares[0], "function");
    await app.close();
  });

  it("are an option of from() too", async () => {
    const seen: string[] = [];
    const injector = new Injector(shop());
    await injector.init();
    const app = await ChoMessage.from(injector, {
      middlewares: [record(seen, "app")],
    });
    await app.handle("orders.created", { value: "{}" });
    assert.deepEqual(seen, ["app in orders.created", "app out"]);
    await app.close();
    await injector.dispose();
  });

  it("are none by default", async () => {
    const app = await ChoMessage.create(shop());
    assert.deepEqual(app.graph.middlewares, []);
    assert.deepEqual(await reply_of(app, "orders.created"), { user: null });
    await app.close();
  });
});

describe("the middlewares option of ChoMessage", () => {
  const create = (options: ChoMessageOptions) =>
    capture(() => ChoMessage.create(shop(), options));

  it("must be an array", async () => {
    await assert.rejects(create({ middlewares: loose(() => {}) }), {
      code: "CHO_MESSAGE_INVALID_ARGUMENT",
      message: /^ChoMessage: "middlewares" must be an array, got /,
    });
  });

  it("takes functions, and classes with a handle method", async () => {
    await assert.rejects(create({ middlewares: loose(["log"]) }), {
      code: "CHO_CORE_INVALID_MIDDLEWARE",
    });
  });

  it("does not take validate(): it covers handlers, not an application", async () => {
    await assert.rejects(create({ middlewares: [validate()] }), {
      code: "CHO_MESSAGE_INVALID_ARGUMENT",
      message:
        "ChoMessage: validate() is not a middleware of an application: it covers the handlers under it. Declare it with @Middlewares(validate()), on a handler, a controller or a feature module",
    });
  });

  it("rejects a class the root module cannot inject", async () => {
    class Hidden {
      handle(_ctx: ChoMessageContext, next: ChoMessageNext) {
        return next();
      }
    }
    Injectable()(Hidden);
    await assert.rejects(
      create({ middlewares: [Hidden] }),
      (error: Error & { code?: string; cause?: { code?: string } }) =>
        error.code === "CHO_MESSAGE_CREATE_FAILED" &&
        error.cause?.code === "CHO_CORE_NOT_VISIBLE",
    );
  });
});
