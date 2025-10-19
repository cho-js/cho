import type { Ctr, Token } from "@chojs/core";
import { Injector } from "@chojs/core";
import { parseArgs } from "@std/cli/parse-args";
import {
  HelpKey,
  LinkedApp,
  LinkedCommandsApp,
  LinkedMainApp,
} from "./linker.ts";
import { Linker } from "./linker.ts";
import {
  type CompiledModule,
  Compiler,
  graphBuilder,
  onModuleActivate,
  onModuleInit,
  onModuleShutdown,
} from "@chojs/core/application";
import { type ChoArgs, ChoCommandContext } from "./context.ts";

/**
 * Error thrown when no command is provided.
 */
export class MissingCommandError extends Error {}

/**
 * Error thrown when a command is not found.
 */
export class NotFoundError extends Error {}

/**
 * Error thrown when help content is missing for a command or application.
 */
export class MissingHelpError extends Error {}

/**
 * Command Application Handler
 */
export abstract class Application<T extends LinkedApp> {
  /**
   * Create an application instance from a root controller.
   *
   * @param ctr
   */
  static async create(
    ctr: Ctr,
  ): Promise<ApplicationMain | ApplicationCommands> {
    const compiled = await new Compiler().compile(graphBuilder(ctr));
    await onModuleInit(compiled);

    const linked = new Linker().link(compiled);
    await onModuleActivate(compiled, linked);

    return ("main" in linked)
      ? new ApplicationMain(ctr, compiled, linked)
      : new ApplicationCommands(ctr, compiled, linked);
  }

  protected constructor(
    readonly ctr: Ctr,
    readonly instance: CompiledModule,
    readonly appRef: T,
  ) {
  }

  /**
   * Run the application with the given command-line arguments.
   * @param argv
   */
  abstract run(argv: string[]): void | Promise<void>;

  /**
   * Handle an error using the application's error handler if available.
   * @param err
   * @param args
   */
  protected async handleError(err: Error, args: ChoArgs): Promise<void> {
    if (this.appRef.errorHandler) {
      await this.appRef.errorHandler(
        err,
        new ChoCommandContext(args),
      );
      return;
    }
    throw err;
  }

  protected handleHelp(help?: string) {
    if (!help) {
      throw new MissingHelpError();
    }
    console.log(help);
  }
}

export class ApplicationMain extends Application<LinkedMainApp> {
  /**
   * @param argv
   */
  async run(argv: string[]): Promise<void> {
    const args = parseArgs(argv) as ChoArgs;
    const showHelp = args.help ?? args.h ?? false;

    if (showHelp) {
      return this.handleHelp(
        this.appRef.help["main"] || this.appRef.help[HelpKey],
      );
    }

    await this.appRef.main(new ChoCommandContext(args));
    await onModuleShutdown(this.instance, this.appRef);
  }
}

export class ApplicationCommands extends Application<LinkedCommandsApp> {
  /**
   * @param argv
   */
  async run(argv: string[]): Promise<void> {
    const args = parseArgs(argv) as ChoArgs;
    const route = args._.length ? args._[0] as string : null;
    const showHelp = args.help ?? args.h ?? false;

    // if show help without subcommand, show main help (gateway help)
    if (showHelp && !route) {
      // todo auto generate main help from subcommands if no help provided?
      return this.handleHelp(this.appRef.help[HelpKey]);
    }

    // no subcommand?
    if (!route) {
      return await this.handleError(
        new MissingCommandError("No command provided"),
        args,
      );
    }

    // is subcommand exists?
    if (!this.appRef.commands[route]) {
      return await this.handleError(
        new NotFoundError(`Command "${route}" not found`),
        args,
      );
    }

    // show help for this subcommand
    if (showHelp) {
      return this.handleHelp(this.appRef.help[route]);
    }

    // remove the route from args
    const normalized = {
      ...args,
      _: (args._ ?? []).slice(1),
    };

    // invoke the subcommand
    await this.appRef.commands[route](new ChoCommandContext(normalized));
    await onModuleShutdown(this.instance, this.appRef);
  }
}
