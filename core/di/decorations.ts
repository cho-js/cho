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
 * ## What is validated here
 *
 * Only the shape of the options, so that a mistake fails at the decorator
 * that made it, with a message naming the bad value:
 *
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
 * failed call leaves the record as it was. A decorator is two calls, though:
 * when `set_module` throws, the record `set_injectable` wrote stays, and the
 * class looks decorated to a later DI decorator.
 *
 * @module
 */

import {
  add_to_metadata_object,
  type InjectableDescriptor,
  type MetaTarget,
  type ModuleDescriptor,
  read_metadata_object,
  write_metadata_object,
} from "./metadata.ts";
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
 * Besides the fields below, any key is accepted and stored as is in the
 * module's record, for the application module (for example the route prefix
 * of a web feature). The DI system ignores those keys.
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
  /** Extra metadata for the application module, stored as is. */
  [key: string]: unknown;
};

/**
 * Options of `@Controller`.
 *
 * Besides `dependencies`, any key is accepted and stored as is in the
 * controller's record, for the application module that invokes the controller
 * (for example the description of a CLI command). The DI system ignores those
 * keys.
 */
export type ControllerOptions = InjectableOptions & {
  /** Extra metadata for the application module, stored as is. */
  [key: string]: unknown;
};

// Validation helpers
// -----------------------------------------------------------------------------

/**
 * Throw if the target already has a DI decorator.
 *
 * Every DI record has `isInjectable`, so this catches `@Injectable`, `@Module`
 * and `@Controller` alike. Only the target's own record counts: a subclass of
 * a decorated class can be decorated.
 *
 * @param target The class, or its decorator metadata object.
 * @throws {Error} When the target is already decorated with `@Injectable`,
 *   `@Module` or `@Controller`.
 */
