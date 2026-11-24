/**
 * Tests for `message.ts`: `ChoMessage.create` and `ChoMessage.from` build the
 * application and link it with the given linker, and `start`, `handle` and
 * `close` run it.
 *
 * A fake linker records what it is asked, so the tests need no broker.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Injectable, Injector, provider, token } from "@chojs/core/di";
import { capture, legacy, loose, with_env } from "@chojs/core/utils/test_utils";
import type { Ctr } from "@chojs/core/di";
import type { ChoMessageContext } from "./context.ts";
import { Controller, Module, Subscribe } from "./decorators.ts";
import type { Linked, Linker, Route } from "./linker.ts";
import { ChoMessage } from "./message.ts";

/** What the fake linker links: the routes, kept for the assertions. */
type Fake = { routes: readonly Route[] };

/** A linker that keeps the routes, and records its starts and stops. */
class FakeLinker implements Linker<Fake> {
  calls: (readonly Route[])[] = [];
  log: string[] = [];
  start = () => Promise.resolve();
  stop = () => Promise.resolve();
  link(routes: readonly Route[]): Linked<Fake> {
    this.calls.push(routes);
    return {
      instance: { routes },
      start: () => {
        this.log.push("start");
        return this.start();
      },
      stop: () => {
        this.log.push("stop");
        return this.stop();
      },
    };
  }
}

/** A promise, and what settles it. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/**
 * An app with a provider, `Db`, and one controller, `Orders`, with the
 * handler of `orders.created`.
 */
function orders_app(
  log: string[] = [],
  handler: (ctx: ChoMessageContext) => unknown = () => {},
) {
  class Db {
    constructor() {
      log.push("Db created");
    }
    [Symbol.asyncDispose]() {
      log.push("Db disposed");
      return Promise.resolve();
    }
  }
  Injectable()(Db);
  class Unused {
    constructor() {
      log.push("Unused created");
    }
  }
  Injectable()(Unused);
  class Orders {
    constructor(readonly db: Db) {}
    created(ctx: ChoMessageContext) {
      return handler(ctx);
    }
  }
  legacy(Subscribe("created"), Orders, "created");
  Controller({ topic: "orders", dependencies: [Db] })(Orders);
  class App {}
  Module({ providers: [Db, Unused], controllers: [Orders] })(App);
  return { App, Db, Orders };
}

