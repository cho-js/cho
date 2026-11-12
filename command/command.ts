/**
 * The command-line application: {@link ChoCommand} reads the command graph of
 * a module, parses the command line and runs the matching command method.
 *
 * A command runs through its pipeline (`pipeline.ts`): its middlewares, the
 * command method, and its error handler. Errors go to the nearest `@Catch`
 * handler (the method's, the controller's, the module's), then to the
 * `onError` option, or are printed as `Error: <message>` with exit code `1`.
 *
 * `ChoCommand` logs to the `cho:command` debug context (`CHO_DEBUGLOG=cho:command`
 * or `CHO_DEBUG=1`): the commands it found, each run with its exit code, and
 * each error.
 *
 * @module
 */

import type { Ctr, Provider } from "@chojs/core/di";
import { Injector } from "@chojs/core/di";
import { type Debuglog, debuglog, describe } from "@chojs/core/utils";
import {
  ChoActionsParser,
  type ChoArgsParser,
  ChoMainParser,
  type ParserOptions,
} from "./args.ts";
import { command_graph, type CommandGraph } from "./graph.ts";
import { create_context } from "./context.ts";
import { format_help } from "./help.ts";
import { ALIAS, command_record, FLAGS } from "./keys.ts";
import { command_pipeline, type CommandPipeline } from "./pipeline.ts";
import type { ChoCommandErrorHandler } from "./types.ts";

/**
 * Options of {@link ChoCommand.create}. Every option is optional.
 *
 * @example
 * ```ts
 * const app = ChoCommand.create(App, {
 *   name: "fs",
 *   version: "2.1.0", // ./fs --version -> fs version 2.1.0
 *   parseOptions: { boolean: ["force"], alias: { f: "force" } },
 * });
 * ```
 */
export type ChoCommandOptions = {
  /** The application version, printed by `--version`. Default: `"1.0.0"`. */
  version: string;
  /**
   * The application name, printed by `--version` and in the help usage lines.
   * Default: `"chojs"`.
   */
  name: string;
  /**
   * `parseArgs` options that declare the handlers' flags, for example
   * `{ boolean: ["force"] }`. `--help` and `--version` stay negatable
   * booleans whatever they declare. Default: none.
   */
  parseOptions: ParserOptions;
  /**
   * Providers that replace the declared providers of the same token, for
   * tests (see `InjectorOptions.overrides` of `@chojs/core`). Default: none.
   */
  overrides: readonly Provider[];
  /**
   * The error handler of the application: it handles the errors of every
   * command that no `@Catch` handler covers (the method's, the controller's
   * and the module's come first). Like `@Catch`, it takes a function
   * `(error, ctx)`, or a class with a `handle(error, ctx)` method, created by
   * the injector in the scope of the root module; a non-negative integer it
   * returns is the exit code, anything else gives `1`. Default: none, such
   * errors are printed and the exit code is `1`.
   *
   * It handles the errors of commands only: an unknown command is reported
   * by the application.
   */
  onError: ChoCommandErrorHandler;
};

/**
 * A command-line application, built from a root module.
 *
 * The mode depends on the command methods of the whole module graph:
 *
 * - **single command**: exactly one `@Main` method, run for every command line
 *   (`./app [options] [args]`);
 * - **multiple actions**: one or more `@Action` methods, the first positional
 *   argument names the one to run (`./app <command> [options] [args]`).
 *
 * @example
 * ```ts
 * const app = ChoCommand.create(AppModule, { name: "fs", version: "1.0.0" });
 * Deno.exit(await app.run(Deno.args));
 * ```
 */
export class ChoCommand {
  /**
   * Create the application of a root module.
   *
   * Creates the injector and the command graph, and picks the parser of the
   * mode. No instance is created: controllers are created by {@link run}.
   *
   * @param app The root module.
   * @param options The application options; every option is optional.
   * @returns The application.
   * @throws {Error} When the module graph is invalid (see `Injector`), or when
   *   its command methods are: none, `@Main` mixed with `@Action`, more than
   *   one `@Main`, or a duplicate action name.
   *
   * @example
   * ```ts
   * const app = ChoCommand.create(AppModule, { name: "fs", version: "1.0.0" });
   * ```
   */
  static create(
    app: Ctr,
    options: Partial<ChoCommandOptions> = {},
  ): ChoCommand {
    const inj = new Injector(
      app,
      options.overrides ? { overrides: options.overrides } : {},
    );
    const graph = command_graph(inj);

    return new ChoCommand(
      inj,
      graph,
      options,
      graph.mode === "main"
        ? new ChoMainParser(command_record(graph.actions[0]![1].meta)[FLAGS])
        : new ChoActionsParser(
          new Map(
            graph.actions.map(([, { meta }]) => {
              const record = command_record(meta);
              return [record[ALIAS]!, record[FLAGS]];
            }),
          ),
        ),
    );
  }

