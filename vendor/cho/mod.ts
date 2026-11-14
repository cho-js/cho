/**
 * @chojs/vendor-cho — the plain router of CHO web applications.
 *
 * The router is now part of `@chojs/web`, where it is the default linker of
 * `ChoWeb.create`. This package exports the same `ChoLinker` and `ChoRouter`,
 * for the applications that import them from here.
 *
 * @example
 * ```ts
 * import { ChoWeb } from "@chojs/web";
 *
 * // the plain router is used when no linker is given
 * const app = await ChoWeb.create(AppModule);
 * Deno.serve(app.handler);
 * ```
 *
 * @module
 */

export {
  ChoLinker,
  type ChoLinkerOptions,
  type ChoMatch,
  ChoRouter,
} from "@chojs/web";
// The `@chojs/web` types `ChoLinker` and `ChoRouter` refer to.
export type { Linked, Linker, Route } from "@chojs/web/linker";
