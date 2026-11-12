/**
 * The help text of a command-line application, built from its `@Help` records.
 *
 * - `@Help` on a controller class is in the controller node's metadata
 *   (`node.meta.options[HELP]`);
 * - `@Help` on a command method is in the method's metadata
 *   (`method.meta[HELP]`).
 *
 * Help texts can span several lines. Where only one line fits (the list of
 * commands, a group heading), the first non-empty line is used.
 *
 * @module
 */

import type { MethodMetadata } from "@chojs/core/di";
import type { CommandGraph, ControllerNode } from "./graph.ts";
import { ALIAS, command_record, HELP } from "./keys.ts";

/** The heading of the commands whose controller has no `@Help`. */
const DEFAULT_GROUP = "Commands";

/** The reserved flags (see `args.ts`), as listed in every help text. */
const OPTIONS: [string, string][] = [
  ["--help", "Show this help"],
  ["--version", "Show the version"],
];

/** The `@Help` text of a record, trimmed, or `undefined` when it has none. */
function help_of(meta: object): string | undefined {
  const help = command_record(meta)[HELP];
  return typeof help === "string" && help.trim() ? help.trim() : undefined;
}

/** The first line of a (trimmed, non-empty) help text. */
function summary(help: string): string {
  const [first = ""] = help.split("\n");
  return first.trim();
}

/**
 * Two-column rows, indented, with the second column aligned. A row with no
 * description is the name alone.
 */
function rows(entries: [string, string | undefined][]): string[] {
  const width = Math.max(...entries.map(([name]) => name.length));
  return entries.map(([name, text]) =>
    text ? `  ${name.padEnd(width)}  ${text}` : `  ${name}`
  );
}

/** The `Options:` section. */
function options_section(): string {
  return ["Options:", ...rows(OPTIONS)].join("\n");
}

/** Join the non-empty sections with a blank line. */
function sections(...parts: (string | undefined)[]): string {
  return parts.filter((p) => p).join("\n\n");
}

/**
 * The help of a single-command application: the controller's `@Help`, then the
 * `@Main` method's.
 */
function main_help(
  name: string,
  [node, method]: [ControllerNode, MethodMetadata],
): string {
  return sections(
    `Usage: ${name} [options] [args]`,
    help_of(node.meta.options),
    help_of(method.meta),
    options_section(),
  );
}

/** The help of one command of a multi-command application: its `@Help`. */
function action_help(
  name: string,
  [, method]: [ControllerNode, MethodMetadata],
): string {
  return sections(
    `Usage: ${name} ${command_record(method.meta)[ALIAS]} [options] [args]`,
    help_of(method.meta),
    options_section(),
  );
}

/**
 * The global help of a multi-command application: the commands, grouped under
 * their controller's `@Help` (its first line). The commands of controllers
 * without `@Help` are grouped under "Commands". Groups and commands keep the
 * graph order; controllers with the same heading share a group.
 */
function global_help(name: string, graph: CommandGraph): string {
  const groups = new Map<string, [string, string | undefined][]>();
  for (const [node, method] of graph.actions) {
    const help = help_of(node.meta.options);
    const heading = help ? summary(help) : DEFAULT_GROUP;
    const methodHelp = help_of(method.meta);
    const group = groups.get(heading) ?? [];
    group.push([
      String(command_record(method.meta)[ALIAS]),
      methodHelp && summary(methodHelp),
    ]);
    groups.set(heading, group);
  }

  return sections(
    `Usage: ${name} <command> [options] [args]`,
    ...[...groups].map(([heading, commands]) =>
      [`${heading}:`, ...rows(commands)].join("\n")
    ),
    options_section(),
    `Run '${name} <command> --help' for help on a command.`,
  );
}

/**
 * Build the help text of an application.
 *
 * - Single-command mode: the help of the `@Main` command, whatever the route.
 * - Multi-command mode: the help of the command named `route`; the global help
 *   when `route` is empty or names no command.
 *
 * @param graph The command graph of the application.
 * @param name The application name, shown in the usage lines.
 * @param route The parsed command name (`""` when there is none).
 * @returns The help text, without a trailing newline.
 */
export function format_help(
  graph: CommandGraph,
  name: string,
  route: string,
): string {
  const [main] = graph.actions;
  if (graph.mode === "main" && main) {
    return main_help(name, main);
  }
  const action = route
    ? graph.actions.find(([, { meta }]) =>
      command_record(meta)[ALIAS] === route
    )
    : undefined;
  return action ? action_help(name, action) : global_help(name, graph);
}
