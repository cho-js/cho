import { expect } from "@std/expect";
import { test } from "../testing/mod.ts";
import { Controller, Injectable, Module } from "../di/decorators.ts";
import { graphBuilder } from "./graph-builder.ts";
import { Compiler } from "./compiler.ts";
import type {
  ChoErrorHandler,
  ChoMiddleware,
  Context,
  Next,
} from "../di/types.ts";

test("Compiler should compile a simple module", async () => {
  @Injectable()
  class SimpleService {
    getValue() {
      return "test-value";
    }
  }

  @Controller({
    route: "api",
    deps: [SimpleService],
  })
  class SimpleController {
    constructor(readonly service: SimpleService) {}
  }

  @Module({
    providers: [SimpleService],
    controllers: [SimpleController],
  })
  class SimpleModule {}

  const graph = graphBuilder(SimpleModule);
  const compiler = new Compiler();
  const compiled = await compiler.compile(graph);

  // Verify compiled module structure
  expect(compiled.meta.isModule).toBe(true);
  expect(compiled.controllers.length).toBe(1);
  expect(compiled.imports.length).toBe(0);
  expect(compiled.middlewares.length).toBe(0);
  expect(compiled.errorHandler).toBeUndefined();
  expect(compiled.handle).toBeDefined();

  // Verify compiled controller
  const controller = compiled.controllers[0];
  expect(controller.meta.isGateway).toBe(true);
  expect(controller.meta.route).toBe("api");
  expect(controller.handle).toBeDefined();
  expect(controller.handle).toBeInstanceOf(SimpleController);
  expect((controller.handle as SimpleController).service).toBeInstanceOf(
    SimpleService,
  );
});

test("Compiler should compile modules with imports", async () => {
  @Injectable()
  class SharedService {
    getData() {
      return "shared-data";
    }
  }

  @Module({
    providers: [SharedService],
  })
  class SharedModule {}

  @Controller({
    route: "api",
    deps: [SharedService],
  })
  class AppController {
    constructor(readonly service: SharedService) {}
  }

  @Module({
    imports: [SharedModule],
    controllers: [AppController],
  })
  class AppModule {}

  const graph = graphBuilder(AppModule);
  const compiler = new Compiler();
  const compiled = await compiler.compile(graph);

  // Verify imports
  expect(compiled.imports.length).toBe(1);
  expect(compiled.imports[0].meta.isModule).toBe(true);

  // Verify controller can access imported service
  const controller = compiled.controllers[0];
  expect((controller.handle as AppController).service).toBeInstanceOf(
    SharedService,
  );
});

test("Compiler should handle function middlewares", async () => {
  const middlewareFn = async (ctx: Context, next: Next) => {
    await next();
  };

  @Controller({
    route: "api",
    middlewares: [middlewareFn],
  })
  class TestController {}

  @Module({
    controllers: [TestController],
  })
  class TestModule {}

  const graph = graphBuilder(TestModule);
  const compiler = new Compiler();
  const compiled = await compiler.compile(graph);

  const controller = compiled.controllers[0];
  expect(controller.middlewares.length).toBe(1);
  expect(controller.middlewares[0]).toBe(middlewareFn);
});

test("Compiler should handle class middlewares", async () => {
  @Injectable()
  class LoggerMiddleware implements ChoMiddleware {
    async handle(ctx: Context, next: Next): Promise<void> {
      await next();
    }
  }

  @Controller({
    route: "api",
    middlewares: [LoggerMiddleware as unknown as ChoMiddleware],
  })
  class TestController {}

  @Module({
    providers: [LoggerMiddleware],
    controllers: [TestController],
  })
  class TestModule {}

  const graph = graphBuilder(TestModule);
  const compiler = new Compiler();
  const compiled = await compiler.compile(graph);

  const controller = compiled.controllers[0];
  expect(controller.middlewares.length).toBe(1);
  expect(typeof controller.middlewares[0]).toBe("function");
});

test("Compiler should handle function error handlers", async () => {
  const errorHandlerFn = (err: Error, ctx: Context) => {
    return new Response("Error: " + err.message);
  };

  @Controller({
    route: "api",
    errorHandler: errorHandlerFn,
  })
  class TestController {}

  @Module({
    controllers: [TestController],
  })
  class TestModule {}

  const graph = graphBuilder(TestModule);
  const compiler = new Compiler();
  const compiled = await compiler.compile(graph);

  const controller = compiled.controllers[0];
  expect(controller.errorHandler).toBe(errorHandlerFn);
});

