import { stub } from "@std/testing/mock";
import { expect } from "@std/expect";
import { env, envbool, envnum } from "./env.ts";

Deno.test("should read environment variables", () => {
  const envStub = stub(Deno.env, "get", () => "value");
  expect(env("key")).toBe("value");
  envStub.restore();
});

Deno.test("should read environment variables as number", () => {
  const envStub = stub(Deno.env, "get", () => "44");
  expect(envnum("key")).toBe(44);
  envStub.restore();
});

Deno.test("should read environment variables as number (nan)", () => {
  const envStub = stub(Deno.env, "get", () => "not a number");
  expect(envnum("key")).toBe(NaN);
  envStub.restore();
});

Deno.test("should read environment variables as bool true (1)", () => {
  const envStub = stub(Deno.env, "get", () => "1");
  expect(envbool("key")).toBe(true);
  envStub.restore();
});

Deno.test("should read environment variables as bool true (true)", () => {
  const envStub = stub(Deno.env, "get", () => "true");
  expect(envbool("key")).toBe(true);
  envStub.restore();
});

Deno.test("should read environment variables as bool true (yes)", () => {
  const envStub = stub(Deno.env, "get", () => "yes");
  expect(envbool("key")).toBe(true);
  envStub.restore();
});

Deno.test("should read environment variables as bool true (on)", () => {
  const envStub = stub(Deno.env, "get", () => "on");
  expect(envbool("key")).toBe(true);
  envStub.restore();
});

Deno.test("should read environment variables as bool false (any)", () => {
  const envStub = stub(Deno.env, "get", () => "any value");
  expect(envbool("key")).toBe(false);
  envStub.restore();
});
