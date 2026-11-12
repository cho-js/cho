/**
 * Tests for `handles.ts`: functions and handle classes, as middlewares and
 * error handlers.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Injectable, Module } from "./decorators.ts";
import { assert_handle, is_handle_class, resolve_handle } from "./handles.ts";
import { Injector } from "./injector.ts";

describe("is_handle_class", () => {
  it("is true for a class with a handle method only", () => {
    class Yes {
      handle() {}
    }
    class No {}
    assert.equal(is_handle_class(Yes), true);
    assert.equal(is_handle_class(No), false);
    assert.equal(is_handle_class(() => {}), false);
    assert.equal(is_handle_class({ handle() {} }), false);
  });
});

describe("assert_handle", () => {
  it("accepts a function and a handle class", () => {
    class Auth {
      handle() {}
    }
    assert.doesNotThrow(() => assert_handle(() => {}, "Middleware"));
    assert.doesNotThrow(() =>
      assert_handle(async function mw() {}, "Middleware")
    );
    assert.doesNotThrow(() => assert_handle(Auth, "Middleware"));
  });

  it("rejects a class without a handle method", () => {
    class Auth {}
    assert.throws(() => assert_handle(Auth, "Middleware"), {
      message: "Middleware class Auth must implement 'handle' method.",
    });
    assert.throws(() => assert_handle(class {}, "Error handler"), {
      message:
        "Error handler class <anonymous> must implement 'handle' method.",
    });
  });

  it("rejects what is not a function", () => {
    assert.throws(() => assert_handle("auth", "Middleware"), {
      message:
        "Invalid middleware \"auth\": must be a function or a class with a 'handle' method.",
    });
    assert.throws(() => assert_handle(undefined, "Error handler"), {
      message:
        "Invalid error handler undefined: must be a function or a class with a 'handle' method.",
    });
  });
});

describe("resolve_handle", () => {
  it("returns a function as it is", async () => {
    class App {}
    Module()(App);
    const fn = () => 1;
    assert.equal(await resolve_handle(new Injector(App), fn, App), fn);
  });

  it("creates a handle class with the injector, and binds its handle", async () => {
    class Clock {
      now = 42;
    }
    Injectable()(Clock);
    class Timing {
      constructor(readonly clock: Clock) {}
      handle(extra: number) {
        return this.clock.now + extra;
      }
    }
    Injectable([Clock])(Timing);
    class App {}
    Module({ providers: [Clock, Timing] })(App);
    const injector = new Injector(App);

    const handle = await resolve_handle<(extra: number) => number>(
      injector,
      Timing,
      App,
    );
    assert.equal(handle(1), 43);
    assert.equal(handle.name, "Timing.handle");
    // the instance is the injector's: created once
    assert.equal(
      (await injector.resolve(Timing)).handle(1),
      43,
    );
  });

  it("rejects when the class is not visible in the module", async () => {
    class Timing {
      handle() {}
    }
    Injectable()(Timing);
    class App {}
    Module()(App);
    await assert.rejects(resolve_handle(new Injector(App), Timing, App), {
      message: "Timing is not visible in module App",
    });
  });
});
