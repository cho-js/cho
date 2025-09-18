import type { CompiledModule } from "./compiler.ts";
import type { Target } from "../di/meta.ts";

async function visit(m: CompiledModule, method: string) {
  if (
    m.handle && typeof m.handle[method as keyof typeof m.handle] === "function"
  ) {
    await (m.handle[method as keyof typeof m.handle] as Target)();
  }

  for (const im of m.imports) {
    await visit(im, method);
  }
}

export function onModuleInit(mdl: CompiledModule): Promise<void> {
  return visit(mdl, "onModuleInit");
}

export function onModuleActivate(mdl: CompiledModule): Promise<void> {
  return visit(mdl, "onModuleActivate");
}

export function onModuleShutdown(mdl: CompiledModule): Promise<void> {
  return visit(mdl, "onModuleShutdown");
}
