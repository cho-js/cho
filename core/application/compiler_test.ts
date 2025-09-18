import { expect } from "@std/expect";
import { Compiler } from "./compiler.ts";
import { Module } from "../di/decorators.ts";
import { writeMetadataObject } from "../meta/mod.ts";
import { graphBuilder } from "./graph-builder.ts";

// todo fix tests
//
// Deno.test("should throw for class not a module", async () => {
//   class NotAModule {}
//   await expect(new Compiler().compile(NotAModule)).rejects.toThrow();
// });
//
// Deno.test("should throw for an empty gateway", async () => {
//   class EmptyGateway {}
//   writeMetadataObject(EmptyGateway, {});
//
//   @Module({
//     controllers: [EmptyGateway],
//   })
//   class TestModule {}
//
//   await expect(new Compiler().compile(graphBuilder(TestModule)).rejects.toThrow();
// });
//
// Deno.test("should return compiled module", async () => {
//   class TestGateway {
//     test() {}
//   }
//   writeMetadataObject(TestGateway, {});
//   writeMetadataObject(TestGateway.prototype.test, {});
//
//   @Module({
//     controllers: [TestGateway],
//   })
//   class TestModule {}
//
//   const compiled = await new Compiler().compile(TestModule);
//   expect(compiled).toBeDefined();
//   expect(compiled.controllers.length).toBe(1);
//   expect(compiled.controllers[0].handle).toBeInstanceOf(TestGateway);
// });

// todo complete the tests
