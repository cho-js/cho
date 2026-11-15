/**
 * Tests for `build-graph.ts` and `routes.ts`: the pipeline of a message, end
 * to end, through `ChoMessage.create` and `handle`, so without any broker.
 *
 * Decorators are applied as plain function calls, so the tests run on every
 * runtime.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Injectable } from "@chojs/core/di";
import { capture, legacy, loose } from "@chojs/core/utils/test_utils";
import type { ChoMessageContext } from "./context.ts";
import {
  Catch,
  Controller,
  Middlewares,
  Module,
  Subscribe,
} from "./decorators.ts";
import { ChoMessage } from "./message.ts";
import type { ChoMessageMiddlewareFn } from "./types.ts";

type Class = new (...args: never[]) => object;

/** A controller with one handler, on `<topic>`. */
function controller(
  topic: string,
  handler: (ctx: ChoMessageContext) => unknown = () => {},
) {
  class Ctrl {
    run(ctx: ChoMessageContext) {
      return handler(ctx);
    }
  }
  legacy(Subscribe(""), Ctrl, "run");
  Controller({ topic })(Ctrl);
  return Ctrl;
}

/** A module declaring the given controllers. */
function module_of(
  controllers: Class[],
  topic?: string,
  imports: Class[] = [],
) {
  class Mod {}
  Module(
    loose({ controllers, imports, ...(topic === undefined ? {} : { topic }) }),
  )(Mod);
  return Mod;
}

/** A middleware that records its name, then runs the rest of the chain. */
function recorder(seen: string[]) {
  return (name: string): ChoMessageMiddlewareFn => async (ctx, next) => {
    seen.push(`${name} ${ctx.topic}`);
    await next();
  };
}

describe("topics", () => {
  it("joins the prefix, the feature, the controller and the handler with dots", async () => {
    class Orders {
      created() {}
      all() {}
    }
    legacy(Subscribe("created"), Orders, "created");
    legacy(Subscribe(""), Orders, "all");
    Controller({ topic: "orders" })(Orders);
    const app = await ChoMessage.create(module_of([Orders], "shop"), {
      prefix: "staging",
    });
    assert.deepEqual(
      app.routes.map((route) => [route.topic, route.name]),
      [
        ["staging.shop.orders.created", "Orders.created"],
        ["staging.shop.orders", "Orders.all"],
      ],
    );
  });

  it("skips the levels that are missing", async () => {
    class Orders {
      created() {}
    }
    legacy(Subscribe("orders.created"), Orders, "created");
    Controller()(Orders);
    const app = await ChoMessage.create(module_of([Orders]));
    assert.deepEqual(app.routes.map((route) => route.topic), [
      "orders.created",
    ]);
  });

  it("trims the topics", async () => {
    const app = await ChoMessage.create(
      module_of([controller("  orders ")], " shop "),
      { prefix: " staging " },
    );
    assert.equal(app.routes[0]!.topic, "staging.shop.orders");
  });

  it("mounts every feature at the root, whatever imports it", async () => {
    const inner = module_of([controller("payments")], "billing");
    const app = await ChoMessage.create(
      module_of([controller("orders")], "shop", [inner]),
    );
    assert.deepEqual(app.routes.map((route) => route.topic).sort(), [
      "billing.payments",
      "shop.orders",
    ]);
  });

  it("leaves out a controller without a handler, and its module", async () => {
    const created: string[] = [];
    class Plain {
      constructor() {
        created.push("Plain");
      }
      helper() {}
    }
    Controller()(Plain);
    class Guard {
      handle() {
        created.push("Guard.handle");
      }
    }
    Injectable()(Guard);
    class Other {}
    Module(loose({ providers: [Guard], controllers: [Plain], topic: "*" }))(
      Other,
    );
    Middlewares(Guard)(Other);

    const app = await ChoMessage.create(
      module_of([controller("orders")], undefined, [Other]),
    );
    // its invalid topic is not read, and its middleware is not part of anything
    assert.deepEqual(app.routes.map((route) => route.topic), ["orders"]);
    assert.equal(app.graph.features.length, 1);
    await app.handle("orders");
    assert.deepEqual(created, ["Plain"]);
  });

  it("gives an inherited handler to the controller that inherits it", async () => {
    const seen: string[] = [];
    class Base {
      created(ctx: ChoMessageContext) {
        seen.push(`${this.constructor.name} ${ctx.topic}`);
      }
    }
    legacy(Subscribe("created"), Base, "created");
    class Orders extends Base {}
    Controller({ topic: "orders" })(Orders);
    const app = await ChoMessage.create(module_of([Orders]));
    await app.handle("orders.created");
    assert.deepEqual(seen, ["Orders orders.created"]);
  });

  it("rejects an invalid topic at any level, before anything is created", async () => {
    const created: string[] = [];
    class Orders {
      constructor() {
        created.push("Orders");
      }
      run() {}
    }
    legacy(Subscribe(""), Orders, "run");
    Controller(loose({ topic: "orders/created" }))(Orders);
    await assert.rejects(
      ChoMessage.create(module_of([Orders])),
      {
        message:
          'Invalid topic "orders/created" of controller Orders: "orders/created" is not a valid segment: write letters, digits, "_" and "-"',
      },
    );

    await assert.rejects(
      ChoMessage.create(module_of([controller("orders")], "shop.")),
      {
        message:
          'Invalid topic "shop." of feature Mod: it must not start or end with "."',
      },
    );
    await assert.rejects(
      ChoMessage.create(module_of([controller("orders")]), {
        prefix: "staging.*",
      }),
      {
        message:
          'Invalid topic "staging.*" of the global prefix: "*" has a "*": wildcards are not part of the topic syntax',
      },
    );
    await assert.rejects(
      ChoMessage.create(module_of([controller("orders")]), {
        prefix: loose(7),
      }),
      {
        name: "TypeError",
        message: "Invalid topic of the global prefix: expected a string, got 7",
      },
    );
  });

  it("rejects a handler whose topic is empty", async () => {
    await assert.rejects(ChoMessage.create(module_of([controller("")])), {
      message:
        "Invalid topic of Ctrl.run: it is empty. Give @Subscribe(), its controller or its module a topic",
    });
    // any level is enough
    await ChoMessage.create(module_of([controller("")], "shop"));
    await ChoMessage.create(module_of([controller("")]), { prefix: "shop" });
  });

  it("rejects two handlers with the same topic", async () => {
    class Orders {
      created() {}
    }
    legacy(Subscribe("orders.created"), Orders, "created");
    Controller()(Orders);
    class Audit {
      log() {}
    }
    legacy(Subscribe("created"), Audit, "log");
    Controller({ topic: "orders" })(Audit);
    await assert.rejects(ChoMessage.create(module_of([Orders, Audit])), {
      message:
        'Duplicate topic "orders.created": declared by Orders.created and Audit.log',
    });
  });

  it("says so when one controller is declared by two modules", async () => {
    const Ctrl = controller("orders");
    await assert.rejects(
      ChoMessage.create(module_of([Ctrl], undefined, [module_of([Ctrl])])),
      {
        message:
          'Duplicate topic "orders": declared by Ctrl.run and Ctrl.run. Its controller is declared in more than one module: declare it in one.',
      },
    );
  });
});

