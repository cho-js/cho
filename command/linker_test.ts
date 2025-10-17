import { expect } from "@std/expect";
import { test } from "@chojs/core/testing";
import { Controller, Module } from "@chojs/core/di";
import { Compiler, graphBuilder } from "@chojs/core/application";
import { HelpKey, Linker } from "./linker.ts";
import { Command, Help, Main } from "./decorators.ts";
import type { ChoCommandContext } from "./context.ts";

test("Linker should link a main command application", async () => {
  @Controller()
  class TestController {
    @Main()
    mainHandler() {}
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const compiled = await new Compiler().compile(graphBuilder(TestModule));
  const linked = new Linker().link(compiled);

  expect("main" in linked).toBe(true);
  expect(typeof (linked as any).main).toBe("function");
});

test("Linker should link a commands application", async () => {
  @Controller()
  class TestController {
    @Command("foo")
    fooHandler() {}

    @Command("bar")
    barHandler() {}
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const compiled = await new Compiler().compile(graphBuilder(TestModule));
  const linked = new Linker().link(compiled);

  expect("commands" in linked).toBe(true);
  expect(typeof (linked as any).commands.foo).toBe("function");
  expect(typeof (linked as any).commands.bar).toBe("function");
});

test("Linker should throw when main and subcommands exist together", async () => {
  @Controller()
  class TestController {
    @Main()
    mainHandler() {}

    @Command("foo")
    fooHandler() {}
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const compiled = await new Compiler().compile(graphBuilder(TestModule));

  expect(() => {
    new Linker().link(compiled);
  }).toThrow();
});

test("Linker should throw when duplicate command names exist", async () => {
  @Controller()
  class Controller1 {
    @Command("foo")
    fooHandler1() {}
  }

  @Controller()
  class Controller2 {
    @Command("foo")
    fooHandler2() {}
  }

  @Module({ controllers: [Controller1, Controller2] })
  class TestModule {}

  const compiled = await new Compiler().compile(graphBuilder(TestModule));

  expect(() => {
    new Linker().link(compiled);
  }).toThrow('Command "foo" already exists');
});

test("Linker should collect help from controller", async () => {
  @Help("Global help text")
  @Controller()
  class TestController {
    @Command("foo")
    fooHandler() {}
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const compiled = await new Compiler().compile(graphBuilder(TestModule));
  const linked = new Linker().link(compiled);

  expect(linked.help[HelpKey]).toBe("Global help text");
});

test("Linker should collect help from methods", async () => {
  @Controller()
  class TestController {
    @Help("Foo help")
    @Command("foo")
    fooHandler() {}

    @Help("Bar help")
    @Command("bar")
    barHandler() {}
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const compiled = await new Compiler().compile(graphBuilder(TestModule));
  const linked = new Linker().link(compiled);

  expect(linked.help.foo).toBe("Foo help");
  expect(linked.help.bar).toBe("Bar help");
});

test("Linker should collect help from main command", async () => {
  @Controller()
  class TestController {
    @Help("Main help")
    @Main()
    mainHandler() {}
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const compiled = await new Compiler().compile(graphBuilder(TestModule));
  const linked = new Linker().link(compiled);

  expect(linked.help.main).toBe("Main help");
});

test("Linker should set empty string for help when not provided", async () => {
  @Controller()
  class TestController {
    @Command("foo")
    fooHandler() {}
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const compiled = await new Compiler().compile(graphBuilder(TestModule));
  const linked = new Linker().link(compiled);

  expect(linked.help.foo).toBe("");
});

test("Linker should link commands from imported modules", async () => {
  @Controller()
  class ImportedController {
    @Command("imported")
    importedHandler() {}
  }

  @Module({ controllers: [ImportedController] })
  class ImportedModule {}

  @Controller()
  class MainController {
    @Command("local")
    localHandler() {}
  }

  @Module({ imports: [ImportedModule], controllers: [MainController] })
  class TestModule {}

  const compiled = await new Compiler().compile(graphBuilder(TestModule));
  const linked = new Linker().link(compiled);

  expect("commands" in linked).toBe(true);
  expect(typeof (linked as any).commands.local).toBe("function");
  expect(typeof (linked as any).commands.imported).toBe("function");
});

test("Linker should apply module middlewares to commands", async () => {
  const calls: string[] = [];

  function moduleMiddleware(ctx: ChoCommandContext, next: () => void) {
    calls.push("module");
    return next();
  }

  @Controller()
  class TestController {
    @Command("foo")
    fooHandler() {
      calls.push("handler");
    }
  }

  @Module({
    controllers: [TestController],
    middlewares: [moduleMiddleware],
  })
  class TestModule {}

  const compiled = await new Compiler().compile(graphBuilder(TestModule));
  const linked = new Linker().link(compiled);

  await (linked as any).commands.foo({} as ChoCommandContext);

  expect(calls).toEqual(["module", "handler"]);
});

test("Linker should apply controller middlewares to commands", async () => {
  const calls: string[] = [];

  function controllerMiddleware(ctx: ChoCommandContext, next: () => void) {
    calls.push("controller");
    return next();
  }

  @Controller({ middlewares: [controllerMiddleware] })
  class TestController {
    @Command("foo")
    fooHandler() {
      calls.push("handler");
    }
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const compiled = await new Compiler().compile(graphBuilder(TestModule));
  const linked = new Linker().link(compiled);

  await (linked as any).commands.foo({} as ChoCommandContext);

  expect(calls).toEqual(["controller", "handler"]);
});

test("Linker should apply method middlewares to commands", async () => {
  const calls: string[] = [];

  function methodMiddleware(ctx: ChoCommandContext, next: () => void) {
    calls.push("method");
    return next();
  }

  @Controller()
  class TestController {
    @Command("foo")
    fooHandler() {
      calls.push("handler");
    }
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const compiled = await new Compiler().compile(graphBuilder(TestModule));

  // Manually add method middleware to test
  compiled.controllers[0].methods[0].middlewares = [methodMiddleware];

  const linked = new Linker().link(compiled);

  await (linked as any).commands.foo({} as ChoCommandContext);

  expect(calls).toEqual(["method", "handler"]);
});

test("Linker should apply all middlewares in correct order", async () => {
  const calls: string[] = [];

  function moduleMiddleware(ctx: ChoCommandContext, next: () => void) {
    calls.push("module");
    return next();
  }

  function controllerMiddleware(ctx: ChoCommandContext, next: () => void) {
    calls.push("controller");
    return next();
  }

  function methodMiddleware(ctx: ChoCommandContext, next: () => void) {
    calls.push("method");
    return next();
  }

  @Controller({ middlewares: [controllerMiddleware] })
  class TestController {
    @Command("foo")
    fooHandler() {
      calls.push("handler");
    }
  }

  @Module({
    controllers: [TestController],
    middlewares: [moduleMiddleware],
  })
  class TestModule {}

  const compiled = await new Compiler().compile(graphBuilder(TestModule));
  const linked = new Linker().link(compiled);

  await (linked as any).commands.foo({} as ChoCommandContext);

  expect(calls).toEqual(["module", "controller", "handler"]);
});

test("Linker should handle errors with method error handler", async () => {
  let errorHandled = false;

  function methodErrorHandler(err: Error) {
    errorHandled = true;
    expect(err.message).toBe("test error");
  }

  @Controller()
  class TestController {
    @Command("foo")
    fooHandler() {
      throw new Error("test error");
    }
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const compiled = await new Compiler().compile(graphBuilder(TestModule));

  // Manually set error handler on the endpoint
  compiled.controllers[0].methods[0].errorHandler = methodErrorHandler;

  const linked = new Linker().link(compiled);

  await (linked as any).commands.foo({} as ChoCommandContext);

  expect(errorHandled).toBe(true);
});

test("Linker should propagate error when no error handler is set", async () => {
  @Controller()
  class TestController {
    @Command("foo")
    fooHandler() {
      throw new Error("test error");
    }
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const compiled = await new Compiler().compile(graphBuilder(TestModule));
  const linked = new Linker().link(compiled);

  await expect(
    (linked as any).commands.foo({} as ChoCommandContext),
  ).rejects.toThrow("test error");
});

test("Linker should use global error handler when method handler not set", async () => {
  let errorHandled = false;

  function globalErrorHandler(err: Error) {
    errorHandled = true;
    expect(err.message).toBe("test error");
  }

  @Controller()
  class TestController {
    @Command("foo")
    fooHandler() {
      throw new Error("test error");
    }
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const compiled = await new Compiler().compile(graphBuilder(TestModule));
  compiled.errorHandler = globalErrorHandler;

  const linked = new Linker().link(compiled);

  await (linked as any).commands.foo({} as ChoCommandContext);

  expect(errorHandled).toBe(true);
});

test("Linker should pass correct context to handler", async () => {
  let receivedContext: ChoCommandContext | null = null;

  @Controller()
  class TestController {
    @Command("foo")
    fooHandler(ctx: ChoCommandContext) {
      receivedContext = ctx;
    }
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const compiled = await new Compiler().compile(graphBuilder(TestModule));
  const linked = new Linker().link(compiled);

  const testContext = { args: { _: [] } } as ChoCommandContext;
  await (linked as any).commands.foo(testContext);

  expect(receivedContext).toBe(testContext);
});

test("Linker should store reference to compiled module", async () => {
  @Controller()
  class TestController {
    @Command("foo")
    fooHandler() {}
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const compiled = await new Compiler().compile(graphBuilder(TestModule));
  const linked = new Linker().link(compiled);

  expect(linked.compiled).toBe(compiled);
});

test("Linker should store error handler reference", async () => {
  function globalErrorHandler() {}

  @Controller()
  class TestController {
    @Command("foo")
    fooHandler() {}
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const compiled = await new Compiler().compile(graphBuilder(TestModule));
  compiled.errorHandler = globalErrorHandler;

  const linked = new Linker().link(compiled);

  expect(linked.errorHandler).toBe(globalErrorHandler);
});
