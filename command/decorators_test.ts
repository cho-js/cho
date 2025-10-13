import { expect } from "@std/expect";
import { readMetadataObject } from "@chojs/core/meta";
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

test("Command decorator should add command metadata with given name", () => {
  class TestController {
    @Command("foo")
    fooHandler() {}
  }
  expect(readMetadataObject(TestController.prototype.fooHandler)).toEqual({
    command: "foo",
  });
});

test("Command decorator with different names should create separate metadata", () => {
  class TestController {
    @Command("foo")
    fooHandler() {}

    @Command("bar")
    barHandler() {}
  }
  expect(readMetadataObject(TestController.prototype.fooHandler)).toEqual({
    command: "foo",
  });
  expect(readMetadataObject(TestController.prototype.barHandler)).toEqual({
    command: "bar",
  });
});

test("Help decorator on method should add help metadata", () => {
  class TestController {
    @Help("This is help text")
    @Command("foo")
    fooHandler() {}
  }
  expect(readMetadataObject(TestController.prototype.fooHandler)).toEqual({
    command: "foo",
    help: "This is help text",
  });
});

test("Help decorator on class should add help metadata", () => {
  @Help("Global help text")
  class TestController {}
  expect(readMetadataObject(TestController)).toEqual({
    help: "Global help text",
  });
});

test("Help decorator should work with Main decorator", () => {
  class TestController {
    @Help("Main command help")
    @Main()
    mainHandler() {}
  }
  expect(readMetadataObject(TestController.prototype.mainHandler)).toEqual({
    command: "main",
    help: "Main command help",
  });
});

test("Multiple Command decorators on different methods should be independent", () => {
  class TestController {
    @Command("cmd1")
    @Help("Command 1 help")
    cmd1Handler() {}

    @Command("cmd2")
    @Help("Command 2 help")
    cmd2Handler() {}

    @Main()
    @Help("Main help")
    mainHandler() {}
  }
  expect(readMetadataObject(TestController.prototype.cmd1Handler)).toEqual({
    command: "cmd1",
    help: "Command 1 help",
  });
  expect(readMetadataObject(TestController.prototype.cmd2Handler)).toEqual({
    command: "cmd2",
    help: "Command 2 help",
  });
  expect(readMetadataObject(TestController.prototype.mainHandler)).toEqual({
    command: "main",
    help: "Main help",
  });
});

test("Help decorator can be applied without Command or Main decorator", () => {
  class TestController {
    @Help("Some help")
    someMethod() {}
  }
  expect(readMetadataObject(TestController.prototype.someMethod)).toEqual({
    help: "Some help",
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

test("Command decorator with special characters should preserve name", () => {
  class TestController {
    @Command("foo-bar:baz")
    specialCommand() {}
  }
  expect(readMetadataObject(TestController.prototype.specialCommand)).toEqual({
    command: "foo-bar:baz",
  });
});

test("Help decorator with multiline string should preserve formatting", () => {
  const helpText = `Usage: myapp [options]

Options:
  --help    Show help
  --version Show version`;

  @Help(helpText)
  class TestController {}

  expect(readMetadataObject(TestController)).toEqual({
    help: helpText,
  });
});

test("Help decorator with empty string should add empty help metadata", () => {
  @Help("")
  class TestController {}

  expect(readMetadataObject(TestController)).toEqual({
    help: "",
  });
});
