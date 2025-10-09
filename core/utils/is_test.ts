import { expect } from "@std/expect";
import { test } from "../testing/mod.ts";
import { isClass } from "./is.ts";

test("should return true for class", () => {
  class MyClass {}
  expect(isClass(MyClass)).toBe(true);
});

test("should return false for non class", () => {
  function myClass() {}
  expect(isClass(myClass)).toBe(false);
});
