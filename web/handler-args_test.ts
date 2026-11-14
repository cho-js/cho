/**
 * Tests for `@Args` and `@Doc`: what they record, how a handler with
 * arguments is called, and what the graph of the application exposes.
 *
 * Decorators are applied as plain function calls, so the tests run on every
 * runtime. The typed decorator of `@Args` is checked with decorator syntax
 * in `syntax_test.ts`.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { read_method_metadata } from "@chojs/core/di";
import {
  type AnyMethodDecorator,
  legacy,
  loose,
  tc39,
  tc39_record,
} from "@chojs/core/utils/test_utils";
import { Body, Header, Param, Query } from "./args.ts";
import type { ChoWebContext } from "./context.ts";
import {
  Args,
  Catch,
  Controller,
  Doc,
  Get,
  Middlewares,
  Module,
  Post,
  Put,
} from "./decorators.ts";
import { ARGS, DOC, doc_of, handler_args } from "./keys.ts";
import { TestLinker } from "./testing.ts";
import type {
  ChoWebArg,
  ChoWebMiddlewareFn,
  ChoWebValidator,
} from "./types.ts";
import { validate } from "./validate.ts";
import { ChoWeb } from "./web.ts";

type Class = new () => object;

/** `@Args`, as a decorator the test helpers can apply by hand. */
const args = (...list: unknown[]): AnyMethodDecorator =>
  loose(Args(...loose(list)));

/** Create the application of a root module, with the test linker. */
function create(root: Class, prefix = "") {
  return ChoWeb.create(root, { linker: new TestLinker(), prefix });
}

/** Send a request to an application. */
function send(
  app: ChoWeb<unknown>,
  path: string,
  init: RequestInit = {},
) {
  return app.handler(new Request(`http://localhost${path}`, init));
}

/** A module declaring the given controllers. */
function feature(controllers: Class[], options: Record<string, unknown> = {}) {
  class Feature {}
  Module({ ...options, controllers })(Feature);
  return Feature;
}

const number: ChoWebValidator<number> = { parse: (value) => Number(value) };

describe("@Args", () => {
  it("writes the list of arguments on the method (TC39)", () => {
    const id = Param("id");
    const page = Query("page");
    function update() {}
    tc39(args(id, page), update, "update");
    const record = handler_args(tc39_record(update, "update") as object);
    assert.deepEqual(record, { list: [id, page] });
    assert.ok(Object.isFrozen(record) && Object.isFrozen(record!.list));
  });

  it("writes the list of arguments on the method (legacy)", () => {
    const id = Param("id");
    class Users {
      update() {}
    }
    legacy(args(id), Users, "update");
    assert.deepEqual(
      (read_method_metadata(Users, "update") as Record<symbol, unknown>)[ARGS],
      { list: [id] },
    );
  });

  it("goes above or below the HTTP method decorator", async () => {
    class Users {
      above(id: string) {
        return `above ${id}`;
      }
      below(id: string) {
        return `below ${id}`;
      }
    }
    // decorators apply bottom-up: the last call is the top decorator
    legacy(Get("above/:id"), Users, "above");
    legacy(args(Param("id")), Users, "above");
    legacy(args(Param("id")), Users, "below");
    legacy(Get("below/:id"), Users, "below");
    Controller({ route: "users" })(Users);
    const app = await create(feature([Users]));
    assert.equal(await (await send(app, "/users/above/1")).text(), "above 1");
    assert.equal(await (await send(app, "/users/below/2")).text(), "below 2");
  });

  it("accepts an empty list: the handler still receives the context", async () => {
    class Users {
      get(ctx: ChoWebContext) {
        return ctx.url.pathname;
      }
    }
    legacy(Get(""), Users, "get");
    legacy(args(), Users, "get");
    Controller({ route: "users" })(Users);
    const app = await create(feature([Users]));
    assert.equal(await (await send(app, "/users")).text(), "/users");
  });

  it("rejects an argument that is not a function", () => {
    class Users {
      get() {}
    }
    for (const bad of ["id", 1, null, undefined, {}, number]) {
      assert.throws(() => legacy(args(Param("id"), bad), Users, "get"), {
        name: "TypeError",
        message:
          /^@Args\(\) on method get: argument 2 must be made with Param, Query, Header, Body or Form, or be a function, got /,
      });
    }
    // nothing was written by the failed calls
    assert.equal(read_method_metadata(Users, "get"), undefined);
  });

  it("rejects a second @Args on a method", () => {
    class Users {
      get() {}
    }
    legacy(args(Param("id")), Users, "get");
    assert.throws(() => legacy(args(Query()), Users, "get"), {
      message: "Cannot add @Args() to method get: it already has one.",
    });
  });

  it("rejects a class, and static, private and symbol-named methods", () => {
    class Users {
      static create() {}
    }
    assert.throws(() => loose(Args())(Users), { name: "TypeError" });
    assert.throws(
      () => legacy(args(), Users, "create", { isStatic: true }),
      {
        name: "TypeError",
        message:
          "@Args() cannot decorate static method create: only public, non-static methods with a string name are supported",
      },
    );
    assert.throws(
      () => tc39(args(), function secret() {}, "#secret", { isPrivate: true }),
      { name: "TypeError", message: /private method/ },
    );
    assert.throws(() => tc39(args(), function sym() {}, Symbol("sym")), {
      name: "TypeError",
      message: /symbol-named method/,
    });
  });
});

