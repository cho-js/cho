import { expect } from "@std/expect";
import { Injectable, Module } from "./decorators.ts";
import { Injector } from "./injector.ts";
import { test } from "../testing/mod.ts";

test("injector ctr should throw for module already have injector", () => {
  @Module({})
  class Mdl {}

  new Injector(Mdl);
  expect(() => new Injector(Mdl)).toThrow();
});

test("injector ctr should throw for not a module", () => {
  class Mdl {}
  expect(() => new Injector(Mdl)).toThrow();
});

test("injector resolve should throw for missing provider", async () => {
  @Module({})
  class Mdl {}
  const inj = new Injector(Mdl);

  await expect(inj.resolve("test")).rejects.toThrow();
});

test("injector resolve should return cached value", async () => {
  @Module({})
  class Mdl {}
  const inj = new Injector(Mdl);
  inj.cache.set("test", "test");

  expect(await inj.resolve("test")).toEqual("test");
});

test("injector resolve should return provided value", async () => {
  @Module({
    providers: [
      {
        provide: "test",
        factory: () => "test",
      },
    ],
  })
  class Mdl {}
  const inj = new Injector(Mdl);

  expect(await inj.resolve("test")).toEqual("test");
});

test("injector resolve should return imported value", async () => {
  @Module({
    providers: [
      {
        provide: "test",
        factory: () => "test",
      },
    ],
  })
  class Imp {}

  @Module({
    imports: [Imp],
  })
  class Mdl {}
  const inj = new Injector(Mdl);

  expect(await inj.resolve("test")).toEqual("test");
});

// those next specs are to demonstrate that the order of module resolution matters
// the eager of the importing modules will cause generation of different instances (by design).

test("injector resolve should return 1 instance for 2 modules because AAA resolved before BBB", async () => {
  class Foo {
  }
  @Module({
    providers: [
      {
        provide: "test",
        factory: () => new Foo(),
      },
    ],
  })
  class AAA {}

  @Module({
    imports: [AAA],
  })
  class BBB {}

  const a = new Injector(AAA);
  const b = new Injector(BBB);

  const fa = await a.resolve<Foo>("test");
  const fb = await b.resolve<Foo>("test");

  expect(fa).toBeInstanceOf(Foo);
  expect(fb).toBeInstanceOf(Foo);
  expect(fa).toBe(fb);
});

test("injector resolve should return 1 instance for 2 modules because AAA created, and its generate its deps", async () => {
  class Foo {
  }
  @Module({
    deps: ["test"],
    providers: [
      {
        provide: "test",
        factory: () => new Foo(),
      },
    ],
  })
  class AAA {
    constructor(private foo: Foo) {
    }
  }

  @Module({
    imports: [AAA],
  })
  class BBB {}

  const a = new Injector(AAA);
  a.register(AAA);
  await a.resolve(AAA);

  const b = new Injector(BBB);

  const fb = await b.resolve<Foo>("test");
  const fa = await a.resolve<Foo>("test");

  expect(fa).toBeInstanceOf(Foo);
  expect(fb).toBeInstanceOf(Foo);
  expect(fa).toBe(fb);
});

