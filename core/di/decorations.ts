/**
 * What the DI decorators do: validate their options and write the class
 * records.
 *
 * `@Injectable`, `@Module` and `@Controller` (see `decorators.ts`) only find
 * where to write (the class, or `context.metadata` with TC39 decorators) and
 * call the functions of this module:
 *
 * | Decorator     | Calls                                               |
 * | ------------- | --------------------------------------------------- |
 * | `@Injectable` | {@link set_injectable}                              |
 * | `@Module`     | {@link set_injectable}, then {@link set_module}     |
 * | `@Controller` | {@link set_injectable}, then {@link set_controller} |
 *
 * `@Middlewares` and `@Catch` call {@link set_middlewares} and
 * {@link set_error_handler}, on a class or a method.
 *
 * `set_injectable` comes first because it is the one that rejects a class
 * that already has a DI decorator. `set_module` and `set_controller` add
 * their fields to the record it wrote (see `add_to_metadata_object`).
 *
 * ## Record keys
 *
 * Everything these functions write is stored under the private symbol keys
 * of `keys.ts`. The extra options a CHO module accepts on `@Module` and
 * `@Controller` (such as `route`, see {@link ExtraOptions}) are stored next
 * to them as plain string keys, as given. An option can therefore never
 * overwrite what the DI system wrote, whatever its name:
 * `{ isModule: true }` would just be an extra option.
 *
 * ## What is validated here
 *
 * Only the shape of the options, so that a mistake fails at the decorator
 * that made it, with a message naming the bad value:
 *
 * - every list option is an array;
 * - dependencies and exports are tokens (classes, symbols or injection
 *   tokens);
 * - imports and controllers are classes;
 * - providers are classes or well-formed provider objects.
 *
 * Whatever needs other classes' records is checked later, when an `Injector`
 * reads the graph (`metadata-graph.ts`, `dependency-graph.ts`): that an
 * import is a `@Module`, that a provider class is `@Injectable`, that a
 * controller is a `@Controller`, that every dependency can be resolved, and
 * so on.
 *
 * Every function validates all of its options before writing anything, so a
 * failed call leaves the record as it was. `@Module` is two calls
 * (`set_injectable`, then `set_module`), so it validates the module options
 * first, with {@link assert_module_options}: a `@Module` that throws leaves
 * the class undecorated.
 *
 * @module
 */

import {
  add_to_metadata_object,
  type MetaTarget,
  method_metadata,
  read_metadata_object,
  write_metadata_object,
} from "./metadata.ts";
import {
  CONTROLLER,
  CONTROLLERS,
  DEPENDENCIES,
  ERROR_HANDLER,
  EXPORTS,
  type HandlersRecord,
  IMPORTS,
  INJECTABLE,
  type InjectableRecord,
  MIDDLEWARES,
  MODULE,
  type ModuleRecord,
  PROVIDERS,
} from "./keys.ts";
import type {
  ChoClassOrMethodDecorator,
  ChoErrorHandler,
  ChoMethodDecorator,
  ChoMiddleware,
  Ctr,
  Dependency,
  Provider,
  Token,
} from "./types.ts";
import { isToken } from "./tokens.ts";
import { describe } from "../utils/describe.ts";

/** Options shared by every DI decorator. */
export type InjectableOptions = {
  /** Dependencies passed to the class constructor, in argument order. */
  dependencies: Dependency[];
};

/**
 * Options of `@Module`. Every field is optional; the lists default to `[]`.
 *
 * The type is closed: a key that is not listed is a compile error, so a typo
 * (`provider` for `providers`) cannot pass as an option. A CHO module that
 * reads options of its own (the route prefix of a web feature) declares them
 * with the type parameter of `@Module`, and exports a decorator typed with it
 * (see {@link ExtraOptions}).
 *
 * @example
 * ```ts
 * const options: Partial<ModuleOptions> = {
 *   imports: [DbModule],
 *   providers: [UserService],
 *   controllers: [UsersController],
 *   exports: [UserService],
 * };
 *
 * @Module(options)
 * class UsersModule {}
 * ```
 */
