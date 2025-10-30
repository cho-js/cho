import {InitiatedModule} from "./initiator.ts";

export type OnModuleInit = {
  onModuleInit(mdl: InitiatedModule): void | Promise<void>;
};

export type OnModuleActivate = {
  /**
   * @param mdl
   * @param target The linked target instance associated with the module.
   */
  onModuleActivate(mdl: InitiatedModule, target: unknown): void | Promise<void>;
};

export type OnModuleShutdown = {
  onModuleShutdown(mdl: InitiatedModule, target: unknown): void | Promise<void>;
};

/**
 * Executes the `onModuleInit` lifecycle hook for the given module and its imports.
 * @param mdl
 */
export async function onModuleInit(mdl: InitiatedModule): Promise<void> {
  for (const m of mdl) {
    const handle = m.handle as OnModuleInit;

    if (handle && typeof handle.onModuleInit === "function") {
      await handle.onModuleInit(mdl);
    }
  }
}

/**
 * Executes the `onModuleActivate` lifecycle hook for the given module and its imports.
 *
 * @param mdl
 * @param target
 */
export async function onModuleActivate(
  mdl: InitiatedModule,
  target: unknown,
): Promise<void> {
  for (const m of mdl) {
    const handle = m.handle as OnModuleActivate;

    if (handle && typeof handle.onModuleActivate === "function") {
      await handle.onModuleActivate(mdl, target);
    }
  }
}

/**
 * Executes the `onModuleShutdown` lifecycle hook for the given module and its imports.
 * @param mdl
 * @param target
 */
export async function onModuleShutdown(
  mdl: InitiatedModule,
  target: unknown,
): Promise<void> {
  for (const m of mdl) {
    const handle = m.handle as OnModuleShutdown;

    if (handle && typeof handle.onModuleShutdown === "function") {
      await handle.onModuleShutdown(mdl, target);
    }
  }
}
