import { expect } from "@std/expect";
import { Injectable, Module } from "../di/decorators.ts";
import { graphBuilder } from "../compiler/graph-builder.ts";

Deno.test("creating module graph", () => {
  @Injectable()
  class TestService {
  }
  @Module({
    providers: [TestService],
  })
  class TestModule {}

  @Module({
    imports: [TestModule],
    providers: [
      {
        provide: "config",
        factory: () => Promise.resolve("test"),
      },
    ],
  })
  class RootTestModule {}

  const graph = graphBuilder(RootTestModule);
  expect(graph.ctr).toBe(RootTestModule);
  expect(graph.providers.length).toBe(1);
  expect(graph.imports.length).toBe(1);
  expect(graph.imports[0].ctr).toBe(TestModule);
  expect(graph.imports[0].providers.length).toBe(1);
  expect(graph.imports[0].providers[0]).toBe(TestService);
});
