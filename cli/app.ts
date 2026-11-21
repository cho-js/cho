/**
 * The application of the `cho` command-line tool: its root module, and what
 * runs one command line of it.
 *
 * It is a `@chojs/command` application like any other: modules, controllers
 * and providers. A new command is a controller, added to a module here.
 *
 * @module
 */

import { ChoCommand, Module, provider } from "@chojs/command";
import config from "./deno.json" with { type: "json" };
import { HelpCommands, RUN } from "./help.ts";
import { NewCommand } from "./new.ts";

/** The root module of the tool. */
@Module({
  providers: [provider({ provide: RUN, factory: () => run_cli })],
  controllers: [NewCommand, HelpCommands],
})
export class AppModule {}

/**
 * Run one command line of `cho`, and release what it created.
 *
 * It never exits the process: the entry point does, with the result.
 *
 * @param argv The command-line arguments, without the program name.
 * @returns The exit code.
 */
export async function run_cli(argv: string[]): Promise<number> {
  const app = ChoCommand.create(AppModule, {
    name: "cho",
    version: config.version,
  });
  try {
    return await app.run(argv);
  } catch (err) {
    console.error(err);
    return 1;
  } finally {
    await app.close();
  }
}
