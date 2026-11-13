/**
 * The default linker of `ChoWeb.create`: the plain adapter,
 * `@chojs/vendor-cho`, loaded only when an application gives no linker.
 *
 * @module
 */

import type { Linker } from "./linker.ts";

/** The package of the default linker. */
export const DEFAULT_LINKER_PACKAGE = "@chojs/vendor-cho";

/**
 * Load the default linker.
 *
 * The package is imported by a name held in a variable, on purpose: an
 * `import()` of a literal would make it a dependency of `@chojs/web`, which
 * depends on no adapter. An application that gives no linker installs the
 * package itself.
 *
 * @param specifier The package to load. Default: `@chojs/vendor-cho`.
 * @returns A new linker.
 * @throws {Error} When the package cannot be loaded, usually because it is
 *   not installed, or when it has no `ChoLinker`. The failure is its `cause`.
 */
export async function load_default_handler(
  specifier: string = DEFAULT_LINKER_PACKAGE,
): Promise<Linker<unknown>> {
  let loaded: { ChoLinker?: new () => Linker<unknown> };
  try {
    loaded = await import(specifier);
  } catch (cause) {
    throw new Error(
      `ChoWeb.create() was given no linker, and the default one, ${specifier}, could not be loaded. ` +
        `Install it ("deno add jsr:${specifier}", "npx jsr add ${specifier}" or "bunx jsr add ${specifier}"), ` +
        `or pass a linker in the options`,
      { cause },
    );
  }
  if (typeof loaded.ChoLinker !== "function") {
    throw new Error(
      `ChoWeb.create() was given no linker, and the default one, ${specifier}, has no ChoLinker: ` +
        `update the package, or pass a linker in the options`,
    );
  }
  return new loaded.ChoLinker();
}
