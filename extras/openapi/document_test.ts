/**
 * Tests for `document.ts`: the OpenAPI document of an application, from its
 * graph. The operations, their parameters, their request bodies and their
 * responses come from what the application declares.
 *
 * Decorators are applied as plain function calls.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  Body,
  Controller,
  Delete,
  Doc,
  Form,
  Get,
  Head,
  Header,
  Middlewares,
  Module,
  Options,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Sse,
  validate,
} from "@chojs/web";
import { legacy, loose } from "@chojs/core/utils/test_utils";
import { openApiDocument } from "./document.ts";
import {
  args,
  type Class,
  create,
  plain,
  schema_only,
  send,
  standard,
} from "./testing.ts";
import type { OpenApiDocument, OpenApiOperation } from "./types.ts";

const INFO = { title: "Shop", version: "1.0.0" };

/** A feature module of controllers. */
function module_of(controllers: Class[], route = ""): Class {
  class App {}
  Module({ route, controllers })(App);
  return App;
}

/** The document of a feature module of controllers. */
async function document_of(
  controllers: Class[],
  options: Record<string, unknown> = {},
): Promise<OpenApiDocument> {
  const app = await create(module_of(controllers));
  return openApiDocument(app, loose({ info: INFO, ...options }));
}

/** The one operation of a controller `Users` with one handler, `GET x`. */
async function operation_of(
  decorate: (users: Class) => void,
  options: Record<string, unknown> = {},
  route = "x",
): Promise<OpenApiOperation> {
  class Users {
    get() {}
  }
  legacy(Get(route), Users, "get");
  decorate(Users);
  Controller({})(Users);
  const document = await document_of([Users], options);
  const [item] = Object.values(document.paths);
  return item!.get!;
}

describe("openApiDocument, the document", () => {
  it("is an OpenAPI 3.1.1 document of the application", async () => {
    class Users {
      list() {}
    }
    legacy(Get(""), Users, "list");
    Controller({ route: "users" })(Users);
    const document = await document_of([Users]);
    assert.deepEqual(document, {
      openapi: "3.1.1",
      info: { title: "Shop", version: "1.0.0" },
      paths: {
        "/users": {
          get: {
            operationId: "Users.list",
            tags: ["Users"],
            responses: { 200: { description: "OK" } },
          },
        },
      },
    });
    // what JSON has: the document is served as JSON
    assert.deepEqual(JSON.parse(JSON.stringify(document)), document);
  });

  it("writes what the options say", async () => {
    const info = {
      ...INFO,
      description: "The API of the shop",
      license: { name: "MIT" },
    };
    const options = {
      info,
      servers: [{ url: "https://api.example.com", description: "Production" }],
      tags: { users: "The users of the shop", orders: "Their orders" },
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer" },
        key: { type: "apiKey", name: "x-key", in: "header" },
      },
      security: [{ bearer: [] }, { key: [] }],
      externalDocs: { url: "https://example.com/docs" },
    };
    const document = await document_of([], options);
    assert.deepEqual(document, {
      openapi: "3.1.1",
      info,
      servers: options.servers,
      tags: [
        { name: "users", description: "The users of the shop" },
        { name: "orders", description: "Their orders" },
      ],
      paths: {},
      components: { securitySchemes: options.securitySchemes },
      security: [{ bearer: [] }, { key: [] }],
      externalDocs: options.externalDocs,
    });
    // a document of its own: changing it changes nothing of the options
    document.info.title = "changed";
    document.servers![0]!.url = "changed";
    (document.security![0]!.bearer as string[]).push("x");
    assert.equal(info.title, "Shop");
    assert.equal(options.servers[0]!.url, "https://api.example.com");
    assert.deepEqual(options.security[0], { bearer: [] });
  });

  it("is a new document each time", async () => {
    class Users {
      list() {}
    }
    legacy(Get(""), Users, "list");
    Controller({})(Users);
    const app = await create(module_of([Users]));
    const first = openApiDocument(app, { info: INFO });
    const second = openApiDocument(app, { info: INFO });
    assert.notEqual(first, second);
    assert.notEqual(first.paths["/"], second.paths["/"]);
    assert.deepEqual(first, second);
  });

  it("needs an info with a title and a version", async () => {
    const app = await create(module_of([]));
    const message =
      'openApiDocument(): the "info" option is required: { title: "My API", version: "1.0.0" }';
    for (
      const options of [
        {},
        { info: {} },
        { info: { title: "Shop" } },
        { info: { version: "1" } },
        { info: { title: "", version: "1" } },
        { info: "Shop" },
      ]
    ) {
      assert.throws(() => openApiDocument(app, loose(options)), {
        code: "CHO_OPENAPI_INVALID_OPTION",
        message,
      });
    }
    assert.throws(() => openApiDocument(app, loose(undefined)), {
      code: "CHO_OPENAPI_INVALID_OPTION",
      message: /^openApiDocument\(\): expected options/,
    });
  });

  it("names an unknown option, and the known ones", async () => {
    const app = await create(module_of([]));
    assert.throws(
      () => openApiDocument(app, loose({ info: INFO, server: [] })),
      {
        code: "CHO_CORE_UNKNOWN_OPTION",
        message:
          'openApiDocument(): unknown option "server". Known options: externalDocs, info, security, securitySchemes, servers, tags, toJsonSchema',
      },
    );
  });
});

