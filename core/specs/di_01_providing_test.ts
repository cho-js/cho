import { expect } from "@std/expect";
import { Injectable, Module } from "../di/decorators.ts";
import { Injector } from "../di/injector.ts";

Deno.test("value provider", async () => {
  @Module({
    providers: [
      {
        provide: "config",
        factory: () => Promise.resolve("test"),
      },
    ],
  })
  class TestModule {}

  const injector = await Injector.get(TestModule);
  const config = await injector.resolve<string>("config");

  expect(config).toBe("test");
});

Deno.test("class provider", async () => {
  class TestService {
  }
  @Module({
    providers: [
      {
        provide: TestService,
        factory: () => Promise.resolve(new TestService()),
      },
    ],
  })
  class TestModule {}

  const injector = await Injector.get(TestModule);
  const service = await injector.resolve<TestService>(TestService);

  expect(service).toBeInstanceOf(TestService);
});

Deno.test("class provider with dependencies", async () => {
  @Injectable({
    deps: ["dep1"],
  })
  class TestService {
    constructor(readonly dep: string) {
    }
  }
  @Module({
    providers: [
      {
        provide: "dep1",
        factory: () => Promise.resolve("test"),
      },
      {
        provide: TestService,
        factory: async (i) => {
          const dep = await i.resolve<string>("dep1");
          return Promise.resolve(new TestService(dep));
        },
      },
    ],
  })
  class TestModule {}

  const injector = await Injector.get(TestModule);
  const service = await injector.resolve<TestService>(TestService);

  expect(service).toBeInstanceOf(TestService);
  expect(service.dep).toBe("test");
});

Deno.test("decorator provider", async () => {
  @Injectable()
  class TestService {
  }
  @Module({
    providers: [TestService],
  })
  class TestModule {}

  const injector = await Injector.get(TestModule);
  const service = await injector.resolve<TestService>(TestService);

  expect(service).toBeInstanceOf(TestService);
});

Deno.test("decorator provider with dependencies", async () => {
  @Injectable({
    deps: ["dep1"],
  })
  class TestService {
    constructor(readonly dep: string) {
    }
  }
  @Module({
    providers: [
      TestService,
      {
        provide: "dep1",
        factory: () => Promise.resolve("test"),
      },
    ],
  })
  class TestModule {}

  const injector = await Injector.get(TestModule);
  const service = await injector.resolve<TestService>(TestService);

  expect(service).toBeInstanceOf(TestService);
  expect(service.dep).toBe("test");
});
