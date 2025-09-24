import { Ctr } from "@chojs/core/meta";
import { Any, readMetadataObject } from "../meta/mod.ts";
import {
  ChoErrorHandler,
  ChoErrorHandlerFn,
  ChoMiddleware,
  ChoMiddlewareFn,
  ControllerDescriptor,
  MethodDescriptor,
  ModuleDescriptor,
  Provider,
} from "../di/types.ts";

/**
 * A node in the module graph, representing a module, controller, or method.
 * Each node contains its metadata, associated middlewares, and an optional error handler.
 */
export type Node<M = Any, T = Any> = T & {
  meta: M;
  middlewares: (ChoMiddleware | ChoMiddlewareFn)[];
  errorHandler?: ChoErrorHandler | ChoErrorHandlerFn;
};

/**
 * A node representing a method within a controller, including its metadata and middlewares.
 */
export type MethodNode = Node<MethodDescriptor, {
  name: string;
}>;

/**
 * A node representing a controller, including its metadata, middlewares, and methods.
 */
export type ControllerNode = Node<ControllerDescriptor, {
  ctr: Ctr;
  methods: MethodNode[];
}>;

/**
 * A node representing a module, including its metadata, middlewares, imports, providers, and controllers.
 */
export type ModuleNode = Node<ModuleDescriptor, {
  ctr: Ctr;
  imports: ModuleNode[];
  providers: (Provider | Ctr)[];
  controllers: ControllerNode[];
}>;

/**
 * Get all methods of a class constructor along with their metadata.
 *
 * @param ctr
 */
const getMethods = (ctr: Ctr): { name: string; meta: MethodDescriptor }[] =>
  (
    Object.getOwnPropertyNames(
      ctr.prototype,
    ) as (string & keyof typeof ctr.prototype)[]
  )
    // takes only methods, but not constructor
    .filter((name) => name !== "constructor")
    .filter((name) => typeof ctr.prototype[name] === "function")
    // add metadata to each method
    .map((name) => ({
      name,
      meta: readMetadataObject<MethodDescriptor>(ctr.prototype[name]),
    }))
    // filter out methods without metadata
    .filter(({ meta }) => !!meta) as { name: string; meta: MethodDescriptor }[];

/**
 * Build a graph representation of the module and its dependencies.
 *
 * This function recursively visits modules and controllers, extracting their metadata
 * and constructing a tree-like structure that represents the relationships between them.
 * @param ctr
 */
export function graphBuilder(ctr: Ctr): ModuleNode {
  const modules = new WeakMap<Ctr, ModuleNode>();

  function visitMethod(
    { name, meta }: { name: string; meta: MethodDescriptor },
  ): MethodNode {
    return {
      name,
      middlewares: [],
      errorHandler: undefined,
      meta,
    };
  }

  function visitController(ctr: Ctr): ControllerNode {
    const meta = readMetadataObject<ControllerDescriptor>(ctr);
    if (!meta || !meta.isGateway) {
      throw new Error(
        `Class ${ctr.name} is not a controller. Did you forget to add @Controller()?`,
      );
    }
    return {
      ctr,
      meta,
      methods: getMethods(ctr).map(visitMethod),
      middlewares: meta.middlewares ?? [],
      errorHandler: meta.errorHandler,
    };
  }

  function visitModule(ctr: Ctr): ModuleNode {
    if (modules.has(ctr)) {
      return modules.get(ctr) as ModuleNode;
    }

    const meta = readMetadataObject<ModuleDescriptor>(ctr);
    if (!meta || !meta.isModule) {
      throw new Error(
        `Class ${ctr.name} is not a module. Did you forget to add @Module()?`,
      );
    }

    const node: ModuleNode = {
      ctr,
      meta,
      imports: (meta.imports ?? []).map(visitModule),
      controllers: (meta.controllers ?? []).map(visitController),
      providers: meta.providers ?? [],
      middlewares: meta.middlewares ?? [],
      errorHandler: meta.errorHandler,
    };
    modules.set(ctr, node);
    return node;
  }

  return visitModule(ctr);
}
