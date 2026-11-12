/**
 * Tests for `web.ts`: `ChoWeb.create` builds the application and links it
 * with the given linker.
 *
 * A fake linker records the routes it receives, so the tests do not depend on
 * any runtime adapter.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Injectable, provider } from "@chojs/core/di";
import { capture, legacy, with_env } from "@chojs/core/utils/test_utils";
import { Controller, Get, Module } from "./decorators.ts";
import type { Ctr } from "@chojs/core/di";
import type { Linked, Linker, Route } from "./linker.ts";
import { ChoWeb } from "./web.ts";

/** What the fake linker links: the routes, kept for the assertions. */
type Fake = { routes: readonly Route[] };

/** A linker that keeps the routes, with a handler that answers "linked". */
class FakeLinker implements Linker<Fake> {
  calls: (readonly Route[])[] = [];
  link(routes: readonly Route[]): Linked<Fake> {
    this.calls.push(routes);
    return {
      instance: { routes },
      handler: () => Promise.resolve(new Response("linked")),
    };
  }
}

/** An app with one controller, `Users`, and one handler, `GET users`. */
function users_app(created: string[] = []) {
  class Unused {
    constructor() {
      created.push("Unused");
    }
  }
  Injectable()(Unused);
  class Users {
    constructor() {
      created.push("Users");
    }
    list() {}
  }
  legacy(Get(""), Users, "list");
  Controller({ route: "users" })(Users);
  class App {}
  Module({ providers: [Unused], controllers: [Users] })(App);
  return App;
}

describe("ChoWeb.create", () => {
  it("gives the application's routes to the linker, once", async () => {
    const linker = new FakeLinker();
    const app = await ChoWeb.create(users_app(), { linker });

    assert.equal(linker.calls.length, 1);
    const routes = linker.calls[0]!;
    assert.deepEqual(
      routes.map((r) => [r.method, r.path, r.name]),
      [["GET", "/users", "Users.list"]],
    );
    assert.equal(app.linked.instance.routes, routes);
    assert.equal(app.routes, routes);
  });

  it("gives routes that answer on their own", async () => {
    const linker = new FakeLinker();
    await ChoWeb.create(users_app(), { linker });
    const response = await linker.calls[0]![0]!.handle(
      new Request("http://localhost/users"),
    );
    assert.equal(response.status, 204);
  });

  it("applies the global prefix, and keeps the graph", async () => {
    const linker = new FakeLinker();
    const app = await ChoWeb.create(users_app(), { linker, prefix: " api " });
    assert.equal(linker.calls[0]![0]!.path, "/api/users");
    assert.equal(app.graph.route, "api");
    assert.equal(app.graph.features[0]!.controllers[0]!.route, "users");
  });

  it("creates every instance up front, used by a route or not", async () => {
    const created: string[] = [];
    await ChoWeb.create(users_app(created), { linker: new FakeLinker() });
    assert.deepEqual(created.sort(), ["Unused", "Users"]);
  });

  it("exposes the linked handler", async () => {
    const app = await ChoWeb.create(users_app(), { linker: new FakeLinker() });
    const response = await app.handler(new Request("http://localhost/users"));
    assert.equal(await response.text(), "linked");
  });

  it("rejects an invalid module graph", async () => {
    class NotAModule {}
    await assert.rejects(
      ChoWeb.create(NotAModule, { linker: new FakeLinker() }),
      { message: "Class NotAModule is not a module. Did you forget @Module?" },
    );
  });

  it("rejects an invalid global prefix", async () => {
    await assert.rejects(
      ChoWeb.create(users_app(), { linker: new FakeLinker(), prefix: "/api" }),
      {
        message:
          'Invalid route "/api" of the global prefix: it must not start or end with "/"',
      },
    );
  });

  it("rejects when a factory fails, before linking", async () => {
    class Broken {
      constructor() {
        throw new Error("no database");
      }
    }
    Injectable()(Broken);
    class App {}
    Module({ providers: [Broken] })(App);
    const linker = new FakeLinker();
    await assert.rejects(ChoWeb.create(App, { linker }), {
      message: "Failed to create Broken in module App",
    });
    assert.equal(linker.calls.length, 0);
  });
});

describe("ChoWeb.create, debug logging", () => {
  const OFF = { CHO_DEBUG: undefined, CHO_DEBUGLOG: undefined };

  /** Create the app with the given environment, and return what it logged. */
  async function logs_of(
    vars: Record<string, string | undefined>,
    root: Ctr,
  ): Promise<string> {
    const { output } = await capture(async () => {
      let created!: Promise<unknown>;
      // the logger is created when create() starts, synchronously
      with_env(vars, () => {
        created = ChoWeb.create(root, { linker: new FakeLinker() });
      });
      await created.catch(() => {});
    });
    return output.error.map(String).join(" ");
  }

  it("logs nothing unless the cho:web context is enabled", async () => {
    assert.equal(await logs_of(OFF, users_app()), "");
  });

  it("logs every route with its handler", async () => {
    const logs = await logs_of(
      { ...OFF, CHO_DEBUGLOG: "cho:web" },
      users_app(),
    );
    assert.match(logs, /cho:web GET \/users -> Users\.list/);
    assert.match(logs, /application App created/);
  });

  it("logs why the application cannot be created", async () => {
    class NotAModule {}
    const logs = await logs_of({ ...OFF, CHO_DEBUGLOG: "cho:web" }, NotAModule);
    assert.match(
      logs,
      /ERROR cannot create application NotAModule: Error: Class NotAModule is not a module/,
    );
  });
});

describe("ChoWeb, closing and overrides", () => {
  /** An app whose `GET /` answers with the name of its `Db`. */
  function db_app(log: string[]) {
    class Db {
      name = "real";
      [Symbol.asyncDispose]() {
        log.push(`closed ${this.name}`);
        return Promise.resolve();
      }
    }
    Injectable()(Db);
    class Home {
      constructor(readonly db: Db) {}
      get() {
        return this.db.name;
      }
    }
    legacy(Get(""), Home, "get");
    Controller({ dependencies: [Db] })(Home);
    class App {}
    Module({ providers: [Db], controllers: [Home] })(App);
    return { App, Db };
  }

  it("close() disposes the application's instances, once", async () => {
    const log: string[] = [];
    const app = await ChoWeb.create(db_app(log).App, {
      linker: new FakeLinker(),
    });
    assert.deepEqual(log, []);
    await app.close();
    await app.close();
    assert.deepEqual(log, ["closed real"]);
  });

  it("is closed at the end of an `await using` block", async () => {
    const log: string[] = [];
    {
      await using _app = await ChoWeb.create(db_app(log).App, {
        linker: new FakeLinker(),
      });
    }
    assert.deepEqual(log, ["closed real"]);
  });

  it("disposes what was created when the application cannot be created", async () => {
    const log: string[] = [];
    const { App } = db_app(log);
    await assert.rejects(
      ChoWeb.create(App, { linker: new FakeLinker(), prefix: "/bad" }),
      /Invalid route "\/bad" of the global prefix/,
    );
    assert.deepEqual(log, ["closed real"]);
  });

  it("replaces providers with the overrides option", async () => {
    const { App, Db } = db_app([]);
    const linker = new FakeLinker();
    await ChoWeb.create(App, {
      linker,
      overrides: [
        provider({
          provide: Db,
          factory: () => ({ name: "fake" }) as InstanceType<typeof Db>,
        }),
      ],
    });
    const response = await linker.calls[0]![0]!.handle(
      new Request("http://localhost/"),
    );
    assert.equal(await response.json(), "fake");
  });
});
