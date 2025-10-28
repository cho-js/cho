import { AppRef } from "../core/application/app-ref.ts";
import { Ctr } from "../core/meta/meta.ts";
import { HonoLinker } from "./hono-linker.ts";
import { onModuleActivate, onModuleInit } from "../core/application/hooks.ts";
import { Hono } from "@hono/hono";

export class WebApplication {
  constructor(
    readonly ref: AppRef,
    readonly app: Hono,
  ) {
  }
}

export class WebFactory {
  /**
   * @param ctr
   */
  static async create(ctr: Ctr) {
    const ref = await AppRef.create(ctr);
    await onModuleInit(ref.compiled);

    const linked = new HonoLinker().link(ref.compiled);
    await onModuleActivate(ref.compiled, linked);

    return new WebApplication(ref, linked);
  }
}
