import { expect } from "@std/expect";
import { Injectable, Module } from "../di/decorators.ts";
import { Injector } from "../di/injector.ts";

Deno.test("should throw for creating new injector for module that already have one ", async () => {
  @Injectable()
  class TestService {
  }
  @Module({
    providers: [TestService],
  })
  class TestModule {}

  await Injector.get(TestModule);
  expect(() => new Injector(TestModule)).toThrow();
});

Deno.test("should throw for creating new injector for non module class ", async () => {
  class TestModule {}

  expect(() => new Injector(TestModule)).toThrow();
});

Deno.test("should throw for import non module class ", async () => {
  class TestService {
  }
  @Module({
    imports: [TestService],
  })
  class TestModule {}

  expect(() => new Injector(TestModule)).toThrow();
});

Deno.test("should throw for resolving not found", async () => {
  @Module({})
  class TestModule {}
  const injector = await Injector.get(TestModule);
  try {
    await injector.resolve("nothing");
    expect(true).toBe(false);
  } catch (e) {
    expect((e as Error).message).toContain("not found");
  }
});
