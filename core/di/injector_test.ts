import { expect } from "@std/expect";
import { Module } from "./decorators.ts";
import { Injector } from "./injector.ts";

Deno.test("injector ctr should throw for module already have injector", () => {
  @Module({})
  class Mdl {}

  new Injector(Mdl);
  expect(() => new Injector(Mdl)).toThrow();
});

Deno.test("injector ctr should throw for not a module", () => {
  class Mdl {}
  expect(() => new Injector(Mdl)).toThrow();
});

Deno.test("injector resolve should throw for missing provider", async () => {
  @Module({})
  class Mdl {}
  const inj = new Injector(Mdl);

  await expect(inj.resolve("test")).rejects.toThrow();
});

Deno.test("injector resolve should return cached value", async () => {
  @Module({})
  class Mdl {}
  const inj = new Injector(Mdl);
  inj.cache.set("test", "test");

  expect(await inj.resolve("test")).toEqual("test");
});

Deno.test("injector resolve should return provided value", async () => {
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

Deno.test("injector resolve should return imported value", async () => {
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

Deno.test("injector resolve should return 1 instance for 2 modules because AAA resolved before BBB", async () => {
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

Deno.test("injector resolve should return 1 instance for 2 modules because AAA created, and its generate its deps", async () => {
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