describe("openApiDocument, the operations", () => {
  it("has one operation for each handler, by path and method", async () => {
    class Users {
      list() {}
      create() {}
      get() {}
      replace() {}
      update() {}
      remove() {}
      head() {}
      options() {}
    }
    legacy(Get(""), Users, "list");
    legacy(Post(""), Users, "create");
    legacy(Get(":id"), Users, "get");
    legacy(Put(":id"), Users, "replace");
    legacy(Patch(":id"), Users, "update");
    legacy(Delete(":id"), Users, "remove");
    legacy(Head(":id"), Users, "head");
    legacy(Options(":id"), Users, "options");
    Controller({ route: "users" })(Users);
    class Posts {
      of_user() {}
    }
    legacy(Get(":user/posts/:post"), Posts, "of_user");
    Controller({ route: "users" })(Posts);

    const app = await create(module_of([Users, Posts], "v1"), "api");
    const document = openApiDocument(app, { info: INFO });

    assert.deepEqual(
      Object.entries(document.paths).map((
        [path, item],
      ) => [path, Object.keys(item)]),
      [
        ["/api/v1/users", ["get", "post"]],
        ["/api/v1/users/{id}", [
          "get",
          "put",
          "patch",
          "delete",
          "head",
          "options",
        ]],
        ["/api/v1/users/{user}/posts/{post}", ["get"]],
      ],
    );
    // the paths are those of the routes of the application
    const of_routes = app.routes.map((route) =>
      `${route.method} ${route.path.replace(/:(\w+)/g, "{$1}")}`
    );
    const of_document = Object.entries(document.paths).flatMap((
      [path, item],
    ) => Object.keys(item).map((method) => `${method.toUpperCase()} ${path}`));
    assert.deepEqual(of_document, of_routes);
  });

  it("leaves out what is hidden, on a handler, a controller or a feature", async () => {
    class Users {
      shown() {}
      hidden() {}
    }
    legacy(Get("shown"), Users, "shown");
    legacy(Get("hidden"), Users, "hidden");
    legacy(Doc({ hidden: true }), Users, "hidden");
    Controller({})(Users);
    class Internal {
      get() {}
    }
    legacy(Get("internal"), Internal, "get");
    Doc({ hidden: true })(Internal);
    Controller({})(Internal);
    class Admin {
      get() {}
    }
    legacy(Get("admin"), Admin, "get");
    Controller({})(Admin);
    class AdminModule {}
    Module({ controllers: [Admin] })(AdminModule);
    Doc({ hidden: true })(AdminModule);
    class App {}
    Module({ imports: [AdminModule], controllers: [Users, Internal] })(App);

    const document = openApiDocument(await create(App), { info: INFO });
    assert.deepEqual(Object.keys(document.paths), ["/shown"]);
  });

  it("leaves out the routes mounted on the application", async () => {
    class Users {
      list() {}
    }
    legacy(Get("users"), Users, "list");
    Controller({})(Users);
    const app = await create(module_of([Users]));
    app.mount("GET", "health", () => "ok");
    const document = openApiDocument(app, { info: INFO });
    assert.deepEqual(Object.keys(document.paths), ["/users"]);
  });

  it("names an operation after its handler, or as its @Doc says", async () => {
    class UsersController {
      list() {}
      get() {}
    }
    legacy(Get(""), UsersController, "list");
    legacy(Get(":id"), UsersController, "get");
    legacy(Doc({ operationId: "getUser" }), UsersController, "get");
    Controller({ route: "users" })(UsersController);
    const document = await document_of([UsersController]);
    assert.equal(
      document.paths["/users"]!.get!.operationId,
      "UsersController.list",
    );
    assert.equal(document.paths["/users/{id}"]!.get!.operationId, "getUser");
  });

  it("rejects two operations with one operationId", async () => {
    class Users {
      list() {}
      all() {}
    }
    legacy(Get("a"), Users, "list");
    legacy(Doc({ operationId: "users" }), Users, "list");
    legacy(Get("b"), Users, "all");
    legacy(Doc({ operationId: "users" }), Users, "all");
    Controller({})(Users);
    await assert.rejects(document_of([Users]), {
      code: "CHO_OPENAPI_DUPLICATE_OPERATION_ID",
      message:
        'openApiDocument(): the operationId "users" is used by Users.list and Users.all',
    });
  });

  it("adds up the tags of the feature, the controller and the handler", async () => {
    class Users {
      list() {}
      get() {}
    }
    legacy(Get(""), Users, "list");
    legacy(Get(":id"), Users, "get");
    legacy(Doc({ tags: ["read", "users"] }), Users, "get");
    Doc({ tags: ["users"] })(Users);
    Controller({ route: "users" })(Users);
    class App {}
    Module({ controllers: [Users] })(App);
    Doc({ tags: ["v1"] })(App);

    const document = openApiDocument(await create(App), { info: INFO });
    assert.deepEqual(document.paths["/users"]!.get!.tags, ["v1", "users"]);
    // each tag once
    assert.deepEqual(document.paths["/users/{id}"]!.get!.tags, [
      "v1",
      "users",
      "read",
    ]);
  });

  it("tags a handler that has no tag with its controller", async () => {
    class UsersController {
      get() {}
    }
    legacy(Get("a"), UsersController, "get");
    Controller({})(UsersController);
    class Orders {
      get() {}
    }
    legacy(Get("b"), Orders, "get");
    Controller({})(Orders);
    // a class that is named `Controller` keeps its name
    const Bare = (() => {
      class Controller {
        get() {}
      }
      return Controller;
    })();
    legacy(Get("c"), Bare, "get");
    Controller({})(Bare);

    const document = await document_of([UsersController, Orders, Bare]);
    assert.deepEqual(document.paths["/a"]!.get!.tags, ["Users"]);
    assert.deepEqual(document.paths["/b"]!.get!.tags, ["Orders"]);
    assert.deepEqual(document.paths["/c"]!.get!.tags, ["Controller"]);
  });

  it("writes the summary and the description of the handler", async () => {
    const operation = await operation_of((Users) => {
      legacy(
        Doc({ summary: "Find a user", description: "By its id." }),
        Users,
        "get",
      );
      // the description of a controller is not one of an operation
      Doc({ description: "The users" })(Users);
    });
    assert.equal(operation.summary, "Find a user");
    assert.equal(operation.description, "By its id.");
    const bare = await operation_of(() => {});
    assert.equal("summary" in bare, false);
    assert.equal("description" in bare, false);
    assert.equal("deprecated" in bare, false);
    assert.equal("security" in bare, false);
  });

  it("marks deprecated what is, on any of the three levels", async () => {
    for (const level of ["handler", "controller", "feature"]) {
      class Users {
        get() {}
      }
      legacy(Get("x"), Users, "get");
      if (level === "handler") {
        legacy(Doc({ deprecated: true }), Users, "get");
      }
      if (level === "controller") {
        Doc({ deprecated: true })(Users);
      }
      Controller({})(Users);
      class App {}
      Module({ controllers: [Users] })(App);
      if (level === "feature") {
        Doc({ deprecated: true })(App);
      }
      const document = openApiDocument(await create(App), { info: INFO });
      assert.equal(document.paths["/x"]!.get!.deprecated, true, level);
    }
  });
});

