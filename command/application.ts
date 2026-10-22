import { parseArgs } from "@std/cli/parse-args";
import type { Ctr } from "@chojs/core/internals";
import { AppRef, onModuleActivate, onModuleInit } from "@chojs/core/internals";
import {
  type ChoArgs,
  LinkedCommandsApp,
  LinkedMainApp,
  linker,
} from "./linker.ts";

export { ChoCommandContext } from "./linker.ts";

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

export abstract class CommandApplication<T> {
  constructor(
    readonly ref: AppRef,
    readonly linked: T,
  ) {
  }

  abstract run(argv: string[]): void;
}

export class SingleCommandApplication
  extends CommandApplication<LinkedMainApp> {
  /**
   * @param argv
   */
  run(argv: string[]): void {
    const args = parseArgs(argv) as ChoArgs;
    if (args.help || args.h) {
      const help = this.linked.main.help ?? this.linked.help;
      if (!help) {
        throw new MissingHelpError("No help available");
      }
      console.log(help);
      return;
    }

    // invoke main command
    this.linked.main.handle(args);
  }
}

export class MultiCommandApplication
  extends CommandApplication<LinkedCommandsApp> {
  /**
   * @param argv
   */
  run(argv: string[]): void {
    const args = parseArgs(argv) as ChoArgs;
    const route = args._.length ? args._[0] as string : null;
    const showHelp = args.help ?? args.h ?? false;

    if (showHelp && !route) {
      // show main help
      const help = (this.linked.help ?? []).join("\n");
      if (!help) {
        throw new MissingHelpError("No global help available");
      }
      console.log(help);
      return;
    }

    if (!route) {
      // todo show usage? (global help?!)
      throw new MissingCommandError();
    }

    if (!this.linked.commands[route]) {
      throw new NotFoundError(`Command "${route}" not found`);
    }

    if (showHelp) {
      // show command help for subcommand
      const help = this.linked.commands[route].help;
      if (!help) {
        throw new MissingHelpError(`No help available for command "${route}"`);
      }
      console.log(help);
      return;
    }

    // remove the route from args
    const normalized = {
      ...args,
      _: (args._ ?? []).slice(1),
    };

    // invoke the subcommand
    this.linked.commands[route].handle(normalized);
  }
}

export class CommandFactory {
  /**
   * @param ctr
   */
  static async create(ctr: Ctr) {
    const ref = await AppRef.create(ctr);
    await onModuleInit(ref.initiated);

    const linked = linker(ref);
    await onModuleActivate(ref.initiated, linked);

    return (linked instanceof LinkedMainApp)
      ? new SingleCommandApplication(ref, linked)
      : new MultiCommandApplication(ref, linked);
  }
}
