/**
 * The decorators of `@chojs/web`, applied with decorator **syntax**, end to
 * end.
 *
 * Every other test applies decorators as plain function calls. This file is
 * the exception: it checks that the syntax itself works on each runtime's own
 * decorator implementation (Deno, Bun, and Node.js through `tsx`), which no
 * function call can show.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Catch,
  ChoWeb,
  type ChoWebContext,
  Controller,
  Get,
  Injectable,
  Middlewares,
  Module,
  Post,
} from "./mod.ts";
import { TestLinker } from "./testing.ts";

const seen: string[] = [];

@Injectable()
class Store {
  find(id: string) {
    return { id, name: "Ada" };
  }
}

@Injectable([Store])
class Audit {
  constructor(readonly store: Store) {}
  handle(ctx: ChoWebContext, next: () => Promise<Response>) {
    seen.push(`audit ${ctx.url.pathname}`);
    return next();
  }
}

@Catch((error) => new Response(`controller: ${error}`, { status: 500 }))
@Middlewares(Audit)
@Controller({ route: "users", dependencies: [Store] })
class Users {
  constructor(readonly store: Store) {}

  @Get(":id")
  get(ctx: ChoWebContext) {
    return this.store.find(ctx.params.id!);
  }

  @Middlewares((_ctx, next) => {
    seen.push("create");
    return next();
  })
  @Catch((error) => new Response(`method: ${error}`, { status: 400 }))
  @Post("")
  create() {
    throw new Error("invalid");
  }

  @Get("")
  list() {
    throw new Error("down");
  }
}

@Middlewares(async (_ctx, next) => {
  const response = await next();
  response.headers.set("x-app", "1");
  return response;
})
@Module({ route: "v1", providers: [Store, Audit], controllers: [Users] })
class App {}

describe("decorator syntax", () => {
  const send = async (path: string, method = "GET") => {
    const app = await ChoWeb.create(App, { linker: new TestLinker() });
    return app.handler(new Request(`http://localhost${path}`, { method }));
  };

  it("routes, injects, and runs class- and method-level decorators", async () => {
    const found = await send("/v1/users/7");
    assert.deepEqual(await found.json(), { id: "7", name: "Ada" });
    assert.equal(found.headers.get("x-app"), "1");

    const created = await send("/v1/users", "POST");
    assert.deepEqual(
      [created.status, await created.text()],
      [400, "method: Error: invalid"],
    );

    const listed = await send("/v1/users");
    assert.deepEqual(
      [listed.status, await listed.text()],
      [500, "controller: Error: down"],
    );
    assert.deepEqual(seen, [
      "audit /v1/users/7",
      "audit /v1/users",
      "create",
      "audit /v1/users",
    ]);
  });

  it("keeps the route of a method another decorator replaces", async () => {
    const calls: string[] = [];
    // A decorator that replaces the method, applied above and below @Get.
    // Like the CHO decorators, it handles both call shapes: TC39
    // `(method, context)`, and legacy / Bun `(prototype, name, descriptor)`.
    // deno-lint-ignore no-explicit-any
    function Logged(target: any, context: any, descriptor?: any): any {
      const legacy = descriptor !== undefined;
      const method = legacy ? descriptor.value : target;
      const name = String(legacy ? context : context.name);
      // deno-lint-ignore no-explicit-any
      const wrapper = function (this: any, ...args: any[]) {
        calls.push(name);
        return method.apply(this, args);
      };
      return legacy ? { ...descriptor, value: wrapper } : wrapper;
    }

    @Controller({ route: "wrapped" })
    class Wrapped {
      greeting = "hi";

      @Logged
      @Get("above")
      above() {
        return this.greeting;
      }

      @Get("below")
      @Logged
      below() {
        return this.greeting;
      }
    }

    @Module({ controllers: [Wrapped] })
    class WrappedApp {}

    const app = await ChoWeb.create(WrappedApp, { linker: new TestLinker() });
    for (const path of ["above", "below"]) {
      const response = await app.handler(
        new Request(`http://localhost/wrapped/${path}`),
      );
      assert.equal(await response.json(), "hi");
    }
    assert.deepEqual(calls, ["above", "below"]);
  });

  it("routes the handlers a controller inherits", async () => {
    class Health {
      @Get("health")
      health() {
        return { ok: true };
      }

      @Get("version")
      version() {
        return "base";
      }
    }

    @Controller({ route: "a" })
    class A extends Health {}

    @Controller({ route: "b" })
    class B extends Health {
      @Get("v") // replaces the inherited route of `version`
      override version() {
        return "b";
      }
    }

    @Module({ controllers: [A, B] })
    class InheritedApp {}

    const app = await ChoWeb.create(InheritedApp, { linker: new TestLinker() });
    assert.deepEqual(
      app.routes.map((r) => `${r.path} ${r.name}`),
      [
        "/a/health A.health",
        "/a/version A.version",
        "/b/health B.health",
        "/b/v B.version",
      ],
    );
    const get = async (path: string) =>
      (await app.handler(new Request(`http://localhost${path}`))).json();
    assert.deepEqual(await get("/a/health"), { ok: true });
    assert.equal(await get("/a/version"), "base");
    assert.equal(await get("/b/v"), "b");
  });

  it("rejects a second HTTP method decorator, when the class is defined", () => {
    assert.throws(() => {
      class Twice {
        @Get("a")
        @Post("a")
        run() {}
      }
      return Twice;
    }, { message: /A method can have one HTTP method decorator/ });
  });
});
