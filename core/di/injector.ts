import type { Any, Ctr } from "../meta/mod.ts";
import type {
  InjectableDescriptor,
  ModuleDescriptor,
  Provider,
  Resolver,
  Token,
} from "./types.ts";
import { debuglog } from "../utils/debuglog.ts";
import { read, readMetadataObject, write } from "../meta/mod.ts";

const log = debuglog("di:injector");

const InjectorMetadata = Symbol("ModuleInjector");

const tokenName = (token: Token) =>
  (typeof token === "function" && token.name) ? token.name : String(token);

/**
 * Provider found during search.
 */
export type SearchResultProvider = {
  type: "provider";
  value: Provider;
};

/**
 * Resolved value found in cache.
 */
export type SearchResultResolved = {
  type: "resolved";
  value: Any;
};

/**
 * Token not found in the injector or its imports.
 */
export type SearchResultNotFound = {
  type: "not-found";
  value: null;
};

/**
 * Circular dependency detected during search.
 */
export type SearchResultCircular = {
  type: "circular-dependency-detected";
  value: Injector[];
};

/**
 * Search result can be a provider, a resolved value, not found, or circular dependency.
 */
export type SearchResult =
  | SearchResultProvider
  | SearchResultResolved
  | SearchResultNotFound
  | SearchResultCircular;

/**
 * Create a provider for the given class constructor.
 *
 * @param ctr
 * @returns Provider
 */
function provide(ctr: Ctr): Provider {
  return {
    provide: ctr,
    factory: async (r: Resolver) => {
      const deps = readMetadataObject<InjectableDescriptor>(ctr)?.deps ??
        [] as Token[];
      const args: unknown[] = await Promise.all(
        deps.map((d: Token) => r.resolve(d)),
      );
      return Reflect.construct(ctr, args);
    },
  };
}

/**
 * Dependency Injector
 * This class is responsible for resolving dependencies and managing the lifecycle of instances.
 * It implements the Resolver interface and provides methods to resolve tokens, create instances,
 * and manage providers.
 */
export class Injector implements Resolver {
  readonly name: string;
  readonly providers: Provider[] = [];
  readonly imports: Ctr[] = [];
  readonly cache: Map<Token, Any> = new Map<Token, Any>();

  /**
   * Get the injector instance for a module class, creating it if it doesn't exist.
   * @param ctr
   */
  static async get(ctr: Ctr): Promise<Injector> {
    let inj = read<Injector>(ctr, InjectorMetadata);
    if (!inj) {
      inj = new Injector(ctr);
      await inj.register(ctr).resolve(ctr);
    }
    return inj;
  }

  // todo convert to protected, should be created via Injector.get()
  //  fix tests first to not use constructor directly
  constructor(
    readonly ctr: Ctr,
  ) {
    const inj = read(ctr, InjectorMetadata);
    if (inj) {
      throw new Error(`Injector already set for this module`);
    }
    const meta = readMetadataObject<ModuleDescriptor>(ctr);
    if (!meta) {
      throw new Error(`${ctr.name} is not a module`);
    }
    this.name = `${ctr.name}Injector`;

    for (const p of meta.providers ?? []) {
      this.register(p);
    }

    for (const im of meta.imports ?? []) {
      this.registerImport(im);
    }
    // set the injector instance on the module constructor
    write(ctr, InjectorMetadata, this);
    log(`${this.name} created`);
  }

  /**
   * Register a provider or a class constructor as a provider.
   *
   * @param provider
   */
  register(provider: Provider | Ctr): Injector {
    // last wins strategy (don't check for duplicates)
    if (typeof provider !== "function") {
      this.providers.push(provider);
    } else {
      this.providers.push(provide(provider));
    }
    return this;
  }

  /**
   * Register an imported module.
   *
   * @param ctr
   */
  registerImport(ctr: Ctr) {
    if (typeof ctr !== "function") {
      throw new Error(
        `${this.name}: Cannot register import. Not a class.`,
      );
    }
    if (!readMetadataObject(ctr)) {
      throw new Error(
        `${this.name}: Cannot register ${ctr.name} as import. Did you forget to add @Module()?`,
      );
    }
    if (!this.imports.includes(ctr)) {
      this.imports.push(ctr);
    }
  }

  /**
   * Resolve a token to its corresponding instance.
   * @param token
   * @returns Promise of the resolved instance
   */
  async resolve<T>(token: Token): Promise<T> {
    log(`${this.name}: resolving ${tokenName(token)}`);

    const { type, value } = await this.search(token);
    if (type === "resolved") {
      log(`${this.name}: ${tokenName(token)} resolved from cache`);
      return Promise.resolve(value as T);
    }

    if (type === "provider") {
      log(
        `${this.name}: ${
          tokenName(token)
        } found as provider, creating instance`,
      );
      const instance = await value.factory(this);
      this.cache.set(token, instance);
      return instance as T;
    }

    // TODO: missing tests
    if (type === "circular-dependency-detected") {
      const path = value.map((i) => i.name).join(" → ");
      const error =
        `${this.name}: Circular dependency detected while resolving ${
          tokenName(token)
        }: ${path} → ${tokenName(token)}`;
      log.error(error);
      throw new Error(error);
    }

    const error = `${this.name}: ${
      tokenName(token)
    } not found in module or imports`;
    log.error(error);
    throw new Error(error);
  }

  /**
   * Search for a provider by its token in the current module and its imports.
   * If not found locally, it will recursively search in imported modules.
   *
   * @param token
   * @param ref
   * @returns SearchResult indicating whether the token was resolved, found as a provider, or not found.
   */
  async search(token: Token, ref: Injector[] = []): Promise<SearchResult> {
    if (ref.includes(this)) {
      return {
        type: "circular-dependency-detected",
        value: ref,
      } as SearchResultCircular;
    }

    if (this.cache.has(token)) {
      return {
        type: "resolved",
        value: this.cache.get(token),
      } as SearchResultResolved;
    }

    const provider = this.providers.find((p) => p.provide === token);

    if (provider) {
      return {
        type: "provider",
        value: provider,
      };
    }

    const next = [...ref, this];
    for (const im of this.imports) {
      // Injector & Module must initialize before searching
      // for providers. The initialization is part of the
      // system lifecycle. This is the opportunity to early
      // create entities using the module constructor (its dependencies)
      const injector = await Injector.get(im);
      const res = await injector.search(token, next);
      if (res.type !== "not-found") {
        // propagate resolved, provider or circular results
        return res;
      }
    }

    return {
      type: "not-found",
      value: null,
    };
  }
}