describe("ChoMessage.create", () => {
  it("gives the application's routes to the linker, once", async () => {
    const linker = new FakeLinker();
    const app = await ChoMessage.create(orders_app().App, { linker });

    assert.equal(linker.calls.length, 1);
    const routes = linker.calls[0]!;
    assert.deepEqual(
      routes.map((route) => [route.topic, route.name]),
      [["orders.created", "Orders.created"]],
    );
    assert.equal(app.linked.instance.routes, routes);
    assert.equal(app.routes, routes);
  });

  it("does not connect: the linker is not started", async () => {
    const linker = new FakeLinker();
    await ChoMessage.create(orders_app().App, { linker });
    assert.deepEqual(linker.log, []);
  });

  it("creates every instance up front", async () => {
    const log: string[] = [];
    await ChoMessage.create(orders_app(log).App);
    assert.deepEqual(log.sort(), ["Db created", "Unused created"]);
  });

  it("exposes the graph and the injector", async () => {
    const { App, Db, Orders } = orders_app();
    const app = await ChoMessage.create(App, { prefix: "staging" });
    assert.equal(app.graph.topic, "staging");
    const controller = app.graph.features[0]!.controllers[0]!;
    assert.equal(controller.topic, "orders");
    assert.ok(controller.instance instanceof Orders);
    assert.deepEqual(
      controller.methods.map((method) => [method.name, method.topic]),
      [["created", "created"]],
    );
    assert.ok(app.injector instanceof Injector);
    assert.ok(await app.injector.resolve(Db) instanceof Db);
  });

  it("links to nothing without a linker", async () => {
    const app = await ChoMessage.create(orders_app().App);
    assert.equal(app.linked.instance, undefined);
    assert.equal(app.routes.length, 1);
  });

  it("accepts an application with no handler", async () => {
    class App {}
    Module()(App);
    const linker = new FakeLinker();
    const app = await ChoMessage.create(App, { linker });
    assert.deepEqual(app.routes, []);
    await app.start();
    await app.close();
  });

  it("replaces providers with the overrides", async () => {
    const NAME = token<string>("name");
    let seen: unknown;
    class Orders {
      constructor(readonly name: string) {}
      created() {
        seen = this.name;
      }
    }
    legacy(Subscribe("orders"), Orders, "created");
    Controller({ dependencies: [NAME] })(Orders);
    class App {}
    Module({
      providers: [provider({ provide: NAME, factory: () => "real" })],
      controllers: [Orders],
    })(App);

    const app = await ChoMessage.create(App, {
      overrides: [provider({ provide: NAME, factory: () => "fake" })],
    });
    await app.handle("orders");
    assert.equal(seen, "fake");
  });

  it("rejects an unknown option", async () => {
    await assert.rejects(
      ChoMessage.create(orders_app().App, loose({ linkers: [] })),
      {
        code: "CHO_CORE_UNKNOWN_OPTION",
        message:
          'ChoMessage.create(): unknown option "linkers". Known options: linker, middlewares, onError, overrides, prefix',
      },
    );
  });

  it("disposes what was created when the application cannot be created", async () => {
    const log: string[] = [];
    const { App } = orders_app(log);
    await assert.rejects(ChoMessage.create(App, { prefix: "staging." }), {
      code: "CHO_MESSAGE_INVALID_TOPIC",
    });
    assert.ok(log.includes("Db created"));
    assert.ok(log.includes("Db disposed"));
  });

  it("rejects when the linker cannot link, and disposes", async () => {
    const log: string[] = [];
    const failure = new Error("bad options");
    await assert.rejects(
      ChoMessage.create(orders_app(log).App, {
        linker: {
          link() {
            throw failure;
          },
        },
      }),
      (error) => error === failure,
    );
    assert.ok(log.includes("Db disposed"));
  });
});

describe("start", () => {
  it("starts the linker", async () => {
    const linker = new FakeLinker();
    const app = await ChoMessage.create(orders_app().App, { linker });
    await app.start();
    assert.deepEqual(linker.log, ["start"]);
  });

  it("starts once: a second call is the same start", async () => {
    const linker = new FakeLinker();
    const connected = deferred();
    linker.start = () => connected.promise;
    const app = await ChoMessage.create(orders_app().App, { linker });
    const first = app.start();
    const second = app.start();
    assert.equal(first, second);
    connected.resolve();
    await first;
    await app.start();
    assert.deepEqual(linker.log, ["start"]);
  });

  it("rejects when the broker cannot be reached, and keeps rejecting", async () => {
    const linker = new FakeLinker();
    const failure = new Error("connection refused");
    linker.start = () => Promise.reject(failure);
    const app = await ChoMessage.create(orders_app().App, { linker });
    await assert.rejects(app.start(), (error) => error === failure);
    await assert.rejects(app.start(), (error) => error === failure);
    assert.deepEqual(linker.log, ["start"]);
  });

  it("rejects when the linker throws", async () => {
    const linker = new FakeLinker();
    linker.start = () => {
      throw new Error("not a promise");
    };
    const app = await ChoMessage.create(orders_app().App, { linker });
    await assert.rejects(app.start(), { message: "not a promise" });
  });

  it("rejects without a linker", async () => {
    const app = await ChoMessage.create(orders_app().App);
    await assert.rejects(app.start(), {
      code: "CHO_MESSAGE_NO_LINKER",
      message:
        "ChoMessage.start(): the application has no linker. Give ChoMessage.create or ChoMessage.from a linker, such as KafkaLinker",
    });
  });
});

