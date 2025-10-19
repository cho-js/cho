import { type Ctr, readMetadataObject } from "../meta/mod.ts";
import type {
  ControllerDescriptor,
  MethodDescriptor,
  ModuleDescriptor,
} from "../di/types.ts";

/**
 * A node representing a method within a controller, including its metadata and middlewares.
 */
export type MethodNode = {
  name: string;
  meta: MethodDescriptor;
};

/**
 * A node representing a controller, including its metadata, middlewares, and methods.
 */
export type ControllerNode = {
  ctr: Ctr;
  meta: ControllerDescriptor;
  methods: MethodNode[];
};

/**
 * A node representing a module, including its metadata, middlewares, imports, providers, and controllers.
 */
export type ModuleNode = {
  ctr: Ctr;
  meta: ModuleDescriptor;
  imports: ModuleNode[];
  controllers: ControllerNode[];
};

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

  function constructMethod(
    { name, meta }: { name: string; meta: MethodDescriptor },
  ): MethodNode {
    return {
      name,
      meta,
    };
  }

  function constructController(ctr: Ctr): ControllerNode {
    const meta = readMetadataObject<ControllerDescriptor>(ctr);
    if (!meta || !meta.isGateway) {
      throw new Error(
        `Class ${ctr.name} is not a controller. Did you forget to add @Controller()?`,
      );
    }
    return {
      ctr,
      meta,
      methods: getMethods(ctr).map(constructMethod),
    };
  }

  function constructModule(ctr: Ctr, history: Ctr[] = []): ModuleNode {
    // process module only once
    if (modules.has(ctr)) {
      return modules.get(ctr) as ModuleNode;
    }

    // circular dependencies guard
    if (history.includes(ctr)) {
      const cyclePath = [...history.map((c) => c.name), ctr.name].join(" → ");
      throw new Error(`Circular module dependency detected: ${cyclePath}`);
    }
    history.push(ctr);

    // module metadata
    const meta = readMetadataObject<ModuleDescriptor>(ctr);
    if (!meta || !meta.isModule) {
      throw new Error(
        `Class ${ctr.name} is not a module. Did you forget to add @Module()?`,
      );
    }

    // construct children nodes
    const controllers = (meta.controllers ?? []).map(
      constructController,
    );
    const imports = (meta.imports ?? []).map((im) =>
      constructModule(im, [...history])
    );

    // construct module node
    const node: ModuleNode = {
      ctr,
      meta,
      imports,
      controllers,
    };

    // cache constructed module
    modules.set(ctr, node);

    return node;
  }

  return constructModule(ctr);
}