describe("a handler with arguments", () => {
  it("receives the values in order, then the context", async () => {
    const received: unknown[][] = [];
    class Users {
      prefix = "user-";
      update(...values: unknown[]) {
        received.push(values);
        const ctx = values.at(-1) as ChoWebContext;
        return { id: this.prefix + values[0], path: ctx.url.pathname };
      }
    }
    legacy(Put(":id"), Users, "update");
    legacy(
      args(
        Param("id"),
        Query("notify"),
        Query(),
        Header("x-token"),
        Body(),
        Body("name"),
      ),
      Users,
      "update",
    );
    Controller({ route: "users" })(Users);
    const app = await create(feature([Users]));

    const response = await send(app, "/users/7?notify=1&x=y", {
      method: "PUT",
      body: '{"name":"Ada"}',
      headers: { "x-token": "abc" },
    });
    assert.deepEqual(await response.json(), {
      id: "user-7", // `this` is the controller
      path: "/users/7",
    });
    const [values] = received;
    assert.deepEqual(values!.slice(0, -1), [
      "7",
      "1",
      { notify: "1", x: "y" },
      "abc",
      { name: "Ada" },
      "Ada",
    ]);
    // the context comes last, and is the one of the request
    assert.equal((values!.at(-1) as ChoWebContext).params.id, "7");
  });

  it("receives the values of arguments of its own, asynchronous ones included", async () => {
    const user: ChoWebArg<string> = (ctx) => ctx.state.get("user") as string;
    const later: ChoWebArg<number> = () => Promise.resolve(42);
    const login: ChoWebMiddlewareFn = (ctx, next) => {
      ctx.state.set("user", "ada");
      return next();
    };
    class Me {
      get(name: string, answer: number) {
        return { name, answer };
      }
    }
    legacy(Get(""), Me, "get");
    legacy(args(user, later), Me, "get");
    legacy(Middlewares(login), Me, "get");
    Controller({ route: "me" })(Me);
    const app = await create(feature([Me]));
    assert.deepEqual(await (await send(app, "/me")).json(), {
      name: "ada",
      answer: 42,
    });
  });

  it("evaluates the arguments in order, after the middlewares", async () => {
    const seen: string[] = [];
    const spy = (name: string): ChoWebArg<string> => () => {
      seen.push(name);
      return name;
    };
    const mw: ChoWebMiddlewareFn = async (_ctx, next) => {
      seen.push("middleware in");
      const response = await next();
      seen.push("middleware out");
      return response;
    };
    class Ctrl {
      run() {
        seen.push("handler");
      }
    }
    legacy(Get(""), Ctrl, "run");
    legacy(args(spy("first"), spy("second")), Ctrl, "run");
    legacy(Middlewares(mw), Ctrl, "run");
    Controller({ route: "x" })(Ctrl);
    const app = await create(feature([Ctrl]));
    assert.equal((await send(app, "/x")).status, 204);
    assert.deepEqual(seen, [
      "middleware in",
      "first",
      "second",
      "handler",
      "middleware out",
    ]);
  });

  it("does not read the body when a middleware answers by itself", async () => {
    let called = false;
    const guard: ChoWebMiddlewareFn = () =>
      new Response("unauthorized", { status: 401 });
    class Ctrl {
      run() {
        called = true;
      }
    }
    legacy(Post(""), Ctrl, "run");
    legacy(args(Body()), Ctrl, "run");
    legacy(Middlewares(guard), Ctrl, "run");
    Controller({ route: "x" })(Ctrl);
    const app = await create(feature([Ctrl]));
    const request = new Request("http://localhost/x", {
      method: "POST",
      body: "{oops", // would not parse
    });
    assert.equal((await app.handler(request)).status, 401);
    assert.equal(request.bodyUsed, false);
    assert.equal(called, false);
  });

  it("gives an argument that throws to the nearest error handler, and stops there", async () => {
    const seen: string[] = [];
    const failing: ChoWebArg<never> = () => {
      throw new Error("no such user");
    };
    const after: ChoWebArg<string> = () => {
      seen.push("after");
      return "x";
    };
    class Ctrl {
      run() {
        seen.push("handler");
      }
    }
    legacy(Get(""), Ctrl, "run");
    legacy(args(failing, after), Ctrl, "run");
    legacy(
      Catch((error) =>
        new Response(`caught: ${(error as Error).message}`, { status: 404 })
      ),
      Ctrl,
      "run",
    );
    Controller({ route: "x" })(Ctrl);
    const app = await create(feature([Ctrl]));
    const response = await send(app, "/x");
    assert.deepEqual(
      [response.status, await response.text()],
      [404, "caught: no such user"],
    );
    assert.deepEqual(seen, []);
  });

  it("rejects the route when an argument throws and nothing handles it", async () => {
    class Ctrl {
      run() {}
    }
    legacy(Post(""), Ctrl, "run");
    legacy(args(Body()), Ctrl, "run");
    Controller({ route: "x" })(Ctrl);
    const linker = new TestLinker();
    const app = await ChoWeb.create(feature([Ctrl]), { linker });
    // invalid JSON, and no validation middleware: an error like any other
    const response = await send(app, "/x", { method: "POST", body: "{oops" });
    assert.equal(response.status, 500);
    assert.equal((linker.errors[0] as Error).name, "SyntaxError");
  });

  it("does not run validators without the validation middleware", async () => {
    class Ctrl {
      run(id: unknown) {
        return { id, type: typeof id };
      }
    }
    legacy(Get(":id"), Ctrl, "run");
    legacy(args(Param("id", number)), Ctrl, "run");
    Controller({ route: "x" })(Ctrl);
    const app = await create(feature([Ctrl]));
    assert.deepEqual(await (await send(app, "/x/7")).json(), {
      id: "7",
      type: "string",
    });
  });
});

