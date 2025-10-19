import { expect } from "@std/expect";
import {
  ArgTypeFunction,
  Body,
  Header,
  InputTypeFunction,
  Params,
  Query,
} from "./inputs.ts";
import { InvalidInputError } from "./errors.ts";
import { Context } from "./interfaces/mod.ts";

// Mock ChoWebContext for testing
function createMockContext(options: {
  params?: Record<string, string>;
  query?: Record<string, string | string[]>;
  headers?: Record<string, string | string[]>;
  body?: unknown;
  paramValue?: string;
  queryValue?: string | string[];
  headerValue?: string | string[];
}): Context {
  const cached: Record<string, unknown> = {};

  return {
    req: {
      param: (key?: string) => {
        if (key) return options.paramValue ?? options.params?.[key];
        return options.params ?? {};
      },
      query: (key?: string) => {
        if (key) return options.queryValue ?? options.query?.[key];
        return options.query ?? {};
      },
      header: (key?: string) => {
        if (key) return options.headerValue ?? options.headers?.[key];
        return options.headers ?? {};
      },
      json: () => Promise.resolve(options.body ?? {}),
    },
    get: (key: string) => cached[key],
    set: (key: string, value: unknown) => {
      cached[key] = value;
    },
  } as unknown as Context;
}

// Mock validator for testing
const mockValidator = {
  safeParse: (data: unknown) => ({ success: true, data, error: null }),
};

const mockFailingValidator = {
  safeParse: (data: unknown) => ({
    success: false,
    data: null,
    error: "Validation failed",
  }),
};

// // Test type exports
// Deno.test("ArgTypeFunction type is exported", () => {
//   // This is a compile-time test, if this compiles the export exists
//   const _fn: ArgTypeFunction = () => ({ type: "param" });
//   expect(typeof _fn).toBe("function");
// });
//
// Deno.test("InputTypeFunction type is exported", () => {
//   // This is a compile-time test, if this compiles the export exists
//   const _fn: InputTypeFunction = () => () => Promise.resolve("test");
//   expect(typeof _fn).toBe("function");
// });

// Test Params function
Deno.test("Params() - returns InputFactory that gets all params", async () => {
  const factory = Params();
  const ctx = createMockContext({
    params: { id: "123", name: "test" },
  });

  const result = await factory(ctx);
  expect(result).toEqual({ id: "123", name: "test" });
});

Deno.test("Params(key) - returns InputFactory that gets specific param", async () => {
  const factory = Params("id");
  const ctx = createMockContext({
    paramValue: "123",
  });

  const result = await factory(ctx);
  expect(result).toBe("123");
});

Deno.test("Params(validator) - returns InputFactory that validates all params", async () => {
  const factory = Params(mockValidator);
  const ctx = createMockContext({
    params: { id: "123" },
  });

  const result = await factory(ctx);
  expect(result).toEqual({ id: "123" });
});

Deno.test("Params(key, validator) - returns InputFactory that gets and validates specific param", async () => {
  const factory = Params("id", mockValidator);
  const ctx = createMockContext({
    paramValue: "123",
  });

  const result = await factory(ctx);
  expect(result).toBe("123");
});

Deno.test("Params with failing validator throws InvalidInputError", async () => {
  const factory = Params("id", mockFailingValidator);
  const ctx = createMockContext({
    paramValue: "invalid",
  });

  await expect(factory(ctx)).rejects.toThrow(InvalidInputError);
});

Deno.test("Params with failing validator includes proper error message", async () => {
  const factory = Params("id", mockFailingValidator);
  const ctx = createMockContext({
    paramValue: "invalid",
  });

  try {
    await factory(ctx);
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidInputError);
    expect((error as InvalidInputError).message).toBe(
      'Input validation failed at argument Params("id")',
    );
  }
});

