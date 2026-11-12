/**
 * @chojs/command — command-line applications on top of `@chojs/core`.
 *
 * Controllers declare command methods with `@Main` (a single-command
 * application) or `@Action` (a multi-command application), and
 * {@link ChoCommand} parses the command line and runs the matching method.
 * A command receives the context of the run (`ChoCommandContext`), and runs
 * through the middlewares declared with `@Middlewares`; `@Catch` declares
 * error handlers. `@Controller`, `@Module` and `@Injectable` come from
 * `@chojs/core`.
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
export {
  type ControllerOptions,
  Injectable,
  type InjectableOptions,
  type ModuleOptions,
} from "@chojs/core/di";
export { ChoCommand, type ChoCommandOptions } from "./command.ts";
export type { ChoArgs, CommandFlags, ParserOptions } from "./args.ts";
export type { ChoCommandContext } from "./context.ts";
export type * from "./types.ts";