describe("handlers", () => {
  it("runs the handler on its controller, with the context of the message", async () => {
    const seen: unknown[] = [];
    class Store {
      readonly name = "store";
    }
    Injectable()(Store);
    class Orders {
      constructor(readonly store: Store) {}
      created(ctx: ChoMessageContext) {
        seen.push(this.store.name, ctx.topic, ctx.key, ctx.json(), ctx.headers);
      }
    }
    legacy(Subscribe("created"), Orders, "created");
    Controller({ topic: "orders", dependencies: [Store] })(Orders);
    class App {}
    Module({ providers: [Store], controllers: [Orders] })(App);

    const app = await ChoMessage.create(App);
    await app.handle("orders.created", {
      value: '{"id":"42"}',
      key: "42",
      headers: { "message-id": "abc" },
    });
    assert.deepEqual(seen, [
      "store",
      "orders.created",
      "42",
      { id: "42" },
      { "message-id": "abc" },
    ]);
  });

  it("waits for an async handler", async () => {
    let done = false;
    const app = await ChoMessage.create(module_of([
      controller("orders", async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        done = true;
      }),
    ]));
    await app.handle("orders");
    assert.equal(done, true);
  });

  it("ignores what the handler returns", async () => {
    const app = await ChoMessage.create(module_of([
      controller("orders", () => ({ status: "done" })),
    ]));
    assert.equal(await app.handle("orders"), undefined);
  });

  it("passes the adapter's own message on, as native", async () => {
    let native: unknown;
    const app = await ChoMessage.create(module_of([
      controller("orders", (ctx) => {
        native = ctx.native;
      }),
    ]));
    const message = { partition: 2, offset: "7" };
    await app.routes[0]!.handle({ value: "x" }, message);
    assert.equal(native, message);
  });

  it("fails the message with the error of the handler", async () => {
    const failure = new Error("no database");
    const app = await ChoMessage.create(module_of([
      controller("orders", () => {
        throw failure;
      }),
    ]));
    await assert.rejects(app.handle("orders"), (error) => error === failure);
  });

  it("fails the message whose value cannot be read", async () => {
    const app = await ChoMessage.create(module_of([
      controller("orders", (ctx) => ctx.json()),
    ]));
    await assert.rejects(app.handle("orders", { value: "{" }), SyntaxError);
    await assert.rejects(
      app.handle("orders", { value: loose(42) }),
      TypeError,
    );
  });
});