export type ModuleOptions = InjectableOptions & {
  /** Modules whose exported tokens this module can inject. */
  imports: Ctr[];
  /**
   * What this module declares: `@Injectable` classes, and provider objects
   * (see `provider()`).
   */
  providers: (Provider | Ctr)[];
  /** `@Controller` classes this module declares. */
  controllers: Ctr[];
  /**
   * Tokens that modules importing this module can inject. Each token must be
   * declared by this module or exported by one of its imports.
   */
  exports: Token[];
};

/**
 * Options of `@Controller`: its `dependencies`.
 *
 * The type is closed, like {@link ModuleOptions}: a CHO module that reads
 * options of its own (the route of a web controller) declares them with the
 * type parameter of `@Controller`.
 *
 * @example
 * ```ts
 * @Controller({ dependencies: [UserService] })
 * class UsersController {
 *   constructor(readonly users: UserService) {}
 * }
 * ```
 */
export type ControllerOptions = InjectableOptions;

/**
 * The options a CHO module adds to `@Module` or `@Controller`: the type
 * parameter of both decorators. They are stored as is in the class's record,
 * and the metadata graph hands them back as `options`.
 *
 * The default, no extra option, is what makes the option types closed.
 *
 * @example A CHO module's own `@Controller`
 * ```ts
 * type WebOptions = { route?: string };
 *
 * export function Controller(
 *   options: Partial<ControllerOptions> & WebOptions = {},
 * ): ChoClassDecorator {
 *   assert_known_options("@Controller()", options, ["dependencies", "route"]);
 *   return CoreController<WebOptions>(options);
 * }
 * ```
 */
export type ExtraOptions = Record<string, unknown>;

/** No extra option: the default of `@Module` and `@Controller`. */
export type NoExtraOptions = Record<never, never>;

/**
 * Assert that an options object only has known keys.
 *
 * The closed option types catch a misspelled option when the code is
 * type-checked. This is the same check at runtime, for the decorators of CHO
 * modules, which know every option they accept: plain JavaScript, or a cast,
 * would otherwise let `{ deps: [...] }` through as an option nobody reads.
 *
 * @param decorator The decorator's name, for the error message
 *   (`"@Controller()"`).
 * @param options The options given to the decorator.
 * @param known The keys the decorator accepts.
 * @throws {Error} On the first unknown key, e.g.
 *   `@Controller(): unknown option "deps". Known options: dependencies, route`.
 */
export function assert_known_options(
  decorator: string,
  options: object,
  known: readonly string[],
): void {
  for (const key of Object.keys(options)) {
    if (!known.includes(key)) {
      throw new Error(
        `${decorator}: unknown option ${JSON.stringify(key)}. Known options: ${
          known.join(", ")
        }`,
      );
    }
  }
}

// Validation helpers
// -----------------------------------------------------------------------------

/**
 * Throw if the target already has a DI decorator.
 *
 * Every DI record has the `INJECTABLE` flag, so this catches `@Injectable`,
 * `@Module` and `@Controller` alike. Only the target's own record counts: a subclass of
 * a decorated class can be decorated.
 *
 * @param target The class, or its decorator metadata object.
 * @throws {Error} When the target is already decorated with `@Injectable`,
 *   `@Module` or `@Controller`.
 */
function assert_decorated(target: MetaTarget): void {
  if (read_metadata_object<Partial<InjectableRecord>>(target)?.[INJECTABLE]) {
    throw new Error(
      `class is already decorated with @Injectable, @Module or @Controller`,
    );
  }
}

/** How many keys `describe_value` lists before eliding the rest. */
const MAX_DESCRIBED_KEYS = 5;

/**
 * Readable description of any value a user passed to a decorator, for error
 * messages. It never throws.
 *
 * Plain objects are not converted with `String()`: that gives the useless
 * `[object Object]`, and throws on an object without a prototype or with a
 * throwing `toString`, which would hide the validation error being reported.
 *
 * - an injection token uses its own description: `InjectionToken(URL)`;
 * - an array is shown by its length: `array(2)`;
 * - any other object is shown by its own keys: `{ provide, factory }`, `{}`;
 * - any other value goes through `describe()` (strings quoted): `"Db"`,
 *   `null`, `Symbol(key)`, a class name.
 *
 * @param value The value, of any type.
 * @returns The description.
 */
