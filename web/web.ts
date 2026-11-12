import { type Any, type Ctr, Injector } from "@chojs/core/di";
import { build_http_graph } from "./graph.ts";
import { default_linker, Linked, type Linker } from "./linker.ts";

export type ChoWebOptions = {
  version: string;
  name: string;
  prefix: string;
  platform: () => Promise<Linker<unknown>>;
};

export class ChoWeb<T = Any> {
  linked: Linked<T>;

  static async create<T = Any>(app: Ctr, options: Partial<ChoWebOptions> = {}) {
    const prefix = options.prefix ?? "";
    const inj = new Injector(app);
    await inj.init();
    const graph = await build_http_graph(inj, prefix);
    const linker = await (options.platform ?? default_linker)();
    const ref = linker.link(graph);
    return new ChoWeb(ref);
  }

  constructor(linked: Linked<T>) {
    this.linked = linked;
  }

  get handler() {
    return this.linked.handler;
  }
}
