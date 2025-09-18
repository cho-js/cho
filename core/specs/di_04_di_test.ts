import { expect } from "@std/expect";
import { Injectable, Injector, Module } from "@chojs/core/di";

Deno.test("di specs", async () => {
  /**
   * Scenario:
   * - DA, DB - primitive dependencies provided in MB module
   * - IA, IB - services provided in MA module
   *   - IA depends on DA and DB
   *   - IB depends on IA
   *
   * Target:
   * - Resolve IB from TestModule
   */

  @Injectable({
    deps: ["DA", "DB"],
  })
  class IA {
    constructor(readonly da: string, readonly db: string) {
    }
  }

  @Injectable({
    deps: [IA],
  })
  class IB {
    constructor(readonly ia: IA) {
    }
  }

  @Module({
    providers: [IA, IB],
  })
  class MA {}

  @Module({
    providers: [
      {
        provide: "DA",
        factory: () => Promise.resolve("dep1"),
      },
      {
        provide: "DB",
        factory: () => Promise.resolve("dep2"),
      },
    ],
  })
  class MB {}

  @Module({
    imports: [MA, MB],
  })
  class TestModule {}

  const injector = await Injector.get(TestModule);
  const ib = await injector.resolve<IB>(IB);

  expect(ib).toBeDefined();
  expect(ib).toBeInstanceOf(IB);
  expect(ib.ia).toBeInstanceOf(IA);
  expect(ib.ia.da).toBe("dep1");
  expect(ib.ia.db).toBe("dep2");
});
