/**
 * @chojs/command — command-line applications on top of `@chojs/core`.
 *
 * Controllers declare command methods with `@Main` (a single-command
 * application) or `@Action` (a multi-command application), and
 * {@link ChoCommand} parses the command line and runs the matching method.
 * `@Controller`, `@Module` and `@Catch` come from `@chojs/core`.
 *
 * @example
 * ```ts
 * import { Controller, Module, Action, type ChoArgs, ChoCommand, Help } from "@chojs/command";
 *
 * @Controller()
 * class Files {
 *   @Help("Copy a file")
 *   @Action("copy")
 *   copy(args: ChoArgs) {}
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

export { Action, Controller, Help, Main, Module } from "./decorators.ts";
export {
  Catch,
  type ControllerOptions,
  Injectable,
  type InjectableOptions,
  type ModuleOptions,
} from "@chojs/core/di";
export { ChoCommand, type ChoCommandOptions } from "./command.ts";
export type { ChoArgs, CommandFlags, ParserOptions } from "./args.ts";