describe("@Args, inherited handlers", () => {
  /** A base class with `GET :id`, which receives the id. */
  function base() {
    class Base {
      get(...values: unknown[]): unknown {
        return values.slice(0, -1);
      }
    }
    legacy(Get(":id"), Base, "get");
    legacy(args(Param("id")), Base, "get");
    return Base;
  }

  it("keeps the arguments of a handler it inherits", async () => {
    class Plain extends base() {}
    Controller({ route: "plain" })(Plain);
    class Overridden extends base() {
      override get(...values: unknown[]) {
        return ["overridden", ...values.slice(0, -1)];
      }
    }
    Controller({ route: "overridden" })(Overridden);
    const app = await create(feature([Plain, Overridden]));
    assert.deepEqual(await (await send(app, "/plain/7")).json(), ["7"]);
    assert.deepEqual(await (await send(app, "/overridden/7")).json(), [
      "overridden",
      "7",
    ]);
  });

  it("replaces them when the override declares @Args", async () => {
    class Replaced extends base() {
      override get(...values: unknown[]) {
        return values.slice(0, -1);
      }
    }
    // not added to the inherited list: the override has its own
    legacy(args(Query("a"), Query("b")), Replaced, "get");
    Controller({ route: "replaced" })(Replaced);
    const app = await create(feature([Replaced]));
    assert.deepEqual(await (await send(app, "/replaced/7?a=1&b=2")).json(), [
      "1",
      "2",
    ]);
  });
});

describe("Param, checked when the application is created", () => {
  it("rejects a name that is not a parameter of the full path", async () => {
    class Users {
      get() {}
    }
    legacy(Get(":id"), Users, "get");
    legacy(args(Param("id"), Param("userId")), Users, "get");
    Controller({ route: "users" })(Users);
    await assert.rejects(
      create(feature([Users], { route: "v1" }), "api"),
      {
        message:
          '@Args() of Users.get: Param("userId") is not a parameter of the route "/api/v1/users/:id"',
      },
    );
  });

  it("accepts a parameter of any of the four levels, and Param() without a key", async () => {
    class Posts {
      get(...values: unknown[]) {
        return values.slice(0, -1);
      }
    }
    legacy(Get(":post"), Posts, "get");
    legacy(
      args(
        Param("tenant"),
        Param("org"),
        Param("user"),
        Param("post"),
        Param(),
      ),
      Posts,
      "get",
    );
    Controller({ route: "users/:user/posts" })(Posts);
    const app = await create(feature([Posts], { route: ":org" }), ":tenant");
    assert.deepEqual(await (await send(app, "/t/o/users/u/posts/p")).json(), [
      "t",
      "o",
      "u",
      "p",
      { tenant: "t", org: "o", user: "u", post: "p" },
    ]);
  });
});

