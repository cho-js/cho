import type { Ctr } from "../meta/mod.ts";
import {
  type CompiledGateway,
  type CompiledModule,
  Compiler,
} from "./compiler.ts";
import type { Token } from "../di/types.ts";
import { Injector } from "../di/injector.ts";
import { graphBuilder } from "./graph-builder.ts";

/**
 * Iterate through compiled modules and gateways
 * @param compiled
 */
function* iter(
  compiled: CompiledModule | CompiledGateway,
): Generator<CompiledModule | CompiledGateway> {
  yield compiled;
  if (!("imports" in compiled) && !("controllers" in compiled)) {
    return;
  }
  for (const im of ((compiled as CompiledModule).imports ?? [])) {
    yield* iter(im);
  }
  for (const ctr of ((compiled as CompiledModule).controllers ?? [])) {
    yield* iter(ctr);
  }
}

/**
 * Application Reference
 *
 * Wrap the compiling process and provide a wrapper to the compiled root module.
 * Provide access to all instances and injectors.
 */
export class AppRef {
  /**
   * Create an application reference from a root module constructor.
   * @param mdl
   */
  static async create(mdl: Ctr): Promise<AppRef> {
    const compiled = await new Compiler().compile(graphBuilder(mdl));
    return new AppRef(compiled);
  }

  protected constructor(
    readonly compiled: CompiledModule,
  ) {}

  /**
   * Get an instance by its constructor
   *
   * Search through all compiled modules and gateways.
   *
   * @param ctr
   */
  select<T>(ctr: Ctr): T {
    for (const cm of iter(this.compiled)) {
      if (cm.ctr === ctr) {
        return cm.handle as T;
      }
    }
    throw new Error(`Module not found for controller: ${ctr.name}`);
  }

  /**
   * Resolve a token to its instance using the application's injector (top level one).
   * @param token
   */
  async resolve<T>(token: Token): Promise<T> {
    // todo consider changing the api to make sure no injector created on missing...
    const injector = await Injector.get(this.compiled.ctr);
    return injector.resolve<T>(token);
  }
}
