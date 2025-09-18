import { expect } from "@std/expect";
import { Injectable, Module } from "../di/decorators.ts";
import { Injector } from "../di/injector.ts";

Deno.test("resolve from imported module", async () => {
  @Module({
    providers: [
      {
        provide: "config",
        factory: () => Promise.resolve("test"),
      },
    ],
  })
  class ImportedModule {}

  @Module({
    imports: [ImportedModule],
  })
  class TestModule {
  }

  const injector = await Injector.get(TestModule);
  const config = await injector.resolve<string>("config");

  expect(config).toBe("test");
});

Deno.test("resolve from  nested imported module", async () => {
  @Module({
    providers: [
      {
        provide: "config",
        factory: () => Promise.resolve("test"),
      },
    ],
  })
  class ImportedModule {}

  @Module({
    imports: [ImportedModule],
  })
  class TestModule {
  }

  @Module({
    imports: [TestModule],
  })
  class AnotherModule {
  }

  const injector = await Injector.get(AnotherModule);
  const config = await injector.resolve<string>("config");

  expect(config).toBe("test");
});

Deno.test("resolve service from different scopes", async () => {
  @Injectable()
  class TestService {}

  @Module({
    providers: [TestService],
  })
  class ImportedModule {}

  @Module({
    imports: [ImportedModule],
  })
  class TestModule {
  }

  @Module({
    imports: [TestModule],
  })
  class AnotherModule {
  }

  const injector0 = await Injector.get(AnotherModule);
  const service0 = await injector0.resolve<TestService>(TestService);
  expect(service0).toBeInstanceOf(TestService);

  const injector1 = await Injector.get(TestModule);
  const service1 = await injector1.resolve<TestService>(TestService);
  expect(service1).toBeInstanceOf(TestService);

  // different instances created in different scopes
  expect(service0).not.toBe(service1);
});

Deno.test("resolve singleton from different scopes", async () => {
  @Injectable()
  class TestService {}

  @Module({
    deps: [TestService],
    providers: [TestService],
  })
  class ImportedModule {}

  @Module({
    imports: [ImportedModule],
  })
  class TestModule {
  }

  @Module({
    imports: [TestModule],
  })
  class AnotherModule {
  }

  const injector0 = await Injector.get(AnotherModule);
  const service0 = await injector0.resolve<TestService>(TestService);
  expect(service0).toBeInstanceOf(TestService);

  const injector1 = await Injector.get(TestModule);
  const service1 = await injector1.resolve<TestService>(TestService);
  expect(service1).toBeInstanceOf(TestService);

  // different instances created in different scopes
  expect(service0).toBe(service1);
});
