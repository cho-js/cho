import type { AppRef } from "./graph.ts";

export function default_linker() {
  return import("@chojs/vendor-hono").then((mod) => mod.HonoLinker).then(
    (Linker) => new Linker(),
  );
}

export abstract class Linked<T> {
  readonly instance: T;

  constructor(instance: T) {
    this.instance = instance;
  }

  abstract get handler(): (req: Request) => Promise<Response>;
}

export interface Linker<T> {
  link(graph: AppRef): Linked<T>;
}
