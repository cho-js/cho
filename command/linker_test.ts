import { expect } from "@std/expect";
import { test } from "@chojs/core/testing";
import { Controller, Injectable, Module } from "@chojs/core";
import { graphBuilder } from "@chojs/core/application";
import { Compiler } from "@chojs/core/application";
import { Linker } from "./linker.ts";
import { Command, Help, Main } from "./decorators.ts";
import type { LinkedCommandsApp, LinkedMainApp } from "./linker.ts";

test("Linker should link a module with main command", async () => {
  @Controller()
  class TestController {
    @Main()
    mainHandler() {
      return "main executed";
    }
  }

  @Module({
    controllers: [TestController],
  })
  class TestModule {}

  const graph = graphBuilder(TestModule);
  const compiler = new Compiler();
  const compiled = await compiler.compile(graph);

  const linker = new Linker();
  const linked = linker.link(compiled) as LinkedMainApp;

  expect(linked.main).toBeDefined();
  expect(linked.main.handle).toBeDefined();
  expect(typeof linked.main.handle).toBe("function");
  expect(linked.main.middlewares).toEqual([]);
  expect(linked.main.errorHandler).toBeUndefined();
});

test("Linker should link a module with sub-commands", async () => {
  @Controller()
  class TestController {
    @Command("start")
    startCommand() {
      return "started";
    }

    @Command("stop")
    stopCommand() {
      return "stopped";
    }
  }

  @Module({
    controllers: [TestController],
  })
  class TestModule {}

  const graph = graphBuilder(TestModule);
  const compiler = new Compiler();
  const compiled = await compiler.compile(graph);

  const linker = new Linker();
  const linked = linker.link(compiled) as LinkedCommandsApp;

  expect(linked.commands).toBeDefined();
  expect(linked.commands["start"]).toBeDefined();
  expect(linked.commands["stop"]).toBeDefined();
  expect(typeof linked.commands["start"].handle).toBe("function");
  expect(typeof linked.commands["stop"].handle).toBe("function");
});

test("Linker should throw error when main and sub-commands coexist", async () => {
  @Controller()
  class TestController {
    @Main()
    mainHandler() {
      return "main";
    }

    @Command("test")
    testCommand() {
      return "test";
    }
  }

  @Module({
    controllers: [TestController],
  })
  class TestModule {}

  const graph = graphBuilder(TestModule);
  const compiler = new Compiler();
  const compiled = await compiler.compile(graph);

  const linker = new Linker();
  expect(() => linker.link(compiled)).toThrow(
    "Cannot have subcommands when 'main' command exists",
  );
});

test("Linker should throw error when duplicate commands exist", async () => {
  @Controller()
  class Controller1 {
    @Command("test")
    testCommand1() {
      return "test1";
    }
  }

  @Controller()
  class Controller2 {
    @Command("test")
    testCommand2() {
      return "test2";
    }
  }

  @Module({
    controllers: [Controller1, Controller2],
  })
  class TestModule {}

  const graph = graphBuilder(TestModule);
  const compiler = new Compiler();
  const compiled = await compiler.compile(graph);

  const linker = new Linker();
  expect(() => linker.link(compiled)).toThrow('Command "test" already exists');
});

test("Linker should include middlewares from module, controller, and method", async () => {
  const moduleMw = async () => {};
  const controllerMw = async () => {};
  const methodMw = async () => {};

  @Controller({ middlewares: [controllerMw] })
  class TestController {
    @Command("test")
    testCommand() {
      return "test";
    }
  }

  // Apply method middleware after class definition
  Object.defineProperty(TestController.prototype.testCommand, "name", {
    value: "testCommand",
  });

  @Module({
    controllers: [TestController],
    middlewares: [moduleMw],
  })
  class TestModule {}

  const graph = graphBuilder(TestModule);
  const compiler = new Compiler();
  const compiled = await compiler.compile(graph);

  // Manually add method middleware to compiled structure
  compiled.controllers[0].methods[0].middlewares.push(methodMw);

  const linker = new Linker();
  const linked = linker.link(compiled) as LinkedCommandsApp;

  expect(linked.commands["test"].middlewares.length).toBe(3);
  expect(linked.commands["test"].middlewares[0]).toBe(moduleMw);
  expect(linked.commands["test"].middlewares[1]).toBe(controllerMw);
  expect(linked.commands["test"].middlewares[2]).toBe(methodMw);
});