test("Injector.get should create new injector for module", async () => {
  @Module({})
  class TestModule {}

  const injector = await Injector.get(TestModule);
  expect(injector).toBeInstanceOf(Injector);
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

test("injector.register should add provider to providers list", () => {
  @Module({})
  class TestModule {}

  const injector = new Injector(TestModule);
  const initialCount = injector.providers.length;

  injector.register({ provide: "test", factory: () => "value" });

  expect(injector.providers.length).toBe(initialCount + 1);
});

test("injector.register should return self for chaining", () => {
  @Module({})
  class TestModule {}

  const injector = new Injector(TestModule);
  const result = injector.register({
    provide: "test",
    factory: () => "value",
  });

  expect(result).toBe(injector);
});

test("injector.registerImport should add import to imports list", () => {
  @Module({})
  class ImportedModule {}

  @Module({})
  class TestModule {}

  const injector = new Injector(TestModule);
  const initialCount = injector.imports.length;

  injector.registerImport(ImportedModule);

  expect(injector.imports.length).toBe(initialCount + 1);
});

test("injector.registerImport should throw for non-function", () => {
  @Module({})
  class TestModule {}

  const injector = new Injector(TestModule);

  expect(() => {
    injector.registerImport("not a class" as any);
  }).toThrow();
});

test("injector.registerImport should throw for non-module", () => {
  @Module({})
  class TestModule {}

  class NotAModule {}

  const injector = new Injector(TestModule);

  expect(() => {
    injector.registerImport(NotAModule);
  }).toThrow();
});

test("injector.registerImport should not add duplicate imports", () => {
  @Module({})
  class ImportedModule {}

  @Module({})
  class TestModule {}

  const injector = new Injector(TestModule);
  injector.registerImport(ImportedModule);
  const countAfterFirst = injector.imports.length;

  injector.registerImport(ImportedModule);

  expect(injector.imports.length).toBe(countAfterFirst);
});

test("injector should resolve nested dependencies", async () => {
  @Injectable()
  class ServiceA {
    getValue() {
      return "A";
    }
  }

  @Injectable({ deps: [ServiceA] })
  class ServiceB {
    constructor(readonly serviceA: ServiceA) {}
    getValue() {
      return "B-" + this.serviceA.getValue();
    }
  }

  @Injectable({ deps: [ServiceB] })
  class ServiceC {
    constructor(readonly serviceB: ServiceB) {}
    getValue() {
      return "C-" + this.serviceB.getValue();
    }
  }

  @Module({
    providers: [ServiceA, ServiceB, ServiceC],
  })
  class TestModule {}

  const injector = new Injector(TestModule);
  const serviceC = await injector.resolve<ServiceC>(ServiceC);

  expect(serviceC.getValue()).toBe("C-B-A");
});

test("injector should cache resolved instances", async () => {
  let callCount = 0;

  @Module({
    providers: [
      {
        provide: "service",
        factory: () => {
          callCount++;
          return { value: "test" };
        },
      },
    ],
  })
  class TestModule {}

  const injector = new Injector(TestModule);

  await injector.resolve("service");
  await injector.resolve("service");
  await injector.resolve("service");

  expect(callCount).toBe(1);
});

test("injector should handle async provider factories", async () => {
  @Module({
    providers: [
      {
        provide: "async",
        factory: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return "async-value";
        },
      },
    ],
  })
  class TestModule {}

  const injector = new Injector(TestModule);
  const value = await injector.resolve<string>("async");

  expect(value).toBe("async-value");
});

test("injector should resolve from multiple levels of imports", async () => {
  @Module({
    providers: [{ provide: "level3", factory: () => "value3" }],
  })
  class Level3Module {}

  @Module({
    imports: [Level3Module],
    providers: [{ provide: "level2", factory: () => "value2" }],
  })
  class Level2Module {}

  @Module({
    imports: [Level2Module],
  })
  class Level1Module {}

  const injector = new Injector(Level1Module);

  expect(await injector.resolve("level2")).toBe("value2");
  expect(await injector.resolve("level3")).toBe("value3");
});

test("injector should use first found strategy for duplicate providers", async () => {
  @Module({
    providers: [
      { provide: "value", factory: () => "first" },
      { provide: "value", factory: () => "second" },
      { provide: "value", factory: () => "third" },
    ],
  })
  class TestModule {}

  const injector = new Injector(TestModule);
  const value = await injector.resolve<string>("value");

  // Provider.find() returns the first match
  expect(value).toBe("first");
});

test("injector search should return resolved for cached values", async () => {
  @Module({})
  class TestModule {}

  const injector = new Injector(TestModule);
  injector.cache.set("test", "cached-value");

  const result = await injector.search("test");

  expect(result.type).toBe("resolved");
  expect(result.value).toBe("cached-value");
});

test("injector search should return provider when found locally", async () => {
  @Module({
    providers: [{ provide: "test", factory: () => "value" }],
  })
  class TestModule {}

  const injector = new Injector(TestModule);
  const result = await injector.search("test");

  expect(result.type).toBe("provider");
});

test("injector search should return not-found when token not available", async () => {
  @Module({})
  class TestModule {}

  const injector = new Injector(TestModule);
  const result = await injector.search("non-existent");

  expect(result.type).toBe("not-found");
});

test("injector resolve should use factory resolver for nested deps", async () => {
  @Injectable()
  class DepService {
    getValue() {
      return "dep";
    }
  }

  @Module({
    providers: [
      DepService,
      {
        provide: "complex",
        factory: async (resolver) => {
          const dep = await resolver.resolve<DepService>(DepService);
          return { value: dep.getValue() + "-complex" };
        },
      },
    ],
  })
  class TestModule {}

  const injector = new Injector(TestModule);
  const result = await injector.resolve<{ value: string }>("complex");

  expect(result.value).toBe("dep-complex");
});
