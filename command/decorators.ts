/**
 * The command decorators: `@Main` and `@Action` mark the command methods of a
 * controller, `@Help` adds help text to a controller or a method. `@Module`
 * and `@Controller` are the core's decorators; they accept no extra option.
 *
 * They validate their input when the class is defined and write a record on
 * the decorated method (or class), which the command graph reads. The record
 * keys are the private symbols of `keys.ts`.
 *
 * @module
 */

import {
  add_to_metadata_object,
  assert_known_options,
  type ChoClassOrMethodDecorator,
  type ChoInjectableDecorator,
  type ChoMethodDecorator,
  Controller as CoreController,
  type ControllerOptions,
  decorated_method,
  decorated_target,
  type DecoratedMethod,
  type Dependency,
  Module as CoreModule,
  type ModuleOptions,
  type NoExtraOptions,
  read_metadata_object,
  type WithDependencies,
} from "@chojs/core/di";
import { COMMAND_FLAG_KEYS, type CommandFlags, is_reserved } from "./args.ts";
import { ACTION, ALIAS, command_record, FLAGS, HELP, MAIN } from "./keys.ts";

/**
 * Assert that a decorator argument is a non-empty string.
 *
 * @param value The argument.
 * @param name The decorator name, for the message.
 * @throws {TypeError} When it is not a non-empty string.
 */
