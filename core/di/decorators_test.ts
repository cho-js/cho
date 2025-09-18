import { expect } from "@std/expect";
import {
  Catch,
  Controller,
  Dependencies,
  Deps,
  Injectable,
  Middlewares,
  Module,
} from "./decorators.ts";
import { readMetadataObject } from "../meta/mod.ts";

// sanity check only
// the DI tests are under "core/di/specs" directory

Deno.test("sanity - Injectable decorator should add metadata", () => {
  @Injectable({ deps: ["dep1", "dep2"] })
  class TestClass {}
  expect(readMetadataObject(TestClass)).toEqual({
    deps: ["dep1", "dep2"],
    isInjectable: true,
  });
});

Deno.test("sanity - Module decorator should add metadata", () => {
  @Module({ deps: ["dep1", "dep2"] })
  class TestClass {}
  expect(readMetadataObject(TestClass)).toEqual({
    deps: ["dep1", "dep2"],
    isModule: true,
  });
});

Deno.test("sanity - Controller decorator should add metadata", () => {
  @Controller("route")
  class TestClass {}
  expect(readMetadataObject(TestClass)).toEqual({
    route: "route",
    isGateway: true,
  });
});

Deno.test("sanity - Dependencies decorator should set deps metadata", () => {
  @Dependencies("dep1", "dep2")
  class TestClass {}
  expect(readMetadataObject(TestClass)).toEqual({ deps: ["dep1", "dep2"] });
});

Deno.test("sanity - Deps decorator should set deps metadata", () => {
  @Deps("dep1", "dep2")
  class TestClass {}
  expect(readMetadataObject(TestClass)).toEqual({ deps: ["dep1", "dep2"] });
});

Deno.test("sanity - Middlewares decorator should set middlewares metadata", () => {
  const fn1 = () => {};
  const fn2 = () => {};
  @Middlewares(fn1, fn2)
  class TestClass {}
  expect(readMetadataObject(TestClass)).toEqual({ middlewares: [fn1, fn2] });
});

Deno.test("sanity - Catch decorator should set middlewares metadata", () => {
  const fn1 = () => {};
  @Catch(fn1)
  class TestClass {}
  expect(readMetadataObject(TestClass)).toEqual({ errorHandler: fn1 });
});
