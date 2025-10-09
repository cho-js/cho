// import { expect } from "@std/expect";
// import { assertSpyCalls, spy } from "@std/testing/mock";
// import { debuglog } from "./debuglog.ts";
// import { test } from "../testing/runner.ts";
// import {env} from "./env.ts";
//
// test("debuglog should return a function", () => {
//   expect(debuglog("test")).toBeInstanceOf(Function);
// });
//
// test("debuglog functions should not log", () => {
//   const errSpy = spy(console, "error");
//
//   // the test should fail if debug is enabled
//   const DEBUG = env("CHO_DEBUG");
//
//   process.env.CHO_DEBUG = "none";
//   process.env.CHO_DEBUGLOG = "none";
//   // Deno.env.set("CHO_DEBUG", "none");
//   // Deno.env.set("CHO_DEBUGLOG", "none");
//   const log = debuglog("test");
//
//   log("This is a test message");
//   log.error("This is a test error message");
//   log.start()("This is a test message with elapsed time");
//
//   assertSpyCalls(errSpy, 0);
//   errSpy.restore();
//
//   if (DEBUG) {
//     // restore original env var
//     Deno.env.set("CHO_DEBUG", DEBUG);
//   }
// });
//
// test("debuglog function should log", () => {
//   const errSpy = spy(console, "error");
//
//   Deno.env.set("CHO_DEBUGLOG", "test");
//   const log = debuglog("test");
//
//   log("This is a test message");
//   log.error("This is a test error message");
//   log.start()("This is a test message with elapsed time");
//
//   assertSpyCalls(errSpy, 3);
//   errSpy.restore();
// });
