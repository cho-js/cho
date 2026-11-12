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

import type { Ctr, Injector, MethodMetadata } from "@chojs/core/di";
import {
  compose,
  type Debuglog,
  describe,
  isClass,
  isClassImplement,
} from "@chojs/core/utils";
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
 * class with a `handle` method. Nothing is created.
 *
 * @param value The declared value.
 * @param what `"Middleware"` or `"Error handler"`, for the message.
 * @throws {Error} When it is a class without a `handle` method, or not a
 *   function at all.
 */
function assert_usable(value: unknown, what: string): void {
  if (isClass(value) && !isClassImplement(value, "handle")) {
    throw new Error(
      `${what} class ${describe(value)} must implement 'handle' method.`,
    );
  }
  if (typeof value !== "function") {
    throw new Error(
      `Invalid ${what.toLowerCase()} ${
        describe(value)
      }: must be a function or a class with a 'handle' method.`,
    );
  }
}

/**
 * The function to call for a middleware or an error handler: the function
 * itself, or the `handle` method of an instance the injector creates, bound
 * to it and named after its class (`Auth.handle`).
 *
 * @param injector The injector of the application.
 * @param declared The function or class, and the scope to create a class in.
 * @returns The function to call.
 */
async function callable<F>(
  injector: Injector,
  { value, scope }: Declared,
): Promise<F> {
  if (!isClassImplement<{ handle: F }>(value, "handle")) {
    return value as F;
  }
  const instance = await injector.resolve(value, scope);
  const handle = (instance.handle as (...args: unknown[]) => unknown)
    .bind(instance);
  Object.defineProperty(handle, "name", {
    value: `${describe(value)}.handle`,
  });
  return handle as F;
}

/** The pipeline of one command. */
export type CommandPipeline = {
  /** The middlewares that run around the command, in order, as declared. */
  readonly middlewares: readonly unknown[];
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
 * The middlewares and the error handlers of the command are checked now (a
 * function, or a class with a `handle` method); instances are created when
 * the command first runs.
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
 *   a class with a `handle` method.
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
  middlewares.forEach((mw) => assert_usable(mw, "Middleware"));

  // The nearest error handler: classes of the module tree are created in the
  // controller's module, the application's in the root module.
  const handler: Declared | undefined = [
    { value: method.errorHandler, scope: owner },
    { value: node.meta.errorHandler, scope: owner },
    { value: module.errorHandler, scope: owner },
    { value: on_error, scope: injector.graph.root.ctr },
  ].find(({ value }) => value !== undefined);
  if (handler) {
    assert_usable(handler.value, "Error handler");
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
      fns.push(await callable(injector, { value, scope: owner }));
    }
    return compose<ChoCommandContext, number>(
      fns,
      async (ctx) => exit_code(await command.call(controller, ctx), 0),
      { is: is_exit_code, name: "an exit code", noun: "exit code" },
    );
  };

  return {
    middlewares,
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
          const handle = await callable<ChoCommandErrorHandlerFn>(
            injector,
            handler,
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
