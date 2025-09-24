import type { CompiledModule } from "./compiler.ts";
import type { Target } from "../meta/mod.ts";

export type OnModuleInit = {
  onModuleInit(mdl: CompiledModule): void | Promise<void>;
};

export type OnModuleActivate = {
  onModuleActivate(mdl: CompiledModule, target: unknown): void | Promise<void>;
};

export type OnModuleShutdown = {
  onModuleShutdown(mdl: CompiledModule, target: unknown): void | Promise<void>;
};

/**
 * Executes the `onModuleInit` lifecycle hook for the given module and its imports.
 * @param mdl
 */
export function onModuleInit(mdl: CompiledModule): Promise<void> {
  async function visit(m: CompiledModule) {
    const handle = m.handle as OnModuleInit;

    if (handle && typeof handle.onModuleInit === "function") {
      await handle.onModuleInit(mdl);
    }

    for (const im of m.imports) {
      await visit(im);
    }
  }
  return visit(mdl);
}

/**
 * Executes the `onModuleActivate` lifecycle hook for the given module and its imports.
 *
 * @param mdl
 * @param target
 */
export function onModuleActivate(
  mdl: CompiledModule,
  target: unknown,
): Promise<void> {
  async function visit(m: CompiledModule) {
    const handle = m.handle as OnModuleActivate;

    if (handle && typeof handle.onModuleActivate === "function") {
      await handle.onModuleActivate(mdl, target);
    }

    for (const im of m.imports) {
      await visit(im);
    }
  }
  return visit(mdl);
}

/**
 * Executes the `onModuleShutdown` lifecycle hook for the given module and its imports.
 * @param mdl
 * @param target
 */
export function onModuleShutdown(
  mdl: CompiledModule,
  target: unknown,
): Promise<void> {
  async function visit(m: CompiledModule) {
    const handle = m.handle as OnModuleShutdown;

    if (handle && typeof handle.onModuleShutdown === "function") {
      await handle.onModuleShutdown(mdl, target);
    }

    for (const im of m.imports) {
      await visit(im);
    }
  }
  return visit(mdl);
}