describe("@Doc", () => {
  it("writes its options on a class and on a method, on both decorator shapes", () => {
    const options = { summary: "Find a user", tags: ["users"] };
    function get() {}
    tc39(Doc(options), get, "get");
    assert.deepEqual(doc_of(tc39_record(get, "get") as object), options);

    class Users {
      get() {}
    }
    legacy(Doc(options), Users, "get");
    assert.deepEqual(
      (read_method_metadata(Users, "get") as Record<symbol, unknown>)[DOC],
      options,
    );
    assert.ok(Object.isFrozen(doc_of(read_method_metadata(Users, "get")!)));
  });

  it("rejects an unknown option", () => {
    assert.throws(() => Doc(loose({ tag: ["users"] })), {
      message:
        '@Doc(): unknown option "tag". Known options: deprecated, description, hidden, responses, summary, tags',
    });
  });

  it("rejects a handler option on a class", () => {
    class Users {}
    for (const key of ["summary", "responses"]) {
      assert.throws(() => Doc(loose({ [key]: "x" }))(Users), {
        message:
          `@Doc(): option "${key}" is for a handler, not for a class (class Users)`,
      });
    }
  });

  it("rejects a second @Doc", () => {
    class Users {
      get() {}
    }
    Doc({ tags: ["a"] })(Users);
    assert.throws(() => Doc({ tags: ["b"] })(Users), {
      message: "Cannot add @Doc() to class Users: it already has one.",
    });
    legacy(Doc({ summary: "a" }), Users, "get");
    assert.throws(() => legacy(Doc({ summary: "b" }), Users, "get"), {
      message: "Cannot add @Doc() to method get: it already has one.",
    });
  });
});

describe("the graph of an application", () => {
  it("exposes the arguments, the documentation and the validation of each handler", async () => {
    const id = Param("id", number);
    const body = Body(number);
    const responses = { 200: { description: "The user", schema: number } };
    class Users {
      get() {}
      list() {}
      create() {}
    }
    legacy(Get(":id"), Users, "get");
    legacy(args(id), Users, "get");
    legacy(Doc({ summary: "Find a user", responses }), Users, "get");
    legacy(Get(""), Users, "list");
    legacy(Post(""), Users, "create");
    legacy(args(body), Users, "create");
    legacy(Middlewares(validate()), Users, "create");
    // above and below @Controller
    Doc({ tags: ["users"], deprecated: true })(Users);
    Controller({ route: "users" })(Users);
    class Feature {}
    Module({ route: "v1", controllers: [Users] })(Feature);
    Doc({ description: "Version 1", hidden: true })(Feature);

    const app = await create(Feature);
    const [feat] = app.graph.features;
    assert.deepEqual(feat!.doc, { description: "Version 1", hidden: true });
    const [controller] = feat!.controllers;
    assert.deepEqual(controller!.doc, { tags: ["users"], deprecated: true });
    const [get, list, created] = controller!.methods;
    assert.deepEqual(get!.args, [id]);
    assert.deepEqual(get!.args[0]!.info, {
      source: "param",
      key: "id",
      validator: number,
    });
    assert.deepEqual(get!.doc, { summary: "Find a user", responses });
    assert.equal(get!.validated, false);
    // nothing declared
    assert.deepEqual([list!.args, list!.doc, list!.validated], [[], {}, false]);
    assert.deepEqual(created!.args, [body]);
    assert.equal(created!.validated, true);
  });

  it("marks as validated the handlers under a validated controller or feature", async () => {
    class A {
      run() {}
    }
    legacy(Get(""), A, "run");
    Controller({ route: "a" })(A);
    Middlewares(validate())(A);
    class B {
      run() {}
    }
    legacy(Get(""), B, "run");
    Controller({ route: "b" })(B);
    class Plain {}
    Module({ controllers: [A, B] })(Plain);
    class C {
      run() {}
    }
    legacy(Get(""), C, "run");
    Controller({ route: "c" })(C);
    class Validated {}
    Module({ controllers: [C] })(Validated);
    Middlewares(validate())(Validated);
    class App {}
    Module({ imports: [Plain, Validated] })(App);

    const app = await create(App);
    const validated = Object.fromEntries(
      app.graph.features.flatMap((f) =>
        f.controllers.map((c) => [c.route, c.methods[0]!.validated])
      ),
    );
    assert.deepEqual(validated, { a: true, b: false, c: true });
  });
});