describe("middlewares", () => {
  it("runs the feature's, then the controller's, then the handler's", async () => {
    const seen: string[] = [];
    const mw = recorder(seen);
    class Orders {
      created() {
        seen.push("handler");
      }
    }
    legacy(Middlewares(mw("method")), Orders, "created");
    legacy(Subscribe("created"), Orders, "created");
    Middlewares(mw("controller-1"), mw("controller-2"))(Orders);
    Controller({ topic: "orders" })(Orders);
    const App = module_of([Orders]);
    Middlewares(mw("feature"))(App);

    const app = await ChoMessage.create(App);
    await app.handle("orders.created");
    assert.deepEqual(seen, [
      "feature orders.created",
      "controller-1 orders.created",
      "controller-2 orders.created",
      "method orders.created",
      "handler",
    ]);
  });

  it("keeps the middlewares of a controller to its own handlers", async () => {
    const seen: string[] = [];
    const mw = recorder(seen);
    const A = controller("a");
    Middlewares(mw("A"))(A);
    const B = controller("b");
    const app = await ChoMessage.create(module_of([A, B]));
    await app.handle("b");
    assert.deepEqual(seen, []);
    await app.handle("a");
    assert.deepEqual(seen, ["A a"]);
  });

  it("drops the message of a middleware that does not call next()", async () => {
    let ran = false;
    const Ctrl = controller("orders", () => {
      ran = true;
    });
    Middlewares((ctx) => {
      ctx.state.set("dropped", true);
    })(Ctrl);
    const app = await ChoMessage.create(module_of([Ctrl]));
    await app.handle("orders"); // handled: it resolves
    assert.equal(ran, false);
  });

  it("shares the state between the middlewares and the handler", async () => {
    let user: unknown;
    const Ctrl = controller("orders", (ctx) => {
      user = ctx.state.get("user");
    });
    Middlewares((ctx, next) => {
      ctx.state.set("user", ctx.headers["user"]);
      return next();
    })(Ctrl);
    const app = await ChoMessage.create(module_of([Ctrl]));
    await app.handle("orders", { headers: { user: "ada" } });
    assert.equal(user, "ada");
  });

  it("creates a middleware class with the injector, in the feature's scope", async () => {
    const seen: string[] = [];
    class Log {
      readonly lines = seen;
    }
    Injectable()(Log);
    class Audit {
      constructor(readonly log: Log) {}
      async handle(ctx: ChoMessageContext, next: () => Promise<void>) {
        this.log.lines.push(`audit ${ctx.topic}`);
        await next();
      }
    }
    Injectable([Log])(Audit);
    const Ctrl = controller("orders", () => {
      seen.push("handler");
    });
    Middlewares(Audit)(Ctrl);
    class App {}
    Module({ providers: [Log, Audit], controllers: [Ctrl] })(App);

    const app = await ChoMessage.create(App);
    await app.handle("orders");
    assert.deepEqual(seen, ["audit orders", "handler"]);
  });

  it("rejects a middleware class without a handle method, or that cannot be created", async () => {
    class NoHandle {}
    Injectable()(NoHandle);
    const A = controller("a");
    Middlewares(loose(NoHandle))(A);
    class AppA {}
    Module({ providers: [NoHandle], controllers: [A] })(AppA);
    await assert.rejects(ChoMessage.create(AppA), {
      message: "Middleware class NoHandle must implement 'handle' method.",
    });

    class Missing {
      handle() {}
    }
    Injectable()(Missing);
    const B = controller("b");
    Middlewares(Missing)(B);
    await assert.rejects(ChoMessage.create(module_of([B])), {
      message: "Failed to create middleware Missing in module Mod",
    });
  });

  it("fails the message when a middleware calls next() twice", async () => {
    const Ctrl = controller("orders");
    Middlewares(async function twice(_ctx, next) {
      await next();
      await next();
    })(Ctrl);
    const app = await ChoMessage.create(module_of([Ctrl]));
    await assert.rejects(app.handle("orders"), {
      message: "middleware twice: next() called more than once",
    });
  });
});

