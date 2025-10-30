import { expect } from "@std/expect";
import { test } from "../testing/mod.ts";
import { Module } from "../decorators.ts";
import { graphBuilder } from "./graph-builder.ts";
import { initiate, InitiatedModule } from "./initiator.ts";
import {
  type OnModuleActivate,
  onModuleActivate,
  type OnModuleInit,
  onModuleInit,
  type OnModuleShutdown,
  onModuleShutdown,
} from "./hooks.ts";

test("onModuleInit should call lifecycle hook on module", async () => {
  const calls: string[] = [];

  @Module({})
  class TestModule implements OnModuleInit {
    onModuleInit(_mdl: InitiatedModule): void {
      calls.push("TestModule.onModuleInit");
    }
  }

  const graph = graphBuilder(TestModule);
  const initiated = await initiate(graph);

  await onModuleInit(initiated);

  expect(calls).toEqual(["TestModule.onModuleInit"]);
});

test("onModuleInit should call lifecycle hook on module and imports", async () => {
  const calls: string[] = [];

  @Module({})
  class SharedModule implements OnModuleInit {
    onModuleInit(_mdl: InitiatedModule): void {
      calls.push("SharedModule.onModuleInit");
    }
  }

  @Module({
    imports: [SharedModule],
  })
  class AppModule implements OnModuleInit {
    onModuleInit(_mdl: InitiatedModule): void {
      calls.push("AppModule.onModuleInit");
    }
  }

  const graph = graphBuilder(AppModule);
  const initiated = await initiate(graph);

  await onModuleInit(initiated);

  expect(calls).toEqual([
    "AppModule.onModuleInit",
    "SharedModule.onModuleInit",
  ]);
});

test("onModuleInit should handle modules without the hook", async () => {
  const calls: string[] = [];

  @Module({})
  class ModuleWithoutHook {}

  @Module({
    imports: [ModuleWithoutHook],
  })
  class ModuleWithHook implements OnModuleInit {
    onModuleInit(_mdl: InitiatedModule): void {
      calls.push("ModuleWithHook.onModuleInit");
    }
  }

  const graph = graphBuilder(ModuleWithHook);
  const initiated = await initiate(graph);

  await onModuleInit(initiated);

  expect(calls).toEqual(["ModuleWithHook.onModuleInit"]);
});

test("onModuleInit should handle async hooks", async () => {
  const calls: string[] = [];

  @Module({})
  class AsyncModule implements OnModuleInit {
    async onModuleInit(_mdl: InitiatedModule): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, 10));
      calls.push("AsyncModule.onModuleInit");
    }
  }

  const graph = graphBuilder(AsyncModule);
  const initiated = await initiate(graph);

  await onModuleInit(initiated);

  expect(calls).toEqual(["AsyncModule.onModuleInit"]);
});

test("onModuleInit should pass the correct initiated module", async () => {
  let receivedModule: InitiatedModule | null = null;

  @Module({})
  class TestModule implements OnModuleInit {
    onModuleInit(mdl: InitiatedModule): void {
      receivedModule = mdl;
    }
  }

  const graph = graphBuilder(TestModule);
  const initiated = await initiate(graph);

  await onModuleInit(initiated);

  expect(receivedModule).toBe(initiated);
});

test("onModuleActivate should call lifecycle hook with target", async () => {
  const calls: Array<{ module: string; target: unknown }> = [];
  const targetObject = { name: "test-target" };

  @Module({})
  class TestModule implements OnModuleActivate {
    onModuleActivate(_mdl: InitiatedModule, target: unknown): void {
      calls.push({ module: "TestModule", target });
    }
  }

  const graph = graphBuilder(TestModule);
  const initiated = await initiate(graph);

  await onModuleActivate(initiated, targetObject);

  expect(calls.length).toBe(1);
  expect(calls[0].module).toBe("TestModule");
  expect(calls[0].target).toBe(targetObject);
});

test("onModuleActivate should call hooks on module and imports", async () => {
  const calls: string[] = [];
  const targetObject = { name: "app" };

  @Module({})
  class SharedModule implements OnModuleActivate {
    onModuleActivate(_mdl: InitiatedModule, _target: unknown): void {
      calls.push("SharedModule.onModuleActivate");
    }
  }

  @Module({
    imports: [SharedModule],
  })
  class AppModule implements OnModuleActivate {
    onModuleActivate(_mdl: InitiatedModule, _target: unknown): void {
      calls.push("AppModule.onModuleActivate");
    }
  }

  const graph = graphBuilder(AppModule);
  const initiated = await initiate(graph);

  await onModuleActivate(initiated, targetObject);

  expect(calls).toEqual([
    "AppModule.onModuleActivate",
    "SharedModule.onModuleActivate",
  ]);
});

test("onModuleActivate should handle async hooks", async () => {
  const calls: string[] = [];

  @Module({})
  class AsyncModule implements OnModuleActivate {
    async onModuleActivate(
      _mdl: InitiatedModule,
      _target: unknown,
    ): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, 10));
      calls.push("AsyncModule.onModuleActivate");
    }
  }

  const graph = graphBuilder(AsyncModule);
  const initiated = await initiate(graph);

  await onModuleActivate(initiated, {});

  expect(calls).toEqual(["AsyncModule.onModuleActivate"]);
});

test("onModuleShutdown should call lifecycle hook with target", async () => {
  const calls: Array<{ module: string; target: unknown }> = [];
  const targetObject = { name: "test-target" };

  @Module({})
  class TestModule implements OnModuleShutdown {
    onModuleShutdown(_mdl: InitiatedModule, target: unknown): void {
      calls.push({ module: "TestModule", target });
    }
  }

  const graph = graphBuilder(TestModule);
  const initiated = await initiate(graph);

  await onModuleShutdown(initiated, targetObject);

  expect(calls.length).toBe(1);
  expect(calls[0].module).toBe("TestModule");
  expect(calls[0].target).toBe(targetObject);
});

