import {
  AppRef,
  type ChoErrorHandlerFn,
  type ChoMiddlewareFn,
  InitiatedModule,
  type Target,
} from "@chojs/core/internals";

/**
 * Command context
 * Minimist args API
 */
export type ChoArgs = {
  _: string[];
  [key: string]: boolean | string | number | string[] | undefined;
};

/**
 * Command context
 * Provide access to args and other context data
 * todo complete implementation
 */
export class ChoCommandContext {
  readonly args: string[];
  readonly properties: Record<
    string,
    boolean | string | number | string[] | undefined
  >;

  constructor(readonly raw: ChoArgs) {
    const { _, ...props } = raw;
    this.args = _;
    this.properties = props;
  }
}

function containMain(node: InitiatedModule): boolean {
  for (const ctr of node.ctrls()) {
    for (const method of ctr.methods) {
      const meta = method.meta as { command?: string };
      if (meta && meta.command && meta.command === "main") {
        return true;
      }
    }
  }
  for (const im of node.imports) {
    if (containMain(im)) {
      return true;
    }
  }
  return false;
}

function containSubs(node: InitiatedModule): boolean {
  for (const ctr of node.ctrls()) {
    for (const method of ctr.methods) {
      const meta = method.meta as { command?: string };
      if (meta && meta.command && meta.command !== "main") {
        return true;
      }
    }
  }
  for (const im of node.imports) {
    if (containSubs(im)) {
      return true;
    }
  }
  return false;
}

/**
 * Asynchronous chained middleware executor with final handler
 * and error handling support
 *
 * @param handler
 * @param middlewares
 * @param errorHandler
 */
function linkHandler(
  handler: Target, // todo replace with endpoint type
  middlewares: ChoMiddlewareFn[],
  errorHandler?: ChoErrorHandlerFn,
) {
  return async function (args: ChoArgs) {
    const ctx = new ChoCommandContext(args);
    try {
      for (const fn of middlewares) {
        const { promise, resolve } = Promise.withResolvers();
        fn(ctx, resolve);
        await promise;
      }
      await handler(ctx);
    } catch (err) {
      if (errorHandler) {
        errorHandler(err as Error, ctx);
      } else {
        throw err;
      }
    }
  };
}

export type AppMethod = {
  name: string;
  handle: Target;
  help?: string;
};

export class LinkedMethod {
  constructor(
    readonly name: string,
    readonly handle: Target,
    readonly help?: string,
  ) {
  }
}

export class LinkedMainApp {
  constructor(
    readonly main: LinkedMethod,
    readonly help: string,
  ) {
  }
}

export class LinkedCommandsApp {
  constructor(
    readonly commands: Record<string, LinkedMethod>,
    readonly help?: string[],
  ) {
  }
}

export function linker(app: AppRef): LinkedMainApp | LinkedCommandsApp {
  const hasMain = containMain(app.initiated);
  const hasSubs = containSubs(app.initiated);

  if (hasMain && hasSubs) {
    throw new Error(
      "Cannot mix 'main' command with sub-commands in the same application",
    );
  }
  if (!hasMain && !hasSubs) {
    throw new Error("No commands found in the application");
  }

  // link main application
  if (hasMain) {
    // todo create safer way to get ctr and main method
    const ctr = app.initiated.controllers[0];
    const method = ctr.methods[0];

    return new LinkedMainApp(
      new LinkedMethod(
        "main",
        linkHandler(
          method.handle,
          method.middlewares,
          method.errorHandler ?? ctr.errorHandler,
        ),
        (method.meta as { help?: string }).help,
      ),
      (ctr.meta as { help?: string }).help ?? "",
    );
  }

  // link commands application

  const methods: Record<string, AppMethod> = {};
  const helps: string[] = [];

  // collect all commands from all controllers
  for (const ctr of app.initiated.ctrls()) {
    for (const method of ctr.methods) {
      if (!("command" in method.meta)) {
        continue;
      }

      const command = method.meta.command as string;

      if (command in methods) {
        throw new Error(`Duplicate command '${command}' found`);
      }

      methods[command] = new LinkedMethod(
        command,
        linkHandler(
          method.handle,
          [
            ...ctr.middlewares,
            ...method.middlewares,
          ],
          method.errorHandler ?? ctr.errorHandler,
        ),
        (method.meta as { help?: string }).help,
      );
    }

    const help = (ctr.meta as { help?: string }).help;
    if (help) {
      helps.push(help);
    }
  }
  return new LinkedCommandsApp(
    methods,
    helps,
  );
}
