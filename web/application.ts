import {
  AppRef,
  type Ctr,
  onModuleActivate,
  onModuleInit,
} from "@chojs/core/internals";
import { Hono } from "@hono/hono";
import { HonoLinker } from "./hono-linker.ts";

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
    await onModuleInit(ref.initiated);

    const linked = new HonoLinker().link(ref.initiated);
    await onModuleActivate(ref.initiated, linked);

    return new WebApplication(ref, linked);
  }
}
