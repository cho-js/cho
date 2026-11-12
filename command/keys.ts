/**
 * The keys of the records the command decorators write. Private to
 * `@chojs/command`: not exported by the package.
 *
 * Like core's keys, they are symbols, so they never collide with user options
 * or with other CHO modules' keys, and they are `Symbol.for` keys, so two
 * copies of the package read each other's records.
 *
 * @module
 */

import type { CommandFlags } from "./args.ts";

/** Marks a method as the `@Main` command. */
export const MAIN: unique symbol = Symbol.for("chojs.command.isMain");
/** Marks a method as an `@Action` command. */
export const ACTION: unique symbol = Symbol.for("chojs.command.isAction");
/** The name a command is invoked by: the action name, or `"main"`. */
export const ALIAS: unique symbol = Symbol.for("chojs.command.alias");
/** The flags a command declares (`@Main(flags)`, `@Action(name, flags)`). */
export const FLAGS: unique symbol = Symbol.for("chojs.command.flags");
/** The `@Help` text of a controller or a method. */
export const HELP: unique symbol = Symbol.for("chojs.command.help");

/**
 * What the command decorators write on a method (`@Main`, `@Action`,
 * `@Help`) or on a controller class (`@Help`). Every key is optional: a
 * record can hold any of them, next to other CHO modules' keys.
 */
export type CommandRecord = {
  /** Set by `@Main`. */
  readonly [MAIN]?: true;
  /** Set by `@Action`. */
  readonly [ACTION]?: true;
  /** Set by `@Main` (`"main"`) and `@Action` (the action name). */
  readonly [ALIAS]?: string;
  /** Set by `@Main` and `@Action`, when they declare flags. */
  readonly [FLAGS]?: CommandFlags;
  /** Set by `@Help`. */
  readonly [HELP]?: string;
};

/**
 * Read a record as a command record.
 *
 * @param record A method's or a controller's metadata, as the core's
 *   metadata graph passes it on.
 * @returns The same record, typed: the command keys it may hold.
 */
export function command_record(record: object): CommandRecord {
  return record as CommandRecord;
}