function describe_value(value: unknown): string {
  if (typeof value !== "object" || value === null || isToken(value)) {
    return describe(value);
  }
  if (Array.isArray(value)) {
    return `array(${value.length})`;
  }
  const keys = Object.keys(value);
  if (keys.length === 0) {
    return "{}";
  }
  const shown = keys.slice(0, MAX_DESCRIBED_KEYS);
  if (keys.length > MAX_DESCRIBED_KEYS) {
    shown.push("...");
  }
  return `{ ${shown.join(", ")} }`;
}

/**
 * Assert that an option is an array. Without this check, a value such as
 * `@Injectable(Logger)` (instead of `[Logger]`) fails with an unhelpful
 * `forEach is not a function`.
 *
 * @param name The option name, for the message.
 * @param value The option value.
 * @throws {Error} When the value is not an array.
 */
function assert_array(
  name: string,
  value: unknown,
): asserts value is unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${name} must be an array, got ${describe_value(value)}`);
  }
}

/**
 * Make an assertion that a value is a token: a class (or any function), a
 * symbol, or an injection token (see `isToken`).
 *
 * The assertion is curried so it can be passed to `forEach` with a message
 * that names the option being checked.
 *
 * @param msg The start of the error message. The bad value is appended as
 *   `<msg>: <value>`.
 * @returns The assertion.
 *
 * @example
 * ```ts
 * deps.forEach(assert_dependency("all deps must be tokens"));
 * // throws: all deps must be tokens: "Logger"
 * ```
 */
function assert_dependency(msg: string) {
  return function (token: unknown): asserts token is Token {
    if (!isToken(token)) {
      throw new Error(`${msg}: ${describe_value(token)}`);
    }
  };
}

/**
 * Make an assertion that a value is a class (any function).
 *
 * Only the type is checked: whether the class has the expected DI decorator
 * is checked later, when the graph is read.
 *
 * @param msg The start of the error message. The bad value is appended as
 *   `<msg>: <value>`.
 * @returns The assertion, to pass to `forEach`.
 */
function assert_ctr(msg: string) {
  return function (ctr: unknown): asserts ctr is Ctr {
    if (typeof ctr !== "function") {
      throw new Error(`${msg}: ${describe_value(ctr)}`);
    }
  };
}

/**
 * Make an assertion that a value is a function (a class included).
 *
 * @param msg The start of the error message. The bad value is appended as
 *   `<msg>: <value>`.
 * @returns The assertion, to pass to `forEach`.
 */
function assert_function(msg: string) {
  // deno-lint-ignore ban-types
  return function (fn: unknown): asserts fn is Function {
    if (typeof fn !== "function") {
      throw new Error(`${msg}: ${describe_value(fn)}`);
    }
  };
}

/**
 * Readable name of a `providers` entry, for error messages: an object with a
 * valid `provide` token is named by its token (`for InjectionToken(URL)`),
 * anything else by {@link describe_value}.
 *
 * @param provider The entry, of any type.
 * @returns The description, without the leading `provider`.
 */
function describe_provider(provider: unknown): string {
  if (
    typeof provider === "object" && provider !== null &&
    "provide" in provider && isToken(provider.provide)
  ) {
    return `for ${describe(provider.provide)}`;
  }
  return describe_value(provider);
}

/**
 * Assert that a `providers` entry is a class or a well-formed provider object.
 *
 * A class is accepted as is: that it is `@Injectable` is checked when the
 * graph is read. An object must have:
 *
 * - `provide`: a token;
 * - `factory`: a function;
 * - `deps` (optional, missing or `undefined` means `[]`): an array of tokens.
 *
 * The checks run in that order, and the first one that fails throws. Once
 * `provide` is valid, messages name the provider by its token.
 *
 * @param provider The entry, of any type.
 * @throws {Error} When the entry is neither a class nor a well-formed
 *   provider object, for example:
 *   `provider for InjectionToken(URL): "factory" must be a function, got 1`.
 */
function assert_provider(provider: unknown): asserts provider is Provider {
  if (typeof provider === "function") {
    return;
  }

  const name = `provider ${describe_provider(provider)}`;

  if (typeof provider !== "object" || provider === null) {
    throw new Error(`${name} is not an object`);
  }
  if (!("provide" in provider)) {
    throw new Error(`${name} is missing the "provide" property`);
  }
  if (!isToken(provider.provide)) {
    throw new Error(
      `${name}: "provide" must be a class, symbol or injection token, got ${
        describe_value(provider.provide)
      }`,
    );
  }
  if (!("factory" in provider)) {
    throw new Error(`${name} is missing the "factory" property`);
  }
  if (typeof provider.factory !== "function") {
    throw new Error(
      `${name}: "factory" must be a function, got ${
        describe_value(provider.factory)
      }`,
    );
  }
  const deps = ("deps" in provider ? provider.deps : undefined) ?? [];
  if (!Array.isArray(deps)) {
    throw new Error(
      `${name}: "deps" must be an array, got ${describe_value(deps)}`,
    );
  }
  deps.forEach(
    assert_dependency(
      `${name}: all deps must be classes, symbols or injection tokens`,
    ),
  );
}

// Record writers
// -----------------------------------------------------------------------------

/**
 * Mark a target as injectable: what `@Injectable` does, and the first step of
 * `@Module` and `@Controller`.
 *
 * Writes the `INJECTABLE` flag and the `DEPENDENCIES` to the target's record
 * (see `InjectableRecord` in `keys.ts`).
 *
 * @param target The class, or its decorator metadata object
 *   (`context.metadata` with TC39 decorators).
 * @param options The constructor's dependencies, in argument order.
 * @throws {Error} When the target already has a DI decorator. This is checked
 *   first, before the dependencies.
 * @throws {Error} When `dependencies` is not an array, or a dependency is not
 *   a class, symbol or injection token.
 *   Nothing is written.
 *
 * @example
 * ```ts
 * set_injectable(Server, { dependencies: [Logger, PORT] });
 * read_metadata_object(Server);
 * // { [INJECTABLE]: true, [DEPENDENCIES]: [Logger, PORT] }
 * ```
 *
 * @internal
 */
export function set_injectable(
  target: MetaTarget,
  options: InjectableOptions,
): void {
  assert_decorated(target);
  assert_array("dependencies", options.dependencies);
  options.dependencies.forEach(
    assert_dependency(
      "all dependencies must be classes, symbols or injection tokens",
    ),
  );

  add_to_metadata_object(
    target,
    {
      [INJECTABLE]: true,
      [DEPENDENCIES]: options.dependencies,
    } satisfies InjectableRecord,
  );
}

/**
 * Split the options of `@Module` into the lists the DI system uses (each
 * defaulting to `[]`) and the extra options, and validate the lists.
 *
 * @param options The module's options.
 * @returns The lists and the extra options.
 * @throws {Error} When a list is not an array, or holds an invalid entry (see
 *   {@link set_module}).
 */
function module_options(options: Partial<ModuleOptions> & ExtraOptions) {
  // The options the DI system uses; everything else is an extra option.
  const {
    dependencies: _,
    imports,
    exports,
    providers,
    controllers,
    ...extra
  } = options;
  const norm = {
    imports: imports ?? [],
    exports: exports ?? [],
    providers: providers ?? [],
    controllers: controllers ?? [],
  };

  assert_array("imports", norm.imports);
  assert_array("controllers", norm.controllers);
  assert_array("exports", norm.exports);
  assert_array("providers", norm.providers);
  norm.imports.forEach(assert_ctr("all imports must be classes"));
  norm.controllers.forEach(assert_ctr("all controllers must be classes"));
  norm.exports.forEach(
    assert_dependency(
      "all exports must be classes, symbols or injection tokens",
    ),
  );
  norm.providers.forEach(assert_provider);
  return { norm, extra };
}

/**
 * Assert that the module options of `@Module` are valid, without writing
 * anything. `@Module` calls it before `set_injectable`, so a bad option
 * leaves the class undecorated.
 *
 * @param options The module's options.
 * @throws {Error} When a list is not an array, or holds an invalid entry (see
 *   {@link set_module}).
 *
 * @internal
 */
export function assert_module_options(
  options: Partial<ModuleOptions> & ExtraOptions,
): void {
  module_options(options);
}

/**
 * Add the module fields to a target's record: the second step of `@Module`,
 * after {@link set_injectable}.
 *
 * Writes the `MODULE` flag and the `IMPORTS`, `EXPORTS`, `PROVIDERS` and
 * `CONTROLLERS` lists, each defaulting to `[]` (see `ModuleRecord` in
 * `keys.ts`), plus every other option, as is, under its own string key. Those
 * extra options are metadata for the application module (such as a web route
 * prefix); the DI system ignores them. Values are stored by reference, except
 * top-level arrays, which are copied.
 *
 * It does not write the `dependencies` option: that is `set_injectable`'s
 * job.
 *
 * It does not check for an existing DI decorator either. Calling it twice on
 * the same target concatenates the lists; `@Module` never does, since its
 * `set_injectable` call throws first.
 *
 * Only the shape of each list is validated (see the module documentation);
 * the rest is checked when the graph is read.
 *
 * @param target The class, or its decorator metadata object.
 * @param options The module's options. Every field is optional.
 * @throws {Error} When `imports`, `controllers`, `exports` or `providers` is
 *   not an array.
 * @throws {Error} When an import or a controller is not a class.
 * @throws {Error} When an export is not a class, symbol or injection token.
 * @throws {Error} When a provider is neither a class nor a well-formed
 *   provider object (see `assert_provider`).
 *
 * Nothing is written when any of these throws.
 *
 * @example
 * ```ts
 * set_injectable(App, { dependencies: [] });
 * set_module(App, { imports: [DbModule], providers: [UserService], route: "users" });
 * read_metadata_object(App);
 * // { [INJECTABLE]: true, [DEPENDENCIES]: [], route: "users", [MODULE]: true,
 * //   [IMPORTS]: [DbModule], [EXPORTS]: [], [PROVIDERS]: [UserService],
 * //   [CONTROLLERS]: [] }
 * ```
 *
 * @internal
 */
export function set_module(
  target: MetaTarget,
  options: Partial<ModuleOptions> & ExtraOptions,
): void {
  const { norm, extra } = module_options(options);

  add_to_metadata_object(
    target,
    {
      ...extra,
      [MODULE]: true,
      [IMPORTS]: norm.imports,
      [EXPORTS]: norm.exports,
      [PROVIDERS]: norm.providers,
      [CONTROLLERS]: norm.controllers,
    } satisfies Omit<ModuleRecord, keyof InjectableRecord>,
  );
}

/**
 * Add the controller fields to a target's record: the second step of
 * `@Controller`, after {@link set_injectable}.
 *
 * Writes the `CONTROLLER` flag (see `ControllerRecord` in `keys.ts`) and
 * every option except `dependencies`, as is, under its own string key. Those
 * extra options are metadata for the application module that invokes the
 * controller, such as a CLI command's name; the DI system ignores them.
 * Values are stored by reference, except top-level arrays, which are copied.
 *
 * `dependencies` is skipped: `set_injectable` already wrote it.
 *
 * Nothing is validated, and an existing DI decorator is not checked for:
 * `@Controller` relies on its `set_injectable` call for both.
 *
 * @param target The class, or its decorator metadata object.
 * @param options The controller's options.
 *
 * @example
 * ```ts
 * set_injectable(Cli, { dependencies: [Logger] });
 * set_controller(Cli, { dependencies: [Logger], name: "cli" });
 * read_metadata_object(Cli);
 * // { [INJECTABLE]: true, [DEPENDENCIES]: [Logger], [CONTROLLER]: true,
 * //   name: "cli" }
 * ```
 *
 * @internal
 */
export function set_controller(
  target: MetaTarget,
  options: Partial<ControllerOptions> & ExtraOptions,
): void {
  const { dependencies: _, ...extra } = options;
  add_to_metadata_object(target, { ...extra, [CONTROLLER]: true });
}

// Decorator call shapes
// -----------------------------------------------------------------------------
//
// Helpers for decorators written for both decorator implementations, such as
// the `@Main`, `@Action` and `@Help` decorators of `@chojs/command`. They find,
// from the decorator's arguments, where its record must be written.

/**
 * A decorated method: where its record is stored, the method, its name, and
 * whether it is static or private.
 */
export type DecoratedMethod = {
  /**
   * Where the method's record is stored: the target to give to
   * `add_to_metadata_object` and `read_metadata_object`.
   *
   * It is the method's own metadata object, kept with its class by method
   * name (see `method_metadata`), so the record survives a decorator that
   * replaces the function, and is found for a subclass that inherits the
   * method. When the class cannot be reached from the decorator's arguments
   * (a static or private method, or TC39 decorators compiled for a runtime
   * without `Symbol.metadata`), it is the method function itself.
   */
  meta: MetaTarget;
  /** The method function. */
  // deno-lint-ignore ban-types
  fn: Function;
  /** The method name. A private method's name includes the `#`. */
  name: string | symbol;
  /** Whether the method is static. */
  static: boolean;
  /**
   * Whether the method is private (`#name`). Legacy / Bun decorators cannot
   * decorate private methods, so it is always `false` for them.
   */
  private: boolean;
};

