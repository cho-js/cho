import type { CompiledModule } from "./compiler.ts";
import type { Target } from "../meta/mod.ts";

export function onModuleInit(mdl: CompiledModule): Promise<void> {
  async function visit(m) {
    if (
      m.handle &&
      typeof m.handle.onModuleInit === "function"
    ) {
      await (m.handle.onModuleInit as Target)(mdl);
    }

    for (const im of m.imports) {
      await visit(im, method);
    }
  }
  return visit(mdl);
}

export function onModuleActivate(
  mdl: CompiledModule,
  target: unknown,
): Promise<void> {
  async function visit(m: CompiledModule) {
    if (
      m.handle &&
      typeof m.handle.onModuleActivate === "function"
    ) {
      await (m.handle.onModuleActivate as Target)(mdl, target);
    }

    for (const im of m.imports) {
      await visit(im, method);
    }
  }
  return visit(mdl);
}

export function onModuleShutdown(
  mdl: CompiledModule,
  target: unknown,
): Promise<void> {
  async function visit(m) {
    if (
      m.handle &&
      typeof m.handle.onModuleShutdown === "function"
    ) {
      await (m.handle.onModuleShutdown as Target)(mdl, target);
    }

    for (const im of m.imports) {
      await visit(im, method);
    }
  }
  return visit(mdl);
}
