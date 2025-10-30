import { expect } from "@std/expect";
import { Injectable, Module } from "../decorators.ts";
import { Injector } from "./injector.ts";
import { test } from "../testing/mod.ts";


test("Injector.get should create new injector for module", async () => {
  @Module({})
  class TestModule {}

  const injector = await Injector.get(TestModule);
  expect(injector).toBeDefined();
  expect(injector.ctr).toBe(TestModule);
});

test("Injector.get should return cached injector", async () => {
  @Module({})
  class TestModule {}

  const injector1 = await Injector.get(TestModule);
  const injector2 = await Injector.get(TestModule);

  expect(injector1).toBe(injector2);
});

test("Injector.get should resolve module dependencies", async () => {
  @Module({
    providers: [
      { provide: "config", factory: () => ({ apiUrl: "test" }) },
    ],
    deps: ["config"],
  })
  class TestModule {
    constructor(readonly config: { apiUrl: string }) {}
  }

  const injector = await Injector.get(TestModule);
  const instance = await injector.resolve<TestModule>(TestModule);

  expect(instance).toBeInstanceOf(TestModule);
  expect(instance.config).toEqual({ apiUrl: "test" });
});

