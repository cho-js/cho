import type {
    CompiledGateway,
    CompiledMethod,
    CompiledModule,
} from "@chojs/core/application";
import type { Target } from "@chojs/core/meta";
import { debuglog } from "@chojs/core/utils";

/**
 * A linked command with its middlewares and handler.
 */
export type LinkedCommand = {
    middlewares: Target[];
    handle: Target;
    errorHandler?: Target;
    compiled: CompiledMethod;
};

/**
 * A linked application instance with its commands.
 */
export type LinkedMainApp = {
    main: LinkedCommand;
    compiled?: CompiledGateway;
    errorHandler?: Target;
};

/**
 * A linked application instance with its commands.
 */
export type LinkedCommandsApp = {
    commands: Record<string, LinkedCommand>;
    compiled?: CompiledGateway;
    errorHandler?: Target;
};

/**
 * A linked application instance, either with a main command or multiple sub-commands.
 */
export type LinkedApp =
    | LinkedMainApp
    | LinkedCommandsApp;

const log = debuglog("cli:linker");

/**
 * Linker
 * Link a compiled module to an application instance.
 */
export class Linker {
    isMain = false;
    containSubs = false;

    /**
     * Link a compiled module to an application instance.
     * @param cm
     */
    link(cm: CompiledModule): LinkedApp {
        const end = log.start();
        this.isMain = false;
        this.containSubs = false;
        const linked = this.apply(cm, { commands: {} });
        end("module linked");
        return linked;
    }

    protected apply(cm: CompiledModule, app: LinkedApp): LinkedApp {
        const moduleMiddlewares = cm.middlewares ?? [];

        app.errorHandler = cm.errorHandler;

        for (const cc of cm.controllers) {
            const controllerMiddlewares = cc.middlewares ?? [];

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

                // all middlewares for this endpoint
                const middlewares = [
                    ...moduleMiddlewares,
                    ...controllerMiddlewares,
                    ...(endpoint.middlewares ?? []),
                ];

                // error handler for this endpoint
                const errorHandler = endpoint.errorHandler ?? cc.errorHandler ??
                    cm.errorHandler;

                // attach controller to method for later instantiation
                log(`mount command: ${command}`);
                const cmd: LinkedCommand = {
                    middlewares,
                    handle: endpoint.handle as Target,
                    errorHandler,
                    compiled: endpoint,
                };

                if (command === "main") {
                    this.isMain = true;
                    (app as LinkedMainApp).main = cmd;
                } else {
                    this.containSubs = true;
                    (app as LinkedCommandsApp).commands[command] = cmd;
                }
                app.compiled = cc;
            }
        }

        // attach imported modules
        for (const im of cm.imports) {
            app = this.apply(im, app);
        }

        return app;
    }
}
