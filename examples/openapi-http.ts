#!/usr/bin/env -S deno run --allow-all
/**
 * An HTTP application with its documentation, with `@chojs/openapi`.
 *
 * - `UsersController` declares four handlers. Their arguments have
 *   validators, and `@Doc` says what the code cannot tell. A user that does
 *   not exist is an `HttpError`: the request is answered with its status.
 * - `openApi` mounts the OpenAPI document of the application, and a page that
 *   shows it. It is called three times here, to show the three clients:
 *
 *   | Page                | Client     |
 *   | ------------------- | ---------- |
 *   | `/docs`             | Swagger UI |
 *   | `/docs/scalar`      | Scalar     |
 *   | `/docs/redoc`       | Redoc      |
 *
 * The validators are written by hand, to need no library: `schema` gives an
 * object with a `parse` method, as `@chojs/web` wants, that also says its JSON
 * Schema the way a Zod schema does (Standard JSON Schema).
 *
 * Run it, and open http://localhost:8082/docs
 *
 * @module
 */
import {
  Args,
  Body,
  ChoWeb,
  type ChoWebValidator,
  Controller,
  Doc,
  Get,
  HttpError,
  Middlewares,
  Module,
  Param,
  Post,
  Query,
  validate,
} from "@chojs/web";
import { serve } from "@chojs/web/serve";
import { openApi } from "@chojs/openapi";

type User = { id: string; name: string; email: string };
type NewUser = Omit<User, "id">;
type Page = { page: number; size: number };

/**
 * A validator that says its own JSON Schema. A schema library does both from
 * one declaration: with Zod, `z.object({ name: z.string() })` is enough.
 */
function schema<T>(
  json: Record<string, unknown>,
  parse: (value: unknown) => T,
): ChoWebValidator<T> {
  return {
    parse,
    "~standard": {
      version: 1,
      vendor: "example",
      jsonSchema: { input: () => json, output: () => json },
    },
  } as ChoWebValidator<T>;
}

/** A string that is not empty, or an error. */
function text(value: unknown, name: string): string {
  if (typeof value !== "string" || value === "") {
    throw new Error(`${name} is required`);
  }
  return value;
}

const USER = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    email: { type: "string", format: "email" },
  },
  required: ["id", "name", "email"],
};

const UserSchema = schema<User>(USER, (value) => value as User);

const UsersSchema = schema<User[]>(
  { type: "array", items: USER },
  (value) => value as User[],
);

const NewUserSchema = schema<NewUser>({
  type: "object",
  properties: {
    name: { type: "string", minLength: 1 },
    email: { type: "string", format: "email" },
  },
  required: ["name", "email"],
}, (value) => {
  const { name, email } = (value ?? {}) as Record<string, unknown>;
  return { name: text(name, "name"), email: text(email, "email") };
});

const PageSchema = schema<Page>({
  type: "object",
  properties: {
    page: { type: "integer", minimum: 1, default: 1 },
    size: { type: "integer", minimum: 1, maximum: 100, default: 20 },
  },
}, (value) => {
  const { page, size } = (value ?? {}) as Record<string, string | undefined>;
  return { page: Number(page ?? 1), size: Number(size ?? 20) };
});

const users = new Map<string, User>([
  ["1", { id: "1", name: "Ada", email: "ada@example.com" }],
]);

@Doc({ tags: ["users"], security: [{ bearer: [] }] })
@Middlewares(validate())
@Controller({ route: "users" })
export class UsersController {
  @Doc({
    summary: "List the users",
    security: [], // public
    responses: { 200: { description: "A page of users", schema: UsersSchema } },
  })
  @Get("")
  @Args(Query(PageSchema))
  list({ page, size }: Page) {
    return [...users.values()].slice((page - 1) * size, page * size);
  }

  @Doc({
    summary: "Find a user",
    responses: {
      200: { description: "The user", schema: UserSchema },
      404: { description: "No such user" },
    },
  })
  @Get(":id")
  @Args(Param("id"))
  get(id: string) {
    const user = users.get(id);
    if (!user) {
      // Answered 404, with { "error": "no such user" }.
      throw new HttpError(404, "no such user");
    }
    return user;
  }

  @Doc({
    summary: "Create a user",
    operationId: "createUser",
    responses: { 201: { description: "The new user", schema: UserSchema } },
  })
  @Post("")
  @Args(Body(NewUserSchema))
  create(user: NewUser) {
    const created = { id: String(users.size + 1), ...user };
    users.set(created.id, created);
    return Response.json(created, { status: 201 });
  }

  @Doc({
    summary: "The avatar of a user",
    deprecated: true,
    responses: {
      200: { description: "An image", contentType: "image/svg+xml" },
    },
  })
  @Get(":id/avatar")
  @Args(Param("id"))
  avatar(id: string) {
    const letter = users.get(id)?.name[0] ?? "?";
    return new Response(
      `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#c2410c"/><text x="32" y="42" font-size="32" text-anchor="middle" fill="#fff">${letter}</text></svg>`,
      { headers: { "content-type": "image/svg+xml" } },
    );
  }
}

@Module({ controllers: [UsersController] })
export class AppModule {}

const app = await ChoWeb.create(AppModule, { prefix: "api" });

const documentation = {
  info: {
    title: "Users",
    version: "1.0.0",
    description: "An example of `@chojs/openapi`.",
  },
  tags: { users: "The users of the application" },
  securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
} as const;

// One call is enough: three, to show the three clients.
openApi(app, { ...documentation }); //                             /docs
openApi(app, { ...documentation, route: "docs/scalar", ui: "scalar" });
openApi(app, { ...documentation, route: "docs/redoc", ui: "redoc" });

const server = await serve(app.handler, { port: 8082 });
console.log(`http://localhost:${server.port}/docs`);
for (const route of app.routes) {
  console.log(`  ${route.method} ${route.path}`);
}