/**
 * Find the decorated method from the arguments of a
 * {@link ChoMethodDecorator}.
 *
 * - TC39: `target` is the method and `context.kind` is `"method"`;
 *   `context.static` and `context.private` tell the method's kind;
 * - legacy / Bun: `target` is the prototype (or, for a static method, the
 *   class), `context` is the method name and the method is
 *   `descriptor.value`.
 *
 * @param decorator The decorator's name, for the error message (`"@Main()"`).
 * @param target The decorator's first argument.
 * @param context The decorator's second argument.
 * @param descriptor The decorator's third argument (legacy / Bun only).
 * @returns Where to write the method's record, the method function, its
 *   name, and whether it is static or private.
 * @throws {TypeError} When the decorated member is not a method (a field, an
 *   accessor, a class).
 *
 * @example
 * ```ts
 * function Command(name: string): ChoMethodDecorator {
 *   return (target, context, descriptor) => {
 *     const method = decorated_method("@Command()", target, context, descriptor);
 *     add_to_metadata_object(method.meta, { command: name });
 *   };
 * }
 * ```
 */
export function decorated_method(
  decorator: string,
  ...[target, context, descriptor]: Parameters<ChoMethodDecorator>
): DecoratedMethod {
  if (typeof context === "object") {
    if (context.kind === "method" && typeof target === "function") {
      const is_static = Boolean(context.static);
      const is_private = Boolean(context.private);
      return {
        // `context.metadata` is the metadata object of the class
        meta: context.metadata && !is_static && !is_private
          ? method_metadata(context.metadata, context.name)
          : target,
        fn: target,
        name: context.name,
        static: is_static,
        private: is_private,
      };
    }
  } else if (typeof descriptor?.value === "function") {
    // `target` is the prototype, or the class for a static method
    const is_static = typeof target === "function";
    const ctr: unknown = is_static ? undefined : target.constructor;
    return {
      meta: typeof ctr === "function"
        ? method_metadata(ctr, context)
        : descriptor.value,
      fn: descriptor.value,
      name: context,
      static: is_static,
      private: false,
    };
  }
  throw new TypeError(`${decorator} can only decorate a method`);
}

