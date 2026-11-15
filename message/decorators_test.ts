/**
 * Tests for `decorators.ts`: `@Subscribe` writes the handler's topic under
 * the private `SUBSCRIBE` key, and `@Module` and `@Controller` take the
 * `topic` option.
 *
 * Decorators are applied as plain function calls, so the tests run on every
 * runtime.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { read_metadata_object, read_method_metadata } from "@chojs/core/di";
import { legacy, loose, tc39, tc39_record } from "@chojs/core/utils/test_utils";
import {
  Catch,
  Controller,
  Middlewares,
  Module,
  Subscribe,
} from "./decorators.ts";
import { SUBSCRIBE } from "./keys.ts";

describe("@Subscribe", () => {
  it("writes the topic (TC39)", () => {
    function created() {}
    tc39(Subscribe("orders.created"), created, "created");
    assert.deepEqual(tc39_record(created), {
      [SUBSCRIBE]: { topic: "orders.created" },
    });
  });

  it("writes the topic (legacy)", () => {
    class Orders {
      created() {}
    }
    legacy(Subscribe("created"), Orders, "created");
    assert.deepEqual(read_method_metadata(Orders, "created"), {
      [SUBSCRIBE]: { topic: "created" },
    });
  });

  it("accepts an empty topic: the controller's own", () => {
    class Orders {
      all() {}
    }
    legacy(Subscribe(""), Orders, "all");
    assert.deepEqual(read_method_metadata(Orders, "all"), {
      [SUBSCRIBE]: { topic: "" },
    });
  });

  it("keeps what other decorators wrote on the method", () => {
    const mw = () => {};
    class Orders {
      created() {}
    }
    legacy(Middlewares(mw), Orders, "created");
    legacy(Subscribe("created"), Orders, "created");
    const record = read_method_metadata(Orders, "created") as Record<
      PropertyKey,
      unknown
    >;
    assert.deepEqual(record[SUBSCRIBE], { topic: "created" });
    assert.equal(Reflect.ownKeys(record).length, 2);
  });

  it("rejects an invalid topic, when the class is defined", () => {
    class Orders {
      created() {}
    }
    assert.throws(() => legacy(Subscribe("orders.*"), Orders, "created"), {
      message:
        'Invalid topic "orders.*" of @Subscribe() on method created: "*" has a "*": wildcards are not part of the topic syntax',
    });
    assert.throws(
      () => legacy(Subscribe(loose(42)), Orders, "created"),
      {
        name: "TypeError",
        message:
          "Invalid topic of @Subscribe() on method created: expected a string, got 42",
      },
    );
    assert.equal(read_method_metadata(Orders, "created"), undefined);
  });

  it("rejects a second @Subscribe on a method", () => {
    class Orders {
      created() {}
    }
    legacy(Subscribe("created"), Orders, "created");
    assert.throws(() => legacy(Subscribe("made"), Orders, "created"), {
      message:
        'Cannot add @Subscribe() to method created: it already handles "created". A method can have one @Subscribe().',
    });
  });

  it("rejects a static method", () => {
    class Orders {
      static created() {}
    }
    assert.throws(
      () => legacy(Subscribe("created"), Orders, "created", { isStatic: true }),
      {
        name: "TypeError",
        message:
          "@Subscribe() cannot decorate static method created: a handler must not be static",
      },
    );
    assert.throws(
      () => tc39(Subscribe("created"), () => {}, "created", { isStatic: true }),
      TypeError,
    );
  });

  it("rejects a private method", () => {
    assert.throws(
      () =>
        tc39(Subscribe("created"), () => {}, "#created", { isPrivate: true }),
      {
        name: "TypeError",
        message:
          "@Subscribe() cannot decorate private method #created: a handler must be public",
      },
    );
  });

  it("rejects a method named by a symbol", () => {
    const name = Symbol("created");
    assert.throws(() => tc39(Subscribe("created"), () => {}, name), {
      name: "TypeError",
      message:
        "@Subscribe() cannot decorate method Symbol(created): a handler must have a string name",
    });
  });
});

describe("@Module and @Controller", () => {
  it("take the topic option", () => {
    class Orders {}
    Controller({ topic: "orders" })(Orders);
    class App {}
    Module({ topic: "shop", controllers: [Orders] })(App);
    assert.equal(
      (read_metadata_object(Orders) as { topic?: string }).topic,
      "orders",
    );
    assert.equal(
      (read_metadata_object(App) as { topic?: string }).topic,
      "shop",
    );
  });

  it("need no option", () => {
    class Orders {}
    assert.doesNotThrow(() => Controller()(Orders));
    class App {}
    assert.doesNotThrow(() => Module()(App));
  });

  it("reject an unknown option, the route of @chojs/web included", () => {
    assert.throws(() => Controller(loose({ route: "orders" })), {
      message:
        '@Controller(): unknown option "route". Known options: dependencies, topic',
    });
    assert.throws(() => Module(loose({ topics: "orders" })), {
      message:
        '@Module(): unknown option "topics". Known options: dependencies, imports, providers, controllers, exports, topic',
    });
  });
});

describe("@Middlewares and @Catch", () => {
  it("apply to a class and to a method", () => {
    class Orders {
      created() {}
    }
    assert.doesNotThrow(() => {
      Middlewares((_ctx, next) => next())(Orders);
      Catch(() => true)(Orders);
      legacy(Middlewares((_ctx, next) => next()), Orders, "created");
      legacy(Catch(() => true), Orders, "created");
    });
  });

  it("reject a second @Catch", () => {
    class Orders {}
    Catch(() => true)(Orders);
    assert.throws(() => Catch(() => true)(Orders));
  });
});
