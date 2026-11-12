/**
 * The command graph: the command methods of an application and its mode,
 * read from the controllers of the injector.
 *
 * @module
 */

import type {
  ControllerMetadata,
  DependencyNode,
  Injector,
  MethodMetadata,
} from "@chojs/core/di";
import { describe } from "@chojs/core/utils";
import { ACTION, ALIAS, command_record, MAIN } from "./keys.ts";

/** A controller of the injector: its class, module and method metadata. */
export type ControllerNode = DependencyNode<ControllerMetadata>;

/** The command methods of an application, and the mode they define. */
export type CommandGraph = {
  /**
   * `"main"`: a single-command application (one `@Main` method);
   * `"actions"`: a multi-command application (`@Action` methods).
   */
  mode: "main" | "actions";
  /**
   * The command methods with their controller node, in scan order: the
   * `@Main` method in `"main"` mode, the `@Action` methods otherwise.
   */
  actions: [ControllerNode, MethodMetadata][];
};

/**
 * Build the command graph of an injector.
 *
 * Every controller of the injector is scanned (modules in post-order,
 * controllers and methods in declaration order); methods without a `@Main` or
 * `@Action` record are ignored.
 *
 * - exactly one `@Main` and no `@Action`: single-command mode;
 * - one or more `@Action` and no `@Main`: multi-command mode.
 *
 * @param inj The application's injector.
 * @returns The mode and the command methods.
 * @throws {Error} When there is no command method, when `@Main` and `@Action`
 *   are mixed, when there is more than one `@Main`, or when two `@Action`s
 *   share a name (anywhere in the module graph).
 */
export function command_graph(inj: Injector): CommandGraph {
  const mainMethods: [ControllerNode, MethodMetadata][] = [];
  const actionMethods: [ControllerNode, MethodMetadata][] = [];
  // action name -> where it was first declared, to reject duplicates
  const actionsByName = new Map<unknown, [ControllerNode, MethodMetadata]>();
  for (const c of inj.controllers()) {
    for (const m of c.meta.methods) {
      const record = command_record(m.meta);
      if (record[MAIN]) {
        mainMethods.push([c, m]);
      } else if (record[ACTION]) {
        const prev = actionsByName.get(record[ALIAS]);
        if (prev) {
          throw new Error(
            `Duplicate @Action("${record[ALIAS]}"): declared on ${
              describe(prev[0].token)
            }.${prev[1].name} and ${describe(c.token)}.${m.name}`,
          );
        }
        actionsByName.set(record[ALIAS], [c, m]);
        actionMethods.push([c, m]);
      }
    }
  }

  const ml = mainMethods.length;
  const al = actionMethods.length;

  if (ml === 0 && al === 0) {
    throw new Error("No @Main or @Action methods found in the application");
  }

  if (ml > 0 && al > 0) {
    throw new Error(
      "Mixing @Main and @Action methods in the same application is not allowed",
    );
  }

  if (ml > 1) {
    throw new Error(
      "Multiple @Main methods in the same application is not allowed",
    );
  }

  return (ml === 1
    ? { mode: "main", actions: mainMethods }
    : { mode: "actions", actions: actionMethods });
}
