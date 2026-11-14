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
  Args,
  Body,
  Catch,
  ChoWeb,
  type ChoWebArg,
  type ChoWebContext,
  type ChoWebMiddlewareFn,
  type ChoWebValidator,
  Controller,
  Doc,
  Form,
  Get,
  Header,
  Injectable,
  Middlewares,
  Module,
  Param,
  Post,
  provider,
  Put,
  Query,
  token,
  validate,
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
      assert.equal(await response.text(), "hi");
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
    const get = (path: string) =>
      app.handler(new Request(`http://localhost${path}`));
    assert.deepEqual(await (await get("/a/health")).json(), { ok: true });
    assert.equal(await (await get("/a/version")).text(), "base");
    assert.equal(await (await get("/b/v")).text(), "b");
  });

  it("keeps an inherited route when an override only adds to it", async () => {
    const seen: string[] = [];
    const mw = (name: string): ChoWebMiddlewareFn => (_ctx, next) => {
      seen.push(name);
      return next();
    };

    class Base {
      @Middlewares(mw("base"))
      @Get("health")
      health(): string {
        return "base";
      }
    }

    @Controller({ route: "plain" })
    class Plain extends Base {
      override health() {
        return "plain"; // no decorator: inherits the record as it is
      }
    }

    @Controller({ route: "guarded" })
    class Guarded extends Base {
      @Middlewares(mw("guarded")) // adds a middleware: the route stays
      override health() {
        return "guarded";
      }
    }

    @Controller({ route: "moved" })
    class Moved extends Base {
      @Get("status") // declares the route again: replaces it
      override health() {
        return "moved";
      }
    }

    @Module({ controllers: [Plain, Guarded, Moved] })
    class OverrideApp {}

    const app = await ChoWeb.create(OverrideApp, { linker: new TestLinker() });
    assert.deepEqual(app.routes.map((r) => r.path), [
      "/plain/health",
      "/guarded/health",
      "/moved/status",
    ]);
    const get = async (path: string) => {
      seen.length = 0;
      const body = await (await app.handler(
        new Request(`http://localhost${path}`),
      )).text();
      return [body, ...seen];
    };
    assert.deepEqual(await get("/plain/health"), ["plain", "base"]);
    // the parent's middlewares run first
    assert.deepEqual(await get("/guarded/health"), [
      "guarded",
      "base",
      "guarded",
    ]);
    assert.deepEqual(await get("/moved/status"), ["moved", "base"]);
  });

  it("has token and provider, so an application needs no other import", async () => {
    const GREETING = token<string>("GREETING");

    @Controller({ route: "hello", dependencies: [GREETING] })
    class Hello {
      constructor(readonly greeting: string) {}

      @Get("")
      hello() {
        return this.greeting;
      }
    }

    @Module({
      providers: [provider({ provide: GREETING, factory: () => "hi" })],
      controllers: [Hello],
    })
    class TokenApp {}

    const send = async (app: ChoWeb<unknown>) =>
      (await app.handler(new Request("http://localhost/hello"))).text();
    const linker = () => new TestLinker();
    assert.equal(
      await send(await ChoWeb.create(TokenApp, { linker: linker() })),
      "hi",
    );
    // and the same pair writes the overrides of a test
    const overridden = await ChoWeb.create(TokenApp, {
      linker: linker(),
      overrides: [provider({ provide: GREETING, factory: () => "hello" })],
    });
    assert.equal(await send(overridden), "hello");
  });

  it("checks dependencies against the constructor, at compile time", () => {
    // Type-only: never called, so the mismatched class is never defined.
    const _check = () => {
      // @ts-expect-error the constructor wants a Store, not a number
      @Controller({ route: "bad", dependencies: [Store] })
      class Bad {
        constructor(readonly limit: number) {}
      }
      // @ts-expect-error the constructor needs a dependency
      @Injectable()
      class Missing {
        constructor(readonly store: Store) {}
      }
      // @ts-expect-error the same, for a controller without dependencies
      @Controller({ route: "none" })
      class None {
        constructor(readonly store: Store) {}
      }
      return [Bad, Missing, None];
    };
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

describe("decorator syntax, handler arguments", () => {
  type NewUser = { name: string; age?: number };

  /** A validator in the shape of a zod schema, written by hand. */
  const NewUser: ChoWebValidator<NewUser> = {
    parse(value) {
      const { name, age } = (value ?? {}) as Record<string, unknown>;
      if (typeof name !== "string") {
        throw Object.assign(new Error("invalid"), {
          issues: [{ path: ["name"], message: "Required" }],
        });
      }
      return { name, ...(typeof age === "number" ? { age } : {}) };
    },
  };
  const Id: ChoWebValidator<number> = {
    parse(value) {
      const id = Number(value);
      if (!Number.isInteger(id)) {
        throw new Error("the id is a whole number");
      }
      return id;
    },
  };
  /** An argument of the application's own. */
  const Agent: ChoWebArg<string> = (ctx) =>
    ctx.req.headers.get("user-agent") ?? "unknown";

  @Doc({ tags: ["accounts"] })
  @Middlewares(validate())
  @Controller({ route: "accounts", dependencies: [Store] })
  class Accounts {
    constructor(readonly store: Store) {}

    @Doc({ summary: "Update an account" })
    @Put(":id")
    @Args(Param("id", Id), Query("notify"), Body(NewUser))
    update(
      id: number,
      notify: string | undefined,
      user: NewUser,
      ctx: ChoWebContext,
    ) {
      return { id, notify, user, path: ctx.url.pathname };
    }

    @Args(Form("name"), Form(), Header("x-token"), Agent)
    @Post("login")
    login(
      name: string | undefined,
      form: Readonly<Record<string, string>>,
      token: string | undefined,
      agent: string,
    ) {
      return { name, form, token, agent, found: this.store.find("1").name };
    }

    @Get(":id") // no @Args: the context alone
    get(ctx: ChoWebContext) {
      return { id: ctx.params.id };
    }
  }

  @Module({ providers: [Store], controllers: [Accounts] })
  class AccountsApp {}

  const send = async (path: string, init: RequestInit = {}) => {
    const app = await ChoWeb.create(AccountsApp, { linker: new TestLinker() });
    const response = await app.handler(
      new Request(`http://localhost${path}`, init),
    );
    return [response.status, await response.json()];
  };

  it("calls the handler with its arguments, validated, and the context", async () => {
    assert.deepEqual(
      await send("/accounts/7?notify=1", {
        method: "PUT",
        body: JSON.stringify({ name: "Ada", age: 36, extra: true }),
      }),
      [200, {
        id: 7,
        notify: "1",
        user: { name: "Ada", age: 36 },
        path: "/accounts/7",
      }],
    );
    assert.deepEqual(
      await send("/accounts/login", {
        method: "POST",
        body: "name=ada&password=x",
        headers: { "x-token": "abc", "user-agent": "test" },
      }),
      [200, {
        name: "ada",
        form: { name: "ada", password: "x" },
        token: "abc",
        agent: "test",
        found: "Ada",
      }],
    );
    assert.deepEqual(await send("/accounts/42"), [200, { id: "42" }]);
  });

  it("answers 400 for an argument that is not valid", async () => {
    assert.deepEqual(
      await send("/accounts/7", { method: "PUT", body: "{}" }),
      [400, {
        error: "Invalid request",
        source: "body",
        issues: [{ path: ["name"], message: "Required" }],
      }],
    );
    assert.deepEqual(
      await send("/accounts/x", { method: "PUT", body: '{"name":"Ada"}' }),
      [400, {
        error: "Invalid request",
        source: "param",
        key: "id",
        issues: [{ message: "the id is a whole number" }],
      }],
    );
  });

  it("exposes what is declared on the graph", async () => {
    const app = await ChoWeb.create(AccountsApp, { linker: new TestLinker() });
    const [controller] = app.graph.features[0]!.controllers;
    assert.deepEqual(controller!.doc, { tags: ["accounts"] });
    const update = controller!.methods.find((m) => m.name === "update")!;
    assert.deepEqual(update.doc, { summary: "Update an account" });
    assert.deepEqual(
      update.args.map((arg) => [arg.info?.source, arg.info?.key]),
      [["param", "id"], ["query", "notify"], ["body", undefined]],
    );
    assert.equal(update.validated, true);
  });

  it("checks the parameters against the arguments, at compile time", () => {
    // Type-only: never called, so the classes are never defined.
    const _check = () => {
      class Wrong {
        // @ts-expect-error the id is a string, not a number
        @Args(Param("id"))
        @Get(":id")
        a(_id: number) {}

        // @ts-expect-error a query key can be undefined
        @Args(Query("page"))
        @Get("b")
        b(_page: string) {}

        // @ts-expect-error the context comes last
        @Args(Param("id"))
        @Get(":id")
        c(_ctx: ChoWebContext, _id: string) {}

        // @ts-expect-error the validator gives a NewUser
        @Args(Body(NewUser))
        @Post("d")
        d(_user: { name: number }) {}

        // @ts-expect-error without a validator, the body is unknown
        @Args(Body())
        @Post("e")
        e(_user: NewUser) {}
      }
      class Right {
        @Post("a")
        @Args(Body<NewUser>(), Agent)
        a(_user: NewUser, _agent: string) {} // the context is left out

        @Get(":id")
        @Args(Param("id", Id), Param())
        b(
          _id: number,
          _all: Readonly<Record<string, string>>,
          _ctx: ChoWebContext,
        ) {}

        @Get("c")
        @Args()
        c(_ctx: ChoWebContext) {}
      }
      return [Wrong, Right];
    };
  });
});
