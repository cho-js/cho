import { expect } from "@std/expect";
import { test } from "../testing/mod.ts";
import { Controller, Injectable, Module } from "../di/decorators.ts";
import { AppRef } from "./app-ref.ts";

test("AppRef.create should create an application reference", async () => {
  @Injectable()
  class TestService {
    getValue() {
      return "test-value";
    }
  }

  @Module({
    providers: [TestService],
  })
  class TestModule {}

  const appRef = await AppRef.create(TestModule);

  expect(appRef).toBeDefined();
  expect(appRef.compiled).toBeDefined();
  expect(appRef.compiled.meta.isModule).toBe(true);
});

test("AppRef.select should find module instance", async () => {
  @Module({})
  class TestModule {}

  const appRef = await AppRef.create(TestModule);
  const instance = appRef.select(TestModule);

  expect(instance).toBeDefined();
});

test("AppRef.select should find controller instance", async () => {
  @Controller({
    route: "api",
  })
  class ApiController {
    getData() {
      return "data";
    }
  }

  @Module({
    controllers: [ApiController],
  })
  class TestModule {}

  const appRef = await AppRef.create(TestModule);
  const controller = appRef.select<ApiController>(ApiController);

  expect(controller).toBeInstanceOf(ApiController);
  expect(controller.getData()).toBe("data");
});

test("AppRef.select should find imported module instance", async () => {
  @Injectable()
  class SharedService {
    getValue() {
      return "shared";
    }
  }

  @Module({
    providers: [SharedService],
  })
  class SharedModule {}

  @Module({
    imports: [SharedModule],
  })
  class AppModule {}

  const appRef = await AppRef.create(AppModule);
  const sharedModule = appRef.select(SharedModule);

  expect(sharedModule).toBeDefined();
});

test("AppRef.select should find controller in imported module", async () => {
  @Controller({
    route: "shared",
  })
  class SharedController {}

  @Module({
    controllers: [SharedController],
  })
  class SharedModule {}

  @Module({
    imports: [SharedModule],
  })
  class AppModule {}

  const appRef = await AppRef.create(AppModule);
  const controller = appRef.select<SharedController>(SharedController);

  expect(controller).toBeInstanceOf(SharedController);
});

test("AppRef.select should throw when constructor not found", async () => {
  @Module({})
  class TestModule {}

  class NonExistentController {}

  const appRef = await AppRef.create(TestModule);

  expect(() => appRef.select(NonExistentController)).toThrow(
    "Module not found for controller: NonExistentController",
  );
});

test("AppRef.resolve should resolve provider from root module", async () => {
  @Injectable()
  class TestService {
    getValue() {
      return "test-value";
    }
  }

  @Module({
    providers: [TestService],
  })
  class TestModule {}

  const appRef = await AppRef.create(TestModule);
  const service = await appRef.resolve(TestService) as TestService;

  expect(service).toBeInstanceOf(TestService);
  expect(service.getValue()).toBe("test-value");
});

test("AppRef.resolve should resolve provider by token", async () => {
  const CONFIG_TOKEN = "CONFIG";

  @Module({
    providers: [
      {
        provide: CONFIG_TOKEN,
        factory: () => ({ apiUrl: "https://api.example.com" }),
      },
    ],
  })
  class TestModule {}

  const appRef = await AppRef.create(TestModule);
  const config = await appRef.resolve(CONFIG_TOKEN) as { apiUrl: string };

  expect(config).toEqual({ apiUrl: "https://api.example.com" });
});

test("AppRef.resolve should resolve provider from imported module", async () => {
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

  @Module({
    imports: [SharedModule],
  })
  class AppModule {}

  const appRef = await AppRef.create(AppModule);
  const service = await appRef.resolve(SharedService) as SharedService;

  expect(service).toBeInstanceOf(SharedService);
  expect(service.getData()).toBe("shared-data");
});

test("AppRef.resolve should handle provider with dependencies", async () => {
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

  @Module({
    providers: [DatabaseService, UserService],
  })
  class AppModule {}

  const appRef = await AppRef.create(AppModule);
  const userService = await appRef.resolve(UserService) as UserService;

  expect(userService).toBeInstanceOf(UserService);
  expect(userService.db).toBeInstanceOf(DatabaseService);
  expect(userService.getUsers()).toBe("connected");
});

test("AppRef should work with complex module hierarchies", async () => {
  @Injectable()
  class CoreService {
    getValue() {
      return "core";
    }
  }

  @Module({
    providers: [CoreService],
  })
  class CoreModule {}

  @Controller({
    route: "shared",
    deps: [CoreService],
  })
  class SharedController {
    constructor(readonly coreService: CoreService) {}
  }

  @Module({
    imports: [CoreModule],
    controllers: [SharedController],
  })
  class SharedModule {}

  @Controller({
    route: "app",
    deps: [CoreService],
  })
  class AppController {
    constructor(readonly coreService: CoreService) {}
  }

  @Module({
    imports: [SharedModule],
    controllers: [AppController],
  })
  class AppModule {}

  const appRef = await AppRef.create(AppModule);

  // Should find all modules
  expect(appRef.select(AppModule)).toBeDefined();
  expect(appRef.select(SharedModule)).toBeDefined();
  expect(appRef.select(CoreModule)).toBeDefined();

  // Should find all controllers
  const appController = appRef.select<AppController>(AppController);
  const sharedController = appRef.select<SharedController>(SharedController);
  expect(appController).toBeInstanceOf(AppController);
  expect(sharedController).toBeInstanceOf(SharedController);

  // Both controllers should have CoreService instances
  expect(appController.coreService).toBeInstanceOf(CoreService);
  expect(sharedController.coreService).toBeInstanceOf(CoreService);

  // Should resolve CoreService
  const coreService = await appRef.resolve(CoreService) as CoreService;
  expect(coreService).toBeInstanceOf(CoreService);
  expect(coreService.getValue()).toBe("core");
});