Deno.test("Params with failing validator (no key) includes proper error message", async () => {
  const factory = Params(mockFailingValidator);
  const ctx = createMockContext({
    params: { id: "invalid" },
  });

  try {
    await factory(ctx);
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidInputError);
    expect((error as InvalidInputError).message).toBe(
      "Input validation failed at argument Params()",
    );
  }
});

// Test Body function
Deno.test("Body() - returns InputFactory that gets entire body", async () => {
  const factory = Body();
  const ctx = createMockContext({
    body: { name: "test", email: "test@example.com" },
  });

  const result = await factory(ctx);
  expect(result).toEqual({ name: "test", email: "test@example.com" });
});

Deno.test("Body(key) - returns InputFactory that gets specific body field", async () => {
  const factory = Body("name");
  const ctx = createMockContext({
    body: { name: "test", email: "test@example.com" },
  });

  const result = await factory(ctx);
  expect(result).toBe("test");
});

Deno.test("Body(validator) - returns InputFactory that validates entire body", async () => {
  const factory = Body(mockValidator);
  const ctx = createMockContext({
    body: { name: "test" },
  });

  const result = await factory(ctx);
  expect(result).toEqual({ name: "test" });
});

Deno.test("Body(key, validator) - returns InputFactory that gets and validates specific body field", async () => {
  const factory = Body("name", mockValidator);
  const ctx = createMockContext({
    body: { name: "test", email: "test@example.com" },
  });

  const result = await factory(ctx);
  expect(result).toBe("test");
});

Deno.test("Body caches parsed body in context", async () => {
  const factory1 = Body("name");
  const factory2 = Body("email");
  const ctx = createMockContext({
    body: { name: "test", email: "test@example.com" },
  });

  await factory1(ctx);
  const result2 = await factory2(ctx);

  // Second call should use cached body
  expect(result2).toBe("test@example.com");
  expect(ctx.get("--cached-body")).toEqual({
    name: "test",
    email: "test@example.com",
  });
});

Deno.test("Body with failing validator throws InvalidInputError", async () => {
  const factory = Body("name", mockFailingValidator);
  const ctx = createMockContext({
    body: { name: "invalid" },
  });

  await expect(factory(ctx)).rejects.toThrow(InvalidInputError);
});

// Test Query function
Deno.test("Query() - returns InputFactory that gets all query params", async () => {
  const factory = Query();
  const ctx = createMockContext({
    query: { page: "1", limit: "10" },
  });

  const result = await factory(ctx);
  expect(result).toEqual({ page: "1", limit: "10" });
});

Deno.test("Query(key) - returns InputFactory that gets specific query param", async () => {
  const factory = Query("page");
  const ctx = createMockContext({
    queryValue: "1",
  });

  const result = await factory(ctx);
  expect(result).toBe("1");
});

Deno.test("Query(validator) - returns InputFactory that validates all query params", async () => {
  const factory = Query(mockValidator);
  const ctx = createMockContext({
    query: { page: "1" },
  });

  const result = await factory(ctx);
  expect(result).toEqual({ page: "1" });
});

Deno.test("Query(key, validator) - returns InputFactory that gets and validates specific query param", async () => {
  const factory = Query("page", mockValidator);
  const ctx = createMockContext({
    queryValue: "1",
  });

  const result = await factory(ctx);
  expect(result).toBe("1");
});

Deno.test("Query with failing validator throws InvalidInputError", async () => {
  const factory = Query("page", mockFailingValidator);
  const ctx = createMockContext({
    queryValue: "invalid",
  });

  await expect(factory(ctx)).rejects.toThrow(InvalidInputError);
});

// Test Header function
Deno.test("Header() - returns InputFactory that gets all headers", async () => {
  const factory = Header();
  const ctx = createMockContext({
    headers: {
      "content-type": "application/json",
      "authorization": "Bearer token",
    },
  });

  const result = await factory(ctx);
  expect(result).toEqual({
    "content-type": "application/json",
    "authorization": "Bearer token",
  });
});

