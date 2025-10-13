import { expect } from "@std/expect";
import { test } from "@chojs/core/testing";
import { Controller, Module } from "@chojs/core/di";
import {
  Application,
  ApplicationCommands,
  ApplicationMain,
  MissingCommandError,
  MissingHelpError,
  NotFoundError,
} from "./application.ts";
import { Command, Help, Main } from "./decorators.ts";
import type { ChoCommandContext } from "./context.ts";

test("Application.create should create ApplicationMain for main command", async () => {
  @Controller()
  class TestController {
    @Main()
    mainHandler() {}
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const app = await Application.create(TestModule);

  expect(app instanceof ApplicationMain).toBe(true);
});

test("Application.create should create ApplicationCommands for subcommands", async () => {
  @Controller()
  class TestController {
    @Command("foo")
    fooHandler() {}
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const app = await Application.create(TestModule);

  expect(app instanceof ApplicationCommands).toBe(true);
});

test("ApplicationMain should run main command", async () => {
  let executed = false;

  @Controller()
  class TestController {
    @Main()
    mainHandler() {
      executed = true;
    }
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const app = await Application.create(TestModule);
  await app.run([]);

  expect(executed).toBe(true);
});

test("ApplicationMain should pass context to handler", async () => {
  let receivedContext: ChoCommandContext | null = null;

  @Controller()
  class TestController {
    @Main()
    mainHandler(ctx: ChoCommandContext) {
      receivedContext = ctx;
    }
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const app = await Application.create(TestModule);
  await app.run(["--foo", "bar"]);

  expect(receivedContext).not.toBe(null);
  expect(receivedContext!.args.foo).toBe("bar");
});

test("ApplicationMain should show help with --help flag", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: any[]) => logs.push(args.join(" "));

  try {
    @Controller()
    class TestController {
      @Help("Main command help")
      @Main()
      mainHandler() {}
    }

    @Module({ controllers: [TestController] })
    class TestModule {}

    const app = await Application.create(TestModule);
    await app.run(["--help"]);

    expect(logs).toContain("Main command help");
  } finally {
    console.log = originalLog;
  }
});

test("ApplicationMain should show help with -h flag", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: any[]) => logs.push(args.join(" "));

  try {
    @Controller()
    class TestController {
      @Help("Main command help")
      @Main()
      mainHandler() {}
    }

    @Module({ controllers: [TestController] })
    class TestModule {}

    const app = await Application.create(TestModule);
    await app.run(["-h"]);

    expect(logs).toContain("Main command help");
  } finally {
    console.log = originalLog;
  }
});

test("ApplicationMain should throw MissingHelpError when help not set", async () => {
  @Controller()
  class TestController {
    @Main()
    mainHandler() {}
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const app = await Application.create(TestModule);

  await expect(app.run(["--help"])).rejects.toThrow(MissingHelpError);
});

test("ApplicationCommands should run correct subcommand", async () => {
  const executed: string[] = [];

  @Controller()
  class TestController {
    @Command("foo")
    fooHandler() {
      executed.push("foo");
    }

    @Command("bar")
    barHandler() {
      executed.push("bar");
    }
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const app = await Application.create(TestModule);
  await app.run(["foo"]);

  expect(executed).toEqual(["foo"]);
});

test("ApplicationCommands should pass args without command name", async () => {
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

  const app = await Application.create(TestModule);
  await app.run(["foo", "--bar", "baz", "extra"]);

  expect(receivedContext).not.toBe(null);
  expect(receivedContext!.args._).toEqual(["extra"]);
  expect(receivedContext!.args.bar).toBe("baz");
});

test("ApplicationCommands should throw MissingCommandError when no command provided", async () => {
  @Controller()
  class TestController {
    @Command("foo")
    fooHandler() {}
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const app = await Application.create(TestModule);

  await expect(app.run([])).rejects.toThrow(MissingCommandError);
});

test("ApplicationCommands should throw NotFoundError for unknown command", async () => {
  @Controller()
  class TestController {
    @Command("foo")
    fooHandler() {}
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const app = await Application.create(TestModule);

  await expect(app.run(["unknown"])).rejects.toThrow(NotFoundError);
});

test("ApplicationCommands should show global help with --help flag", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: any[]) => logs.push(args.join(" "));

  try {
    @Help("Global help text")
    @Controller()
    class TestController {
      @Command("foo")
      fooHandler() {}
    }

    @Module({ controllers: [TestController] })
    class TestModule {}

    const app = await Application.create(TestModule);
    await app.run(["--help"]);

    expect(logs).toContain("Global help text");
  } finally {
    console.log = originalLog;
  }
});

test("ApplicationCommands should show command-specific help", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: any[]) => logs.push(args.join(" "));

  try {
    @Controller()
    class TestController {
      @Help("Foo command help")
      @Command("foo")
      fooHandler() {}
    }

    @Module({ controllers: [TestController] })
    class TestModule {}

    const app = await Application.create(TestModule);
    await app.run(["foo", "--help"]);

    expect(logs).toContain("Foo command help");
  } finally {
    console.log = originalLog;
  }
});

