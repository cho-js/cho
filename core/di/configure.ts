/**
 * {@link configure}: makes a module from another one, with more imports and
 * more providers. It is how who uses a module of a library gives it what it
 * needs.
 *
 * @module
 */

import { describe } from "../utils/describe.ts";
import { core_error } from "../errors.ts";
import { assert_known_options, assert_module_options } from "./decorations.ts";
import {
  EXPORTS,
  IMPORTS,
  MODULE,
  type ModuleRecord,
  PROVIDERS,
} from "./keys.ts";
import { read_metadata_object, write_metadata_object } from "./metadata.ts";
import type { Ctr, Provider, Token } from "./types.ts";

/** What {@link configure} adds to a module. */
export type ConfigureOptions = {
  /**
   * More modules to import: what the providers given need, when the module
   * does not import it already.
   */
  readonly imports?: readonly Ctr[] | undefined;
  /**
   * More providers: `@Injectable` classes and provider objects. One whose
   * token the module already provides replaces the provider of the module.
   */
  readonly providers?: readonly (Provider | Ctr)[] | undefined;
  /**
   * The name of the new module, for logs and errors. Default: the name of
   * the module it is made from. Give one to an application that configures
   * one module twice, to tell the two apart.
   */
  readonly name?: string | undefined;
};

/** The token of an entry of `providers`: the class, or what it provides. */
function token_of(entry: Provider | Ctr): Token {
  return typeof entry === "function" ? entry : entry.provide;
}

/**
 * Make a module from another one, with more imports and more providers.
 *
 * The module that is given does not change: `configure` returns a new module,
 * a class that extends it. It has everything the module has (its providers,
 * controllers and exports, its dependencies, its options such as a route,
 * its middlewares and its error handler), and after them what is given.
 *
 * - **A provider given for a token the module already provides replaces
 *   it.** A library leaves a placeholder that way: a provider that throws, or
 *   a default, for who uses the module to fill.
 * - **The providers given are in the scope of the new module**: their
 *   dependencies see what the module declares and what it imports, the
 *   imports given included. They are private to the module unless it exports
 *   their token.
 * - **Each call makes one more module, with instances of its own.** The new
 *   module and the one it is made from are two modules: who imports the
 *   original does not get the configured one. Keep the result in a constant,
 *   and import that constant everywhere.
 *
 * @typeParam C The class of the module.
 * @param module A `@Module` class.
 * @param options The imports and the providers to add, and a name.
 * @returns The new module.
 * @throws {ChoError} `CHO_CORE_NOT_A_MODULE` when the first argument is not a
 *   `@Module` class; `CHO_CORE_INVALID_OPTION` when the options are not an
 *   object, when `imports` or `providers` is not a list of what `@Module`
 *   takes, or when `name` is not a non-empty string;
 *   `CHO_CORE_UNKNOWN_OPTION` for an option that does not exist.
 *
 * @example
 * ```ts
 * // a library: a module with a placeholder for its settings
 * export const MAIL_OPTIONS = token<MailOptions>("MAIL_OPTIONS");
 *
 * @Module({
 *   providers: [
 *     provider({
 *       provide: MAIL_OPTIONS,
 *       factory: (): MailOptions => {
 *         throw new Error("give MAIL_OPTIONS to MailModule, with configure()");
 *       },
 *     }),
 *     Mailer,
 *   ],
 *   exports: [Mailer],
 * })
 * export class MailModule {}
 *
 * // the application: one constant, imported everywhere
 * export const Mail = configure(MailModule, {
 *   imports: [ConfigModule],
 *   providers: [
 *     provider({
 *       provide: MAIL_OPTIONS,
 *       deps: [Config],
 *       factory: (config) => ({ from: config.mailFrom }),
 *     }),
 *   ],
 * });
 *
 * @Module({ imports: [Mail] })
 * class App {}
 * ```
 */
export function configure<C extends Ctr>(
  module: C,
  options: ConfigureOptions = {},
): C {
  const record = typeof module === "function"
    ? read_metadata_object<ModuleRecord>(module)
    : undefined;
  if (!record?.[MODULE]) {
    throw core_error(
      "CHO_CORE_NOT_A_MODULE",
      `configure(): ${
        describe(module)
      } is not a module. Give it a @Module class.`,
    );
  }
  if (typeof options !== "object" || options === null) {
    throw core_error(
      "CHO_CORE_INVALID_OPTION",
      `configure(): expected options, such as { providers: [...] }, got ${
        describe(options)
      }`,
    );
  }
  assert_known_options("configure()", options, [
    "imports",
    "name",
    "providers",
  ]);
  const { imports = [], providers = [], name = module.name } = options;
  if (typeof name !== "string" || name === "") {
    throw core_error(
      "CHO_CORE_INVALID_OPTION",
      `configure(): "name" is a non-empty string, got ${describe(name)}`,
    );
  }
  // The lists are checked as `@Module` checks its own.
  assert_module_options({ imports, providers });

  // Declared with a computed key, so that the class has the name.
  const made = { [name]: class extends module {} }[name] as C;

  const given = new Set(providers.map(token_of));
  write_metadata_object(made, {
    ...record,
    [IMPORTS]: [
      ...record[IMPORTS],
      ...imports.filter((imported) => !record[IMPORTS].includes(imported)),
    ],
    // A provider given replaces the one of the module for the same token.
    [PROVIDERS]: [
      ...record[PROVIDERS].filter((entry) => !given.has(token_of(entry))),
      ...providers,
    ],
    // A module that exports itself exports the new class.
    [EXPORTS]: record[EXPORTS].map((token) => token === module ? made : token),
  });
  return made;
}