describe("openApiDocument, security", () => {
  const securitySchemes = {
    bearer: { type: "http", scheme: "bearer" },
    oauth: { type: "oauth2", flows: {} },
  };

  it("takes the security of the nearest @Doc", async () => {
    class Users {
      inherited() {}
      own() {}
      open() {}
    }
    legacy(Get("inherited"), Users, "inherited");
    legacy(Get("own"), Users, "own");
    legacy(Doc({ security: [{ oauth: ["read", "write"] }] }), Users, "own");
    legacy(Get("open"), Users, "open");
    legacy(Doc({ security: [] }), Users, "open");
    Doc({ security: [{ bearer: [] }] })(Users);
    Controller({})(Users);
    class Other {
      get() {}
    }
    legacy(Get("other"), Other, "get");
    Controller({})(Other);
    class App {}
    Module({ controllers: [Users, Other] })(App);
    Doc({ security: [{ oauth: [] }] })(App);

    const document = openApiDocument(await create(App), {
      info: INFO,
      securitySchemes: loose(securitySchemes),
    });
    const security = (path: string) => document.paths[path]!.get!.security;
    assert.deepEqual(security("/inherited"), [{ bearer: [] }]);
    assert.deepEqual(security("/own"), [{ oauth: ["read", "write"] }]);
    assert.deepEqual(security("/open"), []); // public
    assert.deepEqual(security("/other"), [{ oauth: [] }]); // the feature's
  });

  it("rejects a scheme the document does not have", async () => {
    class Users {
      get() {}
    }
    legacy(Get("x"), Users, "get");
    legacy(Doc({ security: [{ bearer: [] }, { key: [] }] }), Users, "get");
    Controller({})(Users);
    await assert.rejects(document_of([Users], { securitySchemes }), {
      code: "CHO_OPENAPI_UNKNOWN_SECURITY_SCHEME",
      message:
        'openApiDocument(): Users.get requires the security scheme "key", which is not in the "securitySchemes" option',
    });
    await assert.rejects(document_of([], { security: [{ bearer: [] }] }), {
      code: "CHO_OPENAPI_UNKNOWN_SECURITY_SCHEME",
      message:
        'openApiDocument(): the "security" option requires the security scheme "bearer", which is not in the "securitySchemes" option',
    });
  });
});