test("Linker should handle error handlers correctly", async () => {
  const moduleErrorHandler = () => {};
  const controllerErrorHandler = () => {};
  const methodErrorHandler = () => {};

  @Controller({ errorHandler: controllerErrorHandler })
  class TestController {
    @Command("test1")
    testCommand1() {
      return "test1";
    }

    @Command("test2")
    testCommand2() {
      return "test2";
    }

    @Command("test3")
    testCommand3() {
      return "test3";
    }
  }

  @Module({
    controllers: [TestController],
    errorHandler: moduleErrorHandler,
  })
  class TestModule {}

  const graph = graphBuilder(TestModule);
  const compiler = new Compiler();
  const compiled = await compiler.compile(graph);

  // Manually set method error handler on test3
  compiled.controllers[0].methods[2].errorHandler = methodErrorHandler;

  const linker = new Linker();
  const linked = linker.link(compiled) as LinkedCommandsApp;

  // test1 should use controller error handler
  expect(linked.commands["test1"].errorHandler).toBe(controllerErrorHandler);

  // test2 should use controller error handler
  expect(linked.commands["test2"].errorHandler).toBe(controllerErrorHandler);

  // test3 should use method error handler (overrides controller)
  expect(linked.commands["test3"].errorHandler).toBe(methodErrorHandler);

  // App-level should have module error handler
  expect(linked.errorHandler).toBe(moduleErrorHandler);
});

test("Linker should handle imported modules", async () => {
  @Controller()
  class SharedController {
    @Command("shared")
    sharedCommand() {
      return "shared";
    }
  }

  @Module({
    controllers: [SharedController],
  })
  class SharedModule {}

  @Controller()
  class AppController {
    @Command("app")
    appCommand() {
      return "app";
    }
  }

  @Module({
    imports: [SharedModule],
    controllers: [AppController],
  })
  class AppModule {}

  const graph = graphBuilder(AppModule);
  const compiler = new Compiler();
  const compiled = await compiler.compile(graph);

  const linker = new Linker();
  const linked = linker.link(compiled) as LinkedCommandsApp;

  expect(linked.commands["app"]).toBeDefined();
  expect(linked.commands["shared"]).toBeDefined();
});

test("Linker should skip methods without command decorator", async () => {
  @Controller()
  class TestController {
    @Command("test")
    testCommand() {
      return "test";
    }

    // No decorator - should be skipped
    helperMethod() {
      return "helper";
    }
  }

  @Module({
    controllers: [TestController],
  })
  class TestModule {}

  const graph = graphBuilder(TestModule);
  const compiler = new Compiler();
  const compiled = await compiler.compile(graph);

  const linker = new Linker();
  const linked = linker.link(compiled) as LinkedCommandsApp;

  expect(linked.commands["test"]).toBeDefined();
  expect(Object.keys(linked.commands).length).toBe(1);
});

test("Linker should set compiled gateway reference", async () => {
  @Controller()
  class TestController {
    @Main()
    mainHandler() {
      return "main";
    }
  }

  @Module({
    controllers: [TestController],
  })
  class TestModule {}

  const graph = graphBuilder(TestModule);
  const compiler = new Compiler();
  const compiled = await compiler.compile(graph);

  const linker = new Linker();
  const linked = linker.link(compiled) as LinkedMainApp;

  expect(linked.compiled).toBeDefined();
  expect(linked.compiled?.meta.isGateway).toBe(true);
});

test("Linker should handle multiple controllers", async () => {
  @Controller()
  class Controller1 {
    @Command("cmd1")
    command1() {
      return "cmd1";
    }
  }

  @Controller()
  class Controller2 {
    @Command("cmd2")
    command2() {
      return "cmd2";
    }
  }

  @Module({
    controllers: [Controller1, Controller2],
  })
  class TestModule {}

  const graph = graphBuilder(TestModule);
  const compiler = new Compiler();
  const compiled = await compiler.compile(graph);

  const linker = new Linker();
  const linked = linker.link(compiled) as LinkedCommandsApp;

  expect(linked.commands["cmd1"]).toBeDefined();
  expect(linked.commands["cmd2"]).toBeDefined();
});

