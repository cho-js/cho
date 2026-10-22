import { green } from "@std/fmt/colors";
import { CompiledModule } from "../core/application/mod.ts";
// import type { CompiledFeature } from "@chojs/web/compiler";

/**
 * Describe all routes in a initiated feature.
 * @param input
 */
export function describeRoutes(input: CompiledModule): void {
  // function describeFeature(feature: CompiledModule, depth = 0) {
  //   for (const c of feature.controllers) {
  //     for (const m of c.methods) {
  //       const parts = [
  //         feature.meta.route ?? "",
  //         c.meta.route ?? "",
  //         m.meta.route ?? "",
  //       ].filter(Boolean).join("/");
  //       console.log(
  //         green(m.meta.type),
  //         `/${parts}`,
  //       );
  //     }
  //   }
  //   for (const f of feature.imports) {
  //     describeFeature(f, depth + 1);
  //   }
  // }
  //
  // describeFeature(input, 0);
}
