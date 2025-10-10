import { expect } from "@std/expect";
import { Linker } from "./linker.ts";
import type {
  CompiledGateway,
  CompiledMethod,
  CompiledModule,
} from "@chojs/core/application";
import type {
  ChoErrorHandlerFn,
  ChoMiddlewareFn,
  ControllerDescriptor,
  MethodDescriptor,
  ModuleDescriptor,
} from "@chojs/core/di";

const createMockMiddleware = (): ChoMiddlewareFn => (ctx, next) => {};
const createMockErrorHandler = (): ChoErrorHandlerFn => (err, ctx) =>
  new Response();

const createMockCompiledMethod = (
  command: string,
  overrides: Partial<CompiledMethod> = {},
): CompiledMethod => ({
  meta: {
    route: "/test",
    middlewares: [],
    errorHandler: createMockErrorHandler(),
    isMethod: true,
    type: "COMMAND",
    name: "test",
    args: [],
    command,
    ...overrides.meta,
  } as MethodDescriptor & { command: string },
  middlewares: [],
  handle: () => {},
  errorHandler: undefined,
  name: "test",
  ...overrides,
});

const createMockCompiledGateway = (
  methods: CompiledMethod[] = [],
): CompiledGateway => ({
  meta: {
    deps: [],
    route: "/controller",
    middlewares: [],
    errorHandler: createMockErrorHandler(),
    isGateway: true,
  } as ControllerDescriptor,
  middlewares: [],
  handle: class {},
  errorHandler: undefined,
  methods,
});

const createMockCompiledModule = (
  overrides: Partial<CompiledModule> = {},
): CompiledModule => ({
  controllers: [],
  imports: [],
  middlewares: [],
  errorHandler: undefined,
  meta: {
    deps: [],
    route: "/module",
    imports: [],
    providers: [],
    controllers: [],
    middlewares: [],
    errorHandler: createMockErrorHandler(),
    isModule: true,
  } as ModuleDescriptor,
  handle: class {},
  ...overrides,
});

Deno.test("Linker constructor should set initial state", () => {
  const linker = new Linker();
  expect(linker.isMain).toBe(false);
  expect(linker.containSubs).toBe(false);
});

Deno.test("link should return LinkedApp with empty commands for empty module", () => {
  const linker = new Linker();
  const cm = createMockCompiledModule();

  const result = linker.link(cm);

  expect("commands" in result).toBe(true);
  expect((result as any).commands).toEqual({});
  expect(result.errorHandler).toBeUndefined();
});

Deno.test("link should link main command correctly", () => {
  const linker = new Linker();
  const mockHandle = () => "main result";
  const mockMethod = createMockCompiledMethod("main", { handle: mockHandle });
  const mockController = createMockCompiledGateway([mockMethod]);

  const cm = createMockCompiledModule({
    controllers: [mockController],
  });

  const result = linker.link(cm);

  expect("main" in result).toBe(true);
  expect((result as any).main.handle).toBe(mockHandle);
  expect((result as any).main.middlewares).toEqual([]);
  expect((result as any).main.compiled).toBe(mockMethod);
});

Deno.test("link should link subcommand correctly", () => {
  const linker = new Linker();
  const mockHandle = () => "sub result";
  const mockMethod = createMockCompiledMethod("test", { handle: mockHandle });
  const mockController = createMockCompiledGateway([mockMethod]);

  const cm = createMockCompiledModule({
    controllers: [mockController],
  });

  const result = linker.link(cm);

  expect("commands" in result).toBe(true);
  expect((result as any).commands.test.handle).toBe(mockHandle);
  expect((result as any).commands.test.middlewares).toEqual([]);
  expect((result as any).commands.test.compiled).toBe(mockMethod);
});

Deno.test("link should throw error for duplicate command names", () => {
  const linker = new Linker();
  const mockMethod1 = createMockCompiledMethod("test");
  const mockMethod2 = createMockCompiledMethod("test");
  const mockController = createMockCompiledGateway([mockMethod1, mockMethod2]);

  const cm = createMockCompiledModule({
    controllers: [mockController],
  });

  expect(() => linker.link(cm)).toThrow('Command "test" already exists');
});

Deno.test("link should throw error when main command exists with subcommands", () => {
  const linker = new Linker();
  const mainMethod = createMockCompiledMethod("main");
  const subMethod = createMockCompiledMethod("test");
  const mockController = createMockCompiledGateway([subMethod, mainMethod]);

  const cm = createMockCompiledModule({
    controllers: [mockController],
  });

  expect(() => linker.link(cm)).toThrow(
    "Cannot have 'main' command when subcommands exist",
  );
});

Deno.test("link should throw error when subcommands exist with main command", () => {
  const linker = new Linker();
  const mainMethod = createMockCompiledMethod("main");
  const subMethod = createMockCompiledMethod("test");
  const mockController = createMockCompiledGateway([mainMethod, subMethod]);

  const cm = createMockCompiledModule({
    controllers: [mockController],
  });

  expect(() => linker.link(cm)).toThrow(
    "Cannot have subcommands when 'main' command exists",
  );
});