test("onModuleShutdown should call hooks on module and imports", async () => {
  const calls: string[] = [];
  const targetObject = { name: "app" };

  @Module({})
  class SharedModule implements OnModuleShutdown {
    onModuleShutdown(_mdl: InitiatedModule, _target: unknown): void {
      calls.push("SharedModule.onModuleShutdown");
    }
  }

  @Module({
    imports: [SharedModule],
  })
  class AppModule implements OnModuleShutdown {
    onModuleShutdown(_mdl: InitiatedModule, _target: unknown): void {
      calls.push("AppModule.onModuleShutdown");
    }
  }

  const graph = graphBuilder(AppModule);
  const initiated = await initiate(graph);

  await onModuleShutdown(initiated, targetObject);

  expect(calls).toEqual([
    "AppModule.onModuleShutdown",
    "SharedModule.onModuleShutdown",
  ]);
});

test("onModuleShutdown should handle async hooks", async () => {
  const calls: string[] = [];

  @Module({})
  class AsyncModule implements OnModuleShutdown {
    async onModuleShutdown(
      _mdl: InitiatedModule,
      _target: unknown,
    ): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, 10));
      calls.push("AsyncModule.onModuleShutdown");
    }
  }

  const graph = graphBuilder(AsyncModule);
  const initiated = await initiate(graph);

  await onModuleShutdown(initiated, {});

  expect(calls).toEqual(["AsyncModule.onModuleShutdown"]);
});

test("hooks should handle multiple nested imports", async () => {
  const calls: string[] = [];

  @Module({})
  class Level3Module implements OnModuleInit {
    onModuleInit(_mdl: InitiatedModule): void {
      calls.push("Level3Module");
    }
  }

  @Module({
    imports: [Level3Module],
  })
  class Level2Module implements OnModuleInit {
    onModuleInit(_mdl: InitiatedModule): void {
      calls.push("Level2Module");
    }
  }

  @Module({
    imports: [Level2Module],
  })
  class Level1Module implements OnModuleInit {
    onModuleInit(_mdl: InitiatedModule): void {
      calls.push("Level1Module");
    }
  }

  const graph = graphBuilder(Level1Module);
  const initiated = await initiate(graph);

  await onModuleInit(initiated);

  expect(calls).toEqual([
    "Level1Module",
    "Level2Module",
    "Level3Module",
  ]);
});

test("hooks should handle modules with multiple imports", async () => {
  const calls: string[] = [];

  @Module({})
  class SharedModule1 implements OnModuleInit {
    onModuleInit(_mdl: InitiatedModule): void {
      calls.push("SharedModule1");
    }
  }

  @Module({})
  class SharedModule2 implements OnModuleInit {
    onModuleInit(_mdl: InitiatedModule): void {
      calls.push("SharedModule2");
    }
  }

  @Module({
    imports: [SharedModule1, SharedModule2],
  })
  class AppModule implements OnModuleInit {
    onModuleInit(_mdl: InitiatedModule): void {
      calls.push("AppModule");
    }
  }

  const graph = graphBuilder(AppModule);
  const initiated = await initiate(graph);

  await onModuleInit(initiated);

  expect(calls).toEqual([
    "AppModule",
    "SharedModule1",
    "SharedModule2",
  ]);
});

test("module can implement multiple hook interfaces", async () => {
  const initCalls: string[] = [];
  const activateCalls: string[] = [];
  const shutdownCalls: string[] = [];

  @Module({})
  class MultiHookModule
    implements OnModuleInit, OnModuleActivate, OnModuleShutdown {
    onModuleInit(_mdl: InitiatedModule): void {
      initCalls.push("init");
    }

    onModuleActivate(_mdl: InitiatedModule, _target: unknown): void {
      activateCalls.push("activate");
    }

    onModuleShutdown(_mdl: InitiatedModule, _target: unknown): void {
      shutdownCalls.push("shutdown");
    }
  }

  const graph = graphBuilder(MultiHookModule);
  const initiated = await initiate(graph);

  await onModuleInit(initiated);
  await onModuleActivate(initiated, {});
  await onModuleShutdown(initiated, {});

  expect(initCalls).toEqual(["init"]);
  expect(activateCalls).toEqual(["activate"]);
  expect(shutdownCalls).toEqual(["shutdown"]);
});

test("hooks should be called in depth-first order", async () => {
  const calls: string[] = [];

  @Module({})
  class ChildA implements OnModuleInit {
    onModuleInit(_mdl: InitiatedModule): void {
      calls.push("ChildA");
    }
  }

  @Module({})
  class ChildB implements OnModuleInit {
    onModuleInit(_mdl: InitiatedModule): void {
      calls.push("ChildB");
    }
  }

  @Module({
    imports: [ChildA, ChildB],
  })
  class Parent implements OnModuleInit {
    onModuleInit(_mdl: InitiatedModule): void {
      calls.push("Parent");
    }
  }

  @Module({
    imports: [Parent],
  })
  class Root implements OnModuleInit {
    onModuleInit(_mdl: InitiatedModule): void {
      calls.push("Root");
    }
  }

  const graph = graphBuilder(Root);
  const initiated = await initiate(graph);

  await onModuleInit(initiated);

  // Depth-first: Root -> Parent -> ChildA -> ChildB
  expect(calls).toEqual(["Root", "Parent", "ChildA", "ChildB"]);
});