describe("openApiDocument, the parameters", () => {
  it("documents a parameter read by its key, with the schema of its validator", async () => {
    const operation = await operation_of(
      (Users) =>
        legacy(
          args(
            Param("id", standard({ type: "string", format: "uuid" })),
            Query("page", standard({ type: "integer" })),
            Query("sort"),
            Header("x-tenant", standard({ type: "string" })),
          ),
          Users,
          "get",
        ),
      {},
      "users/:id",
    );
    assert.deepEqual(operation.parameters, [
      {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
      { name: "page", in: "query", schema: { type: "integer" } },
      // no validator: a string
      { name: "sort", in: "query", schema: { type: "string" } },
      { name: "x-tenant", in: "header", schema: { type: "string" } },
    ]);
  });

  it("documents every parameter of the path, in its order", async () => {
    const operation = await operation_of(
      (Users) =>
        legacy(
          args(Query("q"), Param("post", standard({ type: "integer" }))),
          Users,
          "get",
        ),
      {},
      "users/:user/posts/:post",
    );
    assert.deepEqual(operation.parameters, [
      // no argument reads it: a required string
      { name: "user", in: "path", required: true, schema: { type: "string" } },
      { name: "post", in: "path", required: true, schema: { type: "integer" } },
      { name: "q", in: "query", schema: { type: "string" } },
    ]);
  });

  it("gives a parameter for each property of a whole source", async () => {
    const page = standard({
      type: "object",
      properties: { page: { type: "integer" }, size: { type: "integer" } },
      required: ["page"],
    });
    const operation = await operation_of(
      (Users) =>
        legacy(
          args(
            Query(page),
            Header(standard({
              type: "object",
              properties: { "x-tenant": { type: "string" } },
              required: ["x-tenant"],
            })),
            Param(standard({
              type: "object",
              properties: { id: { type: "string", format: "uuid" } },
            })),
          ),
          Users,
          "get",
        ),
      {},
      "users/:id",
    );
    assert.deepEqual(operation.parameters, [
      {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      },
      {
        name: "page",
        in: "query",
        required: true,
        schema: { type: "integer" },
      },
      { name: "size", in: "query", schema: { type: "integer" } },
      {
        name: "x-tenant",
        in: "header",
        required: true,
        schema: { type: "string" },
      },
    ]);
  });

  it("reads the properties of a whole source through a reference", async () => {
    const operation = await operation_of((Users) =>
      legacy(
        args(Query(standard({
          $ref: "#/$defs/Page",
          $defs: {
            Page: {
              type: "object",
              properties: { page: { type: "integer" } },
            },
          },
        }))),
        Users,
        "get",
      )
    );
    assert.deepEqual(operation.parameters, [
      { name: "page", in: "query", schema: { type: "integer" } },
    ]);
  });

  it("gives no parameter for a whole source that says nothing", async () => {
    const operation = await operation_of((Users) =>
      legacy(
        args(
          Query(),
          Header(),
          Query(plain()),
          Header(standard({ type: "string" })), // not an object
        ),
        Users,
        "get",
      )
    );
    assert.equal("parameters" in operation, false);
  });

  it("documents a parameter once: the first argument that has a schema", async () => {
    const operation = await operation_of((Users) =>
      legacy(
        args(
          Query("page"),
          Query("page", standard({ type: "integer" })),
          Query("page", standard({ type: "number" })),
        ),
        Users,
        "get",
      )
    );
    assert.deepEqual(operation.parameters, [
      { name: "page", in: "query", schema: { type: "integer" } },
    ]);
  });

  it("leaves out an argument of the application's own", async () => {
    const operation = await operation_of((Users) =>
      legacy(args(() => "user", Query("q")), Users, "get")
    );
    assert.deepEqual(operation.parameters, [
      { name: "q", in: "query", schema: { type: "string" } },
    ]);
  });

  it("asks the validator of an argument for its input", async () => {
    const operation = await operation_of((Users) =>
      legacy(
        args(
          Query("page", standard({ type: "string" }, { type: "integer" })),
        ),
        Users,
        "get",
      )
    );
    assert.deepEqual(operation.parameters![0]!.schema, { type: "string" });
  });
});

describe("openApiDocument, the request body", () => {
  const user = { type: "object", properties: { name: { type: "string" } } };

  it("documents a whole JSON body, required", async () => {
    const operation = await operation_of((Users) =>
      legacy(args(Body(standard(user))), Users, "get")
    );
    assert.deepEqual(operation.requestBody, {
      required: true,
      content: { "application/json": { schema: user } },
    });
  });

  it("documents, and validates, with one Standard Schema that has no parse method", async () => {
    const named = schema_only(
      user,
      (value) => typeof (value as { name?: unknown } | null)?.name === "string",
    );
    class Users {
      add(body: unknown) {
        return body;
      }
    }
    legacy(Post("x"), Users, "add");
    legacy(args(Body(named)), Users, "add");
    legacy(Middlewares(validate()), Users, "add");
    Controller({})(Users);
    const app = await create(module_of([Users]));

    const document = openApiDocument(app, { info: INFO });
    assert.deepEqual(document.paths["/x"]!.post!.requestBody, {
      required: true,
      content: { "application/json": { schema: user } },
    });
    const post = (body: string) => send(app, "/x", { method: "POST", body });
    assert.equal((await post('{"name":"Ada"}')).status, 200);
    const refused = await post('{"name":1}');
    assert.equal(refused.status, 400);
    assert.deepEqual((await refused.json()).issues, [{ message: "not valid" }]);
  });

  it("documents a body with no validator, without a schema", async () => {
    const operation = await operation_of((Users) =>
      legacy(args(Body()), Users, "get")
    );
    assert.deepEqual(operation.requestBody, {
      required: true,
      content: { "application/json": { schema: {} } },
    });
  });

  it("makes one object of the properties read by key", async () => {
    const operation = await operation_of((Users) =>
      legacy(
        args(
          Body("name", standard({ type: "string" })),
          Body("age", standard({ type: "integer" })),
          Body("note"),
        ),
        Users,
        "get",
      )
    );
    assert.deepEqual(operation.requestBody, {
      content: {
        "application/json": {
          schema: {
            type: "object",
            properties: {
              name: { type: "string" },
              age: { type: "integer" },
              note: {},
            },
          },
        },
      },
    });
  });

  it("documents a form as a URL-encoded body", async () => {
    const whole = await operation_of((Users) =>
      legacy(args(Form(standard(user))), Users, "get")
    );
    assert.deepEqual(whole.requestBody, {
      required: true,
      content: { "application/x-www-form-urlencoded": { schema: user } },
    });
    const by_key = await operation_of((Users) =>
      legacy(args(Form("name", standard({ type: "string" }))), Users, "get")
    );
    assert.deepEqual(by_key.requestBody, {
      content: {
        "application/x-www-form-urlencoded": {
          schema: { type: "object", properties: { name: { type: "string" } } },
        },
      },
    });
  });

  it("gives both media types to a handler that reads both", async () => {
    const operation = await operation_of((Users) =>
      legacy(args(Body(standard(user)), Form("name")), Users, "get")
    );
    assert.deepEqual(operation.requestBody, {
      required: true,
      content: {
        "application/json": { schema: user },
        "application/x-www-form-urlencoded": {
          schema: { type: "object", properties: { name: {} } },
        },
      },
    });
  });

  it("has no request body without a body argument", async () => {
    const operation = await operation_of((Users) =>
      legacy(args(Query("q")), Users, "get")
    );
    assert.equal("requestBody" in operation, false);
  });
});

describe("openApiDocument, the responses", () => {
  const user = { type: "object", properties: { id: { type: "string" } } };

  it("documents the responses of @Doc, with the output of their schemas", async () => {
    const operation = await operation_of((Users) =>
      legacy(
        Doc({
          responses: {
            200: {
              description: "The user",
              schema: standard({ type: "string" }, user),
            },
            404: { description: "No such user" },
          },
        }),
        Users,
        "get",
      )
    );
    assert.deepEqual(operation.responses, {
      200: {
        description: "The user",
        content: { "application/json": { schema: user } },
      },
      404: { description: "No such user" },
    });
  });

  it("describes a response that has no description by its status", async () => {
    const operation = await operation_of((Users) =>
      legacy(
        Doc({ responses: { 201: {}, 404: {}, 418: {}, 599: {} } }),
        Users,
        "get",
      )
    );
    assert.deepEqual(operation.responses, {
      201: { description: "Created" },
      404: { description: "Not Found" },
      418: { description: "Response" },
      599: { description: "Response" },
    });
  });

  it("writes the media type of a response", async () => {
    const operation = await operation_of((Users) =>
      legacy(
        Doc({
          responses: {
            200: { contentType: "image/png" },
            202: {
              contentType: "text/csv",
              schema: standard({ type: "string" }),
            },
            // a validator with no schema: the media type alone
            203: { schema: plain() },
          },
        }),
        Users,
        "get",
      )
    );
    assert.deepEqual(operation.responses, {
      200: { description: "OK", content: { "image/png": {} } },
      202: {
        description: "Accepted",
        content: { "text/csv": { schema: { type: "string" } } },
      },
      203: { description: "Response", content: { "application/json": {} } },
    });
  });

  it("adds a 200 to a handler that declares no success", async () => {
    const bare = await operation_of(() => {});
    assert.deepEqual(bare.responses, { 200: { description: "OK" } });
    const with_error = await operation_of((Users) =>
      legacy(Doc({ responses: { 404: {} } }), Users, "get")
    );
    assert.deepEqual(with_error.responses, {
      200: { description: "OK" },
      404: { description: "Not Found" },
    });
    const with_success = await operation_of((Users) =>
      legacy(Doc({ responses: { 204: {} } }), Users, "get")
    );
    assert.deepEqual(with_success.responses, {
      204: { description: "No Content" },
    });
  });

  it("documents an event stream", async () => {
    class Feed {
      events() {}
      declared() {}
    }
    legacy(loose(Sse("events")), Feed, "events");
    legacy(loose(Sse("declared")), Feed, "declared");
    legacy(
      Doc({ responses: { 200: { description: "The feed" } } }),
      Feed,
      "declared",
    );
    Controller({})(Feed);
    const document = await document_of([Feed]);
    assert.deepEqual(document.paths["/events"]!.get!.responses, {
      200: {
        description: "OK",
        content: { "text/event-stream": { schema: { type: "string" } } },
      },
    });
    // what the handler declares stays as it is
    assert.deepEqual(document.paths["/declared"]!.get!.responses, {
      200: { description: "The feed" },
    });
  });

  it("adds the 400 of validate() to a handler it covers", async () => {
    const validated = (
      decorate: (users: Class) => void,
      with_validate = true,
    ) =>
      operation_of((Users) => {
        decorate(Users);
        if (with_validate) {
          legacy(Middlewares(validate()), Users, "get");
        }
      });
    const page = () => Query("page", standard({ type: "integer" }));

    const covered = await validated((Users) =>
      legacy(args(page()), Users, "get")
    );
    assert.deepEqual(covered.responses, {
      200: { description: "OK" },
      400: { description: "The request is not valid" },
    });
    // not covered by validate()
    const uncovered = await validated(
      (Users) => legacy(args(page()), Users, "get"),
      false,
    );
    assert.deepEqual(Object.keys(uncovered.responses), ["200"]);
    // nothing to validate
    const no_validator = await validated((Users) =>
      legacy(args(Query("page")), Users, "get")
    );
    assert.deepEqual(Object.keys(no_validator.responses), ["200"]);
    // the handler says what its 400 is
    const declared = await validated((Users) => {
      legacy(args(page()), Users, "get");
      legacy(
        Doc({ responses: { 400: { description: "Bad page" } } }),
        Users,
        "get",
      );
    });
    assert.deepEqual(declared.responses[400], { description: "Bad page" });
  });
});

describe("openApiDocument, the schemas", () => {
  it("asks the toJsonSchema option for a validator that gives no schema", async () => {
    const page = plain();
    const user = plain();
    const seen: unknown[] = [];
    const operation = await operation_of(
      (Users) => {
        legacy(args(Query("page", page)), Users, "get");
        legacy(Doc({ responses: { 200: { schema: user } } }), Users, "get");
      },
      {
        toJsonSchema: (validator: unknown, io: string) => {
          seen.push([validator === page ? "page" : "user", io]);
          return validator === page ? { type: "integer" } : undefined;
        },
      },
    );
    assert.deepEqual(operation.parameters![0]!.schema, { type: "integer" });
    // no schema: the response is documented without one
    assert.deepEqual(operation.responses[200], {
      description: "OK",
      content: { "application/json": {} },
    });
    assert.deepEqual(seen, [["page", "input"], ["user", "output"]]);
  });

  it("puts the definitions of the schemas in the components, once", async () => {
    const user = () =>
      standard({
        $schema: "https://json-schema.org/draft/2020-12/schema",
        $ref: "#/$defs/User",
        $defs: { User: { type: "object" } },
      });
    class Users {
      create() {}
      get() {}
    }
    legacy(Post("users"), Users, "create");
    legacy(args(Body(user())), Users, "create");
    legacy(Get("users/:id"), Users, "get");
    legacy(Doc({ responses: { 200: { schema: user() } } }), Users, "get");
    Controller({})(Users);

    const document = await document_of([Users]);
    const ref = { $ref: "#/components/schemas/User" };
    assert.deepEqual(document.components, {
      schemas: { User: { type: "object" } },
    });
    assert.deepEqual(
      document.paths["/users"]!.post!.requestBody!.content,
      { "application/json": { schema: ref } },
    );
    assert.deepEqual(
      document.paths["/users/{id}"]!.get!.responses[200]!.content,
      { "application/json": { schema: ref } },
    );
  });

  it("converts a validator once, however many handlers use it", async () => {
    const calls: string[] = [];
    const page = standard({ type: "integer" }, { type: "integer" }, calls);
    class Users {
      a() {}
      b() {}
    }
    legacy(Get("a"), Users, "a");
    legacy(args(Query("page", page)), Users, "a");
    legacy(Get("b"), Users, "b");
    legacy(args(Query("page", page)), Users, "b");
    Controller({})(Users);
    const document = await document_of([Users]);
    assert.equal(calls.length, 1);
    // each use has a schema of its own
    const schema = (path: string) =>
      document.paths[path]!.get!.parameters![0]!.schema;
    assert.deepEqual(schema("/a"), schema("/b"));
    assert.notEqual(schema("/a"), schema("/b"));
  });
});