function assert_decorated(target: MetaTarget): void {
  if (read_metadata_object<InjectableDescriptor>(target)?.isInjectable) {
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
 * Writes `{ isInjectable: true, dependencies }` to the target's record (see
 * `InjectableDescriptor`). Any other key of `options` is stored too.
 *
 * @param target The class, or its decorator metadata object
 *   (`context.metadata` with TC39 decorators).
 * @param options The constructor's dependencies, in argument order.
 * @throws {Error} When the target already has a DI decorator. This is checked
 *   first, before the dependencies.
 * @throws {Error} When a dependency is not a class, symbol or injection token.
 *   Nothing is written.
 *
 * @example
 * ```ts
 * set_injectable(Server, { dependencies: [Logger, PORT] });
 * read_metadata_object(Server);
 * // { isInjectable: true, dependencies: [Logger, PORT] }
 * ```
 *
 * @internal
 */
export function set_injectable(
  target: MetaTarget,
  options: InjectableOptions,
): void {
  assert_decorated(target);
  options.dependencies.forEach(
    assert_dependency(
      "all dependencies must be classes, symbols or injection tokens",
    ),
  );

  add_to_metadata_object(
    target,
    {
      ...options,
      isInjectable: true,
      dependencies: options.dependencies,
    } satisfies InjectableDescriptor,
  );
}

/**
 * Add the module fields to a target's record: the second step of `@Module`,
 * after {@link set_injectable}.
 *
 * Writes `isModule: true` and `imports`, `exports`, `providers` and
 * `controllers`, each defaulting to `[]` (see `ModuleDescriptor`), plus every
 * other key of `options`, as is. Those extra keys are metadata for the
 * application module (such as a web route prefix); the DI system ignores
 * them. Values are stored by reference, except top-level arrays, which are
 * copied.
 *
 * It does not write `isInjectable` or `dependencies`, and ignores those keys
 * of `options`: that is `set_injectable`'s job. An option named `isModule`
 * cannot overwrite the flag either.
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
 * // { isInjectable: true, dependencies: [], route: "users", isModule: true,
 * //   imports: [DbModule], exports: [], providers: [UserService],
 * //   controllers: [] }
 * ```
 *
 * @internal
 */
export function set_module(
  target: MetaTarget,
  options: Partial<ModuleOptions>,
): void {
  // `dependencies` and `isInjectable` are written by `set_injectable`.
  // Writing `dependencies` again would append a second copy, since array
  // values are concatenated on merge, and an `isInjectable` option would
  // overwrite the flag.
  const { dependencies: _deps, isInjectable: _flag, ...extra } = options;
  const norm = {
    imports: options.imports ?? [],
    exports: options.exports ?? [],
    providers: options.providers ?? [],
    controllers: options.controllers ?? [],
  };

  norm.imports.forEach(assert_ctr("all imports must be classes"));
  norm.controllers.forEach(assert_ctr("all controllers must be classes"));
  norm.exports.forEach(
    assert_dependency(
      "all exports must be classes, symbols or injection tokens",
    ),
  );
  norm.providers.forEach(assert_provider);

  add_to_metadata_object(
    target,
    {
      // the extra options first: the module keys below always win
      ...extra,
      isModule: true,
      ...norm,
    } satisfies Omit<ModuleDescriptor, keyof InjectableDescriptor>,
  );
}

/**
 * Add the controller fields to a target's record: the second step of
 * `@Controller`, after {@link set_injectable}.
 *
 * Writes `isController: true` and every key of `options` except
 * `dependencies`, as is (see `ControllerDescriptor`). Those extra keys are
 * metadata for the application module that invokes the controller, such as a
 * CLI command's name; the DI system ignores them. Values are stored by
 * reference, except top-level arrays, which are copied.
 *
 * `dependencies` is skipped because `set_injectable` already wrote it: arrays
 * are concatenated on merge, so writing it again would duplicate every
 * dependency.
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
 * // { isInjectable: true, dependencies: [Logger], isController: true,
 * //   name: "cli" }
 * ```
 *
 * @internal
 */
export function set_controller(
  target: MetaTarget,
  options: Partial<ControllerOptions>,
): void {
  // `dependencies` is written by `set_injectable`; spreading it again would
  // append a second copy, since array values are concatenated on merge.
  const { dependencies: _, ...rest } = options;
  add_to_metadata_object(
    target,
    {
      ...rest,
      isController: true,
    },
  );
}

// Decorator call shapes
// -----------------------------------------------------------------------------
//
// Helpers for decorators written for both decorator implementations, such as
// the `@Main`, `@Action` and `@Help` decorators of `@chojs/command`. They find,
// from the decorator's arguments, where its record must be written.

/**
 * A decorated method: where its record is stored, its name, and whether it is
 * static or private.
 */
export type DecoratedMethod = {
  /**
   * The method function. Method records are stored on it, which is where the
   * metadata graph reads them (`read_metadata_object(prototype[name])`).
   */
  fn: MetaTarget;
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
 * @returns The method function, its name, and whether it is static or
 *   private.
 * @throws {TypeError} When the decorated member is not a method (a field, an
 *   accessor, a class).
 *
 * @example
 * ```ts
 * function Command(name: string): ChoMethodDecorator {
 *   return (target, context, descriptor) => {
 *     const method = decorated_method("@Command()", target, context, descriptor);
 *     add_to_metadata_object(method.fn, { command: name });
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
      return {
        fn: target,
        name: context.name,
        static: Boolean(context.static),
        private: Boolean(context.private),
      };
    }
  } else if (typeof descriptor?.value === "function") {
    return {
      fn: descriptor.value,
      name: context,
      static: typeof target === "function",
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
 * - on a class with legacy / Bun decorators (no `context`): the class itself;
 * - on a method: the method function (see {@link decorated_method}).
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
    return context.metadata;
  } else {
    return decorated_method(decorator, target, context, descriptor).fn;
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
 * Writes `middlewares`, an array. Middlewares from several calls are kept
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
 * read_metadata_object(Cli.prototype.run); // { middlewares: [auth, timing] }
 * ```
 */
export function set_middlewares(
  target: MetaTarget,
  middlewares: ChoMiddleware[],
): void {
  if (!Array.isArray(middlewares)) {
    throw new Error(
      `middlewares must be an array, got ${describe_value(middlewares)}`,
    );
  }
  middlewares.forEach(assert_function("all middlewares must be functions"));

  const record = read_metadata_object<Record<string, unknown>>(target) ?? {};
  const existing = (record["middlewares"] ?? []) as readonly ChoMiddleware[];
  write_metadata_object(target, {
    ...record,
    middlewares: [...middlewares, ...existing],
  });
}

/**
 * Set the error handler of a target: what `@Catch` does.
 *
 * Writes `errorHandler`. A target has at most one error handler.
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
  if (
    read_metadata_object<Record<string, unknown>>(target)?.["errorHandler"] !==
      undefined
  ) {
    throw new Error("an error handler is already set (one @Catch per target)");
  }
  add_to_metadata_object(target, { errorHandler });
}