function assert_non_empty_string(
  value: unknown,
  name: string,
): asserts value is string {
  if (typeof value !== "string" || !value) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

/**
 * Assert that an action name can be typed as a command: a non-empty string,
 * with no whitespace, that does not start with `-` (spec §3.2). A name that
 * breaks these rules could never be invoked, since the command line would
 * split it or parse it as a flag.
 *
 * @throws {TypeError} When the name breaks a rule.
 */
function assert_action_name(alias: unknown): asserts alias is string {
  assert_non_empty_string(alias, "Action");
  if (/\s/.test(alias)) {
    throw new TypeError(
      `@Action(${JSON.stringify(alias)}): the name must not contain whitespace`,
    );
  }
  if (alias.startsWith("-")) {
    throw new TypeError(
      `@Action(${JSON.stringify(alias)}): the name must not start with "-"`,
    );
  }
}

/**
 * Assert that a command method can be called: public, non-static, with a
 * string name (spec §3.5). The metadata graph only collects the own,
 * string-named methods of the prototype, so any other method would be
 * silently dropped.
 *
 * @throws {TypeError} When the method is private, static, or symbol-named.
 */
function assert_command_method(method: DecoratedMethod, adding: string) {
  const name = String(method.name);
  if (typeof method.name !== "string") {
    throw new TypeError(
      `${adding} cannot decorate method ${name}: a command method must have a string name`,
    );
  }
  if (method.private) {
    throw new TypeError(
      `${adding} cannot decorate private method '${name}': a command method must be public`,
    );
  }
  if (method.static) {
    throw new TypeError(
      `${adding} cannot decorate static method '${name}': a command method must not be static`,
    );
  }
}

/**
 * A method has at most one `@Main` or `@Action` (spec §3.2). Both write into
 * the same method record, so a second one would silently overwrite the
 * first one's `alias`.
 */
function assert_no_command(method: DecoratedMethod, adding: string) {
  const prev = command_record(read_metadata_object(method.meta) ?? {});
  if (prev[MAIN] || prev[ACTION]) {
    const existing = prev[MAIN] ? "@Main()" : `@Action("${prev[ALIAS]}")`;
    throw new Error(
      `Cannot add ${adding} to method '${
        String(method.name)
      }': it already has ${existing}. A method can have at most one @Main or @Action.`,
    );
  }
}

/**
 * Assert that the flags a command declares are well formed, so a mistake
 * fails when the class is defined and not when the command runs.
 *
 * @param flags The flags given to `@Main` or `@Action`; `undefined` is none.
 * @param adding The decorator, for the messages.
 * @throws {TypeError} When `flags` is not an object, has an unknown key, a
 *   list that is not an array of non-empty strings, or an `alias`, `default`
 *   or `describe` that is not an object.
 * @throws {Error} When a flag is reserved (`help`, `version`).
 */
function assert_flags(
  flags: unknown,
  adding: string,
): asserts flags is CommandFlags | undefined {
  if (flags === undefined) {
    return;
  }
  if (typeof flags !== "object" || flags === null || Array.isArray(flags)) {
    throw new TypeError(`${adding}: the flags must be an object`);
  }
  assert_known_options(adding, flags, COMMAND_FLAG_KEYS);
  const record = flags as Record<string, unknown>;
  const names: string[] = [];
  for (const key of ["boolean", "string", "collect", "negatable"]) {
    const list = record[key];
    if (list === undefined) {
      continue;
    }
    if (
      !Array.isArray(list) ||
      list.some((name) => typeof name !== "string" || !name)
    ) {
      throw new TypeError(
        `${adding}: "${key}" must be an array of flag names`,
      );
    }
    names.push(...list);
  }
  for (const key of ["alias", "default", "describe"]) {
    const map = record[key];
    if (map === undefined) {
      continue;
    }
    if (typeof map !== "object" || map === null || Array.isArray(map)) {
      throw new TypeError(`${adding}: "${key}" must be an object`);
    }
    names.push(...Object.keys(map));
    if (key === "alias") {
      names.push(...Object.values(map).flat().map(String));
    }
  }
  const reserved = names.find(is_reserved);
  if (reserved) {
    throw new Error(
      `${adding}: the flag "${reserved}" is reserved by the application`,
    );
  }
}

/**
 * Mark a class as a module (see `@Module` of `@chojs/core`).
 *
 * @param options What the module imports, declares and exports.
 * @returns The class decorator.
 * @throws {Error} When an option is unknown or invalid, or when the class
 *   already has a DI decorator.
 *
 * @example
 * ```ts
 * @Module({ providers: [Disk], controllers: [Files] })
 * class App {}
 * ```
 */
export function Module<const D extends readonly Dependency[] = []>(
  options: WithDependencies<Partial<ModuleOptions>, D> = {},
): ChoInjectableDecorator<NoInfer<D>> {
  assert_known_options("@Module()", options, [
    "dependencies",
    "imports",
    "providers",
    "controllers",
    "exports",
  ]);
  return CoreModule<NoExtraOptions, D>(options);
}

/**
 * Mark a class as a controller (see `@Controller` of `@chojs/core`): its
 * methods marked with `@Main` or `@Action` are the commands of the
 * application.
 *
 * @param options The controller's `dependencies`.
 * @returns The class decorator.
 * @throws {Error} When an option is unknown or invalid, or when the class
 *   already has a DI decorator.
 *
 * @example
 * ```ts
 * @Controller({ dependencies: [Disk] })
 * class Files {
 *   constructor(readonly disk: Disk) {}
 * }
 * ```
 */
export function Controller<const D extends readonly Dependency[] = []>(
  options: WithDependencies<Partial<ControllerOptions>, D> = {},
): ChoInjectableDecorator<NoInfer<D>> {
  assert_known_options("@Controller()", options, ["dependencies"]);
  return CoreController<NoExtraOptions, D>(options);
}

/**
 * Mark a method as the single command of the application.
 *
 * The application then runs this method for every command line
 * (`./app [options] [args]`). The whole module graph can have only one `@Main`
 * method, and cannot mix it with `@Action` methods.
 *
 * @param flags The flags the command accepts (see `CommandFlags`): used to
 *   parse the command line, and listed by `--help`. Default: none declared.
 * @returns A method decorator.
 * @throws {TypeError} When the decorated method is not public, non-static and
 *   string-named, or when `flags` is malformed.
 *
 * @example
 * ```ts
 * import { type ChoArgs, ChoCommand, Controller, Main, Module } from "@chojs/command";
 *
 * @Controller()
 * class Greet {
 *   @Main()
 *   main(args: ChoArgs) {
 *     console.log(`Hello, ${args._[0] ?? "world"}!`);
 *   }
 * }
 *
 * @Module({ controllers: [Greet] })
 * class App {}
 *
 * // ./greet Alice -> Hello, Alice!
 * const app = ChoCommand.create(App, { name: "greet" });
 * Deno.exit(await app.run(Deno.args));
 * ```
 */
export function Main(flags?: CommandFlags): ChoMethodDecorator {
  return function (target, context, descriptor) {
    assert_flags(flags, "@Main()");
    const method = decorated_method("@Main()", target, context, descriptor);
    assert_command_method(method, "@Main()");
    assert_no_command(method, "@Main()");
    add_to_metadata_object(method.meta, {
      [MAIN]: true,
      [ALIAS]: "main",
      ...(flags && { [FLAGS]: flags }),
    });
  };
}

/**
 * Mark a method as the command `alias` of a multi-command application.
 *
 * @param alias The command name: non-empty, no whitespace, not starting with
 *   `-`.
 * @param flags The flags the command accepts (see `CommandFlags`): used to
 *   parse the command line when this command runs, and listed by its
 *   `--help`. Default: none declared.
 * @returns A method decorator.
 * @throws {TypeError} When the name breaks these rules, or when the decorated
 *   method is not public, non-static and string-named.
 *
 * @example
 * ```ts
 * import { type ChoArgs, ChoCommand, Controller, Action, Module } from "@chojs/command";
 *
 * @Controller()
 * class Files {
 *   // ./fs copy a.txt b.txt
 *   @Action("copy")
 *   copy(args: ChoArgs) {
 *     const [from, to] = args._;
 *     console.log(`copy ${from} to ${to}`);
 *   }
 *
 *   // ./fs remove a.txt --force
 *   @Action("remove")
 *   remove(args: ChoArgs) {
 *     return args.force ? 0 : 1; // the exit code
 *   }
 * }
 *
 * @Module({ controllers: [Files] })
 * class App {}
 *
 * const app = ChoCommand.create(App, { name: "fs" });
 * Deno.exit(await app.run(Deno.args));
 * ```
 */
export function Action(
  alias: string,
  flags?: CommandFlags,
): ChoMethodDecorator {
  return function (target, context, descriptor) {
    assert_action_name(alias);
    const adding = `@Action(${JSON.stringify(alias)})`;
    assert_flags(flags, adding);
    const method = decorated_method(adding, target, context, descriptor);
    assert_command_method(method, adding);
    assert_no_command(method, adding);
    add_to_metadata_object(method.meta, {
      [ACTION]: true,
      [ALIAS]: alias,
      ...(flags && { [FLAGS]: flags }),
    });
  };
}

/**
 * Help text for a controller class or for a command method, printed by
 * `--help`.
 *
 * On a controller, the text describes the group of commands; on a method, it
 * describes the command.
 *
 * @param help The help text: a non-empty string.
 * @returns A class or method decorator.
 * @throws {TypeError} When `help` is not a non-empty string.
 *
 * @example
 * ```ts
 * import { Action, Controller, Help } from "@chojs/command";
 *
 * @Help("File operations")
 * @Controller()
 * class Files {
 *   @Help("Copy a file: fs copy <from> <to>")
 *   @Action("copy")
 *   copy() {}
 * }
 *
 * // ./fs --help       -> every command, with its help
 * // ./fs copy --help  -> the help of `copy`
 * ```
 */
export function Help(help: string): ChoClassOrMethodDecorator {
  return function (target, context, descriptor) {
    assert_non_empty_string(help, "Help");
    const meta = decorated_target("@Help()", target, context, descriptor);
    add_to_metadata_object(meta, { [HELP]: help });
  };
}
