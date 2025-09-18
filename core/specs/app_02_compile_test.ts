import { expect } from "@std/expect";
import { Injectable, Module } from "../di/decorators.ts";
import { graphBuilder } from "../compiler/graph-builder.ts";
import { Compiler } from "../compiler/compiler.v2.ts";

Deno.test("creating compiled module", async () => {
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
  const compiled = await new Compiler().compile(graph);

  expect(compiled.handle).toBeInstanceOf(RootTestModule);
  expect(compiled.imports[0].handle).toBeInstanceOf(TestModule);
  // todo complete the test
});
