import { expect } from "@std/expect";
import { readMetadataObject } from "@chojs/core";
import { test } from "@chojs/core/testing";
import { Command, Help, Main } from "./decorators.ts";

test("Main decorator should add command metadata with 'main' value", () => {
  class TestController {
    @Main()
    mainHandler() {}
  }
  expect(readMetadataObject(TestController.prototype.mainHandler)).toEqual({
    command: "main",
  });
});

test("Command decorator should add command metadata with provided name", () => {
  class TestController {
    @Command("test")
    testCommand() {}
  }
  expect(readMetadataObject(TestController.prototype.testCommand)).toEqual({
    command: "test",
  });
});

test("Command decorator with different names should create different metadata", () => {
  class TestController {
    @Command("create")
    createCommand() {}

    @Command("delete")
    deleteCommand() {}
  }
  expect(readMetadataObject(TestController.prototype.createCommand)).toEqual({
    command: "create",
  });
  expect(readMetadataObject(TestController.prototype.deleteCommand)).toEqual({
    command: "delete",
  });
});

test("Help decorator on method should add help content metadata", () => {
  class TestController {
    @Help("This is a test command")
    testMethod() {}
  }
  expect(readMetadataObject(TestController.prototype.testMethod)).toEqual({
    help: "This is a test command",
  });
});

test("Help decorator on class should add help content metadata", () => {
  @Help("This is a test controller")
  class TestController {}
  expect(readMetadataObject(TestController)).toEqual({
    help: "This is a test controller",
  });
});

test("Command and Help decorators should merge metadata", () => {
  class TestController {
    @Command("test")
    @Help("This is a test command")
    testCommand() {}
  }
  expect(readMetadataObject(TestController.prototype.testCommand)).toEqual({
    command: "test",
    help: "This is a test command",
  });
});

test("Main and Help decorators should merge metadata", () => {
  class TestController {
    @Main()
    @Help("Main command help text")
    mainHandler() {}
  }
  expect(readMetadataObject(TestController.prototype.mainHandler)).toEqual({
    command: "main",
    help: "Main command help text",
  });
});

test("Multiple methods with Command decorator should have independent metadata", () => {
  class TestController {
    @Command("start")
    @Help("Start the service")
    startCommand() {}

    @Command("stop")
    @Help("Stop the service")
    stopCommand() {}

    @Main()
    @Help("Main handler")
    mainHandler() {}
  }

  expect(readMetadataObject(TestController.prototype.startCommand)).toEqual({
    command: "start",
    help: "Start the service",
  });
  expect(readMetadataObject(TestController.prototype.stopCommand)).toEqual({
    command: "stop",
    help: "Stop the service",
  });
  expect(readMetadataObject(TestController.prototype.mainHandler)).toEqual({
    command: "main",
    help: "Main handler",
  });
});

test("Help decorator with multiline content should preserve formatting", () => {
  const helpText = `Usage: myapp [options]

Options:
  --help, -h     Show help
  --version, -v  Show version`;

  class TestController {
    @Help(helpText)
    @Main()
    mainHandler() {}
  }

  expect(readMetadataObject(TestController.prototype.mainHandler)).toEqual({
    command: "main",
    help: helpText,
  });
});

test("Command decorator with empty string should still add metadata", () => {
  class TestController {
    @Command("")
    emptyCommand() {}
  }
  expect(readMetadataObject(TestController.prototype.emptyCommand)).toEqual({
    command: "",
  });
});

test("Command decorator with special characters should work", () => {
  class TestController {
    @Command("test:run")
    testRunCommand() {}

    @Command("test-all")
    testAllCommand() {}
  }
  expect(readMetadataObject(TestController.prototype.testRunCommand)).toEqual({
    command: "test:run",
  });
  expect(readMetadataObject(TestController.prototype.testAllCommand)).toEqual({
    command: "test-all",
  });
});

test("Help decorator on class and method should be independent", () => {
  @Help("Controller help")
  class TestController {
    @Help("Method help")
    @Command("test")
    testCommand() {}
  }

  expect(readMetadataObject(TestController)).toEqual({
    help: "Controller help",
  });
  expect(readMetadataObject(TestController.prototype.testCommand)).toEqual({
    command: "test",
    help: "Method help",
  });
});

test("Command decorator with unicode characters should work", () => {
  class TestController {
    @Command("K")
    unicodeCommand() {}
  }
  expect(readMetadataObject(TestController.prototype.unicodeCommand)).toEqual({
    command: "K",
  });
});

test("Multiple Help decorators should overwrite (last wins)", () => {
  class TestController {
    @Help("First help")
    @Help("Second help")
    testMethod() {}
  }
  // Decorators apply bottom-up, so "Second help" is applied first,
  // then "First help" overwrites it
  expect(readMetadataObject(TestController.prototype.testMethod)).toEqual({
    help: "First help",
  });
});

test("Command decorator should work with kebab-case names", () => {
  class TestController {
    @Command("create-user")
    @Help("Create a new user")
    createUserCommand() {}
  }
  expect(readMetadataObject(TestController.prototype.createUserCommand))
    .toEqual({
      command: "create-user",
      help: "Create a new user",
    });
});

test("Main decorator with multiple methods should add metadata to each independently", () => {
  class TestController {
    @Main()
    handler1() {}
  }

  class AnotherController {
    @Main()
    handler2() {}
  }

  expect(readMetadataObject(TestController.prototype.handler1)).toEqual({
    command: "main",
  });
  expect(readMetadataObject(AnotherController.prototype.handler2)).toEqual({
    command: "main",
  });
});

test("Command decorator with spaces should work", () => {
  class TestController {
    @Command("run test")
    runTestCommand() {}
  }
  expect(readMetadataObject(TestController.prototype.runTestCommand)).toEqual({
    command: "run test",
  });
});

test("Help decorator with empty string should add empty help", () => {
  class TestController {
    @Help("")
    @Command("test")
    testCommand() {}
  }
  expect(readMetadataObject(TestController.prototype.testCommand)).toEqual({
    command: "test",
    help: "",
  });
});
