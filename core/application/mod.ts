/**
 * Application Lifecycle
 *
 * @example compiling a class into an application tree
 * ```ts
 * import {graphBuilder} from "@chojs/core/application";
 *
 * class Example {
 * }
 *
 * const graph = graphBuilder(Example);
 * const compiled = await new Compiler().compile(graph);
 * ```
 *
 * @module
 */
export * from "./compiler.ts";
export * from "./graph-builder.ts";
export * from "./hooks.ts";
