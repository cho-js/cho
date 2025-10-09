import { expect } from "@std/expect";
import { test } from "../testing/mod.ts";
import { Controller, Injectable, Module } from "../di/decorators.ts";
import { graphBuilder } from "./graph-builder.ts";

test("Graph builder should build a module graph", () => {
  @Injectable({
    deps: ["token"],
  })
  class SomeService {
    constructor(readonly token: string) {
    }
  }

  @Controller({
    route: "test",
    deps: [SomeService],
  })
  class SomeController {
    constructor(readonly service: SomeService) {
    }
  }

  @Module({
    providers: [
      {
        provide: "token",
        factory: () => Promise.resolve("test"),
      },
      SomeService,
    ],
    controllers: [
      SomeController,
    ],
  })
  class SomeModule {
  }

  @Module({
    imports: [SomeModule],
  })
  class RootModule {
  }

  const graph = graphBuilder(RootModule);

  // Verify root module structure
  expect(graph.meta.isModule).toBe(true);
  expect(graph.ctr).toBe(RootModule);
  expect(graph.imports.length).toBe(1);
  expect(graph.controllers.length).toBe(0);
  expect(graph.providers.length).toBe(0);
  expect(graph.middlewares.length).toBe(0);
  expect(graph.errorHandler).toBeUndefined();

  // Verify imported SomeModule
  const someModule = graph.imports[0];
  expect(someModule.meta.isModule).toBe(true);
  expect(someModule.ctr).toBe(SomeModule);
  expect(someModule.imports.length).toBe(0);
  expect(someModule.controllers.length).toBe(1);
  expect(someModule.providers.length).toBe(2);
  expect(someModule.middlewares.length).toBe(0);
  expect(someModule.errorHandler).toBeUndefined();

  // Verify providers in SomeModule
  expect(someModule.providers[0]).toEqual({
    provide: "token",
    factory: expect.any(Function),
  });
  expect(someModule.providers[1]).toBe(SomeService);

  // Verify SomeController
  const controller = someModule.controllers[0];
  expect(controller.ctr).toBe(SomeController);
  expect(controller.meta.isGateway).toBe(true);
  expect(controller.meta.route).toBe("test");
  expect(controller.meta.deps).toEqual([SomeService]);
  expect(controller.middlewares.length).toBe(0);
  expect(controller.errorHandler).toBeUndefined();
  expect(controller.methods.length).toBe(0);
});
