import { expect } from "@std/expect";
import {
  Catch,
  Controller,
  Dependencies,
  Deps,
  Imports,
  Injectable,
  Middlewares,
  Module,
  Providers,
} from "./decorators.ts";
import { readMetadataObject } from "../meta/mod.ts";
import { test } from "../testing/mod.ts";
// sanity check only
// the DI tests are under "core/di/specs" directory

test("sanity - Injectable decorator should add metadata", () => {
  @Injectable({ deps: ["dep1", "dep2"] })
  class TestClass {}
  expect(readMetadataObject(TestClass)).toEqual({
    deps: ["dep1", "dep2"],
    isInjectable: true,
  });
});

test("sanity - Module decorator should add metadata", () => {
  @Module({ deps: ["dep1", "dep2"] })
  class TestClass {}
  expect(readMetadataObject(TestClass)).toEqual({
    deps: ["dep1", "dep2"],
    isModule: true,
  });
});

test("sanity - Controller decorator should add metadata", () => {
  @Controller("route")
  class TestClass {}
  expect(readMetadataObject(TestClass)).toEqual({
    route: "route",
    isGateway: true,
  });
});

test("sanity - Dependencies decorator should set deps metadata", () => {
  @Dependencies("dep1", "dep2")
  class TestClass {}
  expect(readMetadataObject(TestClass)).toEqual({
    deps: ["dep1", "dep2"],
    isInjectable: true,
  });
});

test("sanity - Deps decorator should set deps metadata", () => {
  @Deps("dep1", "dep2")
  class TestClass {}
  expect(readMetadataObject(TestClass)).toEqual({
    deps: ["dep1", "dep2"],
    isInjectable: true,
  });
});

test("sanity - Middlewares decorator should set middlewares metadata", () => {
  const fn1 = () => {};
  const fn2 = () => {};
  @Middlewares(fn1, fn2)
  class TestClass {}
  expect(readMetadataObject(TestClass)).toEqual({ middlewares: [fn1, fn2] });
});

test("sanity - Catch decorator should set middlewares metadata", () => {
  const fn1 = () => {};
  @Catch(fn1)
  class TestClass {}
  expect(readMetadataObject(TestClass)).toEqual({ errorHandler: fn1 });
});

test("Providers decorator should set providers metadata", () => {
  class Service1 {}
  class Service2 {}
  @Providers(Service1, Service2)
  class TestClass {}
  expect(readMetadataObject(TestClass)).toEqual({
    providers: [Service1, Service2],
    isModule: true,
  });
});

test("Imports decorator should set imports metadata", () => {
  @Module({})
  class Module1 {}
  @Module({})
  class Module2 {}
  @Imports(Module1, Module2)
  class TestClass {}
  expect(readMetadataObject(TestClass)).toEqual({
    imports: [Module1, Module2],
    isModule: true,
  });
});

test("Controller decorator with object parameter should set all properties", () => {
  const middleware = () => {};
  const errorHandler = () => {};
  @Controller({
    route: "api",
    deps: ["dep1"],
    middlewares: [middleware],
    errorHandler,
  })
  class TestClass {}
  expect(readMetadataObject(TestClass)).toEqual({
    route: "api",
    deps: ["dep1"],
    middlewares: [middleware],
    errorHandler,
    isGateway: true,
  });
});

test("Controller decorator without arguments should only set isGateway", () => {
  @Controller()
  class TestClass {}
  expect(readMetadataObject(TestClass)).toEqual({ isGateway: true });
});

test("Module decorator with all options should set metadata", () => {
  @Module({})
  class ImportedModule {}
  class Service {}
  @Module({
    deps: ["config"],
    imports: [ImportedModule],
    providers: [Service],
  })
  class TestClass {}
  expect(readMetadataObject(TestClass)).toEqual({
    deps: ["config"],
    imports: [ImportedModule],
    providers: [Service],
    isModule: true,
  });
});

test("Injectable decorator without options should only set isInjectable", () => {
  @Injectable()
  class TestClass {}
  expect(readMetadataObject(TestClass)).toEqual({ isInjectable: true });
});

test("Multiple decorators should merge metadata", () => {
  const middleware1 = () => {};
  const middleware2 = () => {};
  @Injectable()
  @Dependencies("dep1")
  @Middlewares(middleware1)
  @Middlewares(middleware2)
  class TestClass {}
  // Decorators apply bottom-up, so middleware2 is applied first, then middleware1
  expect(readMetadataObject(TestClass)).toEqual({
    isInjectable: true,
    deps: ["dep1"],
    middlewares: [middleware2, middleware1],
  });
});

test("Module with Providers and Imports decorators should merge", () => {
  @Module({})
  class ImportModule {}
  class Service1 {}
  class Service2 {}
  @Module({})
  @Imports(ImportModule)
  @Providers(Service1, Service2)
  class TestClass {}
  expect(readMetadataObject(TestClass)).toEqual({
    isModule: true,
    imports: [ImportModule],
    providers: [Service1, Service2],
  });
});