Deno.test("link should combine middlewares from module, controller, and method", () => {
  const linker = new Linker();
  const moduleMiddleware = createMockMiddleware();
  const controllerMiddleware = createMockMiddleware();
  const methodMiddleware = createMockMiddleware();

  const mockMethod = createMockCompiledMethod("test", {
    middlewares: [methodMiddleware],
  });

  const mockController = createMockCompiledGateway([mockMethod]);
  mockController.middlewares = [controllerMiddleware];

  const cm = createMockCompiledModule({
    middlewares: [moduleMiddleware],
    controllers: [mockController],
  });

  const result = linker.link(cm);

  expect("commands" in result).toBe(true);
  expect((result as any).commands.test.middlewares).toEqual([
    moduleMiddleware,
    controllerMiddleware,
    methodMiddleware,
  ]);
});

Deno.test("link should use method error handler when available", () => {
  const linker = new Linker();
  const methodErrorHandler = createMockErrorHandler();
  const controllerErrorHandler = createMockErrorHandler();
  const moduleErrorHandler = createMockErrorHandler();

  const mockMethod = createMockCompiledMethod("test", {
    errorHandler: methodErrorHandler,
  });

  const mockController = createMockCompiledGateway([mockMethod]);
  mockController.errorHandler = controllerErrorHandler;

  const cm = createMockCompiledModule({
    errorHandler: moduleErrorHandler,
    controllers: [mockController],
  });

  const result = linker.link(cm);

  expect("commands" in result).toBe(true);
  expect((result as any).commands.test.errorHandler).toBe(methodErrorHandler);
});

Deno.test("link should use controller error handler when method handler not available", () => {
  const linker = new Linker();
  const controllerErrorHandler = createMockErrorHandler();
  const moduleErrorHandler = createMockErrorHandler();

  const mockMethod = createMockCompiledMethod("test");

  const mockController = createMockCompiledGateway([mockMethod]);
  mockController.errorHandler = controllerErrorHandler;

  const cm = createMockCompiledModule({
    errorHandler: moduleErrorHandler,
    controllers: [mockController],
  });

  const result = linker.link(cm);

  expect("commands" in result).toBe(true);
  expect((result as any).commands.test.errorHandler).toBe(
    controllerErrorHandler,
  );
});

Deno.test("link should use module error handler when method and controller handlers not available", () => {
  const linker = new Linker();
  const moduleErrorHandler = createMockErrorHandler();

  const mockMethod = createMockCompiledMethod("test");

  const mockController = createMockCompiledGateway([mockMethod]);
  mockController.errorHandler = undefined;

  const cm = createMockCompiledModule({
    errorHandler: moduleErrorHandler,
    controllers: [mockController],
  });

  const result = linker.link(cm);

  expect("commands" in result).toBe(true);
  expect((result as any).commands.test.errorHandler).toBe(moduleErrorHandler);
});

Deno.test("link should skip methods without command metadata", () => {
  const linker = new Linker();
  const methodWithCommand = createMockCompiledMethod("test");
  const methodWithoutCommand = {
    ...createMockCompiledMethod(""),
    meta: {
      route: "/test",
      middlewares: [],
      errorHandler: createMockErrorHandler(),
      isMethod: true,
      type: "GET",
      name: "notCommand",
      args: [],
    } as MethodDescriptor,
  };

  const mockController = createMockCompiledGateway([
    methodWithCommand,
    methodWithoutCommand as CompiledMethod,
  ]);

  const cm = createMockCompiledModule({
    controllers: [mockController],
  });

  const result = linker.link(cm);

  expect("commands" in result).toBe(true);
  expect(Object.keys((result as any).commands)).toEqual(["test"]);
});

Deno.test("link should process imported modules recursively", () => {
  const linker = new Linker();
  const importedMethod = createMockCompiledMethod("imported");
  const mainMethod = createMockCompiledMethod("test");

  const importedController = createMockCompiledGateway([importedMethod]);
  const importedModule = createMockCompiledModule({
    controllers: [importedController],
  });

  const mainController = createMockCompiledGateway([mainMethod]);
  const cm = createMockCompiledModule({
    controllers: [mainController],
    imports: [importedModule],
  });

  const result = linker.link(cm);

  expect("commands" in result).toBe(true);
  expect((result as any).commands.imported).toBeDefined();
  expect((result as any).commands.imported.handle).toBe(importedMethod.handle);
});

Deno.test("link should set module error handler on result", () => {
  const linker = new Linker();
  const moduleErrorHandler = createMockErrorHandler();

  const cm = createMockCompiledModule({
    errorHandler: moduleErrorHandler,
  });

  const result = linker.link(cm);

  expect(result.errorHandler).toBe(moduleErrorHandler);
});

Deno.test("link should update isMain and containSubs flags correctly", () => {
  const linker = new Linker();

  // Set up initial state
  linker.isMain = true;
  linker.containSubs = true;

  const cm = createMockCompiledModule();
  linker.link(cm);

  // Should reset flags at start of link
  expect(linker.isMain).toBe(false);
  expect(linker.containSubs).toBe(false);
});