/**
 * Find where a {@link ChoClassOrMethodDecorator} writes its record:
 *
 * - on a class with TC39 decorators: `context.metadata`, as the DI decorators
 *   do. The runtime installs it as the class's `Symbol.metadata` after the
 *   class decorators run, replacing anything written onto the class itself;
 * - on a class with TC39 decorators but no `context.metadata` (compiled
 *   decorators on a runtime without `Symbol.metadata`): the class itself, as
 *   the DI decorators do;
 * - on a class with legacy / Bun decorators (no `context`): the class itself;
 * - on a method: the method's metadata object (see {@link decorated_method}).
 *
 * @param decorator The decorator's name, for the error message (`"@Help()"`).
 * @param target The decorator's first argument.
 * @param context The decorator's second argument.
 * @param descriptor The decorator's third argument (legacy / Bun methods only).
 * @returns Where to write the record, for `add_to_metadata_object`.
 * @throws {TypeError} When the decorated member is neither a class nor a
 *   method.
 *
 * @example
 * ```ts
 * function Describe(text: string): ChoClassOrMethodDecorator {
 *   return (target, context, descriptor) => {
 *     const meta = decorated_target("@Describe()", target, context, descriptor);
 *     add_to_metadata_object(meta, { text });
 *   };
 * }
 * ```
 */