Deno.test("Header(key) - returns InputFactory that gets specific header", async () => {
  const factory = Header("authorization");
  const ctx = createMockContext({
    headerValue: "Bearer token",
  });

  const result = await factory(ctx);
  expect(result).toBe("Bearer token");
});

Deno.test("Header(validator) - returns InputFactory that validates all headers", async () => {
  const factory = Header(mockValidator);
  const ctx = createMockContext({
    headers: { "content-type": "application/json" },
  });

  const result = await factory(ctx);
  expect(result).toEqual({ "content-type": "application/json" });
});

Deno.test("Header(key, validator) - returns InputFactory that gets and validates specific header", async () => {
  const factory = Header("content-type", mockValidator);
  const ctx = createMockContext({
    headerValue: "application/json",
  });

  const result = await factory(ctx);
  expect(result).toBe("application/json");
});

Deno.test("Header with failing validator throws InvalidInputError", async () => {
  const factory = Header("content-type", mockFailingValidator);
  const ctx = createMockContext({
    headerValue: "invalid",
  });

  await expect(factory(ctx)).rejects.toThrow(InvalidInputError);
});

// Test error message formats for different input types
Deno.test("Body with failing validator (with key) includes proper error message", async () => {
  const factory = Body("email", mockFailingValidator);
  const ctx = createMockContext({
    body: { email: "invalid" },
  });

  try {
    await factory(ctx);
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidInputError);
    expect((error as InvalidInputError).message).toBe(
      'Input validation failed at argument Body("email")',
    );
  }
});

Deno.test("Query with failing validator (with key) includes proper error message", async () => {
  const factory = Query("page", mockFailingValidator);
  const ctx = createMockContext({
    queryValue: "invalid",
  });

  try {
    await factory(ctx);
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidInputError);
    expect((error as InvalidInputError).message).toBe(
      'Input validation failed at argument Query("page")',
    );
  }
});

Deno.test("Header with failing validator (with key) includes proper error message", async () => {
  const factory = Header("authorization", mockFailingValidator);
  const ctx = createMockContext({
    headerValue: "invalid",
  });

  try {
    await factory(ctx);
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidInputError);
    expect((error as InvalidInputError).message).toBe(
      'Input validation failed at argument Header("authorization")',
    );
  }
});

// Test edge cases
Deno.test("Body handles undefined body gracefully", async () => {
  const factory = Body("missing");
  const ctx = createMockContext({
    body: undefined,
  });

  const result = await factory(ctx);
  expect(result).toBeUndefined();
});

Deno.test("Body handles null body gracefully", async () => {
  const factory = Body("missing");
  const ctx = createMockContext({
    body: null,
  });

  const result = await factory(ctx);
  expect(result).toBeUndefined();
});

Deno.test("Params handles missing key gracefully", async () => {
  const factory = Params("missing");
  const ctx = createMockContext({
    paramValue: undefined,
  });

  const result = await factory(ctx);
  expect(result).toBeUndefined();
});

Deno.test("Query handles missing key gracefully", async () => {
  const factory = Query("missing");
  const ctx = createMockContext({
    queryValue: undefined,
  });

  const result = await factory(ctx);
  expect(result).toBeUndefined();
});

Deno.test("Header handles missing key gracefully", async () => {
  const factory = Header("missing");
  const ctx = createMockContext({
    headerValue: undefined,
  });

  const result = await factory(ctx);
  expect(result).toBeUndefined();
});

// Test that InvalidInputError includes the validation error details
Deno.test("InvalidInputError includes validation error details", async () => {
  const factory = Params("id", mockFailingValidator);
  const ctx = createMockContext({
    paramValue: "invalid",
  });

  try {
    await factory(ctx);
  } catch (error) {
    expect(error).toBeInstanceOf(InvalidInputError);
    expect((error as InvalidInputError).description).toBe("Validation failed");
  }
});