  /** Creates the controllers, with their dependencies. */
  readonly #injector: Injector;
  /** The mode and the command methods. */
  readonly #graph: CommandGraph;
  /** The options, with the defaults of `name` and `version` applied. */
  readonly #options: Partial<ChoCommandOptions>;
  /** The command-line parser of the mode. */
  readonly #parser: ChoArgsParser;
  /** The pipeline of each command, by command name. */
  readonly #pipelines: Map<string, CommandPipeline>;
  /**
   * The `cho:command` debug logger, created with the application, so it
   * follows `set_env` and the environment at that time.
   */
  readonly #log: Debuglog = debuglog("cho:command");

  /**
   * Use {@link ChoCommand.create}, which builds the arguments from a module.
   *
   * @param injector The application's injector.
   * @param graph The command graph of the injector.
   * @param options The options; `name` and `version` get their defaults.
   * @param parser The parser of the graph's mode.
   */
  constructor(
    injector: Injector,
    graph: CommandGraph,
    options: Partial<ChoCommandOptions>,
    parser: ChoArgsParser,
  ) {
    this.#injector = injector;
    this.#graph = graph;
    this.#options = {
      ...options,
      name: options.name ?? "chojs",
      version: options.version ?? "1.0.0",
    };
    this.#parser = parser;
    this.#pipelines = new Map(
      graph.actions.map((action) => [
        command_record(action[1].meta)[ALIAS]!,
        command_pipeline(injector, action, options.onError, this.#log),
      ]),
    );
    if (this.#log.enabled) {
      const commands = this.#graph.actions.map(([node, method]) =>
        `${command_record(method.meta)[ALIAS]} (${
          describe(node.token)
        }.${method.name})`
      );
      this.#log(`${this.#graph.mode} mode: ${commands.join(", ")}`);
    }
  }

  /**
   * Run one command line.
   *
   * - `--help`: prints the help (for the command, if one is named) and
   *   resolves to `0`;
   * - `--version`: prints `<name> version <version>` and resolves to `0`;
   * - no command in multi-command mode: prints the global help and resolves to
   *   `0`;
   * - an unknown command in multi-command mode: prints an error and resolves
   *   to `1`;
   * - otherwise: runs the command through its middlewares, with the context
   *   of the run (`ChoCommandContext`). A non-negative integer the command (or a
   *   middleware) returns is the exit code; anything else gives `0`.
   *
   * An error while creating the controller or a middleware class, in a
   * middleware, or in the command, goes to the nearest error handler (the
   * method's, the controller's, the module's `@Catch`, then `onError`): a
   * non-negative integer it returns is the exit code, anything else gives
   * `1`. Without a handler, the error is printed and the exit code is `1`;
   * when the handler fails too, `2`.
   *
   * It never exits the process: pass the result to `Deno.exit` or
   * `process.exit`.
   *
   * @param argv The command-line arguments, without the program name.
   * @returns The exit code.
   *
   * @example Deno
   * ```ts
   * Deno.exit(await app.run(Deno.args));
   * ```
   *
   * @example Node.js and Bun
   * ```ts
   * process.exit(await app.run(process.argv.slice(2)));
   * ```
   */
  async run(argv: string[]): Promise<number> {
    const { args, route, help, version } = this.#parser.parse(
      argv,
      this.#options.parseOptions,
    );
    this.#log("run", argv);

    if (help) {
      this.#log(`help for ${JSON.stringify(route)}`);
      this.#show_help(route);
      return 0;
    }

    if (version) {
      this.#log("version");
      console.log(`${this.#options.name} version ${this.#options.version}`);
      return 0;
    }

    if (!route && this.#graph.mode === "actions") {
      this.#log("no action: help");
      this.#show_help("");
      return 0;
    }

    const pipeline = this.#pipelines.get(route);
    if (!pipeline) {
      this.#log.error(`unknown action ${JSON.stringify(route)}`);
      console.error(
        `Error: Action '${route}' not found. Use --help for usage information.`,
      );
      return 1;
    }
    return await pipeline.run(create_context(args, argv, route));
  }

  /**
   * Release the instances the application created: every provider,
   * controller and module that has a `[Symbol.asyncDispose]()` or
   * `[Symbol.dispose]()` method is disposed, in reverse creation order (see
   * `Injector.dispose`).
   *
   * `run()` does not do it: instances are kept between runs. Call it once,
   * after the last `run()` and before exiting the process. Afterwards `run()`
   * fails with exit code `1`. Calling it again does nothing more.
   *
   * @returns A promise that resolves when everything is disposed.
   * @throws {AggregateError} (as a rejection) When instances failed to
   *   dispose.
   *
   * @example
   * ```ts
   * const app = ChoCommand.create(AppModule);
   * const code = await app.run(Deno.args);
   * await app.close();
   * Deno.exit(code);
   * ```
   */
  close(): Promise<void> {
    return this.#injector.dispose();
  }

  /** Close the application at the end of an `await using` block. */
  [Symbol.asyncDispose](): Promise<void> {
    return this.close();
  }

  /**
   * Print the help text to stdout (see `format_help`).
   *
   * - Single-command mode: the help of the `@Main` command.
   * - Multi-command mode: the help of the command named `route`, or the global
   *   help (every command) when `route` is empty or names no command.
   *
   * @param route The parsed command name (`""` when there is none).
   */
  #show_help(route: string): void {
    console.log(format_help(this.#graph, this.#options.name!, route));
  }
}
