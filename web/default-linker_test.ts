/**
 * Tests for `default-linker.ts`: the default linker of `ChoWeb.create` is
 * loaded by name, when it is needed, and a package that cannot be loaded is
 * reported with what to do about it.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LINKER_PACKAGE,
  load_default_handler,
} from "./default-linker.ts";

describe("load_default_handler", () => {
  it("loads the plain adapter, and gives a new ChoLinker", async () => {
    assert.equal(DEFAULT_LINKER_PACKAGE, "@chojs/vendor-cho");
    const linker = await load_default_handler();
    assert.equal(linker.constructor.name, "ChoLinker");
    assert.equal(typeof linker.link, "function");
    assert.notEqual(await load_default_handler(), linker);
  });

  it("says what to install when the package cannot be loaded", async () => {
    await assert.rejects(
      () => load_default_handler("@chojs/not-installed"),
      (error: Error) => {
        assert.equal(
          error.message,
          "ChoWeb.create() was given no linker, and the default one, @chojs/not-installed, could not be loaded. " +
            'Install it ("deno add jsr:@chojs/not-installed", "npx jsr add @chojs/not-installed" or ' +
            '"bunx jsr add @chojs/not-installed"), or pass a linker in the options',
        );
        // what the runtime said is kept
        assert.match(String(error.cause), /@chojs\/not-installed/);
        return true;
      },
    );
  });

  it("rejects a package that has no ChoLinker", async () => {
    await assert.rejects(() => load_default_handler("node:path"), {
      message:
        "ChoWeb.create() was given no linker, and the default one, node:path, has no ChoLinker: " +
        "update the package, or pass a linker in the options",
    });
  });
});