export function decorated_target(
  decorator: string,
  ...[target, context, descriptor]: Parameters<ChoClassOrMethodDecorator>
): MetaTarget {
  if (context === undefined) {
    if (typeof target === "function") {
      return target;
    }
  } else if (typeof context === "object" && context.kind === "class") {
    // `context.metadata` is missing when the decorators were compiled for a
    // runtime without `Symbol.metadata` (TypeScript's emit only creates the
    // metadata object when the symbol exists): write to the class instead.
    if (context.metadata) {
      return context.metadata;
    }
    if (typeof target === "function") {
      return target;
    }
  } else {
    return decorated_method(decorator, target, context, descriptor).meta;
  }
  throw new TypeError(`${decorator} can only decorate a class or a method`);
}

// Middlewares and error handlers
// -----------------------------------------------------------------------------
//
// `@Middlewares` and `@Catch` decorate a class or a method (see
// `decorated_target`), and can be combined with the DI decorators. The DI
// system only stores them; the application module that runs the class or
// method uses them.

/**
 * Add middlewares to a target's record: what `@Middlewares` does.
 *
 * Writes the `MIDDLEWARES` list (see `keys.ts`). Middlewares from several calls are kept
 * all, in **source order of the decorators**: decorators are applied bottom
 * up, so each call puts its middlewares *before* the existing ones.
 *
 * ```ts
 * @Middlewares(a, b) // applied second: [a, b, c]
 * @Middlewares(c)    // applied first:  [c]
 * run() {}
 * ```
 *
 * @param target The class, the method, or a decorator metadata object.
 * @param middlewares The middlewares, in the order they run.
 * @throws {Error} When `middlewares` is not an array, or a middleware is not
 *   a function. Nothing is written.
 *
 * @example
 * ```ts
 * set_middlewares(Cli.prototype.run, [auth, timing]);
 * read_metadata_object(Cli.prototype.run); // { [MIDDLEWARES]: [auth, timing] }
 * ```
 */
