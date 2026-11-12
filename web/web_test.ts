/**
 * Tests for `web.ts`: `ChoWeb.create` builds the application and links it
 * with the given linker.
 *
 * A fake linker records the graph it receives, so the tests do not depend on
 * any runtime adapter.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Controller, Injectable, Module } from "@chojs/core/di";
import { legacy } from "@chojs/core/utils/test_utils";
import { Get } from "./decorators.ts";
import type { AppRef } from "./graph.ts";
import type { Linked, Linker } from "./linker.ts";
import { ChoWeb } from "./web.ts";

/** What the fake linker links: the graph, kept for the assertions. */
type Fake = { graph: AppRef };

/** A linker that keeps the graph, with a handler that answers "linked". */
class FakeLinker implements Linker<Fake> {
  graphs: AppRef[] = [];
  link(graph: AppRef): Linked<Fake> {
    this.graphs.push(graph);
    return {
      instance: { graph },
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
  it("links the application's graph with the given linker", async () => {
    const linker = new FakeLinker();
    const app = await ChoWeb.create(users_app(), { linker });

    assert.equal(linker.graphs.length, 1);
    const graph = linker.graphs[0]!;
    assert.equal(graph.route, "");
    assert.equal(graph.features[0]!.controllers[0]!.route, "users");
    assert.equal(app.linked.instance.graph, graph);
  });

  it("passes the global prefix to the graph", async () => {
    const linker = new FakeLinker();
    await ChoWeb.create(users_app(), { linker, prefix: " api " });
    assert.equal(linker.graphs[0]!.route, "api");
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
    assert.equal(linker.graphs.length, 0);
  });
});
