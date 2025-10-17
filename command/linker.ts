import type { CompiledModule } from "@chojs/core/application";
import type { Target } from "@chojs/core/meta";
import type { ChoErrorHandlerFn, ChoMiddlewareFn } from "@chojs/core/di";
import { debuglog } from "@chojs/core/utils";
import { ChoCommandContext } from "./context.ts";

/**
 * A linked application instance base, with common properties.
 */
export type LinkedAppBase = {
  help: Record<string | symbol, string>;
  compiled: CompiledModule;
  errorHandler?: Target;
};

/**
 * A linked application instance with its commands.
 */
export type LinkedMainApp = LinkedAppBase & {
  main: Target;
};

/**
 * A linked application instance with its commands.
 */
export type LinkedCommandsApp = LinkedAppBase & {
  commands: Record<string, Target>;
};

/**
 * A linked application instance, either with a main command or multiple sub-commands.
 */
export type LinkedApp =
  | LinkedMainApp
  | LinkedCommandsApp;

const log = debuglog("cli:linker");
export const HelpKey = Symbol("global help key");

function linkHandler(
  handler: Target, // todo replace with endpoint type
  middlewares: ChoMiddlewareFn[],
  errorHandler?: ChoErrorHandlerFn,
) {
  return async function (ctx: ChoCommandContext) {
    let i = 0;

    /**
     * Middlewares runner
     * @param e Error to handle
     */
    async function next(e?: unknown) {
      if (e) {
        if (errorHandler) {
          await errorHandler(e as Error, ctx);
          return;
        }
        throw e;
      }

      if (i < middlewares.length) {
        const mw = middlewares[i++];
        try {
          await mw(ctx, next);
        } catch (err) {
          await next(err);
        }
      } else {
        // all middlewares done
        try {
          await handler(ctx);
        } catch (err) {
          await next(err);
        }
      }
    }
    await next();
  };
}
/**
 * Linker
 * Link a compiled module to an application instance.
 *
 * Collects all commands from the compiled module and its imported modules,
 * into a single application instance.
 */
export class Linker {
  protected isMain = false;
  protected containSubs = false;

  /**
   * Link a compiled module to an application instance.
   * @param cm
   */
  link(cm: CompiledModule): LinkedApp {
    const end = log.start();
    this.isMain = false;
    this.containSubs = false;
    const linked = this.apply(cm, {
      commands: {},
      help: {},
      compiled: cm, // reference to the root compiled module
      errorHandler: cm.errorHandler, // global error handler if any
    });
    end("module linked");
    return linked;
  }

  /**
   * Link a compiled module to an application instance.
   * @param cm
   * @param app
   * @protected
   */
  protected apply(cm: CompiledModule, app: LinkedApp): LinkedApp {
    // collect middlewares. module -> gateway (controller) -> action (method)
    const moduleMiddlewares = cm.middlewares ?? [];

    // iterate over all controllers if there are any
    for (const cc of cm.controllers) {
      // todo what to do in case of multiple controllers with help? Should we concatenate them?
      const controllerMeta = cc.meta as typeof cc.meta & { help?: string };
      if (controllerMeta.help && !app.help[HelpKey]) {
        app.help[HelpKey] = controllerMeta.help;
      }

      const gatewayMiddlewares = cc.middlewares ?? [];

      // iterate over all endpoints
      for (const endpoint of cc.methods) {
        // this method is not a command
        if (!("command" in endpoint.meta)) {
          continue;
        }

        const command = endpoint.meta.command as string;

        // command already exists
        if ((app as LinkedCommandsApp).commands[command]) {
          throw new Error(
            `Command "${command}" already exists`,
          );
        }

        if (command === "main" && this.containSubs) {
          throw new Error(
            "Cannot have 'main' command when subcommands exist",
          );
        }

        if (command !== "main" && this.isMain) {
          throw new Error(
            "Cannot have subcommands when 'main' command exists",
          );
        }

        const handler = linkHandler(
          endpoint.handle as Target,
          // all middlewares for this endpoint
          [
            ...moduleMiddlewares,
            ...gatewayMiddlewares,
            ...(endpoint.middlewares ?? []),
          ],
          // error handler for this endpoint if any
          endpoint.errorHandler ?? cc.errorHandler ?? cm.errorHandler,
        );

        log(`mount command: ${command}`);
        // specific help for this command if any
        const endpointMeta = endpoint.meta as typeof endpoint.meta & {
          help?: string;
        };
        app.help[command] = endpointMeta.help ?? "";
        if (command === "main") {
          this.isMain = true;
          (app as LinkedMainApp).main = handler;
        } else {
          this.containSubs = true;
          (app as LinkedCommandsApp).commands[command] = handler;
        }
      }
    }

    // attach imported modules
    for (const im of cm.imports) {
      app = this.apply(im, app);
    }

    return app;
  }
}