describe("handle", () => {
  it("gives the message to the handler of the topic, with no linker", async () => {
    const seen: unknown[] = [];
    const { App } = orders_app([], (ctx) => {
      seen.push(ctx.topic, ctx.key, ctx.text(), ctx.headers);
    });
    const app = await ChoMessage.create(App, { prefix: "staging" });
    await app.handle("staging.orders.created", {
      value: "hello",
      key: "k",
      headers: { a: "1" },
    });
    assert.deepEqual(seen, ["staging.orders.created", "k", "hello", {
      a: "1",
    }]);
  });

  it("takes a message with nothing", async () => {
    let value: Uint8Array | undefined;
    const { App } = orders_app([], (ctx) => {
      value = ctx.value;
    });
    const app = await ChoMessage.create(App);
    await app.handle("orders.created");
    assert.equal(value?.length, 0);
  });

  it("rejects with the error of a message that failed", async () => {
    const failure = new Error("boom");
    const { App } = orders_app([], () => {
      throw failure;
    });
    const app = await ChoMessage.create(App);
    await assert.rejects(
      app.handle("orders.created"),
      (error) => error === failure,
    );
  });

  it("resolves with the reply of the handler", async () => {
    const { App } = orders_app([], (ctx) => ({ id: ctx.text() }));
    const app = await ChoMessage.create(App);
    const reply = await app.handle("orders.created", { value: "42" });
    assert.equal(new TextDecoder().decode(reply?.value), '{"id":"42"}');
    // No reply for a handler that returns nothing.
    const quiet = await ChoMessage.create(orders_app().App);
    assert.equal(await quiet.handle("orders.created"), undefined);
  });

  it("gives the reply to the linker, through the routes it was given", async () => {
    const linker = new FakeLinker();
    const { App } = orders_app([], () => "pong");
    const app = await ChoMessage.create(App, { linker });
    const [route] = linker.calls[0]!;
    const reply = await route!.handle({ value: "ping" }, { from: "broker" });
    assert.equal(new TextDecoder().decode(reply?.value), "pong");
    await app.close();
  });

  it("rejects a topic that has no handler", async () => {
    const app = await ChoMessage.create(orders_app().App, {
      prefix: "staging",
    });
    await assert.rejects(app.handle("orders.created"), {
      code: "CHO_MESSAGE_UNKNOWN_TOPIC",
      message: 'ChoMessage.handle(): no handler for the topic "orders.created"',
    });
  });
});