test("ApplicationCommands should throw MissingHelpError when global help not set", async () => {
  @Controller()
  class TestController {
    @Command("foo")
    fooHandler() {}
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const app = await Application.create(TestModule);

  await expect(app.run(["--help"])).rejects.toThrow(MissingHelpError);
});

test("Application should handle errors with error handler", async () => {
  let errorHandled = false;

  function errorHandler(err: Error) {
    errorHandled = true;
    expect(err.message).toBe("test error");
  }

  @Controller({ errorHandler })
  class TestController {
    @Main()
    mainHandler() {
      throw new Error("test error");
    }
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const app = await Application.create(TestModule);
  await app.run([]);

  expect(errorHandled).toBe(true);
});

test("Application should propagate error when no error handler set", async () => {
  @Controller()
  class TestController {
    @Main()
    mainHandler() {
      throw new Error("test error");
    }
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const app = await Application.create(TestModule);

  await expect(app.run([])).rejects.toThrow("test error");
});

test("ApplicationCommands should handle MissingCommandError with error handler", async () => {
  let errorHandled = false;

  function errorHandler(err: Error, ctx: ChoCommandContext) {
    errorHandled = true;
    expect(err).toBeInstanceOf(MissingCommandError);
  }

  @Controller()
  class TestController {
    @Command("foo")
    fooHandler() {}
  }

  @Module({ controllers: [TestController], errorHandler })
  class TestModule {}

  const app = await Application.create(TestModule);
  await app.run([]);

  expect(errorHandled).toBe(true);
});

test("ApplicationCommands should handle NotFoundError with error handler", async () => {
  let errorHandled = false;

  function errorHandler(err: Error, ctx: ChoCommandContext) {
    errorHandled = true;
    expect(err).toBeInstanceOf(NotFoundError);
  }

  @Controller()
  class TestController {
    @Command("foo")
    fooHandler() {}
  }

  @Module({ controllers: [TestController], errorHandler })
  class TestModule {}

  const app = await Application.create(TestModule);
  await app.run(["unknown"]);

  expect(errorHandled).toBe(true);
});

test("Application should have instance and appRef properties", async () => {
  @Controller()
  class TestController {
    @Main()
    mainHandler() {}
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const app = await Application.create(TestModule);

  expect(app.instance).toBeDefined();
  expect(app.appRef).toBeDefined();
});

test("ApplicationMain should prefer main help over HelpKey", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: any[]) => logs.push(args.join(" "));

  try {
    @Help("Controller help")
    @Controller()
    class TestController {
      @Help("Main command help")
      @Main()
      mainHandler() {}
    }

    @Module({ controllers: [TestController] })
    class TestModule {}

    const app = await Application.create(TestModule);
    await app.run(["--help"]);

    expect(logs).toContain("Main command help");
    expect(logs).not.toContain("Controller help");
  } finally {
    console.log = originalLog;
  }
});

test("ApplicationMain should fallback to HelpKey when main help not set", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: any[]) => logs.push(args.join(" "));

  try {
    @Help("Controller help")
    @Controller()
    class TestController {
      @Main()
      mainHandler() {}
    }

    @Module({ controllers: [TestController] })
    class TestModule {}

    const app = await Application.create(TestModule);
    await app.run(["--help"]);

    expect(logs).toContain("Controller help");
  } finally {
    console.log = originalLog;
  }
});

test("ApplicationCommands should not execute command when showing help", async () => {
  let executed = false;

  @Controller()
  class TestController {
    @Help("Foo help")
    @Command("foo")
    fooHandler() {
      executed = true;
    }
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const app = await Application.create(TestModule);
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: any[]) => logs.push(args.join(" "));

  try {
    await app.run(["foo", "--help"]);
  } finally {
    console.log = originalLog;
  }

  expect(executed).toBe(false);
});

test("ApplicationMain should not execute main when showing help", async () => {
  let executed = false;

  @Controller()
  class TestController {
    @Help("Main help")
    @Main()
    mainHandler() {
      executed = true;
    }
  }

  @Module({ controllers: [TestController] })
  class TestModule {}

  const app = await Application.create(TestModule);
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: any[]) => logs.push(args.join(" "));

  try {
    await app.run(["--help"]);
  } finally {
    console.log = originalLog;
  }

  expect(executed).toBe(false);
});
