/**
 * The pipeline of a command: what `ChoCommand.run` calls once the command
 * line is parsed and the command is chosen. Internal to `@chojs/command`.
 *
 * A pipeline creates the controller, runs the middlewares of the module, the
 * controller and the method around the command method, converts the result to
 * an exit code, and hands errors to the nearest error handler.
 *
 * Nothing is created before a command runs: an application must be able to
 * print its help without creating anything. What a command needs is created
 * on its first run, and kept.
 *
 * @module
 */

import {
  assert_handle,
  type Ctr,
  type Injector,
  is_handle_class,
  type MethodMetadata,
  resolve_handle,
} from "@chojs/core/di";
import { compose, type Debuglog, describe } from "@chojs/core/utils";
import type { ChoCommandContext } from "./context.ts";
import type { ControllerNode } from "./graph.ts";
import type {
  ChoCommandErrorHandlerFn,
  ChoCommandMiddlewareFn,
} from "./types.ts";

/** The highest exit code a process can report. */
const MAX_EXIT_CODE = 255;

/** Whether a value is an exit code: a non-negative integer. */
function is_exit_code(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

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
export function exit_code(value: unknown, fallback: number): number {
  return is_exit_code(value) ? Math.min(value, MAX_EXIT_CODE) : fallback;
}

/** Print an error the way an unhandled error is reported. */
function print_error(error: unknown): void {
  console.error(
    `Error: ${error instanceof Error ? error.message : String(error)}`,
  );
}

/** A middleware or an error handler, with the module whose scope creates it. */
type Declared = {
  /** The function, or the class with a `handle` method. */
  value: unknown;
  /** The module in whose scope a class is created. */
  scope: Ctr;
};

/**
 * Assert that a middleware or an error handler can be used: a function, or a
 * class with a `handle` method that the injector can find in the scope it
 * will be created in. Nothing is created.
 *
 * @param injector The injector of the application.
 * @param declared The declared value, and the module whose scope creates a
 *   class.
 * @param what `"Middleware"` or `"Error handler"`, for the message.
 * @throws {Error} When it is a class without a `handle` method, not a
 *   function at all, or a class that is not visible, or ambiguous, in the
 *   module.
 */
function assert_usable(
  injector: Injector,
  { value, scope }: Declared,
  what: string,
): void {
  assert_handle(value, what);
  // A class is created by the injector, later. Whether it can be found is a
  // wiring question, answered by the graph, now.
  if (is_handle_class(value)) {
    const module = injector.graph.modules.get(scope)!;
    if (module.ambiguous.has(value)) {
      throw new Error(
        `${what} class ${describe(value)} is ambiguous in module ${
          describe(scope)
        }: several of its imports export it. Provide it there to choose one.`,
      );
    }
    if (!module.visible.has(value)) {
      throw new Error(
        `${what} class ${describe(value)} is not visible in module ${
          describe(scope)
        }. Provide it there or import a module that exports it.`,
      );
    }
  }
}

/** The pipeline of one command. */
export type CommandPipeline = {
  /**
   * Run the command for one command line. It never rejects: an error is
   * handled, or printed.
   *
   * @param ctx The context of the run.
   * @returns The exit code.
   */
  run(ctx: ChoCommandContext): Promise<number>;
};

/**
 * Build the pipeline of a command.
 *
 * The middlewares and the error handler of the command are checked now: each
 * is a function, or a class with a `handle` method that is visible in the
 * module it will be created in. That is the wiring, and wiring mistakes are
 * reported before anything runs. Instances are created when the command
 * first runs.
 *
 * - The chain: the middlewares of the module that declares the controller, of
 *   the controller, then of the method, then the method itself, whose result
 *   is the exit code (`0` when it is not one).
 * - An error anywhere (creating the controller or a middleware class, a
 *   middleware, the command) goes to the nearest error handler: the
 *   method's, the controller's, the module's, then the application's. Its
 *   result is the exit code (`1` when it is not one).
 * - Without an error handler, the error is printed and the exit code is `1`.
 * - When the error handler fails, or cannot be created, the original error is
 *   printed and the exit code is `2`.
 *
 * @param injector The injector of the application.
 * @param action The controller node and the command method.
 * @param on_error The application's error handler (the `onError` option), if
 *   any.
 * @param log The `cho:command` debug logger.
 * @returns The pipeline.
 * @throws {Error} When a middleware or an error handler is not a function or
 *   a class with a `handle` method, or is a class the injector cannot find
 *   in its module.
 */
export function command_pipeline(
  injector: Injector,
  [node, method]: [ControllerNode, MethodMetadata],
  on_error: unknown,
  log: Debuglog,
): CommandPipeline {
  const owner = node.owner;
  const module = injector.graph.modules.get(owner)!.meta;
  const name = `${describe(node.token)}.${method.name}`;

  const middlewares = [
    ...module.middlewares,
    ...node.meta.middlewares,
    ...method.middlewares,
  ];
  middlewares.forEach((value) =>
    assert_usable(injector, { value, scope: owner }, "Middleware")
  );

  // The nearest error handler: classes of the module tree are created in the
  // controller's module, the application's in the root module.
  const handler: Declared | undefined = [
    { value: method.errorHandler, scope: owner },
    { value: node.meta.errorHandler, scope: owner },
    { value: module.errorHandler, scope: owner },
    { value: on_error, scope: injector.graph.root.ctr },
  ].find(({ value }) => value !== undefined);
  if (handler) {
    assert_usable(injector, handler, "Error handler");
  }

  /** The chain, created with what it needs on the first run. */
  let chain: Promise<(ctx: ChoCommandContext) => Promise<number>> | undefined;
  const build = async () => {
    const controller = await injector.resolve(node.token, owner) as Record<
      string,
      unknown
    >;
    const command = controller[method.name];
    if (typeof command !== "function") {
      throw new TypeError(
        `Method '${method.name}' is not a function on controller '${
          describe(node.token)
        }'.`,
      );
    }
    const fns: ChoCommandMiddlewareFn[] = [];
    for (const value of middlewares) {
      fns.push(await resolve_handle(injector, value, owner));
    }
    return compose<ChoCommandContext, number>(
      fns,
      async (ctx) => exit_code(await command.call(controller, ctx), 0),
      { is: is_exit_code, name: "an exit code", noun: "exit code" },
    );
  };

  return {
    async run(ctx) {
      const done = log.start();
      try {
        const code = exit_code(await (await (chain ??= build()))(ctx), 0);
        done(`${ctx.command} (${name}) exited ${code}`);
        return code;
      } catch (error) {
        log.error(`${ctx.command} failed:`, error);
        if (!handler) {
          print_error(error);
          return 1;
        }
        log(`handled by ${describe(handler.value)}`);
        try {
          const handle = await resolve_handle<ChoCommandErrorHandlerFn>(
            injector,
            handler.value,
            handler.scope,
          );
          return exit_code(await handle(error, ctx), 1);
        } catch (handler_error) {
          log.error("the error handler failed:", handler_error);
          print_error(error);
          return 2;
        }
      }
    },
  };
}
