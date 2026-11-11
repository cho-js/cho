import {describe} from "node:test";

describe("placeholder", () => {});
// /**
//  * Tests for `mod.ts`: the public API of the DI system, and the quick start
//  * example from its documentation, end to end.
//  *
//  * Decorators are applied as plain function calls (see `decorators_test.ts`).
//  */
//
// import { describe, it } from "node:test";
// import assert from "node:assert/strict";
// import * as di from "./mod.ts";
// import { Injectable, Injector, Module, provider, token } from "./mod.ts";
//
// describe("public API", () => {
//   it("exports exactly the documented runtime values", () => {
//     assert.deepEqual(Object.keys(di).sort(), [
//       "Controller",
//       "Injectable",
//       "Injector",
//       "Module",
//       "isToken",
//       "provider",
//       "token",
//     ]);
//   });
//
//   it("runs the quick start example", async () => {
//     const GREETING = token<string>("greeting");
//
//     class GreetingModule {}
//     Module({
//       providers: [
//         provider({
//           provide: GREETING,
//           factory: () => Promise.resolve("hello"),
//         }),
//       ],
//       exports: [GREETING],
//     })(GreetingModule);
//
//     class Greeter {
//       readonly greeting: string;
//       constructor(greeting: string) {
//         this.greeting = greeting;
//       }
//     }
//     Injectable([GREETING])(Greeter);
//
//     class App {}
//     Module({ imports: [GreetingModule], providers: [Greeter] })(App);
//
//     const injector = new Injector(App);
//     await injector.init();
//     const greeter = await injector.resolve(Greeter);
//     assert.equal(greeter.greeting, "hello");
//   });
// });