describe("error handlers", () => {
  /** An app whose handler fails, with error handlers at the given levels. */
  function failing(
    levels: { method?: unknown; controller?: unknown; feature?: unknown },
    failure: unknown = new Error("boom"),
  ) {
    class Orders {
      created() {
        throw failure;
      }
    }
    if ("method" in levels) {
      legacy(Catch(loose(levels.method)), Orders, "created");
    }
    legacy(Subscribe("created"), Orders, "created");
    if ("controller" in levels) {
      Catch(loose(levels.controller))(Orders);
    }
    Controller({ topic: "orders" })(Orders);
    const App = module_of([Orders]);
    if ("feature" in levels) {
      Catch(loose(levels.feature))(App);
    }
    return App;
  }

  it("gives the error to the nearest handler, with the context", async () => {
    const seen: string[] = [];
    const tag = (name: string) => (error: Error, ctx: ChoMessageContext) => {
      seen.push(`${name}: ${error.message} ${ctx.topic}`);
      return true;
    };
    const all = {
      method: tag("method"),
      controller: tag("controller"),
      feature: tag("feature"),
    };
    const options = { onError: loose(tag("application")) };

    await (await ChoMessage.create(failing(all), options)).handle(
      "orders.created",
    );
    await (await ChoMessage.create(
      failing({ controller: all.controller, feature: all.feature }),
      options,
    )).handle("orders.created");
    await (await ChoMessage.create(failing({ feature: all.feature }), options))
      .handle("orders.created");
    await (await ChoMessage.create(failing({}), options)).handle(
      "orders.created",
    );
    assert.deepEqual(seen, [
      "method: boom orders.created",
      "controller: boom orders.created",
      "feature: boom orders.created",
      "application: boom orders.created",
    ]);
  });

  it("settles the message as handled when the handler returns true", async () => {
    const app = await ChoMessage.create(failing({ method: () => true }));
    assert.equal(await app.handle("orders.created"), undefined);
    const async_app = await ChoMessage.create(
      failing({ method: () => Promise.resolve(true) }),
    );
    await async_app.handle("orders.created");
  });

  it("leaves the message failed when the handler returns anything else", async () => {
    const failure = new Error("boom");
    for (const returned of [undefined, null, false, 1, "true", {}]) {
      const app = await ChoMessage.create(
        failing({ method: () => returned }, failure),
      );
      await assert.rejects(
        app.handle("orders.created"),
        (error) => error === failure,
        `returned ${String(returned)}`,
      );
    }
  });

  it("does not fall back to an outer handler", async () => {
    let outer = 0;
    const app = await ChoMessage.create(
      failing({
        method: () => {},
        controller: () => {
          outer++;
          return true;
        },
      }),
    );
    await assert.rejects(app.handle("orders.created"));
    assert.equal(outer, 0);
  });

  it("fails the message with its own error when the handler throws, and logs what it threw", async () => {
    const failure = new Error("boom");
    const second = new Error("the error handler broke");
    const app = await ChoMessage.create(
      failing({
        method: () => {
          throw second;
        },
      }, failure),
    );
    const { output } = await capture(() =>
      assert.rejects(app.handle("orders.created"), (error) => error === failure)
    );
    assert.deepEqual(output.error, [
      "The error handler of Orders.created failed:",
      second,
    ]);
  });

  it("handles the error of a middleware too", async () => {
    const seen: unknown[] = [];
    const failure = new Error("denied");
    const Ctrl = controller("orders");
    Middlewares(() => {
      throw failure;
    })(Ctrl);
    Catch((error) => {
      seen.push(error);
      return true;
    })(Ctrl);
    const app = await ChoMessage.create(module_of([Ctrl]));
    await app.handle("orders");
    assert.deepEqual(seen, [failure]);
  });

  it("creates an error handler class with the injector", async () => {
    const seen: string[] = [];
    class Report {
      handle(error: unknown, ctx: ChoMessageContext) {
        seen.push(`${ctx.topic}: ${(error as Error).message}`);
        return true;
      }
    }
    Injectable()(Report);
    const Ctrl = controller("orders", () => {
      throw new Error("boom");
    });
    Catch(Report)(Ctrl);
    class App {}
    Module({ providers: [Report], controllers: [Ctrl] })(App);
    const app = await ChoMessage.create(App);
    await app.handle("orders");
    assert.deepEqual(seen, ["orders: boom"]);
  });

  it("rejects an error handler that is neither a function nor a class with handle", async () => {
    await assert.rejects(
      ChoMessage.create(module_of([controller("orders")]), {
        onError: loose("nope"),
      }),
      {
        message:
          `Invalid error handler "nope": must be a function or a class with a 'handle' method.`,
      },
    );
    class Missing {
      handle() {}
    }
    Injectable()(Missing);
    const Ctrl = controller("orders");
    Catch(Missing)(Ctrl);
    await assert.rejects(ChoMessage.create(module_of([Ctrl])), {
      message: "Failed to create error handler Missing in module Mod",
    });
  });
});
