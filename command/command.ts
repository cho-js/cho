/**
 * The command-line application: {@link ChoCommand} reads the command graph of
 * a module, parses the command line and runs the matching command method.
 *
 * Errors in a command are handled by its `@Catch` error handler (the method's,
 * then the controller's), or by the default one, which prints
 * `Error: <message>` to stderr and exits `1`.
 *
 * `ChoCommand` logs to the `cho:command` debug context (`CHO_DEBUGLOG=cho:command`
 * or `CHO_DEBUG=1`): the commands it found, each run with its exit code, and
 * each error.
 *
 * @module
 */

import type {
  ChoErrorHandler,
  Ctr,
  MethodMetadata,
  Provider,
} from "@chojs/core/di";
import { Injector } from "@chojs/core/di";
import { type Debuglog, debuglog, describe, isClass } from "@chojs/core/utils";
import {
  ChoActionsParser,
  type ChoArgsParser,
  ChoMainParser,
  type ParserOptions,
} from "./args.ts";
import {
  command_graph,
  type CommandGraph,
  type ControllerNode,
} from "./graph.ts";
import { format_help } from "./help.ts";
import { ALIAS, command_record } from "./keys.ts";

/**
 * Assert that a value is truthy.
 *
 * @param el The value.
 * @param msg The error message.
 * @throws {Error} When the value is falsy.
 */
function assert_not_empty(el: unknown, msg: string): asserts el {
  if (!el) {
    throw new Error(msg);
  }
}

/**
 * Assert that a value is a function.
 *
 * @param el The value.
 * @param msg The error message.
 * @throws {TypeError} When the value is not a function.
 */
function assert_is_function(
  el: unknown,
  msg: string,
): asserts el is (...args: unknown[]) => unknown {
  if (typeof el !== "function") {
    throw new TypeError(msg);
  }
}

/** The highest exit code a process can report. */
const MAX_EXIT_CODE = 255;

/**
 * The exit code for what a command method or an error handler returned.
 *
 * A non-negative integer is the exit code, capped at `255`: a process reports
 * exit codes modulo 256, so `256` would read as success. Anything else gives
 * the fallback.
 *
 * @param value The returned value.
 * @param fallback The exit code when the value is not one.
 * @returns The exit code, from `0` to `255`.
 */
function exit_code(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? Math.min(value, MAX_EXIT_CODE)
    : fallback;
}

/**
 * Find the error handler of an action (`@Catch`): the method's own handler
 * first, then the controller's.
 *
 * @param action The controller node and the action method.
 * @returns The handler, or `undefined` when neither has one.
 */
function find_error_handler(
  [node, method]: [ControllerNode, MethodMetadata],
): ChoErrorHandler | undefined {
  return method.errorHandler ?? node.meta.errorHandler;
}

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
      graph.mode === "main" ? new ChoMainParser() : new ChoActionsParser(),
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
   * - otherwise: resolves the command's controller and calls the method with
   *   the parsed arguments. A non-negative integer it returns is the exit
   *   code; anything else gives `0`.
   *
   * An error while creating the controller or running the method goes to the
   * command's `@Catch` handler (the method's, then the controller's): a
   * non-negative integer it returns is the exit code, anything else gives
   * `1`. Without a handler, and for an unknown command, the error is logged to
   * the `cho` debug logger and the exit code is `1`.
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

    let action: [ControllerNode, MethodMetadata] | undefined;

    try {
      assert_not_empty(
        route,
        "No route specified. Use --help for usage information.",
      );

      action = this.#find_controller(route);

      assert_not_empty(
        action,
        `Action '${route}' not found. Use --help for usage information.`,
      );

      const [node, meta] = action;

      const ctrl = await this.#injector.resolve(
        node.token,
        node.owner,
      ) as Record<string, unknown>;

      assert_not_empty(
        ctrl,
        `Controller '${describe(node.token)}' not found.`,
      );

      const method = ctrl[meta.name];

      assert_is_function(
        method,
        `Method '${meta.name}' is not a function on controller '${
          describe(node.token)
        }'.`,
      );

      const handler = method.bind(ctrl);
      const done = this.#log.start();
      const ret = await handler(args);
      const code = exit_code(ret, 0);
      done(`${route} (${describe(node.token)}.${meta.name}) exited ${code}`);
      return code;
    } catch (err) {
      this.#log.error(`${route || "main"} failed:`, err);
      // the method's error handler, then the controller's
      const errorHandler = action && find_error_handler(action);
      if (errorHandler) {
        this.#log(`handled by ${describe(errorHandler)}`);
      }

      // error handler as a resolvable class
      if (action && action[0] && isClass(errorHandler)) {
        try {
          const handler = await this.#injector.resolve<
            { handle: (error: unknown, ctx?: unknown) => unknown }
          >(
            errorHandler,
            action![0].owner,
          );
          const ret = await handler.handle(err, args);
          return exit_code(ret, 1);
        } catch (handlerErr) {
          this.#log.error("the error handler failed:", handlerErr);
          console.error(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          );
          return 2;
        }
      }

      // error handler as a function
      if (typeof errorHandler === "function") {
        try {
          const ret =
            await (errorHandler as (error: unknown, ctx?: unknown) => unknown)(
              err,
              args,
            );
          return exit_code(ret, 1);
        } catch (handlerErr) {
          this.#log.error("the error handler failed:", handlerErr);
          console.error(
            `Error: ${err instanceof Error ? err.message : String(err)}`,
          );
          return 2;
        }
      }

      // default error handling: log the error and return 1
      console.error(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 1;
    }
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

  /**
   * Find a command method by alias.
   *
   * @param route The alias: an action name, or `"main"`.
   * @returns The method and its controller node, or `undefined`.
   */
  #find_controller(
    route: string,
  ): [ControllerNode, MethodMetadata] | undefined {
    return this.#graph.actions.find(([, { meta }]) =>
      command_record(meta)[ALIAS] === route
    );
  }
}