describe("close", () => {
  it("stops the linker, then disposes the instances", async () => {
    const log: string[] = [];
    const linker = new FakeLinker();
    linker.stop = () => {
      log.push("linker stopped");
      return Promise.resolve();
    };
    const app = await ChoMessage.create(orders_app(log).App, { linker });
    await app.start();
    await app.close();
    assert.deepEqual(linker.log, ["start", "stop"]);
    assert.deepEqual(log.slice(-2), ["linker stopped", "Db disposed"]);
  });

  it("does not stop a linker that was not started", async () => {
    const log: string[] = [];
    const linker = new FakeLinker();
    const app = await ChoMessage.create(orders_app(log).App, { linker });
    await app.close();
    assert.deepEqual(linker.log, []);
    assert.ok(log.includes("Db disposed"));
  });

  it("closes once: a second call is the same close", async () => {
    const log: string[] = [];
    const linker = new FakeLinker();
    const app = await ChoMessage.create(orders_app(log).App, { linker });
    await app.start();
    const first = app.close();
    assert.equal(app.close(), first);
    await first;
    await app.close();
    assert.deepEqual(linker.log, ["start", "stop"]);
    assert.equal(log.filter((line) => line === "Db disposed").length, 1);
  });

  it("works with await using", async () => {
    const log: string[] = [];
    {
      await using app = await ChoMessage.create(orders_app(log).App);
      await app.handle("orders.created");
    }
    assert.ok(log.includes("Db disposed"));
  });

  it("waits for a start that is still connecting", async () => {
    const linker = new FakeLinker();
    const connected = deferred();
    linker.start = () => connected.promise;
    const app = await ChoMessage.create(orders_app().App, { linker });
    const starting = app.start();
    const closing = app.close();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(linker.log, ["start"]); // not stopped before it started
    connected.resolve();
    await starting;
    await closing;
    assert.deepEqual(linker.log, ["start", "stop"]);
  });

  it("stops a linker whose start failed", async () => {
    const linker = new FakeLinker();
    linker.start = () => Promise.reject(new Error("connection refused"));
    const app = await ChoMessage.create(orders_app().App, { linker });
    await assert.rejects(app.start());
    await app.close();
    assert.deepEqual(linker.log, ["start", "stop"]);
  });

  it("waits for the messages that are being handled before it disposes", async () => {
    const log: string[] = [];
    const release = deferred();
    const { App } = orders_app(log, async () => {
      log.push("handling");
      await release.promise;
      log.push("handled");
    });
    const linker = new FakeLinker();
    const app = await ChoMessage.create(App, { linker });
    await app.start();
    // the adapter delivers a message, and the application closes meanwhile
    const handling = linker.calls[0]![0]!.handle({ value: "x" });
    const closing = app.close();
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.ok(!log.includes("Db disposed"));
    release.resolve();
    await handling;
    await closing;
    assert.deepEqual(log.slice(-3), ["handling", "handled", "Db disposed"]);
  });

  it("handles what the linker delivers until the linker has stopped", async () => {
    const seen: string[] = [];
    const { App } = orders_app([], (ctx) => {
      seen.push(ctx.text());
    });
    const linker = new FakeLinker();
    const stopped = deferred();
    linker.stop = () => stopped.promise;
    const app = await ChoMessage.create(App, { linker });
    await app.start();
    const route = linker.calls[0]![0]!;

    const closing = app.close();
    await new Promise((resolve) => setTimeout(resolve, 10));
    await route.handle({ value: "late" }); // the linker has not stopped yet
    stopped.resolve();
    await closing;
    await assert.rejects(route.handle({ value: "too late" }), {
      code: "CHO_MESSAGE_CLOSED",
      message: "The application is closed",
    });
    assert.deepEqual(seen, ["late"]);
  });

  it("rejects start() and handle() once it is closing", async () => {
    const linker = new FakeLinker();
    const app = await ChoMessage.create(orders_app().App, { linker });
    const closing = app.close();
    await assert.rejects(app.start(), {
      code: "CHO_MESSAGE_CLOSED",
      message: "The application is closed",
    });
    await assert.rejects(app.handle("orders.created"), {
      code: "CHO_MESSAGE_CLOSED",
      message: "The application is closed",
    });
    await closing;
    await assert.rejects(app.handle("orders.created"), {
      code: "CHO_MESSAGE_CLOSED",
      message: "The application is closed",
    });
    assert.deepEqual(linker.log, []);
  });

  it("disposes the instances even when the linker cannot stop", async () => {
    const log: string[] = [];
    const linker = new FakeLinker();
    const failure = new Error("cannot disconnect");
    linker.stop = () => Promise.reject(failure);
    const app = await ChoMessage.create(orders_app(log).App, { linker });
    await app.start();
    await assert.rejects(app.close(), (error) => error === failure);
    assert.ok(log.includes("Db disposed"));
  });
});

