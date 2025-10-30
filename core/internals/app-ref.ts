import type { Ctr } from "./meta.ts";
import type { Token } from "./types.ts";
import { Injector } from "./injector.ts";
import { graphBuilder } from "./graph-builder.ts";
import { initiate, InitiatedController, InitiatedModule } from "./initiator.ts";

/**
 * Iterate through initiated entities (modules and controllers) recursively.
 * @param initiated
 */
function* iter(
  initiated: InitiatedModule,
): Generator<InitiatedModule | InitiatedController> {
  yield initiated;
  for (const im of (initiated.imports ?? [])) {
    yield* iter(im);
  }
  for (const ctr of (initiated.controllers ?? [])) {
    yield ctr;
  }
}

/**
 * Application Reference
 *
 * Wrap the compiling process and provide a wrapper to the initiated root module.
 * Provide access to all instances and injectors.
 */
export class AppRef {
  /**
   * Create an application reference from a root module constructor.
   * @param mdl
   */
  static async create(mdl: Ctr): Promise<AppRef> {
    return new AppRef(
      await initiate(graphBuilder(mdl)),
    );
  }

  protected constructor(
    readonly initiated: InitiatedModule,
  ) {}

  /**
   * Get an entity instance by its constructor
   * Search through all initiated modules and gateways.
   *
   * @param ctr
   */
  select<T>(ctr: Ctr): T {
    for (const cm of this.initiated.all()) {
      if (cm.ctr === ctr) {
        return cm.handle as T;
      }
    }
    throw new Error(`Entity ${ctr.name} not found`);
  }

  /**
   * Resolve a token to its instance using the application's injector (top level one).
   * @param token
   */
  async resolve<T>(token: Token): Promise<T> {
    // todo consider changing the api to make sure no injector created on missing...
    const injector = await Injector.get(this.initiated.ctr);
    return injector.resolve<T>(token);
  }
}
