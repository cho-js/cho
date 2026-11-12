/**
 * Command-line parsing: splits `argv` into the command name, the reserved
 * flags (`--help`, `--version`) and the arguments a command method receives.
 *
 * Flags are not declared, so `parseArgs` decides their types from the command
 * line alone (see `@std/cli`).
 *
 * @module
 */
import { type Args, parseArgs, type ParseOptions } from "./lib/parse-args.ts";

/**
 * Command context: the parsed command line, exactly as `parseArgs` from
 * `@std/cli` returns it (minimist API).
 *
 * Positionals in `_` that look like numbers are numbers (`"42"` -> `42`).
 * In multi-command mode, `_` does not include the command name. The reserved
 * `--help` and `--version` flags are not included either.
 *
 * @example
 * ```ts
 * @Controller()
 * class Files {
 *   // ./fs copy a.txt b.txt --force --mode=644
 *   @Action("copy")
 *   copy(args: ChoArgs) {
 *     args._;     // ["a.txt", "b.txt"]
 *     args.force; // true
 *     args.mode;  // 644
 *   }
 * }
 * ```
 */
export type ChoArgs = Args;

/**
 * Options of `parseArgs` from `@std/cli`, to declare the handlers' flags (for
 * example `boolean: ["force"]`, so `--force copy` does not take `copy` as its
 * value).
 *
 * The reserved flags (`--help`, `--version`) always stay negatable booleans:
 * they are added to `boolean` and `negatable`, and removed from `string`,
 * `collect` and `default`.
 *
 * @example
 * ```ts
 * const options: ParserOptions = {
 *   boolean: ["force"],
 *   string: ["out"],
 *   alias: { f: "force", o: "out" },
 * };
 * const app = ChoCommand.create(App, { parseOptions: options });
 * ```
 */
export type ParserOptions = ParseOptions;

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
   * @param options The parser options.
   * @returns The route, the reserved flags and the arguments.
   */
  parse(argv: string[], options?: ParserOptions): ParsedArgs;
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

/** Whether a flag name is reserved. */
function is_reserved(name: string): boolean {
  return (RESERVED as readonly string[]).includes(name);
}

/** A `parseArgs` list option (a name or a list of names) as a list. */
function to_list(value: string | readonly string[] | undefined): string[] {
  return value === undefined ? [] : typeof value === "string" ? [value] : [
    ...value,
  ];
}

/**
 * The `parseArgs` options: the caller's options, with the reserved flags kept
 * as negatable booleans whatever the caller declares.
 *
 * @param options The caller's options.
 * @returns The options to parse with.
 */
function parse_options(options: ParserOptions = {}): ParserOptions {
  const { boolean, negatable, string, collect, default: defaults, ...rest } =
    options;
  const merged: ParserOptions = {
    ...rest,
    // `boolean: true` makes every flag without a value a boolean, the reserved
    // ones included
    boolean: boolean === true
      ? true
      : [...RESERVED, ...to_list(boolean === false ? undefined : boolean)],
    negatable: [...RESERVED, ...to_list(negatable)],
    string: to_list(string).filter((name) => !is_reserved(name)),
    collect: to_list(collect).filter((name) => !is_reserved(name)),
  };
  if (defaults !== undefined) {
    merged.default = Object.fromEntries(
      Object.entries(defaults).filter(([name]) => !is_reserved(name)),
    );
  }
  return merged;
}

/**
 * Parse a command line, separating the reserved flags from the handler's
 * arguments.
 *
 * @param argv The command-line arguments.
 * @param options The parser options.
 * @returns The arguments and the reserved flags; no route yet.
 */
function parse(
  argv: string[],
  options?: ParserOptions,
): Omit<ParsedArgs, "route"> {
  const { help, version, ...args } = parseArgs(argv, parse_options(options));
  return { args, help: help === true, version: version === true };
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
   * @param options The parser options.
   * @returns The parsed command line.
   */
  parse(argv: string[], options?: ParserOptions): ParsedArgs {
    return { ...parse(argv, options), route: "main" };
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
   * @param options The parser options.
   * @returns The parsed command line.
   */
  parse(argv: string[], options?: ParserOptions): ParsedArgs {
    const { args, help, version } = parse(argv, options);
    const [first, ...rest] = args._;
    // `parseArgs` turns a numeric command name into a number; action names
    // are strings.
    const route = first === undefined ? "" : String(first);
    return { args: { ...args, _: rest }, route, help, version };
  }
}