export function set_middlewares(
  target: MetaTarget,
  middlewares: ChoMiddleware[],
): void {
  assert_array("middlewares", middlewares);
  middlewares.forEach(assert_function("all middlewares must be functions"));

  const record = read_metadata_object<HandlersRecord>(target) ?? {};
  write_metadata_object(target, {
    ...record,
    [MIDDLEWARES]: [...middlewares, ...(record[MIDDLEWARES] ?? [])],
  });
}

/**
 * Set the error handler of a target: what `@Catch` does.
 *
 * Writes the `ERROR_HANDLER` (see `keys.ts`). A target has at most one error
 * handler.
 *
 * @param target The class, the method, or a decorator metadata object.
 * @param errorHandler A function called with the error, or an injectable
 *   class that handles it. Only its type is checked: whether a class is
 *   `@Injectable` is up to the application module that uses it.
 * @throws {Error} When `errorHandler` is not a function or a class.
 * @throws {Error} When the target already has an error handler. Nothing is
 *   written.
 *
 * @example
 * ```ts
 * set_error_handler(Cli.prototype.run, (error) => 2);
 * ```
 */
export function set_error_handler(
  target: MetaTarget,
  errorHandler: ChoErrorHandler,
): void {
  if (typeof errorHandler !== "function") {
    throw new Error(
      `the error handler must be a function or a class: ${
        describe_value(errorHandler)
      }`,
    );
  }
  if (read_metadata_object<HandlersRecord>(target)?.[ERROR_HANDLER]) {
    throw new Error("an error handler is already set (one @Catch per target)");
  }
  add_to_metadata_object(target, { [ERROR_HANDLER]: errorHandler });
}