test("Linker should handle main command with middlewares and error handler", async () => {
  const middleware1 = async () => {};
  const middleware2 = async () => {};
  const errorHandler = () => {};

  @Controller({ middlewares: [middleware1], errorHandler })
  class TestController {
    @Main()
    mainHandler() {
      return "main";
    }
  }

  @Module({
    controllers: [TestController],
    middlewares: [middleware2],
  })
  class TestModule {}

  const graph = graphBuilder(TestModule);
  const compiler = new Compiler();
  const compiled = await compiler.compile(graph);

  const linker = new Linker();
  const linked = linker.link(compiled) as LinkedMainApp;

  expect(linked.main.middlewares.length).toBe(2);
  expect(linked.main.middlewares[0]).toBe(middleware2);
  expect(linked.main.middlewares[1]).toBe(middleware1);
  expect(linked.main.errorHandler).toBe(errorHandler);
});

test("Linker should preserve compiled method reference in linked command", async () => {
  @Controller()
  class TestController {
    @Command("test")
    testCommand() {
      return "test";
    }
  }

  @Module({
    controllers: [TestController],
  })
  class TestModule {}

  const graph = graphBuilder(TestModule);
  const compiler = new Compiler();
  const compiled = await compiler.compile(graph);

  const linker = new Linker();
  const linked = linker.link(compiled) as LinkedCommandsApp;

  expect(linked.commands["test"].compiled).toBeDefined();
  expect(linked.commands["test"].compiled.name).toBe("testCommand");
  expect(linked.commands["test"].compiled.meta).toBeDefined();
});

test("Linker should handle commands with special characters", async () => {
  @Controller()
  class TestController {
    @Command("test:run")
    testRunCommand() {
      return "test:run";
    }

    @Command("test-all")
    testAllCommand() {
      return "test-all";
    }
  }

  @Module({
    controllers: [TestController],
  })
  class TestModule {}

  const graph = graphBuilder(TestModule);
  const compiler = new Compiler();
  const compiled = await compiler.compile(graph);

  const linker = new Linker();
  const linked = linker.link(compiled) as LinkedCommandsApp;

  expect(linked.commands["test:run"]).toBeDefined();
  expect(linked.commands["test-all"]).toBeDefined();
});

test("Linker should handle deeply nested imports", async () => {
  @Controller()
  class Level3Controller {
    @Command("level3")
    level3Command() {
      return "level3";
    }
  }

  @Module({
    controllers: [Level3Controller],
  })
  class Level3Module {}

  @Controller()
  class Level2Controller {
    @Command("level2")
    level2Command() {
      return "level2";
    }
  }

  @Module({
    imports: [Level3Module],
    controllers: [Level2Controller],
  })
  class Level2Module {}

  @Controller()
  class Level1Controller {
    @Command("level1")
    level1Command() {
      return "level1";
    }
  }

  @Module({
    imports: [Level2Module],
    controllers: [Level1Controller],
  })
  class Level1Module {}

  const graph = graphBuilder(Level1Module);
  const compiler = new Compiler();
  const compiled = await compiler.compile(graph);

  const linker = new Linker();
  const linked = linker.link(compiled) as LinkedCommandsApp;

  expect(linked.commands["level1"]).toBeDefined();
  expect(linked.commands["level2"]).toBeDefined();
  expect(linked.commands["level3"]).toBeDefined();
});

test("Linker should handle module without controllers", async () => {
  @Injectable()
  class TestService {}

  @Module({
    providers: [TestService],
  })
  class TestModule {}

  const graph = graphBuilder(TestModule);
  const compiler = new Compiler();
  const compiled = await compiler.compile(graph);

  const linker = new Linker();
  const linked = linker.link(compiled) as LinkedCommandsApp;

  expect(linked.commands).toBeDefined();
  expect(Object.keys(linked.commands).length).toBe(0);
});

test("Linker state should reset between link calls", async () => {
  @Controller()
  class MainController {
    @Main()
    mainHandler() {
      return "main";
    }
  }

  @Module({
    controllers: [MainController],
  })
  class MainModule {}

  @Controller()
  class SubController {
    @Command("test")
    testCommand() {
      return "test";
    }
  }

  @Module({
    controllers: [SubController],
  })
  class SubModule {}

  const mainGraph = graphBuilder(MainModule);
  const subGraph = graphBuilder(SubModule);
  const compiler = new Compiler();
  const compiledMain = await compiler.compile(mainGraph);
  const compiledSub = await compiler.compile(subGraph);

  const linker = new Linker();

  // First link with main command
  const linkedMain = linker.link(compiledMain) as LinkedMainApp;
  expect(linkedMain.main).toBeDefined();

  // Second link with sub commands should work (state reset)
  const linkedSub = linker.link(compiledSub) as LinkedCommandsApp;
  expect(linkedSub.commands["test"]).toBeDefined();
});
