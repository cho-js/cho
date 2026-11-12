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
