/**
 * The command decorators: `@Main` and `@Action` mark the command methods of a
 * controller, `@Help` adds help text to a controller or a method.
 *
 * They validate their input when the class is defined and write a record on
 * the decorated method (or class), which the command graph reads.
 *
 * @module
 */

import {
  add_to_metadata_object,
  type ChoClassOrMethodDecorator,
  type ChoMethodDecorator,
  decorated_method,
  decorated_target,
  type DecoratedMethod,
  read_metadata_object,
} from "@chojs/core/di";

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
  const prev = read_metadata_object<Record<string, unknown>>(method.fn);
  if (prev?.isMain || prev?.isAction) {
    const existing = prev.isMain ? "@Main()" : `@Action("${prev.alias}")`;
    throw new Error(
      `Cannot add ${adding} to method '${
        String(method.name)
      }': it already has ${existing}. A method can have at most one @Main or @Action.`,
    );
  }
}

/**
 * Mark a method as the single command of the application.
 *
 * @returns A method decorator.
 * @throws {TypeError} When the decorated method is not public, non-static and
 *   string-named.
 */
export function Main(): ChoMethodDecorator {
  return function (target, context, descriptor) {
    const method = decorated_method("@Main()", target, context, descriptor);
    assert_command_method(method, "@Main()");
    assert_no_command(method, "@Main()");
    add_to_metadata_object(method.fn, {
      isMain: true,
      name: method.name,
      alias: "main",
    });
  };
}

/**
 * Mark a method as the command `alias` of a multi-command application.
 *
 * @param alias The command name: non-empty, no whitespace, not starting with
 *   `-`.
 * @returns A method decorator.
 * @throws {TypeError} When the name breaks these rules, or when the decorated
 *   method is not public, non-static and string-named.
 */
export function Action(alias: string): ChoMethodDecorator {
  return function (target, context, descriptor) {
    assert_action_name(alias);
    const adding = `@Action(${JSON.stringify(alias)})`;
    const method = decorated_method(adding, target, context, descriptor);
    assert_command_method(method, adding);
    assert_no_command(method, adding);
    add_to_metadata_object(method.fn, {
      isAction: true,
      name: method.name,
      alias,
    });
  };
}

/**
 * Help text for a controller class or for a command method.
 *
 * @param help The help text.
 * @returns A class or method decorator.
 */
export function Help(help: string): ChoClassOrMethodDecorator {
  return function (target, context, descriptor) {
    assert_non_empty_string(help, "Help");
    const meta = decorated_target("@Help()", target, context, descriptor);
    add_to_metadata_object(meta, { help });
  };
}
