/**
 * @chojs/command — command-line applications on top of `@chojs/core`.
 *
 * Controllers declare command methods with `@Main` (a single-command
 * application) or `@Action` (a multi-command application), and
 * {@link ChoCommand} parses the command line and runs the matching method.
 * A command receives the context of the run (`ChoCommandContext`), and runs
 * through the middlewares declared with `@Middlewares`; `@Catch` declares
 * error handlers. `@Controller`, `@Module` and `@Injectable` come from
 * `@chojs/core`, and so do `token` and `provider`, to declare values that
 * are not classes: an application imports everything from `@chojs/command`.
 *
 * @example
 * ```ts
 * import { Controller, Module, Action, type ChoCommandContext, ChoCommand, Help } from "@chojs/command";
 *
 * @Controller()
 * class Files {
 *   @Help("Copy a file")
 *   @Action("copy")
 *   copy(ctx: ChoCommandContext) {}
 * }
 *
 * @Module({ controllers: [Files] })
 * class App {}
 *
 * const app = ChoCommand.create(App, { name: "fs" });
 * Deno.exit(await app.run(Deno.args));
 * ```
 *
 * @module
 */

export {
  Action,
  Catch,
  Controller,
  Help,
  Main,
  Middlewares,
  Module,
} from "./decorators.ts";
// What an application needs from the core, so that it only imports
// `@chojs/command`: the `@Injectable` decorator, and `token` and `provider`
// to declare values that are not classes (and the `overrides` of tests).
export {
  type ControllerOptions,
  Injectable,
  type InjectableOptions,
  type InjectionToken,
  type ModuleOptions,
  type Provider,
  provider,
  token,
} from "@chojs/core/di";
export { ChoCommand, type ChoCommandOptions } from "./command.ts";
export type { ChoArgs, CommandFlags, ParserOptions } from "./args.ts";
export type { ChoCommandContext } from "./context.ts";
export type * from "./types.ts";