test("Compiler should handle class error handlers", async () => {
  @Injectable()
  class GlobalErrorHandler implements ChoErrorHandler {
    catch(err: Error, ctx: Context): Response {
      return new Response("Global error: " + err.message);
    }
  }

  @Controller({
    route: "api",
    errorHandler: GlobalErrorHandler as unknown as ChoErrorHandler,
  })
  class TestController {}

  @Module({
    providers: [GlobalErrorHandler],
    controllers: [TestController],
  })
  class TestModule {}

  const graph = graphBuilder(TestModule);
  const compiler = new Compiler();
  const compiled = await compiler.compile(graph);

  const controller = compiled.controllers[0];
  expect(controller.errorHandler).toBeDefined();
  expect(typeof controller.errorHandler).toBe("function");
});

test("Compiler should resolve dependencies correctly", async () => {
  @Injectable()
  class DatabaseService {
    connect() {
      return "connected";
    }
  }

  @Injectable({ deps: [DatabaseService] })
  class UserService {
    constructor(readonly db: DatabaseService) {}

    getUsers() {
      return this.db.connect();
    }
  }

  @Controller({
    route: "users",
    deps: [UserService],
  })
  class UserController {
    constructor(readonly userService: UserService) {}
  }

  @Module({
    providers: [DatabaseService, UserService],
    controllers: [UserController],
  })
  class AppModule {}

  const graph = graphBuilder(AppModule);
  const compiler = new Compiler();
  const compiled = await compiler.compile(graph);

  const controller = compiled.controllers[0].handle as UserController;
  expect(controller.userService).toBeInstanceOf(UserService);
  expect(controller.userService.db).toBeInstanceOf(DatabaseService);
  expect(controller.userService.getUsers()).toBe("connected");
});

test("Compiler should handle provider factories", async () => {
  const CONFIG_TOKEN = "CONFIG";

  @Injectable({ deps: [CONFIG_TOKEN] })
  class ConfigService {
    constructor(readonly config: { apiUrl: string }) {}
  }

  @Controller({
    route: "api",
    deps: [ConfigService],
  })
  class ApiController {
    constructor(readonly configService: ConfigService) {}
  }

  @Module({
    providers: [
      {
        provide: CONFIG_TOKEN,
        factory: () => Promise.resolve({ apiUrl: "https://api.example.com" }),
      },
      ConfigService,
    ],
    controllers: [ApiController],
  })
  class AppModule {}

  const graph = graphBuilder(AppModule);
  const compiler = new Compiler();
  const compiled = await compiler.compile(graph);

  const controller = compiled.controllers[0].handle as ApiController;
  expect(controller.configService).toBeInstanceOf(ConfigService);
  expect(controller.configService.config).toEqual({
    apiUrl: "https://api.example.com",
  });
});

test("Compiler should cache compiled modules", async () => {
  @Module({})
  class SharedModule {}

  @Module({
    imports: [SharedModule, SharedModule], // Same module imported twice
  })
  class AppModule {}

  const graph = graphBuilder(AppModule);
  const compiler = new Compiler();
  const compiled = await compiler.compile(graph);

  // Both imports should reference the same compiled module
  expect(compiled.imports.length).toBe(2);
  expect(compiled.imports[0]).toBe(compiled.imports[1]);
});

test("Compiler should handle multiple middlewares in order", async () => {
  const middleware1 = async (ctx: Context, next: Next) => {
    await next();
  };
  const middleware2 = async (ctx: Context, next: Next) => {
    await next();
  };

  @Injectable()
  class Middleware3 implements ChoMiddleware {
    async handle(ctx: Context, next: Next): Promise<void> {
      await next();
    }
  }

  @Controller({
    route: "api",
    middlewares: [middleware1, middleware2, Middleware3 as unknown as ChoMiddleware],
  })
  class TestController {}

  @Module({
    providers: [Middleware3],
    controllers: [TestController],
  })
  class TestModule {}

  const graph = graphBuilder(TestModule);
  const compiler = new Compiler();
  const compiled = await compiler.compile(graph);

  const controller = compiled.controllers[0];
  expect(controller.middlewares.length).toBe(3);
  expect(controller.middlewares[0]).toBe(middleware1);
  expect(controller.middlewares[1]).toBe(middleware2);
  expect(typeof controller.middlewares[2]).toBe("function");
});
