/**
 * Command-line parsing: splits `argv` into the command name, the reserved
 * flags (`--help`, `--version`) and the arguments a command method receives.
 *
 * Flags are not declared, so `parseArgs` decides their types from the command
 * line alone (see `@std/cli`).
 *
 * @module
 */

import { type Args, parseArgs } from "@std/cli/parse-args";

/**
 * Command context: the parsed command line, exactly as `parseArgs` from
 * `@std/cli` returns it (minimist API).
 *
 * Positionals in `_` that look like numbers are numbers (`"42"` -> `42`).
 * In multi-command mode, `_` does not include the command name. The reserved
 * `--help` and `--version` flags are not included either.
 */
export type ChoArgs = Args;

/** A parsed command line. */
export type ParsedArgs = {
  /** What the handler receives. */
  args: ChoArgs;
  /** The command to run: `"main"` in single-command mode. */
  route: string;
  /** Whether `--help` was given. */
  help: boolean;
  /** Whether `--version` was given. */
  version: boolean;
};

/** The command-line parser of one mode. */
export interface ChoArgsParser {
  /**
   * Parse a command line.
   *
   * @param argv The command-line arguments, without the program name.
   * @returns The route, the reserved flags and the arguments.
   */
  parse(argv: string[]): ParsedArgs;
}

/**
 * The flags the application reserves for itself. Only long flags are
 * reserved, so handlers keep every short flag (`-h`, `-v`, ...).
 *
 * They are parsed as negatable booleans, so they never consume the next token
 * (`--help copy` is help for `copy`), and `--help=false` and `--no-help` turn
 * them off.
 */
const RESERVED = ["help", "version"] as const;

/**
 * Parse a command line, separating the reserved flags from the handler's
 * arguments.
 *
 * @param argv The command-line arguments.
 * @returns The arguments and the reserved flags; no route yet.
 */
function parse(argv: string[]): Omit<ParsedArgs, "route"> {
  const { help, version, ...args } = parseArgs(argv, {
    boolean: RESERVED,
    negatable: RESERVED,
  });
  return { args, help, version };
}

/**
 * The parser of single-command mode: the route is always `"main"`, and every
 * positional argument stays in `_`.
 */
export class ChoMainParser implements ChoArgsParser {
  /**
   * Parse a command line, routed to `"main"`.
   *
   * @param argv The command-line arguments, without the program name.
   * @returns The parsed command line.
   */
  parse(argv: string[]): ParsedArgs {
    return { ...parse(argv), route: "main" };
  }
}

/**
 * The parser of multi-command mode: the first positional argument is the route
 * (as a string; `""` when there is none) and is removed from `_`.
 *
 * Flags before the command name are parsed like any other: a flag that is not
 * reserved takes the next word as its value, the command name included
 * (`-v ls` gives `v: "ls"` and no route).
 */
export class ChoActionsParser implements ChoArgsParser {
  /**
   * Parse a command line, routed to its first positional argument.
   *
   * @param argv The command-line arguments, without the program name.
   * @returns The parsed command line.
   */
  parse(argv: string[]): ParsedArgs {
    const { args, help, version } = parse(argv);
    const [first, ...rest] = args._;
    // `parseArgs` turns a numeric command name into a number; action names
    // are strings.
    const route = first === undefined ? "" : String(first);
    return { args: { ...args, _: rest }, route, help, version };
  }
}