describe("ChoMessage.from", () => {
  /** An injector with everything created, as an application would have it. */
  async function ready(app: Ctr) {
    const injector = new Injector(app);
    await injector.init();
    return injector;
  }

  it("builds the application on a given injector, with its instances", async () => {
    const log: string[] = [];
    let handled = false;
    const { App, Db } = orders_app(log, () => {
      handled = true;
    });
    const injector = await ready(App);
    const created = log.length;

    const linker = new FakeLinker();
    const app = await ChoMessage.from(injector, { linker, prefix: "staging" });
    assert.equal(app.injector, injector);
    assert.deepEqual(app.routes.map((route) => route.topic), [
      "staging.orders.created",
    ]);
    assert.equal(log.length, created); // nothing was created again
    const controller = app.graph.features[0]!.controllers[0]!.instance as {
      db: unknown;
    };
    assert.equal(controller.db, await injector.resolve(Db));
    await app.handle("staging.orders.created");
    assert.equal(handled, true);
  });

  it("creates what it needs on an injector that has created nothing", async () => {
    const log: string[] = [];
    const { App } = orders_app(log);
    const app = await ChoMessage.from(new Injector(App));
    assert.deepEqual(log, ["Db created"]); // not Unused: only what it needs
    await app.handle("orders.created");
  });

  it("does not dispose the injector: its owner does", async () => {
    const log: string[] = [];
    const { App, Db } = orders_app(log);
    const injector = await ready(App);
    const linker = new FakeLinker();
    const app = await ChoMessage.from(injector, { linker });
    await app.start();
    await app.close();

    assert.deepEqual(linker.log, ["start", "stop"]);
    assert.ok(!log.includes("Db disposed"));
    assert.ok(await injector.resolve(Db) instanceof Db); // still usable
    await assert.rejects(app.handle("orders.created"), {
      code: "CHO_MESSAGE_CLOSED",
      message: "The application is closed",
    });

    await injector.dispose();
    assert.ok(log.includes("Db disposed"));
  });

  it("disposes nothing when the application cannot be created", async () => {
    const log: string[] = [];
    const injector = await ready(orders_app(log).App);
    await assert.rejects(ChoMessage.from(injector, { prefix: "staging." }), {
      code: "CHO_MESSAGE_INVALID_TOPIC",
    });
    assert.ok(!log.includes("Db disposed"));
    await injector.dispose();
  });

  it("takes the error handler of the application", async () => {
    const seen: unknown[] = [];
    const failure = new Error("boom");
    const { App } = orders_app([], () => {
      throw failure;
    });
    const app = await ChoMessage.from(await ready(App), {
      onError: (error) => {
        seen.push(error);
        return true;
      },
    });
    await app.handle("orders.created");
    assert.deepEqual(seen, [failure]);
  });

  it("rejects overrides, and any unknown option", async () => {
    const injector = await ready(orders_app().App);
    await assert.rejects(
      ChoMessage.from(injector, loose({ overrides: [] })),
      {
        code: "CHO_CORE_UNKNOWN_OPTION",
        message:
          'ChoMessage.from(): unknown option "overrides". Known options: linker, middlewares, onError, prefix',
      },
    );
  });

  it("rejects what is not an injector", async () => {
    for (const value of [undefined, null, {}, orders_app().App]) {
      await assert.rejects(
        ChoMessage.from(loose(value)),
        {
          code: "CHO_MESSAGE_INVALID_INJECTOR",
          message: /^ChoMessage\.from\(\):\ expected\ an\ injector,\ got\ /,
        },
      );
    }
  });

  it("rejects on an injector that is disposed", async () => {
    const injector = await ready(orders_app().App);
    await injector.dispose();
    await assert.rejects(ChoMessage.from(injector), {
      code: "CHO_CORE_DISPOSED",
      message: "The injector is disposed",
    });
  });
});

describe("debug logging", () => {
  const ON = { CHO_DEBUGLOG: "cho:message", CHO_DEBUG: undefined };
  const OFF = { CHO_DEBUGLOG: undefined, CHO_DEBUG: undefined };

  /** What creating an application, and one message, write to the log. */
  async function logs_of(
    vars: Record<string, string | undefined>,
    app: Ctr,
    topic?: string,
  ) {
    const { output } = await capture(async () => {
      let created!: Promise<ChoMessage<undefined>>;
      with_env(vars, () => {
        created = ChoMessage.create(app);
      });
      const message = await created.catch(() => undefined);
      if (message && topic) {
        await message.handle(topic).catch(() => {});
      }
    });
    return output.error.map(String).join(" ");
  }

  it("logs nothing unless the cho:message context is enabled", async () => {
    assert.equal(await logs_of(OFF, orders_app().App), "");
  });

  it("logs every topic with its handler", async () => {
    const logs = await logs_of(ON, orders_app().App);
    assert.match(logs, /orders\.created -> Orders\.created/);
    assert.match(logs, /application App created/);
  });

  it("logs why an application cannot be created", async () => {
    class App {}
    Module(loose({ topic: "*", controllers: [orders_app().Orders] }))(App);
    const logs = await logs_of(ON, App);
    assert.match(logs, /cannot create application App/);
  });

  it("logs each message that fails", async () => {
    const { App } = orders_app([], () => {
      throw new Error("boom");
    });
    const logs = await logs_of(ON, App, "orders.created");
    assert.match(logs, /orders\.created \(Orders\.created\) failed:/);
    assert.match(logs, /boom/);
  });
});
