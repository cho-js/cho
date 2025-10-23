import type { Ctr } from "@chojs/core/meta";
import type { CompiledModule } from "@chojs/core/application";
import { Compiler } from "@chojs/core/application";
import { Injector } from "@chojs/core/di";
import type { ChoWebAdapter } from "./adapter.ts";
import { Linker } from "./linker.ts";
import {
  graphBuilder,
  onModuleActivate,
  onModuleInit,
} from "@chojs/core/application";

export type ApplicationOptions = {
  adapter: ChoWebAdapter;
};

export class Application<AppRef> {
  /**
   * Create an application instance by compiling the feature and linking it with the adapter.
   * @param feature
   * @param options
   */
  static async create<T>(
    feature: Ctr,
    options?: ApplicationOptions,
  ): Promise<Application<T>> {
    let adapter = options?.adapter;
    if (!adapter) {
      try {
        const { HonoAdapter } = await import("@chojs/vendor-hono");
        adapter = new HonoAdapter();
      } catch {
        throw new Error(
          "Adapter is required. Please provide an adapter or install @chojs/vendor-hono.",
        );
      }
    }

    const compiled = await new Compiler().compile(graphBuilder(feature));
    await onModuleInit(compiled);

    const linked: T = new Linker(adapter as ChoWebAdapter).link(compiled);
    await onModuleActivate(compiled, linked);

    const injector = await Injector.get(feature);

    return new Application<T>(
      compiled,
      injector,
      linked,
      adapter as ChoWebAdapter,
    );
  }

  constructor(
    readonly instance: CompiledModule,
    readonly injector: Injector,
    readonly appRef: AppRef,
    readonly adapter: ChoWebAdapter,
  ) {
  }

  /**
   * Select a compiled module by its constructor.
   * @param ctr
   */
  select(ctr: Ctr): CompiledModule {
    for (const cm of this.it()) {
      if (cm.ctr === ctr) {
        return cm;
      }
    }
    throw new Error(`Module "${ctr.name}" not found in application`);
  }

  resolve<T>(ctr: Ctr<T>): T {
  }

  // iterate over all modules in the application
  *it(cm = this.instance): Generator<CompiledModule> {
    yield cm;
    for (const im of this.instance.imports) {
      yield* this.it(im);
    }
  }
}
